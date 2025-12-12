/*
 * Copyright 2021 Kévin Gomez <contact@kevingomez.fr>
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { createApiRef, DiscoveryApi, IdentityApi } from '@backstage/core-plugin-api';
import { QueryEvaluator } from './query';
import { Alert, AlertDetail, Dashboard, DashboardDetail, SLO, TimeSeries, TimeRange, MetricsQueryResponse } from './types';

export interface GrafanaApi {
  listDashboards(query: string): Promise<Dashboard[]>;
  alertsForSelector(selector: string): Promise<Alert[]>;
  getDashboardByUid(uid: string): Promise<DashboardDetail>;
  queryMetrics(query: string, timeRange: TimeRange, step?: string): Promise<TimeSeries[]>;
  getSLOs(labelSelector?: string, timeRange?: string): Promise<SLO[]>;
  getAlertDetails(selector: string): Promise<AlertDetail[]>;
}

interface AlertRuleGroupConfig {
  name: string;
  rules: AlertRule[];
}

interface GrafanaAlert {
  id: number;
  panelId: number;
  name: string;
  state: string;
  url: string;
}

interface UnifiedGrafanaAlert {
  uid: string;
  title: string;
}

interface AlertRule {
  labels: Record<string, string>;
  annotations?: Record<string, string>;
  grafana_alert: UnifiedGrafanaAlert;
}

export const grafanaApiRef = createApiRef<GrafanaApi>({
  id: 'plugin.grafana.service',
});

export type Options = {
  discoveryApi: DiscoveryApi;
  identityApi: IdentityApi;

  /**
   * Domain used by users to access Grafana web UI.
   * Example: https://monitoring.my-company.com/
   */
  domain: string;

  /**
   * Path to use for requests via the proxy, defaults to /grafana/api
   */
  proxyPath?: string;
};

const DEFAULT_PROXY_PATH = '/grafana/api';

const isSingleWord = (input: string): boolean => {
  return input.match(/^[\w-]+$/g) !== null;
}

class Client {
  private readonly discoveryApi: DiscoveryApi;
  private readonly identityApi: IdentityApi;
  private readonly proxyPath: string;
  private readonly queryEvaluator: QueryEvaluator;

  constructor(opts: Options) {
    this.discoveryApi = opts.discoveryApi;
    this.identityApi = opts.identityApi;
    this.proxyPath = opts.proxyPath ?? DEFAULT_PROXY_PATH;
    this.queryEvaluator = new QueryEvaluator();
  }

  public async fetch<T = any>(input: string, init?: RequestInit): Promise<T> {
    const apiUrl = await this.apiUrl();
    const authedInit = await this.addAuthHeaders(init || {});

    const resp = await fetch(`${apiUrl}${input}`, authedInit);
    if (!resp.ok) {
      throw new Error(`Request failed with ${resp.status} ${resp.statusText}`);
    }

    return await resp.json();
  }

  async listDashboards(domain: string, query: string): Promise<Dashboard[]> {
    if (isSingleWord(query)) {
      return this.dashboardsByTag(domain, query);
    }

    return this.dashboardsForQuery(domain, query);
  }

  async dashboardsForQuery(domain: string, query: string): Promise<Dashboard[]> {
    const parsedQuery = this.queryEvaluator.parse(query);
    const response = await this.fetch<Dashboard[]>(`/api/search?type=dash-db`);
    const allDashboards = this.fullyQualifiedDashboardURLs(domain, response);

    return allDashboards.filter((dashboard) => {
      return this.queryEvaluator.evaluate(parsedQuery, dashboard) === true;
    });
  }

  async dashboardsByTag(domain: string, tag: string): Promise<Dashboard[]> {
    const response = await this.fetch<Dashboard[]>(`/api/search?type=dash-db&tag=${tag}`);

    return this.fullyQualifiedDashboardURLs(domain, response);
  }

