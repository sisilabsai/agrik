import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import AdminActiveDateChips from "../components/AdminActiveDateChips";
import { api } from "../lib/api";

type Alert = {
  id: number;
  user_id: string;
  target_phone?: string | null;
  alert_type: string;
  crop?: string | null;
  threshold?: number | null;
  channel?: string | null;
  active: boolean;
  min_interval_hours: number;
  last_notified_at?: string | null;
  created_at?: string;
  location?: { district?: string | null; parish?: string | null } | null;
};

type MetadataUser = {
  id: string;
  phone: string;
  role: string;
};

type Metadata = {
  crops: string[];
  districts: string[];
  parishes: string[];
  alert_types: string[];
  channels: string[];
  users: MetadataUser[];
};

type AlertFilters = {
  alert_type: string;
  crop: string;
  district: string;
  active_only: boolean;
};

type DateRangeFilter = {
  from: string;
  to: string;
};

type AlertDraft = {
  phone: string;
  alert_type: string;
  crop: string;
  threshold: string;
  channel: string;
  active: boolean;
  frequency_per_week: string;
  district: string;
  parish: string;
};

type RecipientMode = "single" | "role" | "manual";

type AlertTemplate = {
  id: string;
  label: string;
  description: string;
  alert_type: string;
  channel: string;
  frequency_per_week: string;
  roleSuggestion?: string;
};

const defaultDraft: AlertDraft = {
  phone: "",
  alert_type: "",
  crop: "",
  threshold: "",
  channel: "sms",
  active: true,
  frequency_per_week: "1",
  district: "",
  parish: "",
};

const templates: AlertTemplate[] = [
  {
    id: "weather-risk",
    label: "Weather risk",
    description: "Quick weather signal for farmers in a district.",
    alert_type: "weather",
    channel: "sms",
    frequency_per_week: "3",
    roleSuggestion: "farmer",
  },
  {
    id: "price-watch",
    label: "Price watch",
    description: "Notify traders when a crop crosses a threshold.",
    alert_type: "price",
    channel: "sms",
    frequency_per_week: "7",
    roleSuggestion: "buyer",
  },
  {
    id: "market-broadcast",
    label: "Market broadcast",
    description: "General admin broadcast to a role group.",
    alert_type: "general",
    channel: "sms",
    frequency_per_week: "1",
    roleSuggestion: "farmer",
  },
];

