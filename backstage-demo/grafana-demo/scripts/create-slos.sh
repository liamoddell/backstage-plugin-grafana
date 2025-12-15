#!/bin/bash

# Create SLOs in Grafana Cloud for discovered services
# Usage:
#   1. Ensure .env is configured (same as generate-entities.sh)
#   2. Run: ./create-slos.sh
#
# Cleanup mode (delete all backstage-created SLOs):
#   ./create-slos.sh --cleanup

set -e

CLEANUP_MODE=false
if [ "$1" = "--cleanup" ]; then
  CLEANUP_MODE=true
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
  echo "Setup: Copy .env.example to .env and add your token"
  exit 1
fi

echo "Grafana Cloud: $GRAFANA_URL"
echo ""

# Cleanup mode - delete all SLOs with backstage tag
if [ "$CLEANUP_MODE" = true ]; then
  echo "🗑️  Cleanup mode: Deleting all backstage-tagged SLOs..."

  EXISTING_SLOS=$(curl -s -H "Authorization: Bearer $GRAFANA_TOKEN" \
    "${GRAFANA_URL}/api/plugins/grafana-slo-app/resources/v1/slo")

  # Extract SLO UUIDs that have the backstage tag or backstage prefix
  # Handle both array and object response formats
  BACKSTAGE_SLOS=$(echo "$EXISTING_SLOS" | jq -r '
    if type == "array" then
      .[] | select(
        (.uuid | startswith("backstage")) or
        (.labels != null and (any(.labels[]; .key == "created_by" and .value == "backstage")))
      ) | .uuid
    else
      empty
    end
  ' 2>/dev/null || echo "")

  if [ -z "$BACKSTAGE_SLOS" ]; then
    echo "No backstage-tagged SLOs found to delete"
    exit 0
  fi

  for uuid in $BACKSTAGE_SLOS; do
    echo "Deleting SLO: $uuid"
    curl -s -X DELETE -H "Authorization: Bearer $GRAFANA_TOKEN" \
      "${GRAFANA_URL}/api/plugins/grafana-slo-app/resources/v1/slo/${uuid}" || echo "Failed to delete $uuid"
  done

  echo "✅ Cleanup complete"
  exit 0
fi

# Get Prometheus datasource UID (same as generate-entities.sh)
echo "Fetching datasources from Grafana Cloud..."
DATASOURCES=$(curl -s -H "Authorization: Bearer $GRAFANA_TOKEN" \
  "${GRAFANA_URL}/api/datasources" | jq -r .)

PROM_UID=$(echo "$DATASOURCES" | jq -r ".[] | select(.type==\"prometheus\" and (.name==\"grafanacloud-${GRAFANA_ORG}-prom\" or .name==\"grafanacloud-${GRAFANA_ORG}-metrics\" or .name==\"${GRAFANA_ORG}\")) | .uid" | head -1)

if [ -z "$PROM_UID" ]; then
  echo "Error: Could not find Prometheus datasource"
  exit 1
fi

DATASOURCE_NAME=$(echo "$DATASOURCES" | jq -r ".[] | select(.uid==\"$PROM_UID\") | .name")
echo "Found Prometheus datasource: $DATASOURCE_NAME (uid: $PROM_UID)"
echo ""

# Get active services with recent data (last 24h)
echo "Querying for active services..."
SERVICES=$(curl -s -H "Authorization: Bearer $GRAFANA_TOKEN" \
  "${GRAFANA_URL}/api/datasources/proxy/uid/${PROM_UID}/api/v1/query" \
  --data-urlencode 'query=count by (service_name) (count_over_time(traces_spanmetrics_calls_total{span_kind="SPAN_KIND_SERVER"}[24h]))' \
  | jq -r '.data.result[] | .metric.service_name' | sort -u)

if [ -z "$SERVICES" ]; then
  echo "Error: No active services found"
  exit 1
fi

# Filter out invalid service names
VALID_SERVICES=""
for service in $SERVICES; do
  case "$service" in
    "null"|"unknown"|"undefined"|"N/A"|""|"-")
      continue
      ;;
    *)
      VALID_SERVICES="$VALID_SERVICES$service
"
      ;;
  esac
done

VALID_SERVICES=$(echo "$VALID_SERVICES" | sed '/^$/d')