  async getDashboardByUid(domain: string, uid: string): Promise<DashboardDetail> {
    const response = await this.fetch<{ dashboard: any }>(`/api/dashboards/uid/${uid}`);
    const dashboard = response.dashboard;

    return {
      title: dashboard.title,
      url: `${domain}/d/${uid}`,
      folderTitle: dashboard.meta?.folderTitle || '',
      folderUrl: `${domain}${dashboard.meta?.folderUrl || ''}`,
      tags: dashboard.tags || [],
      uid: dashboard.uid,
      panels: dashboard.panels || [],
    };
  }

  async queryMetrics(query: string, timeRange: TimeRange, step: string = '15s'): Promise<TimeSeries[]> {
    const datasourceUid = await this.getDefaultPrometheusUid();
    const now = Math.floor(Date.now() / 1000);
    const from = this.parseTimeRange(timeRange.from, now);
    const to = this.parseTimeRange(timeRange.to, now);

    const params = new URLSearchParams({
      query,
      start: from.toString(),
      end: to.toString(),
      step,
    });

    const response = await this.fetch<MetricsQueryResponse>(
      `/api/datasources/proxy/uid/${datasourceUid}/api/v1/query_range?${params}`
    );

    if (response.status !== 'success' || !response.data.result) {
      return [];
    }

    return response.data.result.map(result => ({
      target: result.metric.__name__ || JSON.stringify(result.metric),
      datapoints: result.values.map(([timestamp, value]) => ({
        timestamp: timestamp * 1000,
        value: parseFloat(value),
      })),
    }));
  }

