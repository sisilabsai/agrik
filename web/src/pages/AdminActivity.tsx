import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import AdminActiveDateChips from "../components/AdminActiveDateChips";
import { api } from "../lib/api";

type Activity = {
  id: number;
  admin_id: string;
  action: string;
  details: Record<string, unknown>;
  ip_address?: string | null;
  created_at: string;
};

type DateRangeFilter = {
  from: string;
  to: string;
};

function parseActivityQuery(search: string): {
  action: string;
  dateRange: DateRangeFilter;
} {
  const params = new URLSearchParams(search);
  return {
    action: params.get("action") ?? "",
    dateRange: {
      from: params.get("created_from") ?? "",
      to: params.get("created_to") ?? "",
    },
  };
}

function parseDateBoundary(value: string, endOfDay = false): number | null {
  if (!value) return null;
  const parsed = new Date(`${value}${endOfDay ? "T23:59:59.999" : "T00:00:00.000"}`).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

function formatDateTime(value?: string | null): string {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleString();
}

function summarizeDetails(details: Record<string, unknown>) {
  const entries = Object.entries(details || {});
  if (!entries.length) return "No details recorded";
  return entries
    .slice(0, 4)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(" | ");
}

function severityOf(action: string): "high" | "medium" | "low" {
  const normalized = action.toLowerCase();
  if (
    normalized.includes("delete") ||
    normalized.includes("close") ||
    normalized.includes("pause") ||
    normalized.includes("verification") ||
    normalized.includes("update_user")
  ) {
    return "high";
  }
  if (normalized.includes("create") || normalized.includes("update") || normalized.includes("seed")) return "medium";
  return "low";
}

function entityOf(details: Record<string, unknown>): string {
  const keys = Object.keys(details || {});
  if (keys.some((key) => key.includes("listing"))) return "listing";
  if (keys.some((key) => key.includes("user"))) return "user";
  if (keys.some((key) => key.includes("alert"))) return "alert";
  if (keys.some((key) => key.includes("price"))) return "price";
  if (keys.some((key) => key.includes("service"))) return "service";
  return "general";
}

function destinationFor(item: Activity): { label: string; path: string } | null {
  const details = item.details || {};
  if (typeof details.user_id === "string") {
    return { label: "Open users", path: `/admin/users?search=${encodeURIComponent(details.user_id)}` };
  }
  if (typeof details.listing_id === "number") {
    return { label: "Open listings", path: "/admin/listings" };
  }
  if (typeof details.alert_id === "number") {
    return { label: "Open alerts", path: "/admin/alerts" };
  }
  if (typeof details.price_id === "number") {
    return { label: "Open prices", path: "/admin/prices" };
  }
  if (typeof details.service_id === "number") {
    return { label: "Open services", path: "/admin/services" };
  }
  const entity = entityOf(details);
  if (entity === "user") return { label: "Open users", path: "/admin/users" };
  if (entity === "listing") return { label: "Open listings", path: "/admin/listings" };
  if (entity === "alert") return { label: "Open alerts", path: "/admin/alerts" };
  if (entity === "price") return { label: "Open prices", path: "/admin/prices" };
  if (entity === "service") return { label: "Open services", path: "/admin/services" };
  return null;
}

function exportCsv(items: Activity[]) {
  const headers = ["id", "admin_id", "action", "severity", "entity", "details", "ip_address", "created_at"];
  const lines = items.map((item) =>
    [
      item.id,
      item.admin_id,
      item.action,
      severityOf(item.action),
      entityOf(item.details),
      JSON.stringify(item.details ?? {}).replace(/"/g, '""'),
      item.ip_address ?? "",
      item.created_at,
    ]
      .map((value) => `"${String(value)}"`)
      .join(",")
  );
  const blob = new Blob([[headers.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8;" });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = `admin-activity-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.csv`;
  anchor.click();
  URL.revokeObjectURL(href);
}

export default function AdminActivity() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryInit = useMemo(() => parseActivityQuery(location.search), [location.search]);
  const syncSearchRef = useRef(location.search);
  const [items, setItems] = useState<Activity[]>([]);
  const [actionFilter, setActionFilter] = useState(queryInit.action);
  const [severityFilter, setSeverityFilter] = useState("");
  const [entityFilter, setEntityFilter] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [dateRange, setDateRange] = useState<DateRangeFilter>(queryInit.dateRange);
  const [error, setError] = useState<string | null>(null);

  const loadActivity = useCallback(() => {
    setError(null);
    const params = new URLSearchParams();
    if (actionFilter) params.set("action", actionFilter);
    params.set("limit", "2000");
    const query = params.toString();
    api
      .adminActivity(query ? `?${query}` : "")
      .then((res) => setItems((res as { items: Activity[] }).items || []))
      .catch(() => setError("Unable to load admin activity."));
  }, [actionFilter]);

  useEffect(() => {
    loadActivity();
  }, [loadActivity]);

  useEffect(() => {
    if (location.search === syncSearchRef.current) return;
    syncSearchRef.current = location.search;
    const query = parseActivityQuery(location.search);
    setActionFilter(query.action);
    setDateRange(query.dateRange);
  }, [location.search]);

  const filteredItems = useMemo(() => {
    const fromMs = parseDateBoundary(dateRange.from, false);
    const toMs = parseDateBoundary(dateRange.to, true);
    const q = searchQuery.trim().toLowerCase();

    return items.filter((item) => {
      const createdMs = Date.parse(item.created_at);
      if (fromMs != null && (Number.isNaN(createdMs) || createdMs < fromMs)) return false;
      if (toMs != null && (Number.isNaN(createdMs) || createdMs > toMs)) return false;
      if (severityFilter && severityOf(item.action) !== severityFilter) return false;
      if (entityFilter && entityOf(item.details) !== entityFilter) return false;
      if (q) {
        const haystack = [item.action, item.admin_id, item.ip_address, JSON.stringify(item.details ?? {})]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [dateRange.from, dateRange.to, entityFilter, items, searchQuery, severityFilter]);

  const actionOptions = useMemo(() => Array.from(new Set(items.map((item) => item.action))).sort(), [items]);

  const summary = useMemo(
    () => ({
      total: filteredItems.length,
      high: filteredItems.filter((item) => severityOf(item.action) === "high").length,
      actors: new Set(filteredItems.map((item) => item.admin_id)).size,
      entities: new Set(filteredItems.map((item) => entityOf(item.details))).size,
    }),
    [filteredItems]
  );

  return (
    <section className="admin-page admin-activity-page">
      <div className="admin-page-header">
        <div>
          <div className="label">Activity</div>
          <h1>Audit log</h1>
          <p className="muted">Filter by severity, actor, and entity so sensitive actions are readable at a glance.</p>
        </div>
        <div className="admin-page-actions">
          <button className="btn ghost small" type="button" onClick={() => exportCsv(filteredItems)}>
            Export filtered
          </button>
          <button className="btn ghost small" type="button" onClick={loadActivity}>
            Refresh
          </button>
        </div>
      </div>

      {error && <p className="status error">{error}</p>}
      <AdminActiveDateChips from={dateRange.from} to={dateRange.to} />

      <div className="admin-kpi-grid">
        {[
          { label: "Events", value: summary.total, meta: "Current filtered stream" },
          { label: "High severity", value: summary.high, meta: "Sensitive actions" },
          { label: "Actors", value: summary.actors, meta: "Unique admin accounts" },
          { label: "Entity types", value: summary.entities, meta: "Users, listings, alerts, and more" },
        ].map((item) => (
          <div key={item.label} className="admin-kpi-card">
            <div className="admin-kpi-label">{item.label}</div>
            <div className="admin-kpi-value">{item.value}</div>
            <div className="admin-kpi-meta">{item.meta}</div>
          </div>
        ))}
      </div>

      <section className="admin-card">
        <div className="admin-card-header">
          <div>
            <div className="label">Filters</div>
            <h3>Investigation controls</h3>
          </div>
          <div className="admin-filter-bar">
            <input
              placeholder="Search action, admin id, IP, or details"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
            <select value={actionFilter} onChange={(event) => setActionFilter(event.target.value)}>
              <option value="">All actions</option>
              {actionOptions.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
            <select value={severityFilter} onChange={(event) => setSeverityFilter(event.target.value)}>
              <option value="">All severity</option>
              <option value="high">high</option>
              <option value="medium">medium</option>
              <option value="low">low</option>
            </select>
            <select value={entityFilter} onChange={(event) => setEntityFilter(event.target.value)}>
              <option value="">All entities</option>
              <option value="user">user</option>
              <option value="listing">listing</option>
              <option value="alert">alert</option>
              <option value="price">price</option>
              <option value="service">service</option>
              <option value="general">general</option>
            </select>
          </div>
        </div>
      </section>

      <section className="admin-card">
        {filteredItems.length === 0 ? (
          <p className="admin-empty">No activity recorded for the current filters.</p>
        ) : (
          <div className="admin-activity-list">
            {filteredItems.map((item) => {
              const severity = severityOf(item.action);
              const entity = entityOf(item.details);
              return (
                <article key={item.id} className="admin-activity-card">
                  <div className="admin-activity-card-top">
                    <div>
                      <strong>{item.action.replace(/_/g, " ")}</strong>
                      <p>{formatDateTime(item.created_at)}</p>
                    </div>
                    <div className="admin-chip-row">
                      <span className={`pill ${severity === "high" ? "pill-alert" : severity === "medium" ? "" : "pill-muted"}`}>
                        {severity}
                      </span>
                      <span className="pill pill-muted">{entity}</span>
                    </div>
                  </div>

                  <p className="admin-activity-summary">{summarizeDetails(item.details)}</p>

                  <div className="admin-detail-grid">
                    <div>
                      <span className="label">Admin</span>
                      <strong>{item.admin_id}</strong>
                    </div>
                    <div>
                      <span className="label">IP address</span>
                      <strong>{item.ip_address ?? "--"}</strong>
                    </div>
                  </div>

                  {destinationFor(item) && (
                    <div className="admin-actions">
                      <button className="btn ghost small" type="button" onClick={() => navigate(destinationFor(item)!.path)}>
                        {destinationFor(item)!.label}
                      </button>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </section>
  );
}
