#!/bin/bash

# List all services in Prometheus (not just last 24h)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../.env"

if [ -f "$ENV_FILE" ]; then
  export $(grep -v '^#' "$ENV_FILE" | xargs)
fi

GRAFANA_URL="https://liamoddellmlt.grafana.net"
PROM_UID="grafanacloud-prom"

echo "Querying for ALL service names in Prometheus..."
echo ""

# Get all service_name label values (no time filter)
ALL_SERVICES=$(curl -s -H "Authorization: Bearer $GRAFANA_TOKEN" \
  "${GRAFANA_URL}/api/datasources/proxy/uid/${PROM_UID}/api/v1/label/service_name/values" \
  | jq -r '.data[]' | sort -u)

echo "All services found:"
echo "$ALL_SERVICES"
echo ""
echo "Total: $(echo "$ALL_SERVICES" | wc -l | tr -d ' ') services"
echo ""

# Check which have recent data (last 24h)
echo "Checking which services have data in last 24h..."
ACTIVE_SERVICES=$(curl -s -H "Authorization: Bearer $GRAFANA_TOKEN" \
  "${GRAFANA_URL}/api/datasources/proxy/uid/${PROM_UID}/api/v1/query" \
  --data-urlencode 'query=count by (service_name) (count_over_time(traces_spanmetrics_calls_total{span_kind="SPAN_KIND_SERVER"}[24h]))' \
  | jq -r '.data.result[] | .metric.service_name' | sort -u)

echo "Services with recent data (last 24h):"
echo "$ACTIVE_SERVICES"
echo ""
echo "Active: $(echo "$ACTIVE_SERVICES" | wc -l | tr -d ' ') services"
