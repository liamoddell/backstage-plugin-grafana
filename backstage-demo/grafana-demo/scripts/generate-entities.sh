#!/bin/bash

# Generate Backstage entities from Grafana Cloud metrics
# Usage: GRAFANA_TOKEN=xxx GRAFANA_ORG=liamoddellmlt ./generate-entities.sh

set -e

GRAFANA_ORG="${GRAFANA_ORG:-liamoddellmlt}"
GRAFANA_URL="https://${GRAFANA_ORG}.grafana.net"

if [ -z "$GRAFANA_TOKEN" ]; then
  echo "Error: GRAFANA_TOKEN environment variable not set"
  echo "Usage: GRAFANA_TOKEN=xxx ./generate-entities.sh"
  exit 1
fi

echo "Fetching datasources from Grafana Cloud..."

# Get Prometheus datasource UID
DATASOURCES=$(curl -s -H "Authorization: Bearer $GRAFANA_TOKEN" \
  "${GRAFANA_URL}/api/datasources")

PROM_UID=$(echo "$DATASOURCES" | jq -r '.[] | select(.type=="prometheus") | .uid' | head -1)

if [ -z "$PROM_UID" ]; then
  echo "Error: No Prometheus datasource found"
  exit 1
fi

echo "Found Prometheus datasource: $PROM_UID"
echo "Querying for service names..."

# Query for all service names with span metrics
SERVICES=$(curl -s -H "Authorization: Bearer $GRAFANA_TOKEN" \
  "${GRAFANA_URL}/api/datasources/proxy/uid/${PROM_UID}/api/v1/label/service_name/values" \
  | jq -r '.data[]' | sort -u)

if [ -z "$SERVICES" ]; then
  echo "Error: No services found with span metrics"
  echo "Make sure your OTEL collector is generating traces_spanmetrics_calls_total metrics"
  exit 1
fi

echo "Found services:"
echo "$SERVICES"
echo ""
echo "Generating entities.yaml..."

OUTPUT_FILE="../../examples/entities-generated.yaml"

# Write header
cat > "$OUTPUT_FILE" <<EOF
# Auto-generated from Grafana Cloud metrics
# Generated: $(date)
# DO NOT EDIT MANUALLY - Run scripts/generate-entities.sh to regenerate

---
# Systems
apiVersion: backstage.io/v1alpha1
kind: System
metadata:
  name: microservices-platform
  description: Microservices Platform (auto-discovered from Grafana)
spec:
  owner: platform-team

---
# Teams
apiVersion: backstage.io/v1alpha1
kind: Group
metadata:
  name: platform-team
  description: Platform Engineering Team
spec:
  type: team
  children: []

EOF

# Generate component for each service
for service in $SERVICES; do
  # Clean service name for Backstage (lowercase, replace special chars)
  entity_name=$(echo "$service" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9-]/-/g')

  # Skip if service name is empty or invalid
  if [ -z "$entity_name" ] || [ "$entity_name" = "-" ]; then
    continue
  fi

  echo "Adding service: $service (entity: $entity_name)"

  cat >> "$OUTPUT_FILE" <<EOF
---
apiVersion: backstage.io/v1alpha1
kind: Component
metadata:
  name: $entity_name
  description: $service service (auto-discovered)
  tags:
    - auto-discovered
    - microservice
  annotations:
    # For MetricsCard - OpenTelemetry span metrics
    grafana/metrics-selector: 'service_name="$service",span_kind="SPAN_KIND_SERVER"'
    # For EnhancedAlertsCard - unified alerting
    grafana/alert-label-selector: 'service_name=$service'
    # For SLOCard - requires SLOs created in Grafana Cloud
    grafana/slo-label-selector: 'service_name=$service'
spec:
  type: service
  lifecycle: production
  owner: platform-team
  system: microservices-platform

EOF
done

echo ""
echo "✅ Generated $OUTPUT_FILE"
echo ""
echo "Next steps:"
echo "1. Review the generated file"
echo "2. Add it to your Backstage catalog in app-config.yaml:"
echo "   catalog:"
echo "     locations:"
echo "       - type: file"
echo "         target: ../../examples/entities-generated.yaml"
echo "3. Restart Backstage"
