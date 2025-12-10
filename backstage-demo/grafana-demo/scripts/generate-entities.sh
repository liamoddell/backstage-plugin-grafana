#!/bin/bash

# Generate Backstage entities from Grafana Cloud metrics
# Usage:
#   1. Copy .env.example to .env and fill in your values
#   2. Run: ./generate-entities.sh
# OR
#   GRAFANA_TOKEN=xxx GRAFANA_ORG=liamoddellmlt ./generate-entities.sh

set -e

# Load from .env if it exists
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../.env"

if [ -f "$ENV_FILE" ]; then
  echo "Loading configuration from .env file..."
  export $(grep -v '^#' "$ENV_FILE" | xargs)
fi

GRAFANA_ORG="${GRAFANA_ORG:-liamoddellmlt}"
GRAFANA_URL="https://${GRAFANA_ORG}.grafana.net"

if [ -z "$GRAFANA_TOKEN" ]; then
  echo "Error: GRAFANA_TOKEN not set"
  echo ""
  echo "Setup:"
  echo "  1. Copy .env.example to .env: cp .env.example .env"
  echo "  2. Edit .env and add your Grafana Cloud token"
  echo "  3. Run this script again"
  echo ""
  echo "Or run directly with: GRAFANA_TOKEN=xxx ./generate-entities.sh"
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

# Update app-config.yaml to include the generated entities
APP_CONFIG="../../app-config.yaml"

echo "Updating $APP_CONFIG to include generated entities..."

# Check if the generated entities file is already referenced
if grep -q "entities-generated.yaml" "$APP_CONFIG"; then
  echo "✓ entities-generated.yaml already referenced in app-config.yaml"
else
  # Find the catalog.locations section and add the generated file
  if grep -q "catalog:" "$APP_CONFIG"; then
    # Backup original file
    cp "$APP_CONFIG" "${APP_CONFIG}.backup"

    # Use awk to add the new location entry after the locations: line
    awk '/^  locations:/ {
      print
      print "    # Auto-generated entities from Grafana metrics"
      print "    - type: file"
      print "      target: ../../examples/entities-generated.yaml"
      next
    }
    {print}' "${APP_CONFIG}.backup" > "$APP_CONFIG"

    echo "✓ Added entities-generated.yaml to catalog locations"
    echo "  (backup saved as app-config.yaml.backup)"
  else
    echo "⚠ Warning: Could not find catalog: section in app-config.yaml"
    echo "  Please add manually:"
    echo "    - type: file"
    echo "      target: ../../examples/entities-generated.yaml"
  fi
fi

echo ""
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "1. Review the generated file: $OUTPUT_FILE"
echo "2. Restart Backstage: cd ../.. && yarn dev"
echo "3. Navigate to http://localhost:3000 to see auto-discovered services"
