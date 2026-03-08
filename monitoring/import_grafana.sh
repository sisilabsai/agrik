#!/usr/bin/env bash
set -euo pipefail

GRAFANA_URL=${GRAFANA_URL:-http://localhost:3000}
GRAFANA_API_TOKEN=${GRAFANA_API_TOKEN:-}
DASHBOARD_JSON=${DASHBOARD_JSON:-monitoring/grafana_dashboard.json}

if [ -z "$GRAFANA_API_TOKEN" ]; then
  echo "GRAFANA_API_TOKEN is required" >&2
  exit 1
fi

payload=$(cat "$DASHBOARD_JSON" | jq -c '{dashboard: ., overwrite: true}')

curl -sS -X POST "$GRAFANA_URL/api/dashboards/db" \
  -H "Authorization: Bearer $GRAFANA_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$payload"

echo