function parseAlertsQuery(search: string): { filters: AlertFilters; dateRange: DateRangeFilter } {
  const params = new URLSearchParams(search);
  return {
    filters: {
      alert_type: params.get("alert_type") ?? "",
      crop: params.get("crop") ?? "",
      district: params.get("district") ?? "",
      active_only: (params.get("active_only") ?? "").toLowerCase() === "true",
    },
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

function formatDate(value?: string | null) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleDateString();
}

function frequencyToHours(frequency: string) {
  const count = Number(frequency);
  if (!count || count <= 0) return 24;
  return Math.max(1, Math.round(168 / count));
}

function hoursToFrequency(hours: number) {
  if (!hours || hours <= 0) return "1";
  return String(Math.max(1, Math.round(168 / hours)));
}

function roleLabel(role: string) {
  return role
    .split("_")
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

function exportAlertsCsv(items: Alert[]) {
  const headers = ["id", "target_phone", "alert_type", "crop", "threshold", "channel", "active", "district", "parish", "last_notified_at", "created_at"];
  const csv = [
    headers.join(","),
    ...items.map((item) =>
      [
        item.id,
        item.target_phone ?? item.user_id,
        item.alert_type,
        item.crop ?? "",
        item.threshold ?? "",
        item.channel ?? "",
        item.active ? "active" : "paused",
        item.location?.district ?? "",
        item.location?.parish ?? "",
        item.last_notified_at ?? "",
        item.created_at ?? "",
      ]
        .map((value) => `"${String(value).replace(/"/g, '""')}"`)
        .join(",")
    ),
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = `admin-alerts-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.csv`;
  anchor.click();
  URL.revokeObjectURL(href);
}

export default function AdminAlerts() {
  const location = useLocation();
  const queryInit = useMemo(() => parseAlertsQuery(location.search), [location.search]);
  const syncSearchRef = useRef(location.search);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [metadata, setMetadata] = useState<Metadata | null>(null);
  const [filters, setFilters] = useState<AlertFilters>(queryInit.filters);
  const [dateRange, setDateRange] = useState<DateRangeFilter>(queryInit.dateRange);
  const [draft, setDraft] = useState<AlertDraft>(defaultDraft);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [selectedAlertId, setSelectedAlertId] = useState<number | null>(null);
  const [recipientMode, setRecipientMode] = useState<RecipientMode>("role");
  const [roleAudience, setRoleAudience] = useState("");
  const [singlePhone, setSinglePhone] = useState("");
  const [manualPhones, setManualPhones] = useState<string[]>([]);
  const [recipientSearch, setRecipientSearch] = useState("");
  const [recipientRoleFilter, setRecipientRoleFilter] = useState("");
  const [activeTemplateId, setActiveTemplateId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const buildQuery = (params: Record<string, string>) => {
    const search = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value) search.set(key, value);
    });
    const query = search.toString();
    return query ? `?${query}` : "";
  };

  const loadMetadata = useCallback(() => {
    api
      .adminMetadata()
      .then((res) => setMetadata(res as Metadata))
      .catch(() => setMetadata(null));
  }, []);

  const loadAlerts = useCallback(() => {
    setError(null);
    const query = buildQuery({
      alert_type: filters.alert_type,
      crop: filters.crop,
      district: filters.district,
      active_only: filters.active_only ? "true" : "",
      limit: "2000",
    });
    api
      .adminAlerts(query)
      .then((res) => {
        const rows = (res as { items: Alert[] }).items || [];
        setAlerts(rows);
        setSelectedAlertId((current) => (current && rows.some((item) => item.id === current) ? current : rows[0]?.id ?? null));
      })
      .catch(() => setError("Unable to load alerts."));
  }, [filters]);

  useEffect(() => {
    loadMetadata();
    loadAlerts();
  }, [loadAlerts, loadMetadata]);

  useEffect(() => {
    if (location.search === syncSearchRef.current) return;
    syncSearchRef.current = location.search;
    const query = parseAlertsQuery(location.search);
    setFilters(query.filters);
    setDateRange(query.dateRange);
  }, [location.search]);

  const alertTypes = useMemo(() => metadata?.alert_types?.length ? metadata.alert_types : ["price", "weather", "general"], [metadata]);
  const crops = useMemo(() => metadata?.crops ?? [], [metadata]);
  const districts = useMemo(() => metadata?.districts ?? [], [metadata]);
  const parishes = useMemo(() => metadata?.parishes ?? [], [metadata]);
  const channels = useMemo(() => metadata?.channels ?? ["sms", "email", "push"], [metadata]);
  const userOptions = useMemo(() => metadata?.users ?? [], [metadata]);
  const roleOptions = useMemo(() => Array.from(new Set(userOptions.map((user) => user.role))).sort(), [userOptions]);

  const filteredAlerts = useMemo(() => {
    const fromMs = parseDateBoundary(dateRange.from, false);
    const toMs = parseDateBoundary(dateRange.to, true);
    if (fromMs == null && toMs == null) return alerts;
    return alerts.filter((alert) => {
      const createdMs = Date.parse(alert.created_at ?? "");
      if (Number.isNaN(createdMs)) return false;
      if (fromMs != null && createdMs < fromMs) return false;
      if (toMs != null && createdMs > toMs) return false;
      return true;
    });
  }, [alerts, dateRange.from, dateRange.to]);

  const selectedAlert = useMemo(
    () => filteredAlerts.find((alert) => alert.id === selectedAlertId) ?? filteredAlerts[0] ?? null,
    [filteredAlerts, selectedAlertId]
  );

  const summary = useMemo(
    () => ({
      total: filteredAlerts.length,
      active: filteredAlerts.filter((alert) => alert.active).length,
      paused: filteredAlerts.filter((alert) => !alert.active).length,
      highFrequency: filteredAlerts.filter((alert) => alert.min_interval_hours <= 24).length,
    }),
    [filteredAlerts]
  );

  const composerUsers = useMemo(() => {
    const q = recipientSearch.trim().toLowerCase();
    return userOptions.filter((user) => {
      if (recipientRoleFilter && user.role !== recipientRoleFilter) return false;
      if (!q) return true;
      return `${user.phone} ${user.role}`.toLowerCase().includes(q);
    });
  }, [recipientRoleFilter, recipientSearch, userOptions]);

  const computedRecipientPhones = useMemo(() => {
    if (editingId) return draft.phone ? [draft.phone] : [];
    if (recipientMode === "single") return singlePhone ? [singlePhone] : [];
    if (recipientMode === "role") {
      if (!roleAudience) return [];
      return userOptions.filter((user) => user.role === roleAudience).map((user) => user.phone);
    }
    return manualPhones;
  }, [draft.phone, editingId, manualPhones, recipientMode, roleAudience, singlePhone, userOptions]);

  const computedRecipients = useMemo(
    () => userOptions.filter((user) => computedRecipientPhones.includes(user.phone)),
    [computedRecipientPhones, userOptions]
  );

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === activeTemplateId) ?? null,
    [activeTemplateId]
  );

  const resetComposer = () => {
    setDraft(defaultDraft);
    setEditingId(null);
    setRecipientMode("role");
    setRoleAudience("");
    setSinglePhone("");
    setManualPhones([]);
    setRecipientSearch("");
    setRecipientRoleFilter("");
    setActiveTemplateId("");
  };

  const applyTemplate = (template: AlertTemplate) => {
    setActiveTemplateId(template.id);
    setDraft((prev) => ({
      ...prev,
      alert_type: alertTypes.includes(template.alert_type) ? template.alert_type : prev.alert_type || template.alert_type,
      channel: channels.includes(template.channel) ? template.channel : prev.channel,
      frequency_per_week: template.frequency_per_week,
      active: true,
    }));
    setRecipientMode(template.roleSuggestion ? "role" : "manual");
    if (template.roleSuggestion) setRoleAudience(template.roleSuggestion);
  };

  const startEdit = (alert: Alert) => {
    setEditingId(alert.id);
    setDraft({
      phone: alert.target_phone ?? "",
      alert_type: alert.alert_type ?? "",
      crop: alert.crop ?? "",
      threshold: alert.threshold ? String(alert.threshold) : "",
      channel: alert.channel ?? "sms",
      active: alert.active,
      frequency_per_week: hoursToFrequency(alert.min_interval_hours),
      district: alert.location?.district ?? "",
      parish: alert.location?.parish ?? "",
    });
    setActiveTemplateId("");
    setRecipientSearch("");
    setRecipientRoleFilter("");
  };

  const toggleManualPhone = (phone: string) => {
    setManualPhones((current) => (current.includes(phone) ? current.filter((item) => item !== phone) : [...current, phone]));
  };

  const handleSave = async () => {
    setError(null);
    setStatusMessage(null);

    if (!draft.alert_type.trim()) {
      setError("Alert type is required.");
      return;
    }

    const targetPhones = Array.from(new Set(computedRecipientPhones.filter((phone) => phone.trim())));
    if (!editingId && targetPhones.length === 0) {
      setError("Pick an audience before creating the alert.");
      return;
    }

    const payload = {
      alert_type: draft.alert_type,
      crop: draft.crop || null,
      threshold: draft.threshold ? Number(draft.threshold) : null,
      channel: draft.channel || "sms",
      active: draft.active,
      min_interval_hours: frequencyToHours(draft.frequency_per_week),
      location: draft.district || draft.parish ? { district: draft.district || null, parish: draft.parish || null } : undefined,
    };

    setSaving(true);
    try {
      if (editingId) {
        await api.adminUpdateAlert(editingId, payload);
      } else if (targetPhones.length === 1) {
        await api.adminCreateAlert({ phone: targetPhones[0], ...payload });
      } else {
        await api.adminCreateAlertBulk({ phones: targetPhones, ...payload });
      }
      resetComposer();
      await loadAlerts();
      setStatusMessage(editingId ? `Alert #${editingId} updated.` : `Alert created for ${targetPhones.length} recipient${targetPhones.length === 1 ? "" : "s"}.`);
    } catch {
      setError("Unable to save alert.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (alertId: number) => {
    setError(null);
    setStatusMessage(null);
    try {
      await api.adminDeleteAlert(alertId);
      await loadAlerts();
      setStatusMessage(`Alert #${alertId} deleted.`);
    } catch {
      setError("Unable to delete alert.");
    }
  };

  const toggleAlertActive = async (alert: Alert, nextActive: boolean) => {
    setSaving(true);
    setError(null);
    setStatusMessage(null);
    const previous = alert.active;
    setAlerts((current) => current.map((item) => (item.id === alert.id ? { ...item, active: nextActive } : item)));
    try {
      await api.adminUpdateAlert(alert.id, { active: nextActive });
      setStatusMessage(`Alert #${alert.id} ${nextActive ? "resumed" : "paused"}.`);
    } catch {
      setAlerts((current) => current.map((item) => (item.id === alert.id ? { ...item, active: previous } : item)));
      setError("Unable to update alert state.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="admin-page admin-alerts-page">
      <div className="admin-page-header">
        <div>
          <div className="label">Alerts</div>
          <h1>Alert management</h1>
          <p className="muted">Compose alerts from templates, choose the right audience mode, and send with clear targeting context.</p>
        </div>
      </div>

      {error && <p className="status error">{error}</p>}
      {statusMessage && <p className="status">{statusMessage}</p>}
      <AdminActiveDateChips from={dateRange.from} to={dateRange.to} />

      <div className="admin-kpi-grid">
        {[
          { label: "Alerts", value: summary.total, meta: "Current filtered set" },
          { label: "Active", value: summary.active, meta: "Delivering signals" },
          { label: "Paused", value: summary.paused, meta: "Needs review or restart" },
          { label: "High frequency", value: summary.highFrequency, meta: "At least weekly or faster" },
        ].map((item) => (
          <div key={item.label} className="admin-kpi-card">
            <div className="admin-kpi-label">{item.label}</div>
            <div className="admin-kpi-value">{item.value}</div>
            <div className="admin-kpi-meta">{item.meta}</div>
          </div>
        ))}
      </div>

      <section className="admin-listings-layout">
        <div className="admin-stack">
          <section className="admin-card admin-alert-composer">
            <div className="admin-card-header">
              <div>
                <div className="label">New alert</div>
                <h3>{editingId ? "Edit alert" : "Alert composer"}</h3>
              </div>
              <div className="admin-page-actions">
                {editingId && (
                  <button className="btn ghost small" type="button" onClick={resetComposer}>
                    Cancel edit
                  </button>
                )}
              </div>
            </div>

            {!editingId && (
              <div className="admin-alert-template-grid">
                {templates.map((template) => (
                  <button
                    key={template.id}
                    type="button"
                    className={`admin-alert-template ${activeTemplateId === template.id ? "active" : ""}`}
                    onClick={() => applyTemplate(template)}
                  >
                    <strong>{template.label}</strong>
                    <p>{template.description}</p>
                  </button>
                ))}
              </div>
            )}

            <div className="admin-alert-compose-layout">
              <div className="admin-alert-compose-main">
                {!editingId ? (
                  <section className="admin-detail-block">
                    <div className="label">Audience</div>

                    <div className="admin-chip-row">
                      {[
                        { id: "role", label: "Role group" },
                        { id: "single", label: "Single recipient" },
                        { id: "manual", label: "Manual selection" },
                      ].map((mode) => (
                        <button
                          key={mode.id}
                          type="button"
                          className={`admin-role-chip ${recipientMode === mode.id ? "active" : ""}`}
                          onClick={() => setRecipientMode(mode.id as RecipientMode)}
                        >
                          {mode.label}
                        </button>
                      ))}
                    </div>

                    {recipientMode === "role" && (
                      <div className="admin-alert-role-grid">
                        {roleOptions.map((role) => (
                          <button
                            key={role}
                            type="button"
                            className={`admin-role-chip ${roleAudience === role ? "active" : ""}`}
                            onClick={() => setRoleAudience((current) => (current === role ? "" : role))}
                          >
                            {roleLabel(role)}
                            <strong>{userOptions.filter((user) => user.role === role).length}</strong>
                          </button>
                        ))}
                      </div>
                    )}

                    {recipientMode === "single" && (
                      <label className="field">
                        Recipient
                        <select value={singlePhone} onChange={(event) => setSinglePhone(event.target.value)}>
                          <option value="">Select recipient</option>
                          {userOptions.map((user) => (
                            <option key={user.id} value={user.phone}>
                              {user.phone} ({roleLabel(user.role)})
                            </option>
                          ))}
                        </select>
                      </label>
                    )}

                    {recipientMode === "manual" && (
                      <div className="admin-alert-manual-picker">
                        <div className="admin-filter-bar">
                          <input
                            placeholder="Search phone or role"
                            value={recipientSearch}
                            onChange={(event) => setRecipientSearch(event.target.value)}
                          />
                          <select value={recipientRoleFilter} onChange={(event) => setRecipientRoleFilter(event.target.value)}>
                            <option value="">All roles</option>
                            {roleOptions.map((role) => (
                              <option key={role} value={role}>
                                {roleLabel(role)}
                              </option>
                            ))}
                          </select>
                          <button
                            className="btn ghost small"
                            type="button"
                            onClick={() => setManualPhones(composerUsers.map((user) => user.phone))}
                          >
                            Select shown
                          </button>
                          <button className="btn ghost small" type="button" onClick={() => setManualPhones([])}>
                            Clear
                          </button>
                        </div>

                        <div className="admin-alert-recipient-list">
                          {composerUsers.map((user) => (
                            <button
                              key={user.id}
                              type="button"
                              className={`admin-alert-recipient ${manualPhones.includes(user.phone) ? "active" : ""}`}
                              onClick={() => toggleManualPhone(user.phone)}
                            >
                              <strong>{user.phone}</strong>
                              <span>{roleLabel(user.role)}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {!!computedRecipients.length && (
                      <div className="admin-alert-selected-list">
                        {computedRecipients.slice(0, 10).map((user) => (
                          <span key={user.id} className="admin-filter-chip">
                            {user.phone} <strong>{roleLabel(user.role)}</strong>
                          </span>
                        ))}
                        {computedRecipients.length > 10 && <span className="admin-filter-chip">+{computedRecipients.length - 10} more</span>}
                      </div>
                    )}
                  </section>
                ) : (
                  <section className="admin-detail-block">
                    <div className="label">Target receiver</div>
                    <p>{draft.phone || "--"}</p>
                  </section>
                )}

                <div className="settings-grid admin-form-grid admin-alert-form-grid">
                  <label className="field">
                    Alert type
                    <select value={draft.alert_type} onChange={(event) => setDraft((prev) => ({ ...prev, alert_type: event.target.value }))}>
                      <option value="">Select type</option>
                      {alertTypes.map((item) => (
                        <option key={item} value={item}>
                          {item}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    Crop
                    <select value={draft.crop} onChange={(event) => setDraft((prev) => ({ ...prev, crop: event.target.value }))}>
                      <option value="">Select crop</option>
                      {crops.map((item) => (
                        <option key={item} value={item}>
                          {item}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    Threshold
                    <input type="number" value={draft.threshold} onChange={(event) => setDraft((prev) => ({ ...prev, threshold: event.target.value }))} />
                  </label>
                  <label className="field">
                    Channel
                    <select value={draft.channel} onChange={(event) => setDraft((prev) => ({ ...prev, channel: event.target.value }))}>
                      {channels.map((item) => (
                        <option key={item} value={item}>
                          {item}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    Status
                    <select value={draft.active ? "active" : "paused"} onChange={(event) => setDraft((prev) => ({ ...prev, active: event.target.value === "active" }))}>
                      <option value="active">active</option>
                      <option value="paused">paused</option>
                    </select>
                  </label>
                  <label className="field">
                    Frequency (times per week)
                    <input
                      type="number"
                      min={1}
                      max={14}
                      value={draft.frequency_per_week}
                      onChange={(event) => setDraft((prev) => ({ ...prev, frequency_per_week: event.target.value }))}
                    />
                  </label>
                  <label className="field">
                    District
                    <select value={draft.district} onChange={(event) => setDraft((prev) => ({ ...prev, district: event.target.value }))}>
                      <option value="">Select district</option>
                      {districts.map((item) => (
                        <option key={item} value={item}>
                          {item}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    Parish
                    <select value={draft.parish} onChange={(event) => setDraft((prev) => ({ ...prev, parish: event.target.value }))}>
                      <option value="">Select parish</option>
                      {parishes.map((item) => (
                        <option key={item} value={item}>
                          {item}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>

              <aside className="admin-alert-preview">
                <div>
                  <div className="label">Preview</div>
                  <h4>{draft.alert_type || selectedTemplate?.label || "New alert"}</h4>
                </div>
                <div className="admin-alert-preview-stats">
                  <div>
                    <span>Audience</span>
                    <strong>{computedRecipientPhones.length}</strong>
                  </div>
                  <div>
                    <span>Channel</span>
                    <strong>{draft.channel || "sms"}</strong>
                  </div>
                  <div>
                    <span>Cadence</span>
                    <strong>Every {frequencyToHours(draft.frequency_per_week)}h</strong>
                  </div>
                  <div>
                    <span>Location</span>
                    <strong>{draft.district || "All districts"}</strong>
                  </div>
                </div>
                <div className="admin-detail-block">
                  <div className="label">Send summary</div>
                  <p>
                    {editingId
                      ? `Update alert for ${draft.phone || "selected receiver"}.`
                      : recipientMode === "role" && roleAudience
                        ? `Create a ${draft.alert_type || "new"} alert for all ${roleLabel(roleAudience).toLowerCase()} accounts.`
                        : recipientMode === "single" && singlePhone
                          ? `Create a ${draft.alert_type || "new"} alert for ${singlePhone}.`
                          : `Create a ${draft.alert_type || "new"} alert for the selected manual audience.`}
                  </p>
                </div>
                <button className="btn" type="button" onClick={handleSave} disabled={saving}>
                  {saving ? "Saving..." : editingId ? "Save alert" : "Create alert"}
                </button>
              </aside>
            </div>
          </section>

          <section className="admin-card">
            <div className="admin-card-header">
              <div>
                <div className="label">Alert directory</div>
                <h3>Active and scheduled alerts</h3>
              </div>
              <div className="admin-filter-bar">
                <button className="btn ghost small" type="button" onClick={() => exportAlertsCsv(filteredAlerts)}>
                  Export filtered
                </button>
                <select value={filters.alert_type} onChange={(event) => setFilters((prev) => ({ ...prev, alert_type: event.target.value }))}>
                  <option value="">All types</option>
                  {alertTypes.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
                <select value={filters.crop} onChange={(event) => setFilters((prev) => ({ ...prev, crop: event.target.value }))}>
                  <option value="">All crops</option>
                  {crops.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
                <select value={filters.district} onChange={(event) => setFilters((prev) => ({ ...prev, district: event.target.value }))}>
                  <option value="">All districts</option>
                  {districts.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
                <select value={filters.active_only ? "active" : ""} onChange={(event) => setFilters((prev) => ({ ...prev, active_only: event.target.value === "active" }))}>
                  <option value="">All alerts</option>
                  <option value="active">Active only</option>
                </select>
                <button className="btn ghost small" type="button" onClick={loadAlerts}>
                  Apply
                </button>
              </div>
            </div>

            {filteredAlerts.length === 0 ? (
              <p className="admin-empty">No alerts configured.</p>
            ) : (
              <div className="admin-table">
                {filteredAlerts.map((alert) => (
                  <div key={alert.id} className={`admin-row ${selectedAlert?.id === alert.id ? "admin-price-row active" : ""}`} onClick={() => setSelectedAlertId(alert.id)}>
                    <div className="admin-row-main">
                      <div className="tile-title">{alert.alert_type.toUpperCase()}</div>
                      <div className="tile-meta">
                        {alert.target_phone ?? alert.user_id} | {alert.crop ?? "--"} | {alert.threshold ?? "--"} | {alert.channel ?? "sms"}
                      </div>
                      <div className="admin-row-meta">
                        {alert.location?.district ?? "--"} | Every {alert.min_interval_hours}h | Last sent {formatDate(alert.last_notified_at)} | Created {formatDate(alert.created_at)}
                      </div>
                    </div>
                    <div className="admin-actions">
                      <span className={`pill ${alert.active ? "" : "pill-muted"}`}>{alert.active ? "active" : "paused"}</span>
                      <button className="btn ghost small" type="button" onClick={(event) => { event.stopPropagation(); startEdit(alert); }}>
                        Edit
                      </button>
                      <button className="btn ghost small" type="button" onClick={(event) => { event.stopPropagation(); toggleAlertActive(alert, !alert.active); }}>
                        {alert.active ? "Pause" : "Resume"}
                      </button>
                      <button className="btn ghost small" type="button" onClick={(event) => { event.stopPropagation(); handleDelete(alert.id); }}>
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <aside className="admin-card admin-listing-detail">
          {!selectedAlert ? (
            <p className="admin-empty">Select an alert to inspect targeting and delivery cadence.</p>
          ) : (
            <>
              <div className="admin-card-header">
                <div>
                  <div className="label">Alert detail</div>
                  <h3>{selectedAlert.alert_type.toUpperCase()}</h3>
                </div>
                <span className={`pill ${selectedAlert.active ? "" : "pill-muted"}`}>{selectedAlert.active ? "Active" : "Paused"}</span>
              </div>

              <div className="admin-detail-grid">
                <div>
                  <span className="label">Target</span>
                  <strong>{selectedAlert.target_phone ?? selectedAlert.user_id}</strong>
                </div>
                <div>
                  <span className="label">Channel</span>
                  <strong>{selectedAlert.channel ?? "sms"}</strong>
                </div>
                <div>
                  <span className="label">Crop</span>
                  <strong>{selectedAlert.crop ?? "--"}</strong>
                </div>
                <div>
                  <span className="label">Location</span>
                  <strong>
                    {selectedAlert.location?.district ?? "--"}
                    {selectedAlert.location?.parish ? `, ${selectedAlert.location?.parish}` : ""}
                  </strong>
                </div>
                <div>
                  <span className="label">Frequency</span>
                  <strong>Every {selectedAlert.min_interval_hours}h</strong>
                </div>
                <div>
                  <span className="label">Last sent</span>
                  <strong>{formatDate(selectedAlert.last_notified_at)}</strong>
                </div>
              </div>

              <div className="admin-detail-block">
                <div className="label">Operational notes</div>
                <div className="admin-chip-row">
                  {selectedAlert.threshold != null && <span className="admin-filter-chip">Threshold {selectedAlert.threshold}</span>}
                  {selectedAlert.min_interval_hours <= 24 && <span className="admin-filter-chip">High frequency</span>}
                  {!selectedAlert.last_notified_at && <span className="admin-filter-chip">Never sent</span>}
                </div>
              </div>
            </>
          )}
        </aside>
      </section>
    </section>
  );
}
