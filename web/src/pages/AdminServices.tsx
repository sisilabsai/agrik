import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { DEFAULT_PLATFORM_SERVICES } from "../lib/platformServices";

type Service = {
  id: number;
  service_type: string;
  description?: string | null;
  price?: number | null;
  currency?: string | null;
  status: string;
  updated_at?: string | null;
};

type ServiceFilters = {
  service_type: string;
  status: string;
};

type ServiceDraft = {
  service_type: string;
  description: string;
  price: string;
  currency: string;
  status: string;
};

const defaultDraft: ServiceDraft = {
  service_type: "",
  description: "",
  price: "",
  currency: "UGX",
  status: "open",
};

const formatStatus = (value?: string | null) => {
  if (!value) return "--";
  if (value === "open") return "active";
  if (value === "closed") return "retired";
  return value;
};

function exportServicesCsv(items: Service[]) {
  const headers = ["id", "service_type", "description", "price", "currency", "status", "updated_at"];
  const csv = [
    headers.join(","),
    ...items.map((item) =>
      [item.id, item.service_type, item.description ?? "", item.price ?? "", item.currency ?? "UGX", item.status, item.updated_at ?? ""]
        .map((value) => `"${String(value).replace(/"/g, '""')}"`)
        .join(",")
    ),
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = `admin-services-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.csv`;
  anchor.click();
  URL.revokeObjectURL(href);
}

export default function AdminServices() {
  const [services, setServices] = useState<Service[]>([]);
  const [filters, setFilters] = useState<ServiceFilters>({ service_type: "", status: "" });
  const [draft, setDraft] = useState<ServiceDraft>(defaultDraft);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [selectedServiceId, setSelectedServiceId] = useState<number | null>(null);
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

  const loadServices = useCallback(() => {
    setError(null);
    const query = buildQuery({
      service_type: filters.service_type,
      status: filters.status,
      limit: "40",
    });
    api
      .adminServices(query)
      .then((res) => {
        const rows = (res as { items: Service[] }).items || [];
        setServices(rows);
        setSelectedServiceId((current) => (current && rows.some((item) => item.id === current) ? current : rows[0]?.id ?? null));
      })
      .catch(() => setError("Unable to load services."));
  }, [filters]);

  useEffect(() => {
    loadServices();
  }, [loadServices]);

  const serviceTypes = useMemo(() => {
    const catalog = new Set(DEFAULT_PLATFORM_SERVICES);
    services.forEach((service) => {
      if (service.service_type) {
        catalog.add(service.service_type);
      }
    });
    return Array.from(catalog);
  }, [services]);

  const resetDraft = () => {
    setDraft(defaultDraft);
    setEditingId(null);
  };

  const startEdit = (service: Service) => {
    setEditingId(service.id);
    setDraft({
      service_type: service.service_type ?? "",
      description: service.description ?? "",
      price: service.price ? String(service.price) : "",
      currency: service.currency ?? "UGX",
      status: service.status ?? "open",
    });
  };

  const handleSave = async () => {
    setError(null);
    setStatusMessage(null);
    if (!draft.service_type.trim()) {
      setError("Service selection is required.");
      return;
    }

    const payload = {
      service_type: draft.service_type,
      description: draft.description || null,
      price: draft.price ? Number(draft.price) : null,
      currency: draft.currency || "UGX",
      status: draft.status || "open",
    };

    setSaving(true);
    try {
      if (editingId) {
        await api.adminUpdateService(editingId, payload);
        setStatusMessage(`Service #${editingId} updated.`);
      } else {
        await api.adminCreateService(payload);
        setStatusMessage("Service created.");
      }
      resetDraft();
      loadServices();
    } catch {
      setError("Unable to save service.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (serviceId: number) => {
    setError(null);
    setStatusMessage(null);
    try {
      await api.adminDeleteService(serviceId);
      loadServices();
      setStatusMessage(`Service #${serviceId} deleted.`);
    } catch {
      setError("Unable to delete service.");
    }
  };

  const handleSeed = async () => {
    setSaving(true);
    setError(null);
    setStatusMessage(null);
    try {
      const result = (await api.adminSeedServices({ service_types: null })) as { created: number };
      await loadServices();
      setStatusMessage(`${result.created} default services added.`);
    } catch {
      setError("Unable to seed default services.");
    } finally {
      setSaving(false);
    }
  };

  const selectedService = useMemo(
    () => services.find((service) => service.id === selectedServiceId) ?? services[0] ?? null,
    [selectedServiceId, services]
  );

  const summary = useMemo(
    () => ({
      total: services.length,
      active: services.filter((service) => service.status === "open").length,
      paused: services.filter((service) => service.status === "paused").length,
      incomplete: services.filter((service) => !service.description || service.price == null).length,
    }),
    [services]
  );

  return (
    <section className="admin-page">
      <div className="admin-page-header">
        <div>
          <div className="label">Services</div>
          <h1>Platform subscription services</h1>
          <p className="muted">Internal AGRIK services users subscribe to (separate from marketplace offerings).</p>
        </div>
      </div>

      {error && <p className="status error">{error}</p>}
      {statusMessage && <p className="status">{statusMessage}</p>}

      <div className="admin-kpi-grid">
        {[
          { label: "Catalog", value: summary.total, meta: "Platform services listed" },
          { label: "Active", value: summary.active, meta: "Currently sellable" },
          { label: "Paused", value: summary.paused, meta: "Temporarily withheld" },
          { label: "Incomplete", value: summary.incomplete, meta: "Need pricing or summary" },
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
            <div className="label">Create service</div>
            <h3>{editingId ? "Edit platform service" : "New platform service"}</h3>
          </div>
          <div className="admin-page-actions">
            <button className="btn ghost small" type="button" onClick={handleSeed} disabled={saving}>
              Seed defaults
            </button>
            {editingId && (
              <button className="btn ghost small" type="button" onClick={resetDraft}>
                Cancel edit
              </button>
            )}
          </div>
        </div>

        <div className="settings-grid admin-form-grid">
          <label className="field">
            Service
            <select value={draft.service_type} onChange={(event) => setDraft((prev) => ({ ...prev, service_type: event.target.value }))}>
              <option value="">Select service</option>
              {serviceTypes.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Summary
            <input
              placeholder="What subscribers receive, channels, and who it's for."
              value={draft.description}
              onChange={(event) => setDraft((prev) => ({ ...prev, description: event.target.value }))}
            />
          </label>
          <label className="field">
            Price (subscription)
            <input type="number" value={draft.price} onChange={(event) => setDraft((prev) => ({ ...prev, price: event.target.value }))} />
          </label>
          <label className="field">
            Currency
            <input value={draft.currency} onChange={(event) => setDraft((prev) => ({ ...prev, currency: event.target.value }))} />
          </label>
          <label className="field">
            Status
            <select value={draft.status} onChange={(event) => setDraft((prev) => ({ ...prev, status: event.target.value }))}>
              <option value="open">active</option>
              <option value="paused">paused</option>
              <option value="closed">retired</option>
            </select>
          </label>
          <button className="btn" type="button" onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : editingId ? "Save changes" : "Create service"}
          </button>
        </div>
      </section>

      <section className="admin-listings-layout">
      <section className="admin-card">
        <div className="admin-card-header">
          <div>
            <div className="label">Service catalog</div>
            <h3>Manage platform services</h3>
          </div>
          <div className="admin-filter-bar">
            <button className="btn ghost small" type="button" onClick={() => exportServicesCsv(services)}>
              Export filtered
            </button>
            <select value={filters.service_type} onChange={(event) => setFilters((prev) => ({ ...prev, service_type: event.target.value }))}>
              <option value="">All services</option>
              {serviceTypes.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
            <select value={filters.status} onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))}>
              <option value="">All status</option>
              <option value="open">active</option>
              <option value="paused">paused</option>
              <option value="closed">retired</option>
            </select>
            <button className="btn ghost small" type="button" onClick={loadServices}>
              Apply
            </button>
          </div>
        </div>

        {services.length === 0 ? (
          <p className="admin-empty">No platform services listed.</p>
        ) : (
          <div className="admin-table">
            {services.map((service) => (
              <div key={service.id} className={`admin-row admin-price-row ${selectedService?.id === service.id ? "active" : ""}`} onClick={() => setSelectedServiceId(service.id)}>
                <div className="admin-row-main">
                  <div className="tile-title">{service.service_type}</div>
                  <div className="tile-meta">{service.description || "No description provided."}</div>
                  <div className="admin-row-meta">
                    {service.currency ?? "UGX"} {service.price ?? "--"}
                  </div>
                </div>
                <div className="admin-actions">
                  <span className="pill">{formatStatus(service.status)}</span>
                  <button className="btn ghost small" type="button" onClick={(event) => { event.stopPropagation(); startEdit(service); }}>
                    Edit
                  </button>
                  <button className="btn ghost small" type="button" onClick={(event) => { event.stopPropagation(); handleDelete(service.id); }}>
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <aside className="admin-card admin-listing-detail">
        {!selectedService ? (
          <p className="admin-empty">Select a service to inspect completeness and pricing.</p>
        ) : (
          <>
            <div className="admin-card-header">
              <div>
                <div className="label">Service detail</div>
                <h3>{selectedService.service_type}</h3>
              </div>
              <span className={`pill ${selectedService.status === "open" ? "" : "pill-muted"}`}>{formatStatus(selectedService.status)}</span>
            </div>

            <div className="admin-detail-grid">
              <div>
                <span className="label">Price</span>
                <strong>{selectedService.currency ?? "UGX"} {selectedService.price ?? "--"}</strong>
              </div>
              <div>
                <span className="label">Updated</span>
                <strong>{selectedService.updated_at ? new Date(selectedService.updated_at).toLocaleDateString() : "--"}</strong>
              </div>
            </div>

            <div className="admin-detail-block">
              <div className="label">Summary</div>
              <p>{selectedService.description || "No service summary provided."}</p>
            </div>

            <div className="admin-detail-block">
              <div className="label">Catalog notes</div>
              <div className="admin-chip-row">
                {!selectedService.description && <span className="admin-filter-chip">Summary missing</span>}
                {selectedService.price == null && <span className="admin-filter-chip">Price missing</span>}
                {selectedService.status === "paused" && <span className="admin-filter-chip">Paused offering</span>}
              </div>
            </div>
          </>
        )}
      </aside>
      </section>
    </section>
  );
}
