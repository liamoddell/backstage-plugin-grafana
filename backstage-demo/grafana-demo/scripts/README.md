# Entity Generation Script

This script automatically discovers services from your Grafana Cloud metrics and generates Backstage entities for them.

## Quick Start

1. **Copy the environment template:**
   ```bash
   cd backstage-demo/grafana-demo
   cp .env.example .env
   ```

2. **Edit `.env` and add your Grafana Cloud token:**
   ```bash
   GRAFANA_TOKEN=glsa_your_token_here
   GRAFANA_ORG=liamoddellmlt
   ```

   Get your token from: https://liamoddellmlt.grafana.net/org/serviceaccounts

3. **Run the script:**
   ```bash
   ./scripts/generate-entities.sh
   ```

4. **Restart Backstage:**
   ```bash
   yarn dev
   ```

## What It Does

The script will:
1. ✅ Query your Grafana Cloud Prometheus datasource
2. ✅ Find all services with `traces_spanmetrics_calls_total` metrics
3. ✅ Generate `examples/entities-generated.yaml` with all services
4. ✅ Automatically update `app-config.yaml` to include the generated entities
5. ✅ Add proper annotations for:
   - MetricsCard (RED metrics)
   - EnhancedAlertsCard (alerts by severity)
   - SLOCard (error budget tracking)

## Generated Entity Format

Each service gets:
```yaml
apiVersion: backstage.io/v1alpha1
kind: Component
metadata:
  name: service-name
  description: service-name service (auto-discovered)
  tags:
    - auto-discovered
    - microservice
  annotations:
    grafana/metrics-selector: 'service_name="service-name",span_kind="SPAN_KIND_SERVER"'
    grafana/alert-label-selector: 'service_name=service-name'
    grafana/slo-label-selector: 'service_name=service-name'
spec:
  type: service
  lifecycle: production
  owner: platform-team
  system: microservices-platform
```

## Re-running

Run the script anytime to update entities based on current Grafana metrics:
```bash
./scripts/generate-entities.sh
```

The script is idempotent - safe to run multiple times.

## Manual Override

To manually add/edit services, create a separate file like `examples/entities-manual.yaml` and add it to `app-config.yaml`:

```yaml
catalog:
  locations:
    - type: file
      target: ../../examples/entities-generated.yaml  # Auto-generated
    - type: file
      target: ../../examples/entities-manual.yaml     # Manual overrides
```