  async getSLOs(labelSelector?: string, timeRange?: string): Promise<SLO[]> {
    try {
      let url = '/api/plugins/grafana-slo-app/resources/v1/slo?includeStatus=true';
      if (labelSelector) {
        url += `&labelSelector=${encodeURIComponent(labelSelector)}`;
      }

      const response = await this.fetch<any>(url);
      let slos: SLO[] = [];

      if (Array.isArray(response)) {
        slos = response;
      } else if (response && Array.isArray(response.slos)) {
        slos = response.slos;
      } else if (response && Array.isArray(response.data)) {
        slos = response.data;
      }

      if (labelSelector && slos.length > 0) {
        const [key, value] = labelSelector.split('=');
        if (key && value) {
          slos = slos.filter(slo =>
            slo.labels &&
            Array.isArray(slo.labels) &&
            slo.labels.some(label => label.key === key && label.value === value)
          );
        }
      }

      const slosWithStatus = await Promise.all(
        slos.map(async (slo) => {
          try {
            const datasourceUid = await this.getDefaultPrometheusUid();
            const now = Math.floor(Date.now() / 1000);

            let lookback = '5m';
            if (timeRange) {
              const match = timeRange.match(/now-(.+)/);
              if (match) {
                lookback = match[1];
              } else {
                lookback = timeRange;
              }
            }

            const from = this.parseTimeRange(timeRange || 'now-1h', now);
            const to = now;

            const sliQuery = `clamp_max(sum(sum_over_time((grafana_slo_success_rate_5m{grafana_slo_uuid="${slo.uuid}"} < +Inf)[${lookback}:5m])) / sum(sum_over_time((grafana_slo_total_rate_5m{grafana_slo_uuid="${slo.uuid}"} < +Inf)[${lookback}:5m])), 1)`;
            const errorBudgetQuery = `(clamp_max(sum(sum_over_time((grafana_slo_success_rate_5m{grafana_slo_uuid="${slo.uuid}"} < +Inf)[28d:5m])) / sum(sum_over_time((grafana_slo_total_rate_5m{grafana_slo_uuid="${slo.uuid}"} < +Inf)[28d:5m])), 1) - on() grafana_slo_objective{grafana_slo_uuid="${slo.uuid}"}) / on () (1 - grafana_slo_objective{grafana_slo_uuid="${slo.uuid}"})`;
            const totalEventsQuery = `300 * sum(sum_over_time((grafana_slo_total_rate_5m{grafana_slo_uuid="${slo.uuid}"} < +Inf)[${lookback}:5m]))`;
            const failureEventsQuery = `clamp_min(300 * (sum(sum_over_time((grafana_slo_total_rate_5m{grafana_slo_uuid="${slo.uuid}"} < +Inf)[${lookback}:5m])) - sum(sum_over_time((grafana_slo_success_rate_5m{grafana_slo_uuid="${slo.uuid}"} < +Inf)[${lookback}:5m]))), 0)`;
            const sliTimeSeriesQuery = `clamp_max(sum(avg_over_time((grafana_slo_success_rate_5m{grafana_slo_uuid="${slo.uuid}"} < +Inf)[1m:])) / sum(avg_over_time((grafana_slo_total_rate_5m{grafana_slo_uuid="${slo.uuid}"} < +Inf)[1m:])), 1)`;

            const [sliResponse, budgetResponse, totalEventsResponse, failureEventsResponse, sliTimeSeriesResponse] = await Promise.all([
              this.fetch<MetricsQueryResponse>(
                `/api/datasources/proxy/uid/${datasourceUid}/api/v1/query?query=${encodeURIComponent(sliQuery)}&time=${now}`
              ).catch(() => null),
              this.fetch<MetricsQueryResponse>(
                `/api/datasources/proxy/uid/${datasourceUid}/api/v1/query?query=${encodeURIComponent(errorBudgetQuery)}&time=${now}`
              ).catch(() => null),
              this.fetch<MetricsQueryResponse>(
                `/api/datasources/proxy/uid/${datasourceUid}/api/v1/query?query=${encodeURIComponent(totalEventsQuery)}&time=${now}`
              ).catch(() => null),
              this.fetch<MetricsQueryResponse>(
                `/api/datasources/proxy/uid/${datasourceUid}/api/v1/query?query=${encodeURIComponent(failureEventsQuery)}&time=${now}`
              ).catch(() => null),
              this.fetch<MetricsQueryResponse>(
                `/api/datasources/proxy/uid/${datasourceUid}/api/v1/query_range?query=${encodeURIComponent(sliTimeSeriesQuery)}&start=${from}&end=${to}&step=60`
              ).catch(() => null),
            ]);

            let current: number | undefined;
            let remainingBudget: number | undefined;
            let totalEvents: number | undefined;
            let failureEvents: number | undefined;
            let sliTimeSeries: TimeSeries[] = [];
            const isRatioQuery = slo.query.type === 'ratio';

            if (sliResponse && sliResponse.status === 'success' && sliResponse.data.result.length > 0) {
              const value = sliResponse.data.result[0].value;
              if (value && value.length > 1) {
                current = parseFloat(value[1]);
              }
            } else if (!isRatioQuery) {
              const fallbackSliQuery = `avg_over_time(grafana_slo_sli_1d{grafana_slo_uuid="${slo.uuid}"}[${lookback}])`;
              const fallbackResponse = await this.fetch<MetricsQueryResponse>(
                `/api/datasources/proxy/uid/${datasourceUid}/api/v1/query?query=${encodeURIComponent(fallbackSliQuery)}&time=${now}`
              ).catch(() => null);

              if (fallbackResponse && fallbackResponse.status === 'success' && fallbackResponse.data.result.length > 0) {
                const value = fallbackResponse.data.result[0].value;
                if (value && value.length > 1) {
                  current = parseFloat(value[1]);
                }
              }
            }

            if (budgetResponse && budgetResponse.status === 'success' && budgetResponse.data.result.length > 0) {
              const value = budgetResponse.data.result[0].value;
              if (value && value.length > 1) {
                const rawValue = parseFloat(value[1]);
                remainingBudget = rawValue > 1 ? rawValue : rawValue * 100;
              }
            }

            if (totalEventsResponse && totalEventsResponse.status === 'success' && totalEventsResponse.data.result.length > 0) {
              const value = totalEventsResponse.data.result[0].value;
              if (value && value.length > 1) {
                totalEvents = parseFloat(value[1]);
              }
            }

            if (failureEventsResponse && failureEventsResponse.status === 'success' && failureEventsResponse.data.result.length > 0) {
              const value = failureEventsResponse.data.result[0].value;
              if (value && value.length > 1) {
                failureEvents = parseFloat(value[1]);
              }
            }

            if (sliTimeSeriesResponse && sliTimeSeriesResponse.status === 'success' && sliTimeSeriesResponse.data.result.length > 0) {
              sliTimeSeries = sliTimeSeriesResponse.data.result.map(result => ({
                target: 'SLI',
                datapoints: result.values.map(([timestamp, value]) => ({
                  timestamp: timestamp * 1000,
                  value: parseFloat(value),
                })),
              }));
            } else if (!isRatioQuery) {
              const fallbackTimeSeriesQuery = `grafana_slo_sli_1d{grafana_slo_uuid="${slo.uuid}"}`;
              const fallbackTimeSeriesResponse = await this.fetch<MetricsQueryResponse>(
                `/api/datasources/proxy/uid/${datasourceUid}/api/v1/query_range?query=${encodeURIComponent(fallbackTimeSeriesQuery)}&start=${from}&end=${to}&step=60`
              ).catch(() => null);

              if (fallbackTimeSeriesResponse && fallbackTimeSeriesResponse.status === 'success' && fallbackTimeSeriesResponse.data.result.length > 0) {
                sliTimeSeries = fallbackTimeSeriesResponse.data.result.map(result => ({
                  target: 'SLI',
                  datapoints: result.values.map(([timestamp, value]) => ({
                    timestamp: timestamp * 1000,
                    value: parseFloat(value),
                  })),
                }));
              }
            }

            const status = current !== undefined ? {
              current,
              remaining_error_budget: remainingBudget !== undefined ? remainingBudget : 0,
              total_events: totalEvents,
              failure_events: failureEvents,
            } : undefined;

            return {
              ...slo,
              status,
              sliTimeSeries: sliTimeSeries.length > 0 ? sliTimeSeries : undefined,
            };
          } catch (error) {
            return slo;
          }
        })
      );

      return slosWithStatus;
    } catch (error) {
      return [];
    }
  }