echo "Found $(echo "$VALID_SERVICES" | wc -l | tr -d ' ') active services"
echo ""

# Create SLOs for each service
CREATED_COUNT=0
SKIPPED_COUNT=0

for service in $VALID_SERVICES; do
  echo "Processing service: $service"

  # Check if SLO already exists for this service
  EXISTING=$(curl -s -H "Authorization: Bearer $GRAFANA_TOKEN" \
    "${GRAFANA_URL}/api/plugins/grafana-slo-app/resources/v1/slo" \
    | jq -r "if type == \"array\" then .[] | select(.name == \"${service} - Availability\") | .uuid else empty end" 2>/dev/null || echo "")

  if [ -n "$EXISTING" ]; then
    echo "  ⏭️  SLO already exists (UUID: $EXISTING)"
    SKIPPED_COUNT=$((SKIPPED_COUNT + 1))
    continue
  fi

  # Generate UUID for this SLO (alphanumeric lowercase only, no dashes)
  SLO_UUID="backstage$(echo -n "${service}" | md5 | cut -c1-8)"

  # Create availability SLO (success rate)
  # Target: 99.5% of requests should be successful (99.5% over 30 days)
  SLO_JSON=$(cat <<EOF
{
  "uuid": "${SLO_UUID}",
  "name": "${service} - Availability",
  "description": "Success rate for ${service} service (auto-created by Backstage)",
  "query": {
    "type": "ratio",
    "ratio": {
      "successMetric": {
        "prometheusMetric": "traces_spanmetrics_calls_total{service_name=\"${service}\",span_kind=\"SPAN_KIND_SERVER\",status_code!=\"STATUS_CODE_ERROR\"}",
        "type": "metric"
      },
      "totalMetric": {
        "prometheusMetric": "traces_spanmetrics_calls_total{service_name=\"${service}\",span_kind=\"SPAN_KIND_SERVER\"}",
        "type": "metric"
      },
      "groupByLabels": []
    }
  },
  "objectives": [
    {
      "value": 0.995,
      "window": "30d"
    }
  ],
  "destinationDatasource": {
    "uid": "${PROM_UID}"
  },
  "labels": [
    {
      "key": "service_name",
      "value": "${service}"
    },
    {
      "key": "created_by",
      "value": "backstage"
    }
  ]
}
EOF
)

  # Write JSON to temp file to avoid escaping issues
  TEMP_JSON=$(mktemp)
  echo "$SLO_JSON" > "$TEMP_JSON"

  # Debug: Verify JSON is valid and show query structure
  if ! jq '.' "$TEMP_JSON" > /dev/null 2>&1; then
    echo "  ❌ Invalid JSON generated"
    rm "$TEMP_JSON"
    continue
  fi

  # Create the SLO
  RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" \
    -X POST \
    -H "Authorization: Bearer $GRAFANA_TOKEN" \
    -H "Content-Type: application/json" \
    -d "@$TEMP_JSON" \
    "${GRAFANA_URL}/api/plugins/grafana-slo-app/resources/v1/slo")

  rm "$TEMP_JSON"

  HTTP_CODE=$(echo "$RESPONSE" | grep "HTTP_CODE:" | cut -d: -f2)
  RESPONSE_BODY=$(echo "$RESPONSE" | sed '/HTTP_CODE:/d')

  if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ] || [ "$HTTP_CODE" = "202" ]; then
    UUID=$(echo "$RESPONSE_BODY" | jq -r '.uuid' 2>/dev/null || echo "")
    echo "  ✅ Created availability SLO (UUID: $UUID)"
    CREATED_COUNT=$((CREATED_COUNT + 1))
  else
    echo "  ❌ Failed to create SLO (HTTP $HTTP_CODE)"
    echo "  Response: $RESPONSE_BODY" | head -3
  fi

  echo ""
done

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ SLO Creation Complete"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Created: $CREATED_COUNT SLOs"
echo "Skipped: $SKIPPED_COUNT SLOs (already exist)"
echo ""
echo "View SLOs in Grafana Cloud:"
echo "  ${GRAFANA_URL}/a/grafana-slo-app"
echo ""
echo "Or in Backstage:"
echo "  http://localhost:3000"
echo ""
echo "To delete all backstage-created SLOs:"
echo "  ./create-slos.sh --cleanup"
