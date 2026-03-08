import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import { NavLink } from "react-router-dom";
import { Icon } from "../components/Visuals";
import { api } from "../lib/api";
import { useAuth } from "../state/auth";
import {
  asRecord,
  average,
  formatCompactDate,
  formatMoney,
  normalizeProviderService,
  toNumberValue,
  toStringValue,
  uniqueValues,
  type ProviderServiceListing,
} from "./providerUtils";

type ServiceDraft = {
  serviceType: string;
  description: string;
  coverageRadiusKm: string;
  price: string;
  currency: string;
  status: string;
  district: string;
  parish: string;
};

type ViewMode = "list" | "cards";
type SortMode = "updated" | "newest" | "price_desc" | "price_asc" | "type";

const CURRENCY_OPTIONS = ["UGX", "USD", "KES", "TZS"];
const STATUS_OPTIONS = ["open", "paused", "closed"];
const PAGE_SIZE_OPTIONS = [8, 12, 20];
const DEFAULT_SERVICE_TYPES = [
  "Mechanic",
  "Tractor rental",
  "Irrigation setup",
  "Transport",
  "Input supply",
  "Harvesting crew",
  "Storage and warehousing",
  "Soil testing",
  "Spraying service",
  "Financial services",
  "Other",
];

function emptyDraft(): ServiceDraft {
  return {
    serviceType: "",
    description: "",
    coverageRadiusKm: "",
    price: "",
    currency: "UGX",
    status: "open",
    district: "",
    parish: "",
  };
}

function toOptionalNumber(value: string): number | null {
  const parsed = toNumberValue(value);
  return parsed == null ? null : parsed;
}