  private async getDefaultPrometheusUid(): Promise<string> {
    try {
      const datasources = await this.fetch<any[]>('/api/datasources');

      // 1. Check for default Prometheus datasource
      const defaultPromDs = datasources.find(ds => ds.type === 'prometheus' && ds.isDefault);
      if (defaultPromDs) {
        return defaultPromDs.uid;
      }

      // 2. Prefer Grafana Cloud Prometheus datasource (grafanacloud-*-prom or grafanacloud-*-metrics)
      const grafanaCloudPromDs = datasources.find(ds =>
        ds.type === 'prometheus' &&
        (ds.name.match(/grafanacloud-.*-prom$/) || ds.name.match(/grafanacloud-.*-metrics$/))
      );
      if (grafanaCloudPromDs) {
        return grafanaCloudPromDs.uid;
      }

      // 3. Fall back to any Prometheus datasource
      const anyPromDs = datasources.find(ds => ds.type === 'prometheus');
      if (anyPromDs) {
        return anyPromDs.uid;
      }

      throw new Error('No Prometheus datasource found');
    } catch (error) {
      throw new Error(`Failed to find Prometheus datasource: ${error}`);
    }
  }

  private parseTimeRange(timeStr: string, now: number): number {
    if (timeStr === 'now') {
      return now;
    }

    const match = timeStr.match(/^now-(\d+)([smhd])$/);
    if (!match) {
      return now;
    }

    const value = parseInt(match[1], 10);
    const unit = match[2];

    const seconds: Record<string, number> = {
      s: 1,
      m: 60,
      h: 3600,
      d: 86400,
    };

    return now - (value * seconds[unit]);
  }

  private fullyQualifiedDashboardURLs(domain: string, dashboards: Dashboard[]): Dashboard[] {
    return dashboards.map(dashboard => ({
      ...dashboard,
      url: domain + dashboard.url,
      folderUrl: domain + dashboard.folderUrl,
    }));
  }

  private async apiUrl() {
    const proxyUrl = await this.discoveryApi.getBaseUrl('proxy');
    return proxyUrl + this.proxyPath;
  }

  private async addAuthHeaders(init: RequestInit): Promise<RequestInit> {
    const { token } = await this.identityApi.getCredentials();
    const headers = init.headers || {};

    return {
      ...init,
      headers: {
        ...headers,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      }
    };
  }
}

export class GrafanaApiClient implements GrafanaApi {
  private readonly domain: string;
  private readonly client: Client;

