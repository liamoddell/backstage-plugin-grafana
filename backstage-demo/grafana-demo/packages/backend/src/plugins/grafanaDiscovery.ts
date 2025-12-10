/*
 * Grafana Auto-Discovery Backend Module
 *
 * This module provides auto-discovery of Grafana dashboards and services
 * with support for:
 * - Label-based environment filtering (deployment.environment)
 * - Convention-based service name extraction
 * - Intelligent query discovery from dashboard JSON
 * - Alert auto-mapping
 */

import {
  coreServices,
  createBackendModule,
} from '@backstage/backend-plugin-api';
import { catalogProcessingExtensionPoint } from '@backstage/plugin-catalog-node/alpha';
import { EntityProvider, EntityProviderConnection } from '@backstage/plugin-catalog-node';
import { Entity } from '@backstage/catalog-model';

/**
 * Configuration for Grafana auto-discovery
 */
interface GrafanaDiscoveryConfig {
  domain: string;
  token?: string;
  enabled?: boolean;
  discovery?: {
    enabled?: boolean;
    folders?: string[];
    tags?: string[];
    namingConvention?: 'extract-from-title' | 'use-variable';
    environmentLabel?: string; // Default: 'deployment_environment'
    refreshInterval?: number; // seconds
  };
}

/**
 * Dashboard metadata from Grafana API
 */
interface GrafanaDashboard {
  uid: string;
  title: string;
  url: string;
  folderTitle: string;
  tags: string[];
  templating?: {
    list: Array<{
      name: string;
      query?: string;
      options?: Array<{ value: string }>;
    }>;
  };
}

/**
 * Panel query extracted from dashboard
 */
interface PanelQuery {
  expr: string;
  legendFormat?: string;
}

/**
 * Grafana Entity Provider - discovers services from Grafana dashboards
 */
class GrafanaEntityProvider implements EntityProvider {
  private readonly config: GrafanaDiscoveryConfig;
  private readonly logger: any;
  private connection?: EntityProviderConnection;
  private intervalId?: NodeJS.Timeout;

  constructor(config: GrafanaDiscoveryConfig, logger: any) {
    this.config = config;
    this.logger = logger;
  }

  getProviderName(): string {
    return 'GrafanaEntityProvider';
  }

  async connect(connection: EntityProviderConnection): Promise<void> {
    this.connection = connection;

    if (!this.config.discovery?.enabled) {
      this.logger.info('Grafana auto-discovery is disabled');
      return;
    }

    // Initial discovery
    await this.discover();

    // Set up periodic refresh
    const refreshInterval = (this.config.discovery?.refreshInterval || 300) * 1000;
    this.intervalId = setInterval(async () => {
      await this.discover();
    }, refreshInterval);

    this.logger.info(
      `Grafana auto-discovery enabled, refreshing every ${this.config.discovery?.refreshInterval || 300}s`
    );
  }

  async disconnect(): Promise<void> {
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
  }

  /**
   * Main discovery logic
   */
  private async discover(): Promise<void> {
    if (!this.connection) {
      return;
    }

    try {
      this.logger.info('Starting Grafana dashboard discovery...');

      // Fetch dashboards from Grafana
      const dashboards = await this.fetchDashboards();
      this.logger.info(`Found ${dashboards.length} dashboards`);

      // Convert dashboards to Backstage entities
      const entities = await this.convertDashboardsToEntities(dashboards);
      this.logger.info(`Generated ${entities.length} entities`);

      // Apply mutations to catalog
      await this.connection.applyMutation({
        type: 'full',
        entities: entities.map(entity => ({
          entity,
          locationKey: `grafana-discovery:${this.config.domain}`,
        })),
      });

      this.logger.info('Grafana discovery completed successfully');
    } catch (error) {
      this.logger.error('Failed to discover Grafana dashboards', error);
    }
  }