export default function ProviderMarketplace() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [savingCreate, setSavingCreate] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [uploadingEditMediaId, setUploadingEditMediaId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [myServices, setMyServices] = useState<ProviderServiceListing[]>([]);
  const [districtOptions, setDistrictOptions] = useState<string[]>([]);
  const [parishOptions, setParishOptions] = useState<string[]>([]);
  const [editParishOptions, setEditParishOptions] = useState<string[]>([]);
  const [serviceTypeOptions, setServiceTypeOptions] = useState<string[]>(DEFAULT_SERVICE_TYPES);

  const [draft, setDraft] = useState<ServiceDraft>(emptyDraft());
  const [draftMediaUrls, setDraftMediaUrls] = useState<string[]>([]);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [districtFilter, setDistrictFilter] = useState("all");
  const [sortMode, setSortMode] = useState<SortMode>("updated");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(12);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<ServiceDraft>(emptyDraft());
  const [editMediaUrls, setEditMediaUrls] = useState<string[]>([]);

  const loadData = () => {
    if (!user?.phone) return;
    setLoading(true);
    setError(null);
    Promise.allSettled([
      api.profileDetails(),
      api.referenceDistricts(),
      api.onboardingOptions(),
      api.marketServices(`?phone=${encodeURIComponent(user.phone)}&limit=320`),
    ])
      .then(([profileRes, districtsRes, onboardingRes, servicesRes]) => {
        if (profileRes.status === "fulfilled") {
          const profileDistrict = toStringValue(profileRes.value.settings?.district);
          const profileParish = toStringValue(profileRes.value.settings?.parish);
          setDraft((prev) => ({
            ...prev,
            district: prev.district || profileDistrict,
            parish: prev.parish || profileParish,
          }));
        }

        if (districtsRes.status === "fulfilled") {
          const names = (districtsRes.value.items ?? []).map((item) => toStringValue(item.name)).filter(Boolean);
          setDistrictOptions(uniqueValues(names));
        } else {
          setDistrictOptions([]);
        }

        if (onboardingRes.status === "fulfilled") {
          const onboardingLabels = (onboardingRes.value.service_categories ?? []).map((item) => toStringValue(item.label)).filter(Boolean);
          setServiceTypeOptions(uniqueValues([...DEFAULT_SERVICE_TYPES, ...onboardingLabels]));
        } else {
          setServiceTypeOptions(DEFAULT_SERVICE_TYPES);
        }

        if (servicesRes.status === "fulfilled") {
          setMyServices((servicesRes.value.items ?? []).map((item) => normalizeProviderService(item)).filter((item): item is ProviderServiceListing => item != null));
        } else {
          setMyServices([]);
        }
      })
      .catch(() => setError("Unable to load provider services workspace."))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!user?.phone) return;
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.phone]);

  useEffect(() => {
    if (!draft.district) {
      setParishOptions([]);
      return;
    }
    api
      .referenceParishes(draft.district)
      .then((response) => {
        const names = (response.items ?? []).map((item) => toStringValue(item.name)).filter(Boolean);
        setParishOptions(uniqueValues(names));
      })
      .catch(() => setParishOptions([]));
  }, [draft.district]);

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter, districtFilter, sortMode, pageSize]);

  const openServices = useMemo(() => myServices.filter((item) => item.status.toLowerCase() === "open").length, [myServices]);
  const pausedServices = useMemo(() => myServices.filter((item) => item.status.toLowerCase() === "paused").length, [myServices]);
  const mediaReadyServices = useMemo(() => myServices.filter((item) => item.mediaUrls.length > 0).length, [myServices]);
  const avgPrice = useMemo(() => average(myServices.map((item) => item.price).filter((value): value is number => value != null && value > 0)), [myServices]);
  const coverageDistricts = useMemo(() => new Set(myServices.map((item) => item.district).filter(Boolean)).size, [myServices]);
  const servicesMissingPrice = useMemo(() => myServices.filter((item) => item.price == null || item.price <= 0).length, [myServices]);
  const staleServices = useMemo(
    () => myServices.filter((item) => ((Date.now() - Date.parse(item.updatedAt || item.createdAt || "")) / (1000 * 60 * 60 * 24)) > 14).length,
    [myServices]
  );

  const serviceDistrictOptions = useMemo(() => uniqueValues([...districtOptions, ...myServices.map((item) => item.district)]), [districtOptions, myServices]);

  const filteredServices = useMemo(() => {
    const text = search.trim().toLowerCase();
    const rows = myServices
      .filter((item) => (statusFilter === "all" ? true : item.status.toLowerCase() === statusFilter))
      .filter((item) => (districtFilter === "all" ? true : item.district === districtFilter))
      .filter((item) => {
        if (!text) return true;
        return [item.serviceType, item.description, item.district, item.parish].some((value) => value.toLowerCase().includes(text));
      });

    return [...rows].sort((left, right) => {
      if (sortMode === "newest") return Date.parse(right.createdAt || "") - Date.parse(left.createdAt || "");
      if (sortMode === "price_desc") return (right.price ?? -1) - (left.price ?? -1);
      if (sortMode === "price_asc") return (left.price ?? Number.MAX_SAFE_INTEGER) - (right.price ?? Number.MAX_SAFE_INTEGER);
      if (sortMode === "type") return left.serviceType.localeCompare(right.serviceType);
      return Date.parse(right.updatedAt || right.createdAt || "") - Date.parse(left.updatedAt || left.createdAt || "");
    });
  }, [districtFilter, myServices, search, sortMode, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredServices.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageItems = filteredServices.slice((safePage - 1) * pageSize, safePage * pageSize);
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (search.trim()) count += 1;
    if (statusFilter !== "all") count += 1;
    if (districtFilter !== "all") count += 1;
    if (sortMode !== "updated") count += 1;
    return count;
  }, [districtFilter, search, sortMode, statusFilter]);
  const publishingChecklist = useMemo(
    () => [
      { label: "Open services", detail: `${openServices} currently visible to demand`, done: openServices > 0 },
      { label: "Media proof", detail: `${mediaReadyServices} services with images or video`, done: mediaReadyServices >= Math.max(1, Math.ceil(myServices.length / 2)) },
      { label: "Pricing", detail: servicesMissingPrice === 0 ? "All services priced" : `${servicesMissingPrice} still missing price`, done: servicesMissingPrice === 0 },
      { label: "Fresh updates", detail: staleServices === 0 ? "Catalog recently updated" : `${staleServices} listings need review`, done: staleServices === 0 },
    ],
    [mediaReadyServices, myServices.length, openServices, servicesMissingPrice, staleServices]
  );
  const highlightServices = useMemo(() => filteredServices.slice(0, 3), [filteredServices]);

  const onDraftChange = <K extends keyof ServiceDraft>(field: K, value: ServiceDraft[K]) => {
    setDraft((prev) => ({ ...prev, [field]: value }));
  };

  const onEditChange = <K extends keyof ServiceDraft>(field: K, value: ServiceDraft[K]) => {
    setEditDraft((prev) => ({ ...prev, [field]: value }));
  };

  const resetEdit = () => {
    setEditingId(null);
    setEditDraft(emptyDraft());
    setEditMediaUrls([]);
    setEditParishOptions([]);
  };

  const startEdit = (service: ProviderServiceListing) => {
    setEditingId(service.id);
    setEditDraft({
      serviceType: service.serviceType,
      description: service.description,
      coverageRadiusKm: service.coverageRadiusKm == null ? "" : String(service.coverageRadiusKm),
      price: service.price == null ? "" : String(service.price),
      currency: service.currency || "UGX",
      status: service.status || "open",
      district: service.district,
      parish: service.parish,
    });
    setEditMediaUrls(service.mediaUrls);
    if (service.district) {
      api
        .referenceParishes(service.district)
        .then((response) => {
          const names = (response.items ?? []).map((item) => toStringValue(item.name)).filter(Boolean);
          setEditParishOptions(uniqueValues(names));
        })
        .catch(() => setEditParishOptions([]));
    } else {
      setEditParishOptions([]);
    }
  };

  const onUploadMedia = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) return;
    setUploadingMedia(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api.marketUploadMedia({ files });
      const uploaded = (result.items ?? []).map((item) => toStringValue(asRecord(item).url)).filter(Boolean);
      setDraftMediaUrls((prev) => uniqueValues([...prev, ...uploaded]));
      if (uploaded.length > 0) {
        setMessage(`${uploaded.length} media file${uploaded.length === 1 ? "" : "s"} uploaded.`);
      }
    } catch {
      setError("Unable to upload media files.");
    } finally {
      setUploadingMedia(false);
    }
  };

  const onUploadEditMedia = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (editingId == null || files.length === 0) return;
    setUploadingEditMediaId(editingId);
    setError(null);
    setMessage(null);
    try {
      const result = await api.marketUploadMedia({ files });
      const uploaded = (result.items ?? []).map((item) => toStringValue(asRecord(item).url)).filter(Boolean);
      setEditMediaUrls((prev) => uniqueValues([...prev, ...uploaded]));
      if (uploaded.length > 0) {
        setMessage(`${uploaded.length} media file${uploaded.length === 1 ? "" : "s"} uploaded to edit draft.`);
      }
    } catch {
      setError("Unable to upload media files.");
    } finally {
      setUploadingEditMediaId(null);
    }
  };

  const removeCreateMedia = (url: string) => {
    setDraftMediaUrls((prev) => prev.filter((item) => item !== url));
  };

  const removeEditMedia = (url: string) => {
    setEditMediaUrls((prev) => prev.filter((item) => item !== url));
  };

  const handleCreateService = async (event: FormEvent) => {
    event.preventDefault();
    if (!user?.phone) return;
    if (!draft.serviceType.trim()) {
      setError("Service type is required.");
      return;
    }
    if (!draft.district.trim()) {
      setError("District is required.");
      return;
    }
    setSavingCreate(true);
    setError(null);
    setMessage(null);
    try {
      await api.marketCreateService({
        phone: user.phone,
        service_type: draft.serviceType.trim(),
        description: draft.description.trim() || undefined,
        media_urls: draftMediaUrls,
        coverage_radius_km: toOptionalNumber(draft.coverageRadiusKm) ?? undefined,
        price: toOptionalNumber(draft.price) ?? undefined,
        currency: draft.currency || "UGX",
        status: draft.status || "open",
        location: {
          district: draft.district.trim(),
          parish: draft.parish.trim() || undefined,
        },
      });
      setMessage("Service published.");
      setDraft((prev) => ({
        ...prev,
        description: "",
        coverageRadiusKm: "",
        price: "",
      }));
      setDraftMediaUrls([]);
      loadData();
    } catch {
      setError("Unable to publish service.");
    } finally {
      setSavingCreate(false);
    }
  };

  const handleSaveEdit = async () => {
    if (editingId == null) return;
    if (!editDraft.serviceType.trim()) {
      setError("Service type is required.");
      return;
    }
    if (!editDraft.district.trim()) {
      setError("District is required.");
      return;
    }

    setSavingEdit(true);
    setError(null);
    setMessage(null);
    try {
      await api.marketUpdateService(editingId, {
        service_type: editDraft.serviceType.trim(),
        description: editDraft.description.trim() || null,
        media_urls: editMediaUrls,
        coverage_radius_km: toOptionalNumber(editDraft.coverageRadiusKm),
        price: toOptionalNumber(editDraft.price),
        currency: editDraft.currency || "UGX",
        status: editDraft.status || "open",
        location: {
          district: editDraft.district.trim() || null,
          parish: editDraft.parish.trim() || null,
        },
      });
      setMessage("Service updated.");
      resetEdit();
      loadData();
    } catch {
      setError("Unable to update service.");
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDelete = async (serviceId: number) => {
    if (!window.confirm("Delete this service listing?")) return;
    setDeletingId(serviceId);
    setError(null);
    setMessage(null);
    try {
      await api.marketDeleteService(serviceId);
      setMessage("Service deleted.");
      if (editingId === serviceId) {
        resetEdit();
      }
      loadData();
    } catch {
      setError("Unable to delete service.");
    } finally {
      setDeletingId(null);
    }
  };

  const renderServiceItem = (item: ProviderServiceListing) => {
    const isEditing = editingId === item.id;
    return (
      <article key={item.id} className={`provider-service-item ${isEditing ? "editing" : ""}`}>
        <div className="provider-service-main">
          <div className="provider-service-head">
            <strong>{item.serviceType}</strong>
            <span className={`provider-status-pill status-${item.status.toLowerCase()}`}>{item.status}</span>
          </div>
          <p>{item.description || "No service description provided."}</p>
          <div className="provider-service-meta">
            <span>{item.price != null ? formatMoney(item.price, item.currency) : "Price by quote"}</span>
            <span>{item.coverageRadiusKm != null ? `${item.coverageRadiusKm} km` : "Coverage n/a"}</span>
            <span>{[item.parish, item.district].filter(Boolean).join(", ") || "Location --"}</span>
            <span>{item.mediaUrls.length} media</span>
            <span>Updated {formatCompactDate(item.updatedAt || item.createdAt)}</span>
          </div>
        </div>
        <div className="provider-service-actions">
          <button className="btn ghost tiny" type="button" onClick={() => (isEditing ? resetEdit() : startEdit(item))}>
            {isEditing ? "Close" : "Edit"}
          </button>
          <button className="btn ghost tiny danger" type="button" disabled={deletingId === item.id} onClick={() => handleDelete(item.id)}>
            {deletingId === item.id ? "Deleting..." : "Delete"}
          </button>
        </div>

        {isEditing ? (
          <div className="provider-edit-panel">
            <div className="provider-edit-grid">
              <label className="field">
                Service type
                <input list={`service-types-${item.id}`} value={editDraft.serviceType} onChange={(event) => onEditChange("serviceType", event.target.value)} />
                <datalist id={`service-types-${item.id}`}>
                  {serviceTypeOptions.map((option) => (
                    <option key={option} value={option} />
                  ))}
                </datalist>
              </label>
              <label className="field">
                Status
                <select value={editDraft.status} onChange={(event) => onEditChange("status", event.target.value)}>
                  {STATUS_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Price
                <input type="number" min="0" value={editDraft.price} onChange={(event) => onEditChange("price", event.target.value)} placeholder="120000" />
              </label>
              <label className="field">
                Currency
                <select value={editDraft.currency} onChange={(event) => onEditChange("currency", event.target.value)}>
                  {CURRENCY_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Coverage radius (km)
                <input
                  type="number"
                  min="0"
                  value={editDraft.coverageRadiusKm}
                  onChange={(event) => onEditChange("coverageRadiusKm", event.target.value)}
                  placeholder="20"
                />
              </label>
              <label className="field">
                District
                <select
                  value={editDraft.district}
                  onChange={(event) => {
                    const nextDistrict = event.target.value;
                    onEditChange("district", nextDistrict);
                    onEditChange("parish", "");
                    if (!nextDistrict) {
                      setEditParishOptions([]);
                      return;
                    }
                    api
                      .referenceParishes(nextDistrict)
                      .then((response) => {
                        const names = (response.items ?? []).map((row) => toStringValue(row.name)).filter(Boolean);
                        setEditParishOptions(uniqueValues(names));
                      })
                      .catch(() => setEditParishOptions([]));
                  }}
                >
                  <option value="">Select district</option>
                  {serviceDistrictOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Parish
                {editParishOptions.length > 0 ? (
                  <select value={editDraft.parish} onChange={(event) => onEditChange("parish", event.target.value)}>
                    <option value="">Select parish</option>
                    {editParishOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input value={editDraft.parish} onChange={(event) => onEditChange("parish", event.target.value)} placeholder="Parish" />
                )}
              </label>
              <label className="field provider-edit-span">
                Description
                <textarea rows={2} value={editDraft.description} onChange={(event) => onEditChange("description", event.target.value)} />
              </label>
              <label className="field provider-edit-span">
                Add media
                <input type="file" multiple accept="image/*" onChange={onUploadEditMedia} disabled={uploadingEditMediaId === item.id} />
              </label>
            </div>
            {editMediaUrls.length > 0 ? (
              <div className="provider-media-strip">
                {editMediaUrls.map((url, index) => (
                  <div key={`${item.id}-${url}-${index}`} className="provider-media-item">
                    <a href={url} target="_blank" rel="noreferrer" className="market-media-thumb">
                      <img src={url} alt={`Service ${item.id} media ${index + 1}`} loading="lazy" />
                    </a>
                    <button type="button" className="btn ghost tiny" onClick={() => removeEditMedia(url)}>
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="farmer-inline-meta">No media attached.</div>
            )}
            <div className="provider-edit-actions">
              <button className="btn small" type="button" onClick={handleSaveEdit} disabled={savingEdit || uploadingEditMediaId === item.id}>
                {savingEdit ? "Saving..." : "Save updates"}
              </button>
              <button className="btn ghost small" type="button" onClick={resetEdit}>
                Cancel
              </button>
            </div>
          </div>
        ) : null}
      </article>
    );
  };

  if (loading) return <section className="farmer-page provider-page">Loading provider services...</section>;

  return (
    <section className="farmer-page provider-page provider-workspace-neo provider-services-neo">
      <section className="provider-workspace-hero">
        <div className="provider-workspace-hero-main">
          <div className="section-title-with-icon">
            <span className="section-icon">
              <Icon name="services" size={18} />
            </span>
            <div>
              <div className="label">Service operations</div>
              <h1>Run your service catalog with less friction.</h1>
              <p className="muted">Publish faster, keep listings fresh, and fix catalog gaps before they reduce trust or lead quality.</p>
            </div>
          </div>
          <div className="provider-header-actions">
            <NavLink className="btn ghost small" to="/provider/leads">
              Open leads
            </NavLink>
            <NavLink className="btn small" to="/provider/marketing">
              Marketing studio
            </NavLink>
          </div>
          <div className="provider-overview-tags">
            <span>{coverageDistricts} districts</span>
            <span>{mediaReadyServices} with media</span>
            <span>{servicesMissingPrice} missing price</span>
          </div>
        </div>
        <aside className="provider-workspace-sidecard">
          <div className="provider-panel-header">
            <div>
              <div className="label">Catalog health</div>
              <h3>What to fix next</h3>
            </div>
          </div>
          <div className="provider-checklist compact">
            {publishingChecklist.map((item) => (
              <article key={item.label} className={`provider-check-item ${item.done ? "done" : ""}`}>
                <div>
                  <strong>{item.label}</strong>
                  <p>{item.detail}</p>
                </div>
                <span className={`provider-check-pill ${item.done ? "done" : "pending"}`}>{item.done ? "Done" : "Check"}</span>
              </article>
            ))}
          </div>
        </aside>
      </section>

      {(message || error) && <p className={`status ${error ? "error" : ""}`}>{error ?? message}</p>}

      <div className="provider-kpi-grid">
        <article className="provider-kpi-card">
          <div className="provider-kpi-label">Total services</div>
          <div className="provider-kpi-value">{myServices.length}</div>
          <div className="provider-kpi-meta">Your provider listings</div>
        </article>
        <article className="provider-kpi-card">
          <div className="provider-kpi-label">Open services</div>
          <div className="provider-kpi-value">{openServices}</div>
          <div className="provider-kpi-meta">Currently discoverable</div>
        </article>
        <article className="provider-kpi-card">
          <div className="provider-kpi-label">Paused services</div>
          <div className="provider-kpi-value">{pausedServices}</div>
          <div className="provider-kpi-meta">Need review or reopening</div>
        </article>
        <article className="provider-kpi-card">
          <div className="provider-kpi-label">Coverage districts</div>
          <div className="provider-kpi-value">{coverageDistricts}</div>
          <div className="provider-kpi-meta">Live operational footprint</div>
        </article>
        <article className="provider-kpi-card">
          <div className="provider-kpi-label">Avg listed price</div>
          <div className="provider-kpi-value">{avgPrice != null ? formatMoney(avgPrice, "UGX") : "--"}</div>
          <div className="provider-kpi-meta">{mediaReadyServices} with media evidence</div>
        </article>
      </div>

      <div className="provider-two-col provider-two-col-emphasis">
        <section className="farmer-card provider-panel">
          <div className="provider-panel-header">
            <div>
              <div className="label">New service</div>
              <h3>Publish service listing</h3>
            </div>
          </div>
          <form className="provider-form-grid" onSubmit={handleCreateService}>
          <label className="field">
            Service type
            <input list="provider-service-options" value={draft.serviceType} onChange={(event) => onDraftChange("serviceType", event.target.value)} />
            <datalist id="provider-service-options">
              {serviceTypeOptions.map((option) => (
                <option key={option} value={option} />
              ))}
            </datalist>
          </label>
          <label className="field">
            Status
            <select value={draft.status} onChange={(event) => onDraftChange("status", event.target.value)}>
              {STATUS_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            District
            <select value={draft.district} onChange={(event) => onDraftChange("district", event.target.value)}>
              <option value="">Select district</option>
              {serviceDistrictOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Parish
            {parishOptions.length > 0 ? (
              <select value={draft.parish} onChange={(event) => onDraftChange("parish", event.target.value)}>
                <option value="">Select parish</option>
                {parishOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            ) : (
              <input value={draft.parish} onChange={(event) => onDraftChange("parish", event.target.value)} placeholder="Parish" />
            )}
          </label>
          <label className="field">
            Price
            <input type="number" min="0" value={draft.price} onChange={(event) => onDraftChange("price", event.target.value)} placeholder="100000" />
          </label>
          <label className="field">
            Currency
            <select value={draft.currency} onChange={(event) => onDraftChange("currency", event.target.value)}>
              {CURRENCY_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Coverage radius (km)
            <input
              type="number"
              min="0"
              value={draft.coverageRadiusKm}
              onChange={(event) => onDraftChange("coverageRadiusKm", event.target.value)}
              placeholder="25"
            />
          </label>
          <label className="field provider-form-span">
            Description
            <textarea
              rows={2}
              value={draft.description}
              onChange={(event) => onDraftChange("description", event.target.value)}
              placeholder="Service scope, turnaround time, and requirements."
            />
          </label>
          <label className="field provider-form-span">
            Upload media evidence
            <input type="file" multiple accept="image/*" onChange={onUploadMedia} disabled={uploadingMedia} />
          </label>
          {draftMediaUrls.length > 0 ? (
            <div className="provider-media-strip provider-form-span">
              {draftMediaUrls.map((url, index) => (
                <div key={`${url}-${index}`} className="provider-media-item">
                  <a href={url} target="_blank" rel="noreferrer" className="market-media-thumb">
                    <img src={url} alt={`Uploaded media ${index + 1}`} loading="lazy" />
                  </a>
                  <button type="button" className="btn ghost tiny" onClick={() => removeCreateMedia(url)}>
                    Remove
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          <div className="provider-form-actions">
            <button className="btn" type="submit" disabled={savingCreate || uploadingMedia}>
              {savingCreate ? "Publishing..." : uploadingMedia ? "Uploading..." : "Publish service"}
            </button>
          </div>
          </form>
        </section>

        <section className="farmer-card provider-panel provider-guide-panel">
          <div className="provider-panel-header">
            <div>
              <div className="label">Quick guide</div>
              <h3>Publish listings that convert</h3>
            </div>
          </div>
          <div className="provider-guide-steps">
            <article>
              <strong>1</strong>
              <p>Use a clear service type and district so matching works immediately.</p>
            </article>
            <article>
              <strong>2</strong>
              <p>Add a working price and coverage radius to reduce back-and-forth.</p>
            </article>
            <article>
              <strong>3</strong>
              <p>Upload real work evidence. Media-ready listings build trust faster.</p>
            </article>
          </div>
          <div className="provider-highlight-list">
            {highlightServices.length === 0 ? (
              <p className="muted">Your strongest listings will appear here once you publish them.</p>
            ) : (
              highlightServices.map((item) => (
                <article key={item.id} className="provider-highlight-item">
                  <div>
                    <strong>{item.serviceType}</strong>
                    <p>{[item.parish, item.district].filter(Boolean).join(", ") || "Location pending"}</p>
                  </div>
                  <span>{item.mediaUrls.length > 0 ? "Media" : "No media"}</span>
                </article>
              ))
            )}
          </div>
        </section>
      </div>

      <section className="farmer-card provider-panel">
        <div className="provider-panel-header">
          <div>
            <div className="label">Service library</div>
            <h3>Manage existing listings</h3>
          </div>
          <div className="provider-view-toggle" role="group" aria-label="Service view mode">
            <button type="button" className={viewMode === "list" ? "active" : ""} onClick={() => setViewMode("list")}>
              List
            </button>
            <button type="button" className={viewMode === "cards" ? "active" : ""} onClick={() => setViewMode("cards")}>
              Cards
            </button>
          </div>
        </div>

        <div className="provider-filter-row">
          <label className="field">
            Search
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Service, district, description" />
          </label>
          <label className="field">
            Status
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="all">All statuses</option>
              {STATUS_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            District
            <select value={districtFilter} onChange={(event) => setDistrictFilter(event.target.value)}>
              <option value="all">All districts</option>
              {serviceDistrictOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Sort by
            <select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)}>
              <option value="updated">Recently updated</option>
              <option value="newest">Newest created</option>
              <option value="price_desc">Price high-low</option>
              <option value="price_asc">Price low-high</option>
              <option value="type">Service type</option>
            </select>
          </label>
        </div>

        <div className="provider-submeta-row">
          <span>{filteredServices.length} services in view</span>
          <span>{activeFilterCount ? `${activeFilterCount} filters applied` : "No filters applied"}</span>
        </div>

        {pageItems.length === 0 ? (
          <p className="muted">No service listings match your filters.</p>
        ) : (
          <div className={viewMode === "cards" ? "provider-service-grid" : "provider-service-list"}>{pageItems.map((item) => renderServiceItem(item))}</div>
        )}

        <div className="provider-pagination">
          <div className="provider-pagination-meta">
            Showing {pageItems.length === 0 ? 0 : (safePage - 1) * pageSize + 1}-{Math.min(safePage * pageSize, filteredServices.length)} of {filteredServices.length}
          </div>
          <label className="provider-pagination-size">
            Per page
            <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>
              {PAGE_SIZE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <div className="provider-pagination-actions">
            <button type="button" className="btn ghost tiny" disabled={safePage <= 1} onClick={() => setPage((prev) => Math.max(1, prev - 1))}>
              Previous
            </button>
            <span>
              Page {safePage} / {totalPages}
            </span>
            <button
              type="button"
              className="btn ghost tiny"
              disabled={safePage >= totalPages}
              onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
            >
              Next
            </button>
          </div>
        </div>
      </section>
    </section>
  );
}