  constructor(opts: Options) {
    this.domain = opts.domain;
    this.client = new Client(opts);
  }

  async listDashboards(query: string): Promise<Dashboard[]> {
    return this.client.listDashboards(this.domain, query);
  }

  async alertsForSelector(dashboardTag: string): Promise<Alert[]> {
    const response = await this.client.fetch<GrafanaAlert[]>(`/api/alerts?dashboardTag=${dashboardTag}`);

    return response.map(alert => (
      {
        name: alert.name,
        state: alert.state,
        url: `${this.domain}${alert.url}?panelId=${alert.panelId}&fullscreen&refresh=30s`,
      }
    ));
  }

  async getDashboardByUid(uid: string): Promise<DashboardDetail> {
    return this.client.getDashboardByUid(this.domain, uid);
  }

  async queryMetrics(query: string, timeRange: TimeRange, step?: string): Promise<TimeSeries[]> {
    return this.client.queryMetrics(query, timeRange, step);
  }

  async getSLOs(labelSelector?: string, timeRange?: string): Promise<SLO[]> {
    return this.client.getSLOs(labelSelector, timeRange);
  }

  async getAlertDetails(dashboardTag: string): Promise<AlertDetail[]> {
    const response = await this.client.fetch<GrafanaAlert[]>(`/api/alerts?dashboardTag=${dashboardTag}`);

    return response.map(alert => ({
      name: alert.name,
      state: alert.state,
      url: `${this.domain}${alert.url}?panelId=${alert.panelId}&fullscreen&refresh=30s`,
      severity: 'unknown',
      labels: {},
      annotations: {},
    }));
  }
}

export class UnifiedAlertingGrafanaApiClient implements GrafanaApi {
  private readonly domain: string;
  private readonly client: Client;

  constructor(opts: Options) {
    this.domain = opts.domain;
    this.client = new Client(opts);
  }

  async listDashboards(query: string): Promise<Dashboard[]> {
    return this.client.listDashboards(this.domain, query);
  }

  async alertsForSelector(selector: string): Promise<Alert[]> {
    const response = await this.client.fetch<Record<string, AlertRuleGroupConfig[]>>('/api/ruler/grafana/api/v1/rules');
    const rules = Object.values(response).flat().map(ruleGroup => ruleGroup.rules).flat();
    const [label, labelValue] = selector.split('=');

    const matchingRules = rules.filter(rule => rule.labels && rule.labels[label] === labelValue);

    return matchingRules.map(rule => {
      return {
        name: rule.grafana_alert.title,
        url: `${this.domain}/alerting/grafana/${rule.grafana_alert.uid}/view`,
        state: "n/a",
      };
    })
  }

  async getDashboardByUid(uid: string): Promise<DashboardDetail> {
    return this.client.getDashboardByUid(this.domain, uid);
  }

  async queryMetrics(query: string, timeRange: TimeRange, step?: string): Promise<TimeSeries[]> {
    return this.client.queryMetrics(query, timeRange, step);
  }

  async getSLOs(labelSelector?: string, timeRange?: string): Promise<SLO[]> {
    return this.client.getSLOs(labelSelector, timeRange);
  }

  async getAlertDetails(selector: string): Promise<AlertDetail[]> {
    const response = await this.client.fetch<Record<string, AlertRuleGroupConfig[]>>('/api/ruler/grafana/api/v1/rules');
    const rules = Object.values(response).flat().map(ruleGroup => ruleGroup.rules).flat();

    const selectors = selector.split(',').map(s => {
      const [key, value] = s.trim().split('=');
      return { key, value };
    });

    const matchingRules = rules.filter(rule => {
      if (!rule.labels) return false;
      return selectors.every(({ key, value }) => rule.labels[key] === value);
    });

    return matchingRules.map(rule => ({
      name: rule.grafana_alert.title,
      url: `${this.domain}/alerting/grafana/${rule.grafana_alert.uid}/view`,
      state: "n/a",
      severity: rule.labels?.severity || 'unknown',
      labels: rule.labels || {},
      annotations: rule.annotations || {},
    }));
  }
}
