#!/bin/bash

# Create SLOs for ALL services in Grafana Cloud (not just active ones)
# Usage: ./create-slos-all.sh

set -e

# Load from .env if it exists
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../.env"

if [ -f "$ENV_FILE" ]; then
  export $(grep -v '^#' "$ENV_FILE" | xargs)
fi

GRAFANA_ORG="${GRAFANA_ORG:-liamoddellmlt}"
GRAFANA_URL="https://${GRAFANA_ORG}.grafana.net"

if [ -z "$GRAFANA_TOKEN" ]; then
  echo "Error: GRAFANA_TOKEN not set"
  exit 1
fi

echo "Grafana Cloud: $GRAFANA_URL"
echo ""

# Get Prometheus datasource UID
echo "Fetching datasources..."
DATASOURCES=$(curl -s -H "Authorization: Bearer $GRAFANA_TOKEN" \
  "${GRAFANA_URL}/api/datasources" | jq -r .)

PROM_UID=$(echo "$DATASOURCES" | jq -r ".[] | select(.type==\"prometheus\" and (.name==\"grafanacloud-${GRAFANA_ORG}-prom\" or .name==\"grafanacloud-${GRAFANA_ORG}-metrics\")) | .uid" | head -1)

echo "Found Prometheus datasource: $PROM_UID"
echo ""

# Get ALL service names (no time filter)
echo "Querying for ALL service names..."
ALL_SERVICES=$(curl -s -H "Authorization: Bearer $GRAFANA_TOKEN" \
  "${GRAFANA_URL}/api/datasources/proxy/uid/${PROM_UID}/api/v1/label/service_name/values" \
  | jq -r '.data[]' | sort -u)

# Filter out invalid service names
VALID_SERVICES=""
for service in $ALL_SERVICES; do
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

echo "Found $(echo "$VALID_SERVICES" | wc -l | tr -d ' ') services"
echo ""

# Create SLOs
CREATED_COUNT=0
SKIPPED_COUNT=0

for service in $VALID_SERVICES; do
  echo "Processing: $service"

  # Check if SLO already exists
  EXISTING=$(curl -s -H "Authorization: Bearer $GRAFANA_TOKEN" \
    "${GRAFANA_URL}/api/plugins/grafana-slo-app/resources/v1/slo" \
    | jq -r "if type == \"array\" then .[] | select(.name == \"${service} - Availability\") | .uuid else empty end" 2>/dev/null || echo "")

  if [ -n "$EXISTING" ]; then
    echo "  ⏭️  Already exists"
    SKIPPED_COUNT=$((SKIPPED_COUNT + 1))
    continue
  fi

  # Generate UUID
  SLO_UUID="backstage$(echo -n "${service}" | md5 | cut -c1-8)"

  # Create SLO JSON
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

  # Write to temp file
  TEMP_JSON=$(mktemp)
  echo "$SLO_JSON" > "$TEMP_JSON"

  # Create SLO
  RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" \
    -X POST \
    -H "Authorization: Bearer $GRAFANA_TOKEN" \
    -H "Content-Type: application/json" \
    -d "@$TEMP_JSON" \
    "${GRAFANA_URL}/api/plugins/grafana-slo-app/resources/v1/slo")

  rm "$TEMP_JSON"

  HTTP_CODE=$(echo "$RESPONSE" | grep "HTTP_CODE:" | cut -d: -f2)

  if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ] || [ "$HTTP_CODE" = "202" ]; then
    echo "  ✅ Created"
    CREATED_COUNT=$((CREATED_COUNT + 1))
  else
    echo "  ❌ Failed (HTTP $HTTP_CODE)"
  fi
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Complete"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Created: $CREATED_COUNT SLOs"
echo "Skipped: $SKIPPED_COUNT SLOs"
echo ""
echo "View in Grafana Cloud:"
echo "  ${GRAFANA_URL}/a/grafana-slo-app"
