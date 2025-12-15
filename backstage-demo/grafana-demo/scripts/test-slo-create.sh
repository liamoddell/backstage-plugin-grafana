#!/bin/bash

# Test SLO creation with detailed output

set -e

# Load from .env
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../.env"

if [ -f "$ENV_FILE" ]; then
  export $(grep -v '^#' "$ENV_FILE" | xargs)
fi

echo "Testing SLO creation..."
echo ""

# Create test JSON
cat > /tmp/test-slo.json <<'JSONEOF'
{
  "name": "test-service - Availability",
  "description": "Test SLO",
  "query": {
    "type": "ratio",
    "ratio": {
      "successMetric": "sum(rate(traces_spanmetrics_calls_total{service_name=\"frontend\",span_kind=\"SPAN_KIND_SERVER\",status_code!=\"STATUS_CODE_ERROR\"}[5m]))",
      "totalMetric": "sum(rate(traces_spanmetrics_calls_total{service_name=\"frontend\",span_kind=\"SPAN_KIND_SERVER\"}[5m]))",
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
    "uid": "grafanacloud-prom"
  },
  "labels": [
    {
      "key": "created_by",
      "value": "backstage"
    }
  ]
}
JSONEOF

echo "JSON payload:"
cat /tmp/test-slo.json | jq '.'
echo ""
echo "Sending request..."
echo ""

RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" \
  -X POST \
  -H "Authorization: Bearer $GRAFANA_TOKEN" \
  -H "Content-Type: application/json" \
  -d @/tmp/test-slo.json \
  "https://liamoddellmlt.grafana.net/api/plugins/grafana-slo-app/resources/v1/slo")

HTTP_CODE=$(echo "$RESPONSE" | grep "HTTP_CODE:" | cut -d: -f2)
RESPONSE_BODY=$(echo "$RESPONSE" | sed '/HTTP_CODE:/d')

echo "HTTP Code: $HTTP_CODE"
echo "Response:"
echo "$RESPONSE_BODY" | jq '.' 2>/dev/null || echo "$RESPONSE_BODY"
echo ""

# Check token permissions
echo "Checking token info..."
TOKEN_INFO=$(curl -s -H "Authorization: Bearer $GRAFANA_TOKEN" \
  "https://liamoddellmlt.grafana.net/api/auth/keys")
echo "$TOKEN_INFO" | jq '.' 2>/dev/null || echo "$TOKEN_INFO"

rm /tmp/test-slo.json
