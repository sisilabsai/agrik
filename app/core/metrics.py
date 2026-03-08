from prometheus_client import Counter, Histogram, Gauge

REQUEST_COUNT = Counter("agrik_http_requests_total", "Total HTTP requests", ["method", "path", "status"])
REQUEST_LATENCY = Histogram("agrik_http_request_duration_seconds", "Request latency", ["method", "path"])
QUEUE_BACKLOG = Gauge("agrik_outbound_queue_backlog", "Pending outbound message backlog")

OUTBOUND_SEND_COUNT = Counter(
    "agrik_outbound_send_total",
    "Outbound SMS send attempts",
    ["provider", "status"],
)
