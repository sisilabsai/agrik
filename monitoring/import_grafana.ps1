Param(
  [string]$GrafanaUrl = $env:GRAFANA_URL,
  [string]$GrafanaApiToken = $env:GRAFANA_API_TOKEN,
  [string]$DashboardJson = "monitoring/grafana_dashboard.json"
)

if (-not $GrafanaUrl) { $GrafanaUrl = "http://localhost:3000" }
if (-not $GrafanaApiToken) { throw "GRAFANA_API_TOKEN is required" }

$dashboard = Get-Content -Raw -Path $DashboardJson | ConvertFrom-Json
$payload = @{ dashboard = $dashboard; overwrite = $true } | ConvertTo-Json -Depth 20

Invoke-RestMethod -Method Post -Uri "$GrafanaUrl/api/dashboards/db" \
  -Headers @{ Authorization = "Bearer $GrafanaApiToken" } \
  -ContentType "application/json" \
  -Body $payload
