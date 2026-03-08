import { useCallback, useEffect, useMemo, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { Icon } from "../components/Visuals";
import { api } from "../lib/api";

type AdminSummary = {
  users_total: number;
  users_verified: number;
  users_pending: number;
  listings: number;
  offers: number;
  services: number;
  alerts: number;
  prices: number;
};

type AdminUserRow = {
  id: string;
  phone: string;
  role: string;
  status: string;
  verification_status: string;
  created_at: string;
  last_login_at?: string | null;
};

type Listing = {
  id: number;
  user_id: string;
  crop: string;
  role: string;
  status: string;
  price?: number | null;
  quantity?: number | null;
  unit?: string | null;
  currency?: string | null;
  description?: string | null;
  contact_phone?: string | null;
  contact_whatsapp?: string | null;
  media_urls?: string[];
  location?: { district?: string | null; parish?: string | null } | null;
  created_at?: string | null;
};

type Price = {
  id: number;
  crop: string;
  price: number;
  district?: string | null;
  market?: string | null;
  currency?: string | null;
  captured_at?: string | null;
};

type Alert = {
  id: number;
  alert_type: string;
  active: boolean;
  crop?: string | null;
  channel?: string | null;
  location?: { district?: string | null } | null;
  created_at?: string | null;
};

type Service = {
  id: number;
  service_type: string;
  status: string;
  price?: number | null;
  currency?: string | null;
  created_at?: string | null;
};

type Activity = {
  id: number;
  admin_id: string;
  action: string;
  details: Record<string, unknown>;
  ip_address?: string | null;
  created_at: string;
};

type QueueCard = {
  label: string;
  value: number;
  meta: string;
  icon: "users" | "listings" | "prices" | "alerts" | "activity";
  path: string;
};

type DistrictLoad = {
  district: string;
  listings: number;
  alerts: number;
  services: number;
  total: number;
};

const STALE_LISTING_DAYS = 14;
const STALE_PRICE_DAYS = 5;

const ROLE_COLORS: Record<string, string> = {
  farmer: "#6fe2a4",
  buyer: "#6bb9ff",
  offtaker: "#f7b365",
  service_provider: "#b295ff",
  input_supplier: "#ff8ead",
  other: "#a9b4c7",
};

function formatInteger(value: number): string {
  return new Intl.NumberFormat().format(Math.round(value));
}

function formatCompact(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatDate(value?: string | null): string {
  if (!value) return "--";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "--";
  return parsed.toLocaleDateString();
}

function formatDateTime(value?: string | null): string {
  if (!value) return "--";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "--";
  return parsed.toLocaleString();
}

function formatCurrency(value?: number | null, currency = "UGX"): string {
  if (value == null) return "--";
  return `${currency} ${formatInteger(value)}`;
}

function parseStamp(value?: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isOlderThan(value: string | null | undefined, days: number): boolean {
  const stamp = parseStamp(value);
  if (stamp == null) return false;
  return Date.now() - stamp > days * 24 * 60 * 60 * 1000;
}

function safePercent(part: number, total: number): number {
  if (total <= 0) return 0;
  return (part / total) * 100;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roleLabel(role: string): string {
  const key = role.trim().toLowerCase();
  if (key === "service_provider") return "Service providers";
  if (key === "input_supplier") return "Input suppliers";
  if (key === "offtaker") return "Offtakers";
  if (key === "buyer") return "Buyers";
  if (key === "farmer") return "Farmers";
  return "Other";
}

function roleColor(role: string): string {
  const key = role.trim().toLowerCase();
  return ROLE_COLORS[key] ?? ROLE_COLORS.other;
}

function activitySeverity(action: string): "high" | "medium" | "low" {
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

function summarizeDetails(details: Record<string, unknown>): string {
  const entries = Object.entries(details || {});
  if (!entries.length) return "No details recorded";
  return entries
    .slice(0, 3)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(" | ");
}

function csvCell(value: unknown): string {
  if (value == null) return "";
  const text = String(value);
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function downloadCsv(name: string, headers: string[], rows: Array<Array<unknown>>) {
  const csv = [headers.map(csvCell).join(","), ...rows.map((row) => row.map(csvCell).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(href);
}

function exportStamp(): string {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
}

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [summary, setSummary] = useState<AdminSummary | null>(null);
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [listings, setListings] = useState<Listing[]>([]);
  const [prices, setPrices] = useState<Price[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<string | null>(null);
  const [rangeDays, setRangeDays] = useState<7 | 30 | 90>(30);

  const refreshAll = useCallback(async () => {
    setError(null);
    const results = await Promise.allSettled([
      api.adminSummary(),
      api.adminUsers("?limit=2000"),
      api.adminListings("?limit=1200"),
      api.adminPrices("?limit=2000"),
      api.adminAlerts("?limit=1200"),
      api.adminServices("?limit=500"),
      api.adminActivity("?limit=1200"),
    ]);

    const [summaryRes, usersRes, listingsRes, pricesRes, alertsRes, servicesRes, activityRes] = results;

    setSummary(summaryRes.status === "fulfilled" ? (summaryRes.value as AdminSummary) : null);
    setUsers(usersRes.status === "fulfilled" ? ((usersRes.value as AdminUserRow[]) || []) : []);
    setListings(listingsRes.status === "fulfilled" ? ((listingsRes.value as { items: Listing[] }).items || []) : []);
    setPrices(pricesRes.status === "fulfilled" ? ((pricesRes.value as { items: Price[] }).items || []) : []);
    setAlerts(alertsRes.status === "fulfilled" ? ((alertsRes.value as { items: Alert[] }).items || []) : []);
    setServices(servicesRes.status === "fulfilled" ? ((servicesRes.value as { items: Service[] }).items || []) : []);
    setActivity(activityRes.status === "fulfilled" ? ((activityRes.value as { items: Activity[] }).items || []) : []);

    if (results.some((item) => item.status === "rejected")) {
      setError("Some admin data failed to load. Refresh to retry.");
    }

    setLastRefresh(new Date().toLocaleTimeString());
  }, []);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  const usersTotal = summary?.users_total ?? users.length;
  const usersVerified =
    summary?.users_verified ??
    users.filter((user) => (user.verification_status || "").toLowerCase() === "verified").length;
  const usersPending = summary?.users_pending ?? Math.max(0, usersTotal - usersVerified);
  const verificationRate = safePercent(usersVerified, usersTotal);

  const openListings = useMemo(() => listings.filter((item) => item.status === "open"), [listings]);
  const pausedListings = useMemo(() => listings.filter((item) => item.status === "paused"), [listings]);
  const openServices = useMemo(() => services.filter((item) => item.status === "open"), [services]);
  const pausedAlerts = useMemo(() => alerts.filter((item) => !item.active), [alerts]);
  const listingsWithoutMedia = useMemo(
    () => openListings.filter((item) => !item.media_urls || item.media_urls.length === 0),
    [openListings]
  );
  const listingsMissingContact = useMemo(
    () => openListings.filter((item) => !item.contact_phone && !item.contact_whatsapp),
    [openListings]
  );
  const staleOpenListings = useMemo(
    () => openListings.filter((item) => isOlderThan(item.created_at, STALE_LISTING_DAYS)),
    [openListings]
  );
  const stalePrices = useMemo(
    () => prices.filter((item) => isOlderThan(item.captured_at, STALE_PRICE_DAYS)),
    [prices]
  );
  const highSignalActivity = useMemo(
    () => activity.filter((item) => activitySeverity(item.action) === "high").slice(0, 6),
    [activity]
  );

  const rangeFrom = useMemo(() => {
    const from = new Date();
    from.setDate(from.getDate() - rangeDays + 1);
    from.setHours(0, 0, 0, 0);
    return from.toISOString().slice(0, 10);
  }, [rangeDays]);

  const buildFilteredPath = useCallback(
    (pathname: string, extra: Record<string, string | undefined> = {}) => {
      const params = new URLSearchParams();
      params.set("created_from", rangeFrom);
      Object.entries(extra).forEach(([key, value]) => {
        if (value) params.set(key, value);
      });
      const query = params.toString();
      return query ? `${pathname}?${query}` : pathname;
    },
    [rangeFrom]
  );

  const roleBreakdown = useMemo(() => {
    const counts = new Map<string, number>();
    users.forEach((user) => {
      const key = (user.role || "").trim().toLowerCase() || "other";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });
    return [...counts.entries()]
      .map(([role, count]) => ({ role, count, pct: safePercent(count, users.length) }))
      .sort((left, right) => right.count - left.count);
  }, [users]);

  const districtLoad = useMemo(() => {
    const map = new Map<string, DistrictLoad>();
    const touch = (district?: string | null, key?: "listings" | "alerts" | "services") => {
      const name = (district || "").trim();
      if (!name || !key) return;
      const item = map.get(name) ?? { district: name, listings: 0, alerts: 0, services: 0, total: 0 };
      item[key] += 1;
      item.total += 1;
      map.set(name, item);
    };
    listings.forEach((item) => touch(item.location?.district, "listings"));
    alerts.forEach((item) => touch(item.location?.district, "alerts"));
    services.forEach((item) =>
      touch((item as Service & { location?: { district?: string | null } | null }).location?.district, "services")
    );
    return [...map.values()].sort((left, right) => right.total - left.total).slice(0, 6);
  }, [alerts, listings, services]);

  const districtPeak = useMemo(() => Math.max(1, ...districtLoad.map((item) => item.total)), [districtLoad]);

  const queueCards = useMemo<QueueCard[]>(
    () => [
      {
        label: "Pending verification",
        value: usersPending,
        meta: usersPending ? "Accounts waiting for trusted access" : "No verification backlog",
        icon: "users",
        path: buildFilteredPath("/admin/users", { verification_status: "pending" }),
      },
      {
        label: "Listings without proof",
        value: listingsWithoutMedia.length,
        meta: listingsWithoutMedia.length ? "Open records missing photo or video evidence" : "Evidence coverage is healthy",
        icon: "listings",
        path: buildFilteredPath("/admin/listings", { queue: "no-media", status: "open" }),
      },
      {
        label: "Missing contact coverage",
        value: listingsMissingContact.length,
        meta: listingsMissingContact.length ? "Open records missing phone or WhatsApp" : "Contact coverage is healthy",
        icon: "listings",
        path: buildFilteredPath("/admin/listings", { queue: "no-contact", status: "open" }),
      },
      {
        label: "Stale price updates",
        value: stalePrices.length,
        meta: stalePrices.length ? "Markets likely need a new publish cycle" : "Price board is current",
        icon: "prices",
        path: buildFilteredPath("/admin/prices"),
      },
      {
        label: "Paused alerts",
        value: pausedAlerts.length,
        meta: pausedAlerts.length ? "Monitoring coverage needs review" : "Alert coverage is active",
        icon: "alerts",
        path: buildFilteredPath("/admin/alerts"),
      },
      {
        label: "Sensitive admin actions",
        value: highSignalActivity.length,
        meta: highSignalActivity.length ? "Recent actions worth auditing" : "No high-risk actions in view",
        icon: "activity",
        path: buildFilteredPath("/admin/activity"),
      },
    ],
    [
      buildFilteredPath,
      highSignalActivity.length,
      listingsMissingContact.length,
      listingsWithoutMedia.length,
      pausedAlerts.length,
      stalePrices.length,
      usersPending,
    ]
  );

  const moderationHealth = useMemo(
    () => [
      {
        label: "Open listings",
        value: openListings.length,
        meta: "Currently visible in marketplace feeds",
        progress: safePercent(openListings.length, Math.max(1, listings.length)),
      },
      {
        label: "Stale listings",
        value: staleOpenListings.length,
        meta: `Open for more than ${STALE_LISTING_DAYS} days`,
        progress: safePercent(staleOpenListings.length, Math.max(1, openListings.length)),
      },
      {
        label: "Proof-ready",
        value: openListings.length - listingsWithoutMedia.length,
        meta: "Open listings with media attached",
        progress: safePercent(openListings.length - listingsWithoutMedia.length, Math.max(1, openListings.length)),
      },
      {
        label: "Fresh prices",
        value: prices.length - stalePrices.length,
        meta: `Updated within ${STALE_PRICE_DAYS} days`,
        progress: safePercent(prices.length - stalePrices.length, Math.max(1, prices.length)),
      },
    ],
    [listings.length, listingsWithoutMedia.length, openListings.length, prices.length, staleOpenListings.length, stalePrices.length]
  );

  const exportUsers = useCallback(() => {
    downloadCsv(
      `admin-users-${exportStamp()}.csv`,
      ["id", "phone", "role", "status", "verification_status", "created_at", "last_login_at"],
      users.map((item) => [
        item.id,
        item.phone,
        item.role,
        item.status,
        item.verification_status,
        item.created_at,
        item.last_login_at ?? "",
      ])
    );
  }, [users]);

  const exportActivity = useCallback(() => {
    downloadCsv(
      `admin-activity-${exportStamp()}.csv`,
      ["id", "admin_id", "action", "details", "ip_address", "created_at"],
      activity.map((item) => [
        item.id,
        item.admin_id,
        item.action,
        JSON.stringify(item.details ?? {}),
        item.ip_address ?? "",
        item.created_at,
      ])
    );
  }, [activity]);

  return (
    <section className="admin-page admin-overview-neo">
      <div className="admin-page-header">
        <div>
          <div className="label">Overview</div>
          <h1>Admin command center</h1>
          <p className="muted">Operational visibility for trust, moderation, pricing, alerts, and admin risk.</p>
        </div>
        <div className="admin-page-actions">
          <div className="admin-export-actions">
            <button className="btn ghost small" type="button" onClick={exportUsers}>
              Export users
            </button>
            <button className="btn ghost small" type="button" onClick={exportActivity}>
              Export audit
            </button>
          </div>
          <button className="btn ghost small" type="button" onClick={refreshAll}>
            Refresh data
          </button>
          <span className="admin-meta">Last refresh {lastRefresh ?? "--"}</span>
        </div>
      </div>

      {error && <p className="status error">{error}</p>}

      <section className="admin-command-hero">
        <div className="admin-command-hero-main">
          <div className="label">Action board</div>
          <h2>Start with the queues that need intervention, not with raw totals.</h2>
          <p className="muted">
            Verification backlog, weak listings, stale prices, paused alerts, and sensitive admin actions are surfaced
            first so the next move is obvious.
          </p>

          <div className="admin-range-toggle" role="group" aria-label="Dashboard date range">
            {[7, 30, 90].map((days) => (
              <button
                key={days}
                type="button"
                className={`admin-range-chip ${rangeDays === days ? "active" : ""}`}
                onClick={() => setRangeDays(days as 7 | 30 | 90)}
              >
                {days}d
              </button>
            ))}
          </div>

          <div className="admin-quick-action-row">
            <button className="btn" type="button" onClick={() => navigate(buildFilteredPath("/admin/users", { verification_status: "pending" }))}>
              Review users
            </button>
            <button className="btn" type="button" onClick={() => navigate(buildFilteredPath("/admin/listings", { queue: "quality" }))}>
              Moderate listings
            </button>
            <button className="btn ghost" type="button" onClick={() => navigate("/admin/prices")}>
              Publish prices
            </button>
            <button className="btn ghost" type="button" onClick={() => navigate("/admin/activity")}>
              Open audit
            </button>
          </div>

          <div className="admin-command-notes">
            <span>{formatCompact(usersTotal)} users</span>
            <span>{formatCompact(openListings.length)} open listings</span>
            <span>{formatCompact(highSignalActivity.length)} sensitive actions in view</span>
          </div>
        </div>

        <div className="admin-command-hero-side">
          <div className="admin-card-header">
            <div>
              <div className="label">Immediate attention</div>
              <h3>What needs review now</h3>
            </div>
          </div>
          <div className="admin-attention-list">
            {queueCards.slice(0, 4).map((item) => (
              <button key={item.label} className="admin-attention-card" type="button" onClick={() => navigate(item.path)}>
                <span className="admin-attention-icon">
                  <Icon name={item.icon} size={16} />
                </span>
                <div>
                  <strong>{item.label}</strong>
                  <p>{item.meta}</p>
                </div>
                <b>{formatInteger(item.value)}</b>
              </button>
            ))}
          </div>
        </div>
      </section>

      <div className="admin-kpi-grid">
        {[
          { label: "Users", value: formatInteger(usersTotal), meta: `${formatInteger(usersVerified)} verified`, icon: "users" as const },
          {
            label: "Verification rate",
            value: `${verificationRate.toFixed(1)}%`,
            meta: `${formatInteger(usersPending)} pending`,
            icon: "activity" as const,
          },
          {
            label: "Open listings",
            value: formatInteger(openListings.length),
            meta: `${formatInteger(pausedListings.length)} paused`,
            icon: "listings" as const,
          },
          {
            label: "Live alerts",
            value: formatInteger(alerts.length - pausedAlerts.length),
            meta: `${formatInteger(pausedAlerts.length)} paused`,
            icon: "alerts" as const,
          },
          {
            label: "Price points",
            value: formatInteger(summary?.prices ?? prices.length),
            meta: stalePrices.length ? `${formatInteger(stalePrices.length)} stale` : "Fresh coverage",
            icon: "prices" as const,
          },
          {
            label: "Services",
            value: formatInteger(openServices.length),
            meta: `${formatInteger(services.length)} total`,
            icon: "services" as const,
          },
        ].map((kpi) => (
          <div key={kpi.label} className="admin-kpi-card">
            <div className="admin-kpi-head">
              <span className="kpi-icon">
                <Icon name={kpi.icon} size={16} />
              </span>
              <div className="admin-kpi-label">{kpi.label}</div>
            </div>
            <div className="admin-kpi-value">{kpi.value}</div>
            <div className="admin-kpi-meta">{kpi.meta}</div>
          </div>
        ))}
      </div>

      <div className="admin-priority-grid">
        <section className="admin-card">
          <div className="admin-card-header">
            <div>
              <div className="label">Review lanes</div>
              <h3>Action queues</h3>
            </div>
          </div>
          <div className="admin-queue-grid">
            {queueCards.map((item) => (
              <button key={item.label} className="admin-queue-card" type="button" onClick={() => navigate(item.path)}>
                <div className="admin-queue-card-top">
                  <span className="section-icon">
                    <Icon name={item.icon} size={16} />
                  </span>
                  <span className="pill">{formatInteger(item.value)}</span>
                </div>
                <strong>{item.label}</strong>
                <p>{item.meta}</p>
              </button>
            ))}
          </div>
        </section>

        <section className="admin-card">
          <div className="admin-card-header">
            <div>
              <div className="label">Moderation health</div>
              <h3>Readiness board</h3>
            </div>
            <NavLink className="btn ghost small" to={buildFilteredPath("/admin/listings", { queue: "quality" })}>
              Open moderation
            </NavLink>
          </div>
          <div className="admin-health-list">
            {moderationHealth.map((item) => (
              <article key={item.label} className="admin-health-item">
                <div className="admin-health-head">
                  <div>
                    <strong>{item.label}</strong>
                    <p>{item.meta}</p>
                  </div>
                  <span>{formatInteger(item.value)}</span>
                </div>
                <div className="provider-progress-track">
                  <i style={{ width: `${clamp(item.progress, 4, 100)}%` }} />
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>

      <div className="admin-analytics-shell">
        <section className="admin-card">
          <div className="admin-card-header">
            <div className="section-title-with-icon">
              <span className="section-icon">
                <Icon name="users" size={18} />
              </span>
              <div>
                <div className="label">User mix</div>
                <h3>Role distribution</h3>
              </div>
            </div>
            <span className="admin-list-meta">{formatInteger(users.length)} accounts</span>
          </div>

          {roleBreakdown.length === 0 ? (
            <p className="admin-empty">No user records available.</p>
          ) : (
            <div className="admin-role-list">
              {roleBreakdown.map((row) => (
                <div key={row.role} className="admin-role-row">
                  <div className="admin-role-label">
                    <i style={{ backgroundColor: roleColor(row.role) }} />
                    <span>{roleLabel(row.role)}</span>
                  </div>
                  <div className="admin-role-track">
                    <div
                      className="admin-role-fill"
                      style={{ width: `${clamp(row.pct, 2, 100)}%`, backgroundColor: roleColor(row.role) }}
                    />
                  </div>
                  <strong>{formatInteger(row.count)}</strong>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="admin-card">
          <div className="admin-card-header">
            <div className="section-title-with-icon">
              <span className="section-icon">
                <Icon name="market" size={18} />
              </span>
              <div>
                <div className="label">District pressure</div>
                <h3>Top active districts</h3>
              </div>
            </div>
          </div>

          {districtLoad.length === 0 ? (
            <p className="admin-empty">No district-linked activity yet.</p>
          ) : (
            <div className="admin-district-list">
              {districtLoad.map((row) => (
                <div key={row.district} className="admin-district-row">
                  <div className="admin-district-meta">
                    <strong>{row.district}</strong>
                    <span className="admin-district-facts">
                      {row.listings} listings | {row.alerts} alerts | {row.services} services
                    </span>
                  </div>
                  <div className="admin-district-track">
                    <div className="admin-district-fill" style={{ width: `${(row.total / districtPeak) * 100}%` }} />
                  </div>
                  <strong className="admin-district-total">{row.total}</strong>
                  <div className="admin-district-actions">
                    <button
                      className="btn tiny ghost"
                      type="button"
                      onClick={() => navigate(buildFilteredPath("/admin/listings", { district: row.district }))}
                    >
                      Listings
                    </button>
                    <button
                      className="btn tiny ghost"
                      type="button"
                      onClick={() => navigate(buildFilteredPath("/admin/alerts", { district: row.district }))}
                    >
                      Alerts
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <div className="admin-split">
        <div className="admin-stack">
          <section className="admin-card">
            <div className="admin-card-header">
              <div className="section-title-with-icon">
                <span className="section-icon">
                  <Icon name="listings" size={18} />
                </span>
                <div>
                  <div className="label">Moderation radar</div>
                  <h3>Listings that need context</h3>
                </div>
              </div>
              <NavLink className="btn ghost small" to={buildFilteredPath("/admin/listings", { queue: "quality" })}>
                Open workspace
              </NavLink>
            </div>
            {listings.length === 0 ? (
              <p className="admin-empty">No listings found.</p>
            ) : (
              <div className="admin-spotlight-list">
                {openListings.slice(0, 4).map((listing) => (
                  <button
                    key={listing.id}
                    type="button"
                    className="admin-spotlight-card"
                    onClick={() => navigate(buildFilteredPath("/admin/listings", { crop: listing.crop, status: "open" }))}
                  >
                    <div className="admin-spotlight-head">
                      <strong>{listing.crop}</strong>
                      <span className={`pill ${listing.media_urls?.length ? "" : "pill-muted"}`}>
                        {listing.media_urls?.length ? `${listing.media_urls.length} media` : "No media"}
                      </span>
                    </div>
                    <div className="admin-spotlight-meta">
                      <span>{listing.role}</span>
                      <span>{listing.location?.district ?? "--"}</span>
                      <span>{formatCurrency(listing.price, listing.currency ?? "UGX")}</span>
                    </div>
                    <p>{listing.description || "No description added."}</p>
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="admin-card">
            <div className="admin-card-header">
              <div className="section-title-with-icon">
                <span className="section-icon">
                  <Icon name="prices" size={18} />
                </span>
                <div>
                  <div className="label">Price board</div>
                  <h3>Freshness checks</h3>
                </div>
              </div>
              <NavLink className="btn ghost small" to="/admin/prices">
                Manage prices
              </NavLink>
            </div>
            {prices.length === 0 ? (
              <p className="admin-empty">No prices published yet.</p>
            ) : (
              <div className="admin-mini-list">
                {prices.slice(0, 5).map((price) => (
                  <div key={price.id} className="admin-mini-row">
                    <div>
                      <strong>{price.crop}</strong>
                      <p>
                        {price.district || price.market || "--"} | {formatCurrency(price.price, price.currency ?? "UGX")}
                      </p>
                    </div>
                    <span className={`pill ${isOlderThan(price.captured_at, STALE_PRICE_DAYS) ? "pill-muted" : ""}`}>
                      {isOlderThan(price.captured_at, STALE_PRICE_DAYS) ? "Stale" : "Fresh"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <div className="admin-stack">
          <section className="admin-card">
            <div className="admin-card-header">
              <div className="section-title-with-icon">
                <span className="section-icon">
                  <Icon name="activity" size={18} />
                </span>
                <div>
                  <div className="label">Audit watch</div>
                  <h3>Sensitive admin actions</h3>
                </div>
              </div>
              <NavLink className="btn ghost small" to={buildFilteredPath("/admin/activity")}>
                Open log
              </NavLink>
            </div>
            {highSignalActivity.length === 0 ? (
              <p className="admin-empty">No sensitive actions in the current window.</p>
            ) : (
              <div className="admin-risk-feed">
                {highSignalActivity.map((item) => (
                  <div key={item.id} className="admin-risk-item">
                    <div className="admin-risk-item-top">
                      <span className="pill pill-alert">High</span>
                      <span className="admin-list-meta">{formatDateTime(item.created_at)}</span>
                    </div>
                    <strong>{item.action.replace(/_/g, " ")}</strong>
                    <p>{summarizeDetails(item.details)}</p>
                    <span className="admin-list-meta">
                      {item.admin_id} | {item.ip_address ?? "--"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="admin-card">
            <div className="admin-card-header">
              <div className="section-title-with-icon">
                <span className="section-icon">
                  <Icon name="alerts" size={18} />
                </span>
                <div>
                  <div className="label">Alert coverage</div>
                  <h3>Monitoring state</h3>
                </div>
              </div>
              <NavLink className="btn ghost small" to="/admin/alerts">
                Open alerts
              </NavLink>
            </div>
            {alerts.length === 0 ? (
              <p className="admin-empty">No alerts configured.</p>
            ) : (
              <div className="admin-mini-list">
                {alerts.slice(0, 5).map((alert) => (
                  <div key={alert.id} className="admin-mini-row">
                    <div>
                      <strong>{alert.alert_type.toUpperCase()}</strong>
                      <p>
                        {alert.crop ?? "--"} | {alert.location?.district ?? "--"} | {alert.channel ?? "--"}
                      </p>
                    </div>
                    <span className={`pill ${alert.active ? "" : "pill-muted"}`}>{alert.active ? "Active" : "Paused"}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </section>
  );
}
