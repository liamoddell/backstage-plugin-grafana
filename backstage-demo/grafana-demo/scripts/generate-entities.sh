#!/bin/bash

# Generate Backstage entities from Grafana Cloud metrics
# Usage:
#   1. Copy .env.example to .env and fill in your values
#   2. Run: ./generate-entities.sh
# OR
#   GRAFANA_TOKEN=xxx GRAFANA_ORG=liamoddellmlt ./generate-entities.sh
#
# Test mode (just verify token):
#   ./generate-entities.sh --test

set -e

TEST_MODE=false
if [ "$1" = "--test" ]; then
  TEST_MODE=true
fi

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
DATASOURCES=$(curl -s -w "\nHTTP_CODE:%{http_code}" -H "Authorization: Bearer $GRAFANA_TOKEN" \
  "${GRAFANA_URL}/api/datasources")

# Extract HTTP code
HTTP_CODE=$(echo "$DATASOURCES" | grep "HTTP_CODE:" | cut -d: -f2)
DATASOURCES=$(echo "$DATASOURCES" | sed '/HTTP_CODE:/d')

if [ "$HTTP_CODE" != "200" ]; then
  echo "Error: Failed to fetch datasources (HTTP $HTTP_CODE)"
  echo "Response: $DATASOURCES"
  echo ""
  echo "Troubleshooting:"
  echo "  1. Check your GRAFANA_TOKEN is correct"
  echo "  2. Token needs 'datasources:read' permission"
  echo "  3. Verify URL: $GRAFANA_URL"
  exit 1
fi

# Check if response is valid JSON array
if ! echo "$DATASOURCES" | jq -e 'type == "array"' > /dev/null 2>&1; then
  echo "Error: Invalid response from Grafana"
  echo "Response: $DATASOURCES"
  echo ""
  echo "This usually means:"
  echo "  - Invalid authentication token"
  echo "  - Wrong Grafana URL: $GRAFANA_URL"
  exit 1
fi

# Look for the metrics datasource with the expected naming pattern
# Try common Grafana Cloud patterns: -prom, -metrics, or exact match
PROM_UID=$(echo "$DATASOURCES" | jq -r ".[] | select(.type==\"prometheus\" and (.name==\"grafanacloud-${GRAFANA_ORG}-prom\" or .name==\"grafanacloud-${GRAFANA_ORG}-metrics\" or .name==\"${GRAFANA_ORG}\")) | .uid" | head -1)

if [ -z "$PROM_UID" ]; then
  echo "Error: Could not find Grafana Cloud Prometheus datasource"
  echo ""
  echo "Available Prometheus datasources:"
  echo "$DATASOURCES" | jq -r '.[] | select(.type=="prometheus") | "  - \(.name) (uid: \(.uid))"'
  echo ""
  echo "Expected pattern: grafanacloud-${GRAFANA_ORG}-prom or grafanacloud-${GRAFANA_ORG}-metrics"
  exit 1
fi

DATASOURCE_NAME=$(echo "$DATASOURCES" | jq -r ".[] | select(.uid==\"$PROM_UID\") | .name")

echo "Found Prometheus datasource: $DATASOURCE_NAME (uid: $PROM_UID)"

if [ "$TEST_MODE" = true ]; then
  echo ""
  echo "✅ Token is valid! Grafana API accessible."
  echo ""
  echo "To generate entities, run without --test flag:"
  echo "  ./generate-entities.sh"
  exit 0
fi

echo "Querying for service names with recent activity (last 24h)..."

# Query for all service names with span metrics in the last 24 hours
# This filters out stale services that no longer report data
SERVICES_JSON=$(curl -s -H "Authorization: Bearer $GRAFANA_TOKEN" \
  "${GRAFANA_URL}/api/datasources/proxy/uid/${PROM_UID}/api/v1/query" \
  --data-urlencode 'query=count by (service_name) (count_over_time(traces_spanmetrics_calls_total{span_kind="SPAN_KIND_SERVER"}[24h]))' \
  | jq -r '.data.result[] | .metric.service_name' | sort -u)

if [ -z "$SERVICES_JSON" ]; then
  echo "Error: No services found with recent span metrics (last 24h)"
  echo "Make sure your OTEL collector is generating traces_spanmetrics_calls_total metrics"
  echo "And that services have reported data in the last 24 hours"
  exit 1
fi

# List of services to exclude (already manually defined in entities.yaml)
# These services have better manual definitions with proper relationships and metadata
EXCLUDE_SERVICES=(
  "frontend"
  "checkoutservice"
  "checkout"
  "paymentservice"
  "payment"
  "productcatalogservice"
  "product-catalog"
  "cartservice"
  "cart"
  "recommendationservice"
  "recommendation"
  "shippingservice"
  "shipping"
  "emailservice"
  "email"
  "adservice"
  "ad"
  "currencyservice"
  "currency"
  "loadgenerator"
  "load-generator"
)

# Filter out excluded services
SERVICES=""
for service in $SERVICES_JSON; do
  EXCLUDED=false
  for exclude in "${EXCLUDE_SERVICES[@]}"; do
    if [ "$service" = "$exclude" ]; then
      EXCLUDED=true
      break
    fi
  done

  if [ "$EXCLUDED" = false ]; then
    SERVICES="$SERVICES$service
"
  fi
done

# Trim whitespace
SERVICES=$(echo "$SERVICES" | sed '/^$/d')

if [ -z "$SERVICES" ]; then
  echo "Note: All discovered services are already manually defined in entities.yaml"
  echo "No new services to add. This is normal if you have a stable set of services."
  echo ""
  echo "To regenerate all services (including manual ones), remove them from entities.yaml first."
  exit 0
fi

echo "Found active services (last 24h):"
echo "$SERVICES"
echo ""
echo "Note: Excluding manually-defined services from entities.yaml"
echo ""
echo "Generating entities.yaml..."

OUTPUT_FILE="$SCRIPT_DIR/../examples/entities-generated.yaml"

# Write header
cat > "$OUTPUT_FILE" <<EOF
# Auto-generated from Grafana Cloud metrics
# Generated: $(date)
# DO NOT EDIT MANUALLY - Run scripts/generate-entities.sh to regenerate
#
# This file contains auto-discovered services from Grafana Cloud that have:
# - Reported span metrics (traces_spanmetrics_calls_total) in the last 24 hours
# - Are not already manually defined in entities.yaml
#
# Manually curated services (with relationships, detailed metadata) are in entities.yaml

EOF

# Generate component for each service
for service in $SERVICES; do
  # Skip invalid/placeholder service names
  case "$service" in
    "null"|"unknown"|"undefined"|"N/A"|""|"-")
      echo "Skipping invalid service name: $service"
      continue
      ;;
  esac

  # Clean service name for Backstage (lowercase, replace special chars)
  entity_name=$(echo "$service" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9-]/-/g')

  # Skip if service name is empty or invalid after cleaning
  if [ -z "$entity_name" ] || [ "$entity_name" = "-" ]; then
    echo "Skipping invalid entity name after cleaning: $service -> $entity_name"
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
APP_CONFIG="$SCRIPT_DIR/../app-config.yaml"

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
