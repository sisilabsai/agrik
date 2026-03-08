import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { api } from "../lib/api";
import AdminActiveDateChips from "../components/AdminActiveDateChips";

type AdminUser = {
  id: string;
  phone: string;
  role: string;
  status: string;
  verification_status: string;
  full_name?: string | null;
  email?: string | null;
  district?: string | null;
  parish?: string | null;
  organization_name?: string | null;
  onboarding_stage?: string | null;
  crops?: string[];
  service_categories?: string[];
  focus_crops?: string[];
  market_listings?: number;
  market_alerts?: number;
  market_offers?: number;
  chat_messages?: number;
  last_chat_at?: string | null;
  recent_activity?: { action: string; created_at: string; detail_summary?: string | null }[];
  created_at: string;
  updated_at?: string | null;
  last_login_at?: string | null;
};

type UserEdit = {
  role: string;
  status: string;
  verification_status: string;
};

type UserFilters = {
  role: string;
  status: string;
  verification: string;
  district: string;
  onboarding: string;
  activity: string;
  market: string;
};

type DateRangeFilter = {
  from: string;
  to: string;
};

type DirectoryViewMode = "list" | "cards";
const PAGE_SIZE_OPTIONS = [25, 50, 100];

const USER_SAVED_VIEWS = [
  {
    id: "pending-verification",
    label: "Pending verification",
    filters: { verification: "unverified", activity: "", role: "", status: "", district: "", onboarding: "", market: "" },
    search: "",
  },
  {
    id: "inactive-recent",
    label: "Inactive recent",
    filters: { verification: "", activity: "inactive_30d", role: "", status: "", district: "", onboarding: "", market: "" },
    search: "",
  },
  {
    id: "providers-no-footprint",
    label: "Providers no footprint",
    filters: { verification: "", activity: "", role: "service_provider", status: "", district: "", onboarding: "", market: "without_market" },
    search: "",
  },
  {
    id: "high-activity",
    label: "High activity",
    filters: { verification: "", activity: "active_7d", role: "", status: "active", district: "", onboarding: "", market: "with_market" },
    search: "",
  },
] as const;

