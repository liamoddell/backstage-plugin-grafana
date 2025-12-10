# Grafana Auto-Discovery for Backstage

This implementation provides intelligent auto-discovery of services from Grafana dashboards with support for label-based environment filtering, following Grafana's recommended single-stack approach.

## Features

### 1. Auto-Discovery
- Automatically discovers services from Grafana dashboards
- Eliminates manual YAML configuration
- Self-healing: services appear/disappear automatically as dashboards change

### 2. Label-Based Environment Filtering
- Supports Grafana's single-stack approach with `deployment.environment` labels
- Works with multi-environment setups using label differentiation
- No need for separate Grafana instances per environment

### 3. Intelligent Query Discovery
- Extracts Prometheus queries from dashboard panels
- Auto-detects metrics selectors from existing queries
- Adapts to your naming conventions

### 4. Convention-Based Service Mapping
- Two modes: `use-variable` (template variables) or `extract-from-title` (dashboard names)
- Flexible naming extraction
- Customer-agnostic

## Configuration

### Enable Auto-Discovery

Edit `app-config.yaml`:

```yaml
grafana:
  domain: 'https://your-org.grafana.net'
  unifiedAlerting: true

  discovery:
    enabled: true  # Enable auto-discovery

    # Optional: Filter by folder
    folders:
      - "Production Services"
      - "Infrastructure"

    # Optional: Filter by tags
    tags:
      - "backstage-visible"
      - "microservices"

    # Service name extraction method
    namingConvention: 'use-variable'  # or 'extract-from-title'

    # Label for environment differentiation
    environmentLabel: 'deployment_environment'

    # Refresh interval (seconds)
    refreshInterval: 300
```

### Environment Variables

Set the Grafana API token:

```bash
export GRAFANA_TOKEN="your-grafana-api-token"
```

## How It Works

### Service Discovery Flow

1. **Dashboard Fetch**: Backend periodically queries Grafana API for dashboards
2. **Filtering**: Applies folder/tag filters if configured
3. **Service Extraction**: Extracts service name using configured convention
4. **Query Analysis**: Parses dashboard JSON to extract Prometheus queries
5. **Metrics Derivation**: Intelligently determines metrics selector from queries
6. **Environment Detection**: Extracts environment from labels/tags
7. **Entity Generation**: Creates Backstage component entities with annotations

### Naming Conventions

#### `use-variable` Mode (Recommended)
Extracts service name from dashboard template variables:

```json
{
  "templating": {
    "list": [
      {
        "name": "service",
        "query": "label_values(service)",
        "current": { "value": "checkout" }
      }
    ]
  }
}
```

Result: `serviceName = "checkout"`

#### `extract-from-title` Mode
Parses service name from dashboard title:

- `[Checkout] Service Dashboard` → `checkout`
- `Payment Service - Metrics` → `payment`
- `Cart-Service Overview` → `cart-service`

### Query Intelligence

The system analyzes Prometheus queries to auto-detect label patterns:

#### Pattern 1: Job Labels
```promql
rate(http_requests_total{job="opentelemetry-demo/checkout"}[5m])
```
Result: `metrics-selector: 'job="opentelemetry-demo/checkout"'`

#### Pattern 2: Service Labels
```promql
histogram_quantile(0.95, rate(http_request_duration_seconds_bucket{service="checkout"}[5m]))
```
Result: `metrics-selector: 'service="checkout"'`

#### Pattern 3: Multiple Labels
```promql
rate(spans_total{service_name="checkoutservice",service_namespace="opentelemetry-demo"}[5m])
```
Result: `metrics-selector: 'service_name="checkoutservice",service_namespace="opentelemetry-demo"'`

### Environment Filtering

Supports Grafana's single-stack pattern with label-based differentiation:

#### Dashboard Tags
If dashboard has tags like `production`, `staging`, `development`:
```yaml
metadata:
  labels:
    deployment.environment: production
```

#### Template Variables
If dashboard has environment variable:
```json
{
  "name": "environment",
  "current": { "value": "staging" }
}
```

## Generated Entities

Auto-discovered entities include:

```yaml
apiVersion: backstage.io/v1alpha1
kind: Component
metadata:
  name: checkout
  title: "Checkout Service Dashboard"
  description: "Auto-discovered from Grafana dashboard"
  annotations:
    grafana/dashboard-selector: "abc123def"
    grafana/overview-dashboard: "abc123def?var-service=checkout"
    grafana/metrics-selector: 'job="opentelemetry-demo/checkout"'
    grafana/tag-selector: "microservices,production"
  tags:
    - auto-discovered
    - environment:production
  labels:
    grafana.com/auto-discovered: "true"
    deployment.environment: "production"
spec:
  type: service
  lifecycle: production
  owner: unknown
  system: default
```

## Hybrid Mode: Manual Override

Auto-discovery can coexist with manual entities. Manual annotations take precedence:

```yaml
# entities.yaml
apiVersion: backstage.io/v1alpha1
kind: Component
metadata:
  name: special-service
  annotations:
    grafana/dashboard-selector: "custom-dashboard"
    grafana/metrics-selector: 'custom_label="value"'
spec:
  type: service
  lifecycle: production
  owner: platform-team
```

## Best Practices

### 1. Start with Discovery Disabled
Test your setup with manual entities first, then enable auto-discovery.

### 2. Use Dashboard Tags for Filtering
Tag dashboards you want visible in Backstage:
```bash
# In Grafana, add tag: "backstage-visible"
```

### 3. Organize with Folders
Structure Grafana folders to match your service architecture:
- `Production Services`
- `Infrastructure`
- `Development`

### 4. Label Your Metrics Consistently
Ensure Prometheus metrics use consistent label names:
```yaml
# Good: Consistent service label
job: "namespace/service-name"
service: "service-name"

# Avoid: Mixed conventions
app: "ServiceA"
service_name: "service-b"
component: "ServiceC"
```

### 5. Use Environment Labels
For single-stack Grafana, use `deployment.environment` label:
```promql
rate(requests_total{deployment_environment="production"}[5m])
```

## Troubleshooting

### No Services Discovered

1. Check Grafana API token permissions
2. Verify folder/tag filters in config
3. Check logs: `Grafana auto-discovery enabled`
4. Ensure dashboards have template variables or parseable titles

### Wrong Metrics Selector

Override in manual entity:
```yaml
annotations:
  grafana/metrics-selector: 'custom_label="value"'
```

### Environment Not Detected

Add environment tag to dashboard or use template variable named `environment`, `env`, or `deployment_environment`.

### Duplicate Services

Auto-discovery creates entities with unique names based on dashboard titles. If you have manual entities with the same names, disable auto-discovery or use `folders`/`tags` filters to avoid conflicts.

## Migration Path

### From Manual to Auto-Discovery

1. **Audit existing entities**: Document manual annotations
2. **Tag Grafana dashboards**: Add `backstage-visible` tag
3. **Enable discovery in test**: Set `enabled: true` with strict filters
4. **Compare outputs**: Verify auto-discovered annotations match manual ones
5. **Remove manual entities**: Once confident, remove redundant YAML
6. **Monitor**: Watch logs for discovery activity

## Advanced Configuration

### Multi-Environment with Single Stack

```yaml
grafana:
  discovery:
    enabled: true
    environmentLabel: 'deployment_environment'
    # All environments share same Grafana, differentiated by labels
```

Dashboards use template variables:
```json
{
  "templating": {
    "list": [
      {
        "name": "environment",
        "query": "label_values(deployment_environment)",
        "current": { "value": "production" }
      }
    ]
  }
}
```

### Folder-Based Discovery

```yaml
grafana:
  discovery:
    enabled: true
    folders:
      - "Microservices/Production"
      - "Microservices/Staging"
    namingConvention: 'extract-from-title'
```

### Tag-Based Discovery

```yaml
grafana:
  discovery:
    enabled: true
    tags:
      - "backstage"
      - "service-catalog"
```

## API Reference

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `discovery.enabled` | boolean | `false` | Enable auto-discovery |
| `discovery.folders` | string[] | `undefined` | Filter by folder names |
| `discovery.tags` | string[] | `undefined` | Filter by tags |
| `discovery.namingConvention` | string | `'use-variable'` | Extraction method |
| `discovery.environmentLabel` | string | `'deployment_environment'` | Label for env filtering |
| `discovery.refreshInterval` | number | `300` | Refresh interval (seconds) |

### Auto-Generated Annotations

| Annotation | Source | Example |
|------------|--------|---------|
| `grafana/dashboard-selector` | Dashboard UID | `abc123def` |
| `grafana/overview-dashboard` | UID + service var | `abc123def?var-service=checkout` |
| `grafana/metrics-selector` | Query analysis | `job="ns/service"` |
| `grafana/tag-selector` | Dashboard tags | `prod,microservice` |

## Performance Considerations

- Discovery runs every `refreshInterval` seconds (default: 5 minutes)
- Each discovery fetches all dashboards, then detailed JSON for filtered ones
- Grafana API rate limits apply
- Cache is maintained by Backstage catalog

## Security

- Grafana API token should have read-only permissions
- Token stored in environment variable, not config file
- Discovery respects Grafana folder permissions (future enhancement)
- No write operations performed on Grafana

## Future Enhancements

Planned features:

1. **Alert Auto-Discovery**: Map Grafana alerts to services
2. **Multi-Instance Support**: Connect multiple Grafana instances
3. **Permission Integration**: Respect Grafana RBAC in Backstage
4. **SLO Discovery**: Auto-discover SLO dashboards and link to services
5. **Annotation Validation**: Warn about missing/misconfigured annotations