  /**
   * Fetch dashboards from Grafana API
   */
  private async fetchDashboards(): Promise<GrafanaDashboard[]> {
    const response = await fetch(`${this.config.domain}/api/search?type=dash-db`, {
      headers: {
        Authorization: `Bearer ${this.config.token || process.env.GRAFANA_TOKEN}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch dashboards: ${response.statusText}`);
    }

    const dashboards = await response.json();

    // Filter by configured folders/tags
    return dashboards.filter((dashboard: any) => {
      if (this.config.discovery?.folders?.length) {
        if (!this.config.discovery.folders.includes(dashboard.folderTitle || '')) {
          return false;
        }
      }

      if (this.config.discovery?.tags?.length) {
        const dashboardTags = dashboard.tags || [];
        if (!this.config.discovery.tags.some(tag => dashboardTags.includes(tag))) {
          return false;
        }
      }

      return true;
    });
  }

  /**
   * Fetch detailed dashboard JSON to extract queries
   */
  private async fetchDashboardDetails(uid: string): Promise<any> {
    const response = await fetch(`${this.config.domain}/api/dashboards/uid/${uid}`, {
      headers: {
        Authorization: `Bearer ${this.config.token || process.env.GRAFANA_TOKEN}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      this.logger.warn(`Failed to fetch dashboard details for ${uid}: ${response.statusText}`);
      return null;
    }

    return response.json();
  }

  /**
   * Extract service name from dashboard
   */
  private extractServiceName(dashboard: GrafanaDashboard, dashboardDetails: any): string | null {
    const convention = this.config.discovery?.namingConvention || 'use-variable';

    if (convention === 'use-variable') {
      // Look for 'service' or 'namespace' template variables
      const templateVars = dashboardDetails?.dashboard?.templating?.list || [];
      const serviceVar = templateVars.find((v: any) =>
        v.name === 'service' || v.name === 'namespace' || v.name === 'component'
      );

      if (serviceVar?.query) {
        // Ensure query is a string before calling .match()
        if (typeof serviceVar.query === 'string') {
          // Extract from label_values query
          const match = serviceVar.query.match(/label_values\([^,]+,\s*([^)]+)\)/);
          if (match) {
            return match[1];
          }
        }
      }

      if (serviceVar?.options && serviceVar.options.length > 0) {
        // Use first option as default service
        return serviceVar.options[0].value;
      }
    }

    // extract-from-title: Parse service name from dashboard title
    // Patterns: "[Service Name] Dashboard", "Service Name - Metrics", etc.
    const titleMatch = dashboard.title.match(/^\[?([A-Za-z0-9-_]+)\]?/);
    if (titleMatch) {
      return titleMatch[1].toLowerCase().replace(/\s+/g, '-');
    }

    return null;
  }

  /**
   * Extract Prometheus queries from dashboard panels
   */
  private extractPanelQueries(dashboardDetails: any): PanelQuery[] {
    const queries: PanelQuery[] = [];

    if (!dashboardDetails?.dashboard?.panels) {
      return queries;
    }

    for (const panel of dashboardDetails.dashboard.panels) {
      // Handle row panels with nested panels
      if (panel.type === 'row' && panel.panels) {
        for (const subPanel of panel.panels) {
          this.extractQueriesFromPanel(subPanel, queries);
        }
      } else {
        this.extractQueriesFromPanel(panel, queries);
      }
    }

    return queries;
  }

  private extractQueriesFromPanel(panel: any, queries: PanelQuery[]): void {
    if (!panel.targets) {
      return;
    }

    for (const target of panel.targets) {
      if (target.expr) {
        queries.push({
          expr: target.expr,
          legendFormat: target.legendFormat,
        });
      }
    }
  }

  /**
   * Intelligently determine metrics selector from queries
   */
  private deriveMetricsSelector(queries: PanelQuery[], serviceName: string): string {
    // Look for common label patterns
    for (const query of queries) {
      // Pattern 1: job="namespace/service"
      const jobMatch = query.expr.match(/job="([^/]+\/[^"]+)"/);
      if (jobMatch) {
        return `job="${jobMatch[1]}"`;
      }

      // Pattern 2: service="service-name"
      const serviceMatch = query.expr.match(/service="([^"]+)"/);
      if (serviceMatch) {
        return `service="${serviceMatch[1]}"`;
      }

      // Pattern 3: service_name=value,service_namespace=value
      const serviceNameMatch = query.expr.match(/service_name="([^"]+)"/);
      const serviceNsMatch = query.expr.match(/service_namespace="([^"]+)"/);
      if (serviceNameMatch && serviceNsMatch) {
        return `service_name="${serviceNameMatch[1]}",service_namespace="${serviceNsMatch[1]}"`;
      }
    }

    // Fallback: use service name
    return `service="${serviceName}"`;
  }

  /**
   * Extract environment from dashboard labels/tags
   */
  private extractEnvironment(dashboard: GrafanaDashboard, dashboardDetails: any): string {
    const envLabel = this.config.discovery?.environmentLabel || 'deployment_environment';

    // Check dashboard tags for environment indicators
    const envTags = ['production', 'staging', 'development', 'dev', 'prod', 'stage'];
    for (const tag of dashboard.tags || []) {
      const normalized = tag.toLowerCase();
      if (envTags.includes(normalized)) {
        return normalized === 'dev' ? 'development' :
               normalized === 'prod' ? 'production' :
               normalized === 'stage' ? 'staging' :
               normalized;
      }
    }

    // Check template variables for environment filter
    const templateVars = dashboardDetails?.dashboard?.templating?.list || [];
    const envVar = templateVars.find((v: any) =>
      v.name === 'environment' || v.name === 'env' || v.name === envLabel
    );

    if (envVar?.current?.value) {
      return envVar.current.value;
    }

    // Default to production if not specified
    return 'production';
  }

  /**
   * Convert Grafana dashboards to Backstage component entities
   */
  private async convertDashboardsToEntities(dashboards: GrafanaDashboard[]): Promise<Entity[]> {
    const entities: Entity[] = [];

    for (const dashboard of dashboards) {
      try {
        // Fetch detailed dashboard JSON
        const dashboardDetails = await this.fetchDashboardDetails(dashboard.uid);
        if (!dashboardDetails) {
          continue;
        }

        // Extract service name
        const serviceName = this.extractServiceName(dashboard, dashboardDetails);
        if (!serviceName) {
          this.logger.debug(`Could not extract service name from dashboard: ${dashboard.title}`);
          continue;
        }

        // Extract queries and derive metrics selector
        const queries = this.extractPanelQueries(dashboardDetails);
        const metricsSelector = this.deriveMetricsSelector(queries, serviceName);

        // Extract environment
        const environment = this.extractEnvironment(dashboard, dashboardDetails);

        // Build entity
        const entity: Entity = {
          apiVersion: 'backstage.io/v1alpha1',
          kind: 'Component',
          metadata: {
            name: serviceName,
            title: dashboard.title,
            description: `Auto-discovered from Grafana dashboard: ${dashboard.title}`,
            annotations: {
              'grafana/dashboard-selector': dashboard.uid,
              'grafana/overview-dashboard': `${dashboard.uid}?var-service=${serviceName}`,
              'grafana/metrics-selector': metricsSelector,
              'grafana/tag-selector': dashboard.tags?.join(',') || '',
              'backstage.io/source-location': `url:${this.config.domain}/d/${dashboard.uid}`,
            },
            tags: [
              ...(dashboard.tags || []),
              'auto-discovered',
              `environment:${environment}`,
            ],
            labels: {
              'grafana.com/auto-discovered': 'true',
              'deployment.environment': environment,
            },
          },
          spec: {
            type: 'service',
            lifecycle: environment,
            owner: 'unknown', // TODO: Could be derived from dashboard folder permissions
            system: dashboard.folderTitle?.toLowerCase().replace(/\s+/g, '-') || 'default',
          },
        };

        entities.push(entity);
        this.logger.info(`Generated entity for service: ${serviceName} (${environment})`);
      } catch (error) {
        this.logger.warn(`Failed to process dashboard ${dashboard.title}:`, error);
      }
    }

    return entities;
  }
}

/**
 * Backstage backend module for Grafana auto-discovery
 */
export default createBackendModule({
  pluginId: 'catalog',
  moduleId: 'grafana-discovery',
  register(reg) {
    reg.registerInit({
      deps: {
        catalog: catalogProcessingExtensionPoint,
        config: coreServices.rootConfig,
        logger: coreServices.logger,
      },
      async init({ catalog, config, logger }) {
        const grafanaConfig = config.getOptionalConfig('grafana');

        if (!grafanaConfig) {
          logger.info('Grafana configuration not found, skipping auto-discovery');
          return;
        }

        const discoveryConfig: GrafanaDiscoveryConfig = {
          domain: grafanaConfig.getString('domain'),
          token: grafanaConfig.getOptionalString('token'),
          enabled: grafanaConfig.getOptionalBoolean('discovery.enabled') ?? true,
          discovery: {
            enabled: grafanaConfig.getOptionalBoolean('discovery.enabled') ?? true,
            folders: grafanaConfig.getOptionalStringArray('discovery.folders'),
            tags: grafanaConfig.getOptionalStringArray('discovery.tags'),
            namingConvention: grafanaConfig.getOptionalString('discovery.namingConvention') as any || 'use-variable',
            environmentLabel: grafanaConfig.getOptionalString('discovery.environmentLabel') || 'deployment_environment',
            refreshInterval: grafanaConfig.getOptionalNumber('discovery.refreshInterval') || 300,
          },
        };

        const provider = new GrafanaEntityProvider(discoveryConfig, logger);
        catalog.addEntityProvider(provider);

        logger.info('Grafana auto-discovery module initialized');
      },
    });
  },
});
