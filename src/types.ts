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

export interface Dashboard {
  title: string;
  url: string;
  folderTitle: string;
  folderUrl: string;
  tags: string[];
}

export interface Alert {
  name: string;
  state: string;
  url: string;
}

export interface TimeRange {
  from: string;
  to: string;
}

export interface MetricDataPoint {
  timestamp: number;
  value: number;
}

export interface TimeSeries {
  target: string;
  datapoints: MetricDataPoint[];
}

export interface MetricsQueryResponse {
  status: string;
  data: {
    resultType: string;
    result: Array<{
      metric: Record<string, string>;
      values: Array<[number, string]>;
    }>;
  };
}

export interface DashboardPanel {
  id: number;
  title: string;
  type: string;
  targets: PanelTarget[];
}

export interface PanelTarget {
  expr: string;
  datasource: any;
}

export interface DashboardDetail extends Dashboard {
  uid: string;
  panels: DashboardPanel[];
}

export interface SLO {
  uuid: string;
  name: string;
  description: string;
  query: {
    type: string;
  };
  objectives: Array<{
    value: number;
    window: string;
  }>;
  status?: {
    current: number;
    remaining_error_budget: number;
  };
  labels?: Record<string, string>;
}

export interface AlertDetail extends Alert {
  severity?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  firing_since?: string;
}