function parseUsersQuery(search: string): {
  filters: UserFilters;
  searchTerm: string;
  dateRange: DateRangeFilter;
} {
  const params = new URLSearchParams(search);
  return {
    filters: {
      role: params.get("role") ?? "",
      status: params.get("status") ?? "",
      verification: params.get("verification_status") ?? params.get("verification") ?? "",
      district: params.get("district") ?? "",
      onboarding: params.get("onboarding_stage") ?? "",
      activity: params.get("activity") ?? "",
      market: params.get("market_presence") ?? "",
    },
    searchTerm: params.get("search") ?? "",
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

function formatDate(value?: string | null): string {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleDateString();
}

function formatDateTime(value?: string | null): string {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleString();
}

function roleLabel(role: string): string {
  const key = (role || "").toLowerCase();
  if (key === "service_provider") return "Service provider";
  if (key === "input_supplier") return "Input supplier";
  if (key === "offtaker") return "Offtaker";
  return key || "unknown";
}

function titleCase(value: string): string {
  if (!value) return "--";
  return value
    .split("_")
    .join(" ")
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

function safeList(values?: string[] | null): string[] {
  if (!Array.isArray(values)) return [];
  return values.filter((value) => typeof value === "string" && value.trim().length > 0);
}

function activityActionLabel(action: string): string {
  return action.replace(/_/g, " ");
}

function withinDays(value: string | null | undefined, days: number): boolean {
  if (!value) return false;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return false;
  return Date.now() - ms <= days * 24 * 60 * 60 * 1000;
}

function readUsersViewMode(): DirectoryViewMode {
  if (typeof window === "undefined") return "list";
  const stored = window.localStorage.getItem("admin_users_view_mode");
  return stored === "cards" ? "cards" : "list";
}

export default function AdminUsers() {
  const location = useLocation();
  const queryInit = useMemo(() => parseUsersQuery(location.search), [location.search]);
  const syncSearchRef = useRef(location.search);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [userEdits, setUserEdits] = useState<Record<string, UserEdit>>({});
  const [userSaving, setUserSaving] = useState<Record<string, boolean>>({});
  const [userSearch, setUserSearch] = useState(queryInit.searchTerm);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<UserFilters>(queryInit.filters);
  const [dateRange, setDateRange] = useState<DateRangeFilter>(queryInit.dateRange);
  const [viewMode, setViewMode] = useState<DirectoryViewMode>(readUsersViewMode);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [activeSavedViewId, setActiveSavedViewId] = useState<string>("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const buildQuery = (params: Record<string, string>) => {
    const search = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value) search.set(key, value);
    });
    const query = search.toString();
    return query ? `?${query}` : "";
  };

  const loadUsers = useCallback(() => {
    setError(null);
    setLoading(true);
    const query = buildQuery({
      role: filters.role,
      status: filters.status,
      verification_status: filters.verification,
      limit: String(pageSize),
      offset: String((page - 1) * pageSize),
    });
    api
      .adminUsers(query)
      .then((res) => {
        const rows = (res as AdminUser[]) || [];
        setUsers(rows);
        setHasMore(rows.length === pageSize);
        setSelectedUserId((current) => (current && rows.some((user) => user.id === current) ? current : rows[0]?.id ?? null));
        setSelectedUserIds((current) => current.filter((id) => rows.some((user) => user.id === id)));
        const edits: Record<string, UserEdit> = {};
        rows.forEach((user) => {
          edits[user.id] = {
            role: user.role,
            status: user.status,
            verification_status: user.verification_status,
          };
        });
        setUserEdits(edits);
      })
      .catch(() => setError("Unable to load users."))
      .finally(() => setLoading(false));
  }, [filters.role, filters.status, filters.verification, page, pageSize]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  useEffect(() => {
    if (location.search === syncSearchRef.current) return;
    syncSearchRef.current = location.search;
    const query = parseUsersQuery(location.search);
    setFilters(query.filters);
    setUserSearch(query.searchTerm);
    setDateRange(query.dateRange);
  }, [location.search]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("admin_users_view_mode", viewMode);
  }, [viewMode]);

  useEffect(() => {
    setPage(1);
  }, [filters.role, filters.status, filters.verification, pageSize]);

  const districts = useMemo(
    () => [...new Set(users.map((user) => (user.district || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [users]
  );
  const onboardingStages = useMemo(
    () =>
      [...new Set(users.map((user) => (user.onboarding_stage || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [users]
  );

  const filteredUsers = useMemo(() => {
    const fromMs = parseDateBoundary(dateRange.from, false);
    const toMs = parseDateBoundary(dateRange.to, true);
    const search = userSearch.trim().toLowerCase();
    return users.filter((user) => {
      const searchBlob = [
        user.id,
        user.phone,
        user.full_name || "",
        user.email || "",
        user.district || "",
        user.parish || "",
        user.organization_name || "",
      ]
        .join(" ")
        .toLowerCase();
      if (search && !searchBlob.includes(search)) {
        return false;
      }

      if (filters.district && (user.district || "").toLowerCase() !== filters.district.toLowerCase()) {
        return false;
      }
      if (filters.onboarding && (user.onboarding_stage || "").toLowerCase() !== filters.onboarding.toLowerCase()) {
        return false;
      }

      const marketTotal = (user.market_listings || 0) + (user.market_alerts || 0) + (user.market_offers || 0);
      if (filters.market === "with_market" && marketTotal <= 0) return false;
      if (filters.market === "without_market" && marketTotal > 0) return false;
      if (filters.market === "with_admin_activity" && (user.recent_activity?.length || 0) <= 0) return false;

      if (filters.activity === "active_7d" && !withinDays(user.last_login_at, 7)) return false;
      if (filters.activity === "active_30d" && !withinDays(user.last_login_at, 30)) return false;
      if (filters.activity === "inactive_30d" && (withinDays(user.last_login_at, 30) || !user.last_login_at)) return false;
      if (filters.activity === "never_logged" && !!user.last_login_at) return false;

      if (fromMs == null && toMs == null) return true;
      const createdMs = Date.parse(user.created_at);
      if (Number.isNaN(createdMs)) return false;
      if (fromMs != null && createdMs < fromMs) return false;
      if (toMs != null && createdMs > toMs) return false;
      return true;
    });
  }, [dateRange.from, dateRange.to, filters.activity, filters.district, filters.market, filters.onboarding, userSearch, users]);

  const roleBreakdown = useMemo(() => {
    const counts = new Map<string, number>();
    users.forEach((user) => {
      const key = (user.role || "other").toLowerCase();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [users]);

  const usersVerified = useMemo(
    () => users.filter((user) => (user.verification_status || "").toLowerCase() === "verified").length,
    [users]
  );
  const activeLast7 = useMemo(() => users.filter((user) => withinDays(user.last_login_at, 7)).length, [users]);
  const withMarketFootprint = useMemo(
    () => users.filter((user) => (user.market_listings || 0) + (user.market_alerts || 0) + (user.market_offers || 0) > 0).length,
    [users]
  );

  const selectedUser = useMemo(
    () => filteredUsers.find((user) => user.id === selectedUserId) ?? filteredUsers[0] ?? null,
    [filteredUsers, selectedUserId]
  );

  const reviewQueues = useMemo(
    () => [
      { id: "verification", label: "Pending verification", active: filters.verification === "unverified", count: users.filter((u) => u.verification_status === "unverified").length, apply: () => setFilters((prev) => ({ ...prev, verification: prev.verification === "unverified" ? "" : "unverified" })) },
      { id: "inactive", label: "Inactive 30d", active: filters.activity === "inactive_30d", count: users.filter((u) => u.last_login_at && !withinDays(u.last_login_at, 30)).length, apply: () => setFilters((prev) => ({ ...prev, activity: prev.activity === "inactive_30d" ? "" : "inactive_30d" })) },
      { id: "providers", label: "Providers", active: filters.role === "service_provider", count: users.filter((u) => u.role === "service_provider").length, apply: () => setFilters((prev) => ({ ...prev, role: prev.role === "service_provider" ? "" : "service_provider" })) },
      { id: "market", label: "With footprint", active: filters.market === "with_market", count: withMarketFootprint, apply: () => setFilters((prev) => ({ ...prev, market: prev.market === "with_market" ? "" : "with_market" })) },
    ],
    [filters.activity, filters.market, filters.role, filters.verification, users, withMarketFootprint]
  );

  const handleUserEdit = (userId: string, field: keyof UserEdit, value: string) => {
    setUserEdits((prev) => ({
      ...prev,
      [userId]: { ...prev[userId], [field]: value },
    }));
  };

  const toggleSelectedUser = (userId: string) => {
    setSelectedUserIds((current) => (current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId]));
  };

  const handleUserSave = async (userId: string) => {
    const payload = userEdits[userId];
    if (!payload) return;
    const previous = users.find((user) => user.id === userId);
    setUserSaving((prev) => ({ ...prev, [userId]: true }));
    setError(null);
    setStatusMessage(null);
    setUsers((current) =>
      current.map((user) => (user.id === userId ? { ...user, role: payload.role, status: payload.status, verification_status: payload.verification_status } : user))
    );
    try {
      await api.adminUpdateUser(userId, payload);
      setStatusMessage(`User ${previous?.phone ?? userId} updated.`);
      loadUsers();
    } catch {
      if (previous) {
        setUsers((current) => current.map((user) => (user.id === userId ? previous : user)));
      }
      setError("Unable to update user.");
    } finally {
      setUserSaving((prev) => ({ ...prev, [userId]: false }));
    }
  };

  const handleBulkSave = async (changes: Partial<UserEdit>, label: string) => {
    if (!selectedUserIds.length) return;
    setError(null);
    setStatusMessage(null);
    const previous = users.filter((user) => selectedUserIds.includes(user.id));
    setUsers((current) =>
      current.map((user) => (selectedUserIds.includes(user.id) ? { ...user, ...changes } : user))
    );
    try {
      await Promise.all(selectedUserIds.map((userId) => api.adminUpdateUser(userId, changes)));
      setStatusMessage(`${selectedUserIds.length} users updated: ${label}.`);
      setSelectedUserIds([]);
      loadUsers();
    } catch {
      setUsers((current) =>
        current.map((user) => {
          const original = previous.find((item) => item.id === user.id);
          return original ?? user;
        })
      );
      setError("Unable to update selected users.");
    }
  };

  const exportFilteredUsers = () => {
    const headers = ["id", "phone", "role", "status", "verification_status", "district", "parish", "created_at", "last_login_at"];
    const rows = filteredUsers.map((user) => [
      user.id,
      user.phone,
      user.role,
      user.status,
      user.verification_status,
      user.district ?? "",
      user.parish ?? "",
      user.created_at,
      user.last_login_at ?? "",
    ]);
    const csv = [headers.join(","), ...rows.map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = `admin-users-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.csv`;
    anchor.click();
    URL.revokeObjectURL(href);
  };

  const applySavedView = (viewId: string) => {
    const view = USER_SAVED_VIEWS.find((item) => item.id === viewId);
    if (!view) return;
    const isSame = activeSavedViewId === viewId;
    setActiveSavedViewId(isSame ? "" : viewId);
    if (isSame) {
      resetFilters();
      return;
    }
    setFilters({ ...view.filters });
    setUserSearch(view.search);
    setPage(1);
  };

  const resetFilters = () => {
    setUserSearch("");
    setActiveSavedViewId("");
    setFilters({
      role: "",
      status: "",
      verification: "",
      district: "",
      onboarding: "",
      activity: "",
      market: "",
    });
    setPage(1);
  };

  const pageStart = users.length > 0 ? (page - 1) * pageSize + 1 : 0;
  const pageEnd = users.length > 0 ? pageStart + users.length - 1 : 0;

  return (
    <section className="admin-page admin-users-page">
      <div className="admin-page-header">
        <div>
          <div className="label">Users</div>
          <h1>User intelligence desk</h1>
          <p className="muted">Rich profile visibility, activity context, and fast account control in one surface.</p>
        </div>
      </div>

      {error && <p className="status error">{error}</p>}
      {statusMessage && <p className="status">{statusMessage}</p>}
      <AdminActiveDateChips from={dateRange.from} to={dateRange.to} />

      <div className="admin-kpi-grid">
        <div className="admin-kpi-card">
          <div className="admin-kpi-label">Total users</div>
          <div className="admin-kpi-value">{users.length}</div>
          <div className="admin-kpi-meta">{filteredUsers.length} in current view</div>
        </div>
        <div className="admin-kpi-card">
          <div className="admin-kpi-label">Verified</div>
          <div className="admin-kpi-value">{usersVerified}</div>
          <div className="admin-kpi-meta">{users.length ? Math.round((usersVerified / users.length) * 100) : 0}% verification</div>
        </div>
        <div className="admin-kpi-card">
          <div className="admin-kpi-label">Active 7d</div>
          <div className="admin-kpi-value">{activeLast7}</div>
          <div className="admin-kpi-meta">Logged in during last week</div>
        </div>
        <div className="admin-kpi-card">
          <div className="admin-kpi-label">Market footprint</div>
          <div className="admin-kpi-value">{withMarketFootprint}</div>
          <div className="admin-kpi-meta">Users with listings, alerts, or offers</div>
        </div>
      </div>

      <section className="admin-card">
        <div className="admin-card-header">
          <div>
            <div className="label">Filters</div>
            <h3>Modern user filters</h3>
          </div>
          <div className="admin-user-role-chips">
            <button className="btn ghost small" type="button" onClick={exportFilteredUsers}>
              Export filtered
            </button>
            <button
              type="button"
              className={`admin-role-chip ${filters.role === "" ? "active" : ""}`}
              onClick={() => setFilters((prev) => ({ ...prev, role: "" }))}
            >
              All
            </button>
            {roleBreakdown.slice(0, 6).map(([role, count]) => (
              <button
                key={role}
                type="button"
                className={`admin-role-chip ${filters.role === role ? "active" : ""}`}
                onClick={() => setFilters((prev) => ({ ...prev, role: prev.role === role ? "" : role }))}
              >
                {titleCase(role)} <strong>{count}</strong>
              </button>
            ))}
          </div>
        </div>

        <div className="admin-user-filter-grid">
          <label className="field">
            Search
            <input
              placeholder="Name, phone, email, district, organization"
              value={userSearch}
              onChange={(event) => setUserSearch(event.target.value)}
            />
          </label>
          <label className="field">
            Status
            <select value={filters.status} onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))}>
              <option value="">All status</option>
              <option value="active">active</option>
              <option value="pending">pending</option>
              <option value="locked">locked</option>
            </select>
          </label>
          <label className="field">
            Verification
            <select
              value={filters.verification}
              onChange={(event) => setFilters((prev) => ({ ...prev, verification: event.target.value }))}
            >
              <option value="">All verification</option>
              <option value="verified">verified</option>
              <option value="unverified">unverified</option>
            </select>
          </label>
          <label className="field">
            District
            <select value={filters.district} onChange={(event) => setFilters((prev) => ({ ...prev, district: event.target.value }))}>
              <option value="">All districts</option>
              {districts.map((district) => (
                <option key={district} value={district}>
                  {district}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Onboarding
            <select value={filters.onboarding} onChange={(event) => setFilters((prev) => ({ ...prev, onboarding: event.target.value }))}>
              <option value="">All stages</option>
              {onboardingStages.map((stage) => (
                <option key={stage} value={stage}>
                  {titleCase(stage)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Activity
            <select value={filters.activity} onChange={(event) => setFilters((prev) => ({ ...prev, activity: event.target.value }))}>
              <option value="">Any activity</option>
              <option value="active_7d">Active in 7 days</option>
              <option value="active_30d">Active in 30 days</option>
              <option value="inactive_30d">Inactive 30+ days</option>
              <option value="never_logged">Never logged in</option>
            </select>
          </label>
          <label className="field">
            Footprint
            <select value={filters.market} onChange={(event) => setFilters((prev) => ({ ...prev, market: event.target.value }))}>
              <option value="">All users</option>
              <option value="with_market">With market footprint</option>
              <option value="without_market">No market footprint</option>
              <option value="with_admin_activity">With admin activity</option>
            </select>
          </label>
          <div className="admin-user-filter-actions">
            <button className="btn ghost small" type="button" onClick={loadUsers}>
              Refresh data
            </button>
            <button className="btn ghost small" type="button" onClick={resetFilters}>
              Reset filters
            </button>
          </div>
        </div>

        <div className="admin-chip-row">
          {reviewQueues.map((queue) => (
            <button key={queue.id} type="button" className={`admin-role-chip ${queue.active ? "active" : ""}`} onClick={queue.apply}>
              {queue.label} <strong>{queue.count}</strong>
            </button>
          ))}
        </div>

        <div className="admin-chip-row">
          {USER_SAVED_VIEWS.map((view) => (
            <button
              key={view.id}
              type="button"
              className={`admin-role-chip ${activeSavedViewId === view.id ? "active" : ""}`}
              onClick={() => applySavedView(view.id)}
            >
              {view.label}
            </button>
          ))}
        </div>
      </section>

      <section className="admin-users-layout">
      <section className="admin-card">
        <div className="admin-card-header">
          <div>
            <div className="label">Directory</div>
            <h3>Users directory</h3>
          </div>
          <div className="admin-user-directory-actions">
            <div className="admin-view-toggle" role="group" aria-label="Users view">
              <button
                type="button"
                className={`admin-view-chip ${viewMode === "list" ? "active" : ""}`}
                onClick={() => setViewMode("list")}
              >
                List
              </button>
              <button
                type="button"
                className={`admin-view-chip ${viewMode === "cards" ? "active" : ""}`}
                onClick={() => setViewMode("cards")}
              >
                Cards
              </button>
            </div>
            <span className="admin-list-meta">
              {pageStart > 0 ? `Showing ${pageStart}-${pageEnd}` : "Showing 0"} | Page {page}
            </span>
          </div>
        </div>

        <div className="admin-pagination compact">
          <div className="admin-pagination-meta">
            {loading ? "Loading users..." : hasMore ? "More pages available" : "Last page reached"}
          </div>
          <label className="admin-pagination-size">
            Rows
            <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>
              {PAGE_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
          <div className="admin-pagination-actions">
            <button className="btn ghost small" type="button" onClick={() => setPage((prev) => Math.max(1, prev - 1))} disabled={page === 1 || loading}>
              Prev
            </button>
            <button className="btn ghost small" type="button" onClick={() => setPage((prev) => prev + 1)} disabled={!hasMore || loading}>
              Next
            </button>
          </div>
        </div>

        <div className="admin-bulk-bar">
          <span className="admin-meta">{selectedUserIds.length} selected</span>
          <button className="btn ghost small" type="button" onClick={() => setSelectedUserIds(filteredUsers.map((user) => user.id))}>
            Select all visible
          </button>
          <button className="btn ghost small" type="button" onClick={() => setSelectedUserIds([])}>
            Clear
          </button>
          <button className="btn ghost small" type="button" disabled={!selectedUserIds.length} onClick={() => handleBulkSave({ verification_status: "verified" }, "verified")}>
            Verify selected
          </button>
          <button className="btn ghost small" type="button" disabled={!selectedUserIds.length} onClick={() => handleBulkSave({ status: "locked" }, "locked")}>
            Lock selected
          </button>
          <button className="btn ghost small" type="button" disabled={!selectedUserIds.length} onClick={() => handleBulkSave({ status: "active" }, "activated")}>
            Activate selected
          </button>
        </div>

        {filteredUsers.length === 0 ? (
          <p className="admin-empty">
            {users.length === 0 ? "No users found for this page/filter." : "No users on this page match the local filters."}
          </p>
        ) : viewMode === "cards" ? (
          <div className="admin-user-grid compact">
            {filteredUsers.map((user) => {
              const crops = safeList(user.crops);
              const focus = safeList(user.focus_crops);
              const services = safeList(user.service_categories);
              const marketTotal = (user.market_listings || 0) + (user.market_alerts || 0) + (user.market_offers || 0);
              return (
                <article key={user.id} className={`admin-user-card compact ${selectedUser?.id === user.id ? "active" : ""}`} onClick={() => setSelectedUserId(user.id)}>
                  <div className="admin-user-card-head">
                    <label className="admin-check" onClick={(event) => event.stopPropagation()}>
                      <input type="checkbox" checked={selectedUserIds.includes(user.id)} onChange={() => toggleSelectedUser(user.id)} />
                      <span />
                    </label>
                    <div>
                      <div className="tile-title">{user.full_name || user.phone}</div>
                      <div className="tile-meta">{user.phone}</div>
                    </div>
                    <div className="admin-user-pill-stack">
                      <span className="pill">{roleLabel(user.role)}</span>
                      <span className={`pill ${user.verification_status === "verified" ? "" : "pill-muted"}`}>
                        {user.verification_status}
                      </span>
                    </div>
                  </div>

                  <div className="admin-user-meta-line">
                    <span>{user.email || "No email mapped"}</span>
                    <span>
                      {user.district || "--"} / {user.parish || "--"}
                    </span>
                  </div>

                  <div className="admin-user-stats compact">
                    <span>L {user.market_listings || 0}</span>
                    <span>A {user.market_alerts || 0}</span>
                    <span>O {user.market_offers || 0}</span>
                    <span>C {user.chat_messages || 0}</span>
                    <span>F {marketTotal}</span>
                  </div>

                  <div className="admin-user-row-meta">
                    Joined {formatDate(user.created_at)} | Last login {formatDateTime(user.last_login_at)}
                  </div>

                  <div className="admin-user-edit-grid compact">
                    <label className="admin-user-inline-field">
                      Role
                      <select value={userEdits[user.id]?.role ?? user.role} onChange={(event) => handleUserEdit(user.id, "role", event.target.value)}>
                        <option value="farmer">farmer</option>
                        <option value="buyer">buyer</option>
                        <option value="offtaker">offtaker</option>
                        <option value="service_provider">service_provider</option>
                        <option value="input_supplier">input_supplier</option>
                        <option value="admin">admin</option>
                      </select>
                    </label>
                    <label className="admin-user-inline-field">
                      Status
                      <select
                        value={userEdits[user.id]?.status ?? user.status}
                        onChange={(event) => handleUserEdit(user.id, "status", event.target.value)}
                      >
                        <option value="active">active</option>
                        <option value="pending">pending</option>
                        <option value="locked">locked</option>
                      </select>
                    </label>
                    <label className="admin-user-inline-field">
                      Verification
                      <select
                        value={userEdits[user.id]?.verification_status ?? user.verification_status}
                        onChange={(event) => handleUserEdit(user.id, "verification_status", event.target.value)}
                      >
                        <option value="verified">verified</option>
                        <option value="unverified">unverified</option>
                      </select>
                    </label>
                    <button className="btn small" type="button" onClick={() => handleUserSave(user.id)} disabled={userSaving[user.id]}>
                      {userSaving[user.id] ? "Saving..." : "Save"}
                    </button>
                  </div>

                  <div className="admin-user-hover-card">
                    <div className="admin-user-hover-head">
                      <strong>{user.full_name || user.phone}</strong>
                      <span>{titleCase(user.onboarding_stage || "completed")}</span>
                    </div>
                    <div className="admin-user-hover-item">
                      <span>Organization</span>
                      <strong>{user.organization_name || "--"}</strong>
                    </div>
                    <div className="admin-user-hover-item">
                      <span>Primary crops</span>
                      <strong>{crops.slice(0, 4).join(", ") || "--"}</strong>
                    </div>
                    <div className="admin-user-hover-item">
                      <span>Focus crops</span>
                      <strong>{focus.slice(0, 4).join(", ") || "--"}</strong>
                    </div>
                    <div className="admin-user-hover-item">
                      <span>Service categories</span>
                      <strong>{services.slice(0, 3).join(", ") || "--"}</strong>
                    </div>
                    <div className="admin-user-hover-activity">
                      <div className="label">Recent admin activity</div>
                      {user.recent_activity && user.recent_activity.length > 0 ? (
                        <ul>
                          {user.recent_activity.slice(0, 3).map((item, index) => (
                            <li key={`${user.id}-${item.action}-${index}`}>
                              <strong>{activityActionLabel(item.action)}</strong>
                              <span>{item.detail_summary || formatDateTime(item.created_at)}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="admin-empty">No recent admin actions linked to this user.</p>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="admin-user-list">
            {filteredUsers.map((user) => {
              const crops = safeList(user.crops);
              const focus = safeList(user.focus_crops);
              const services = safeList(user.service_categories);
              const marketTotal = (user.market_listings || 0) + (user.market_alerts || 0) + (user.market_offers || 0);
              return (
                <article key={user.id} className={`admin-user-list-row ${selectedUser?.id === user.id ? "active" : ""}`} onClick={() => setSelectedUserId(user.id)}>
                  <div className="admin-user-list-main">
                    <div>
                      <label className="admin-check" onClick={(event) => event.stopPropagation()}>
                        <input type="checkbox" checked={selectedUserIds.includes(user.id)} onChange={() => toggleSelectedUser(user.id)} />
                        <span />
                      </label>
                      <div className="tile-title">{user.full_name || user.phone}</div>
                      <div className="tile-meta">
                        {user.phone} | {user.email || "No email mapped"}
                      </div>
                    </div>

                  <div className="admin-user-meta-line">
                    <span>
                      {user.district || "--"} / {user.parish || "--"}
                    </span>
                    <span>{titleCase(user.onboarding_stage || "completed")}</span>
                    <span className="pill">{roleLabel(user.role)}</span>
                    <span className={`pill ${user.verification_status === "verified" ? "" : "pill-muted"}`}>{user.verification_status}</span>
                  </div>

                  <div className="admin-user-stats compact">
                    <span>L {user.market_listings || 0}</span>
                    <span>A {user.market_alerts || 0}</span>
                    <span>O {user.market_offers || 0}</span>
                    <span>C {user.chat_messages || 0}</span>
                    <span>F {marketTotal}</span>
                  </div>

                  <div className="admin-user-row-meta">
                    Joined {formatDate(user.created_at)} | Last login {formatDateTime(user.last_login_at)}
                  </div>
                  </div>

                  <div className="admin-user-list-actions">
                    <label className="admin-user-inline-field">
                      Role
                      <select value={userEdits[user.id]?.role ?? user.role} onChange={(event) => handleUserEdit(user.id, "role", event.target.value)}>
                        <option value="farmer">farmer</option>
                        <option value="buyer">buyer</option>
                        <option value="offtaker">offtaker</option>
                        <option value="service_provider">service_provider</option>
                        <option value="input_supplier">input_supplier</option>
                        <option value="admin">admin</option>
                      </select>
                    </label>
                    <label className="admin-user-inline-field">
                      Status
                      <select
                        value={userEdits[user.id]?.status ?? user.status}
                        onChange={(event) => handleUserEdit(user.id, "status", event.target.value)}
                      >
                        <option value="active">active</option>
                        <option value="pending">pending</option>
                        <option value="locked">locked</option>
                      </select>
                    </label>
                    <label className="admin-user-inline-field">
                      Verification
                      <select
                        value={userEdits[user.id]?.verification_status ?? user.verification_status}
                        onChange={(event) => handleUserEdit(user.id, "verification_status", event.target.value)}
                      >
                        <option value="verified">verified</option>
                        <option value="unverified">unverified</option>
                      </select>
                    </label>
                    <button className="btn small" type="button" onClick={() => handleUserSave(user.id)} disabled={userSaving[user.id]}>
                      {userSaving[user.id] ? "Saving..." : "Save"}
                    </button>
                  </div>

                  <div className="admin-user-hover-card admin-user-hover-card-list">
                    <div className="admin-user-hover-head">
                      <strong>{user.full_name || user.phone}</strong>
                      <span>{titleCase(user.onboarding_stage || "completed")}</span>
                    </div>
                    <div className="admin-user-hover-item">
                      <span>Organization</span>
                      <strong>{user.organization_name || "--"}</strong>
                    </div>
                    <div className="admin-user-hover-item">
                      <span>Primary crops</span>
                      <strong>{crops.slice(0, 4).join(", ") || "--"}</strong>
                    </div>
                    <div className="admin-user-hover-item">
                      <span>Focus crops</span>
                      <strong>{focus.slice(0, 4).join(", ") || "--"}</strong>
                    </div>
                    <div className="admin-user-hover-item">
                      <span>Service categories</span>
                      <strong>{services.slice(0, 3).join(", ") || "--"}</strong>
                    </div>
                    <div className="admin-user-hover-activity">
                      <div className="label">Recent admin activity</div>
                      {user.recent_activity && user.recent_activity.length > 0 ? (
                        <ul>
                          {user.recent_activity.slice(0, 3).map((item, index) => (
                            <li key={`${user.id}-${item.action}-${index}`}>
                              <strong>{activityActionLabel(item.action)}</strong>
                              <span>{item.detail_summary || formatDateTime(item.created_at)}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="admin-empty">No recent admin actions linked to this user.</p>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        <div className="admin-pagination">
          <div className="admin-pagination-meta">Page {page}</div>
          <div className="admin-pagination-actions">
            <button className="btn ghost small" type="button" onClick={() => setPage((prev) => Math.max(1, prev - 1))} disabled={page === 1 || loading}>
              Prev
            </button>
            <button className="btn ghost small" type="button" onClick={() => setPage((prev) => prev + 1)} disabled={!hasMore || loading}>
              Next
            </button>
          </div>
        </div>
      </section>

      <aside className="admin-card admin-user-focus-panel">
        {!selectedUser ? (
          <p className="admin-empty">Select a user to inspect profile, trust state, and activity context.</p>
        ) : (
          <>
            <div className="admin-card-header">
              <div>
                <div className="label">User detail</div>
                <h3>{selectedUser.full_name || selectedUser.phone}</h3>
              </div>
              <div className="admin-user-pill-stack">
                <span className="pill">{roleLabel(selectedUser.role)}</span>
                <span className={`pill ${selectedUser.verification_status === "verified" ? "" : "pill-muted"}`}>
                  {selectedUser.verification_status}
                </span>
              </div>
            </div>

            <div className="admin-user-focus-grid">
              <div>
                <span className="label">Phone</span>
                <strong>{selectedUser.phone}</strong>
              </div>
              <div>
                <span className="label">Email</span>
                <strong>{selectedUser.email || "--"}</strong>
              </div>
              <div>
                <span className="label">Location</span>
                <strong>{selectedUser.district || "--"}{selectedUser.parish ? `, ${selectedUser.parish}` : ""}</strong>
              </div>
              <div>
                <span className="label">Organization</span>
                <strong>{selectedUser.organization_name || "--"}</strong>
              </div>
              <div>
                <span className="label">Joined</span>
                <strong>{formatDate(selectedUser.created_at)}</strong>
              </div>
              <div>
                <span className="label">Last login</span>
                <strong>{formatDateTime(selectedUser.last_login_at)}</strong>
              </div>
            </div>

            <div className="admin-detail-block">
              <div className="label">Market footprint</div>
              <div className="admin-user-stats">
                <span>L {selectedUser.market_listings || 0}</span>
                <span>A {selectedUser.market_alerts || 0}</span>
                <span>O {selectedUser.market_offers || 0}</span>
                <span>C {selectedUser.chat_messages || 0}</span>
                <span>M {(selectedUser.market_listings || 0) + (selectedUser.market_alerts || 0) + (selectedUser.market_offers || 0)}</span>
              </div>
            </div>

            <div className="admin-detail-block">
              <div className="label">Profile signals</div>
              <div className="admin-chip-row">
                {selectedUser.onboarding_stage && <span className="admin-filter-chip">{titleCase(selectedUser.onboarding_stage)}</span>}
                {!selectedUser.last_login_at && <span className="admin-filter-chip">Never logged in</span>}
                {selectedUser.last_login_at && !withinDays(selectedUser.last_login_at, 30) && <span className="admin-filter-chip">Inactive 30d</span>}
                {safeList(selectedUser.service_categories).length > 0 && <span className="admin-filter-chip">Service categories mapped</span>}
                {safeList(selectedUser.crops).length > 0 && <span className="admin-filter-chip">Crop profile present</span>}
              </div>
            </div>

            <div className="admin-detail-block">
              <div className="label">Recent admin activity</div>
              {selectedUser.recent_activity && selectedUser.recent_activity.length > 0 ? (
                <div className="admin-mini-list">
                  {selectedUser.recent_activity.slice(0, 5).map((item, index) => (
                    <div key={`${selectedUser.id}-${item.action}-${index}`} className="admin-mini-row">
                      <div>
                        <strong>{activityActionLabel(item.action)}</strong>
                        <p>{item.detail_summary || formatDateTime(item.created_at)}</p>
                      </div>
                      <span className="admin-list-meta">{formatDateTime(item.created_at)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="admin-empty">No recent admin activity linked to this user.</p>
              )}
            </div>
          </>
        )}
      </aside>
      </section>
    </section>
  );
}
