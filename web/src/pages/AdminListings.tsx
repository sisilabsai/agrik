import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import AdminActiveDateChips from "../components/AdminActiveDateChips";
import { api } from "../lib/api";

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
  grade?: string | null;
  description?: string | null;
  contact_name?: string | null;
  contact_phone?: string | null;
  contact_whatsapp?: string | null;
  media_urls?: string[];
  availability_start?: string | null;
  availability_end?: string | null;
  location?: { district?: string | null; parish?: string | null } | null;
  created_at?: string | null;
};

type Metadata = {
  crops: string[];
  districts: string[];
};

type ListingFilters = {
  q: string;
  crop: string;
  district: string;
  role: string;
  status: string;
  queue: string;
};

type DateRangeFilter = {
  from: string;
  to: string;
};

type ListingDraft = {
  price: string;
  quantity: string;
  unit: string;
  currency: string;
  grade: string;
};

function parseListingsQuery(search: string): { filters: ListingFilters; dateRange: DateRangeFilter } {
  const params = new URLSearchParams(search);
  return {
    filters: {
      q: params.get("q") ?? "",
      crop: params.get("crop") ?? "",
      district: params.get("district") ?? "",
      role: params.get("role") ?? "",
      status: params.get("status") ?? "",
      queue: params.get("queue") ?? "",
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

function formatDate(value?: string | null): string {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleDateString();
}

function formatCurrency(value?: number | null, currency = "UGX"): string {
  if (value == null) return "--";
  return `${currency} ${new Intl.NumberFormat().format(Math.round(value))}`;
}

function isOlderThan(value: string | null | undefined, days: number): boolean {
  if (!value) return false;
  const stamp = Date.parse(value);
  if (Number.isNaN(stamp)) return false;
  return Date.now() - stamp > days * 24 * 60 * 60 * 1000;
}

const queueDefinitions = [
  { id: "", label: "All" },
  { id: "quality", label: "Quality watch" },
  { id: "stale", label: "Stale" },
  { id: "no-media", label: "No media" },
  { id: "no-contact", label: "No contact" },
  { id: "buyer", label: "Buyer demand" },
  { id: "seller", label: "Seller supply" },
];

function moderationStatusLabel(status: string): string {
  if (status === "open") return "Approved";
  if (status === "paused") return "Paused";
  if (status === "closed") return "Closed";
  return status;
}

function buildDraft(listing: Listing | null): ListingDraft {
  if (!listing) {
    return { price: "", quantity: "", unit: "", currency: "UGX", grade: "" };
  }
  return {
    price: listing.price == null ? "" : String(listing.price),
    quantity: listing.quantity == null ? "" : String(listing.quantity),
    unit: listing.unit ?? "",
    currency: listing.currency ?? "UGX",
    grade: listing.grade ?? "",
  };
}

export default function AdminListings() {
  const location = useLocation();
  const queryInit = useMemo(() => parseListingsQuery(location.search), [location.search]);
  const syncSearchRef = useRef(location.search);
  const [listings, setListings] = useState<Listing[]>([]);
  const [metadata, setMetadata] = useState<Metadata | null>(null);
  const [filters, setFilters] = useState<ListingFilters>(queryInit.filters);
  const [dateRange, setDateRange] = useState<DateRangeFilter>(queryInit.dateRange);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [focusedId, setFocusedId] = useState<number | null>(null);
  const [draft, setDraft] = useState<ListingDraft>(buildDraft(null));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  const loadListings = useCallback(() => {
    setError(null);
    const query = buildQuery({
      crop: filters.crop,
      district: filters.district,
      role: filters.role,
      status: filters.status,
      limit: "1500",
    });
    api
      .adminListings(query)
      .then((res) => {
        setListings((res as { items: Listing[] }).items || []);
        setStatusMessage(null);
      })
      .catch(() => setError("Unable to load listings."));
  }, [filters.crop, filters.district, filters.role, filters.status]);

  useEffect(() => {
    loadMetadata();
    loadListings();
  }, [loadListings, loadMetadata]);

  useEffect(() => {
    if (location.search === syncSearchRef.current) return;
    syncSearchRef.current = location.search;
    const query = parseListingsQuery(location.search);
    setFilters(query.filters);
    setDateRange(query.dateRange);
  }, [location.search]);

  const visibleListings = useMemo(() => {
    const query = filters.q.trim().toLowerCase();
    const fromMs = parseDateBoundary(dateRange.from, false);
    const toMs = parseDateBoundary(dateRange.to, true);

    return listings.filter((listing) => {
      const createdMs = Date.parse(listing.created_at ?? "");
      if (fromMs != null && (Number.isNaN(createdMs) || createdMs < fromMs)) return false;
      if (toMs != null && (Number.isNaN(createdMs) || createdMs > toMs)) return false;

      if (query) {
        const haystack = [
          listing.crop,
          listing.role,
          listing.description,
          listing.location?.district,
          listing.location?.parish,
          listing.contact_phone,
          listing.contact_whatsapp,
          listing.contact_name,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(query)) return false;
      }

      if (filters.queue === "stale" && !isOlderThan(listing.created_at, 14)) return false;
      if (filters.queue === "no-media" && (listing.media_urls?.length ?? 0) > 0) return false;
      if (filters.queue === "no-contact" && (listing.contact_phone || listing.contact_whatsapp)) return false;
      if (
        filters.queue === "quality" &&
        !(
          (listing.media_urls?.length ?? 0) === 0 ||
          (!listing.contact_phone && !listing.contact_whatsapp) ||
          listing.price == null ||
          isOlderThan(listing.created_at, 14)
        )
      ) {
        return false;
      }
      if (filters.queue === "buyer" && listing.role !== "buyer") return false;
      if (filters.queue === "seller" && listing.role !== "seller") return false;

      return true;
    });
  }, [dateRange.from, dateRange.to, filters.q, filters.queue, listings]);

  useEffect(() => {
    if (!visibleListings.length) {
      setFocusedId(null);
      setSelectedIds([]);
      return;
    }
    setFocusedId((current) => (current && visibleListings.some((item) => item.id === current) ? current : visibleListings[0].id));
    setSelectedIds((current) => current.filter((id) => visibleListings.some((item) => item.id === id)));
  }, [visibleListings]);

  const focusedListing = useMemo(
    () => visibleListings.find((item) => item.id === focusedId) ?? visibleListings[0] ?? null,
    [focusedId, visibleListings]
  );

  useEffect(() => {
    setDraft(buildDraft(focusedListing));
  }, [focusedListing]);

  const summary = useMemo(
    () => ({
      total: visibleListings.length,
      open: visibleListings.filter((item) => item.status === "open").length,
      flagged: visibleListings.filter(
        (item) =>
          (item.media_urls?.length ?? 0) === 0 ||
          (!item.contact_phone && !item.contact_whatsapp) ||
          item.price == null ||
          isOlderThan(item.created_at, 14)
      ).length,
      stale: visibleListings.filter((item) => isOlderThan(item.created_at, 14)).length,
    }),
    [visibleListings]
  );

  const toggleSelected = (listingId: number) => {
    setSelectedIds((current) => (current.includes(listingId) ? current.filter((id) => id !== listingId) : [...current, listingId]));
  };

  const patchListing = useCallback((listingId: number, changes: Partial<Listing>) => {
    setListings((current) => current.map((item) => (item.id === listingId ? { ...item, ...changes } : item)));
  }, []);

  const handleStatus = async (listingId: number, status: string) => {
    setSaving(true);
    setError(null);
    setStatusMessage(null);
    const previous = listings.find((item) => item.id === listingId);
    patchListing(listingId, { status });
    try {
      const updated = (await api.adminUpdateListing(listingId, { status })) as Listing;
      patchListing(listingId, updated);
      setStatusMessage(`Listing ${listingId} marked ${moderationStatusLabel(status).toLowerCase()}.`);
    } catch {
      if (previous) patchListing(listingId, previous);
      setError("Unable to update listing.");
    } finally {
      setSaving(false);
    }
  };

  const handleBulkStatus = async (status: string) => {
    if (!selectedIds.length) return;
    setSaving(true);
    setError(null);
    setStatusMessage(null);
    const previous = listings.filter((item) => selectedIds.includes(item.id));
    setListings((current) => current.map((item) => (selectedIds.includes(item.id) ? { ...item, status } : item)));
    try {
      const results = (await Promise.all(selectedIds.map((listingId) => api.adminUpdateListing(listingId, { status })))) as Listing[];
      setListings((current) =>
        current.map((item) => {
          const updated = results.find((row) => row.id === item.id);
          return updated ? { ...item, ...updated } : item;
        })
      );
      setSelectedIds([]);
      setStatusMessage(`${results.length} listings marked ${moderationStatusLabel(status).toLowerCase()}.`);
    } catch {
      setListings((current) =>
        current.map((item) => {
          const original = previous.find((row) => row.id === item.id);
          return original ?? item;
        })
      );
      setError("Unable to update selected listings.");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveDetails = async () => {
    if (!focusedListing) return;
    setSaving(true);
    setError(null);
    setStatusMessage(null);

    const payload = {
      price: draft.price ? Number(draft.price) : null,
      quantity: draft.quantity ? Number(draft.quantity) : null,
      unit: draft.unit || null,
      currency: draft.currency || null,
      grade: draft.grade || null,
    };

    const previous = focusedListing;
    patchListing(focusedListing.id, {
      price: payload.price,
      quantity: payload.quantity,
      unit: payload.unit,
      currency: payload.currency,
      grade: payload.grade,
    });

    try {
      const updated = (await api.adminUpdateListing(focusedListing.id, payload)) as Listing;
      patchListing(focusedListing.id, updated);
      setStatusMessage(`Listing ${focusedListing.id} details updated.`);
    } catch {
      patchListing(focusedListing.id, previous);
      setError("Unable to save listing details.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="admin-page admin-listings-page">
      <div className="admin-page-header">
        <div>
          <div className="label">Listings</div>
          <h1>Moderation workspace</h1>
          <p className="muted">Triage weak records, apply bulk actions, and inspect listing detail without losing context.</p>
        </div>
      </div>

      {error && <p className="status error">{error}</p>}
      {statusMessage && <p className="status">{statusMessage}</p>}
      <AdminActiveDateChips from={dateRange.from} to={dateRange.to} />

      <div className="admin-kpi-grid">
        {[
          { label: "Visible", value: summary.total, meta: "Current filtered view" },
          { label: "Approved", value: summary.open, meta: "Live marketplace records" },
          { label: "Needs review", value: summary.flagged, meta: "Weak quality or trust signals" },
          { label: "Stale", value: summary.stale, meta: "Open longer than 14 days" },
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
            <div className="label">Moderation lanes</div>
            <h3>Queue and filter controls</h3>
          </div>
          <div className="admin-filter-bar">
            <input
              placeholder="Search crop, district, contact, or description"
              value={filters.q}
              onChange={(event) => setFilters((prev) => ({ ...prev, q: event.target.value }))}
            />
            <select value={filters.crop} onChange={(event) => setFilters((prev) => ({ ...prev, crop: event.target.value }))}>
              <option value="">All crops</option>
              {(metadata?.crops ?? []).map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
            <select value={filters.district} onChange={(event) => setFilters((prev) => ({ ...prev, district: event.target.value }))}>
              <option value="">All districts</option>
              {(metadata?.districts ?? []).map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
            <select value={filters.role} onChange={(event) => setFilters((prev) => ({ ...prev, role: event.target.value }))}>
              <option value="">All roles</option>
              <option value="seller">seller</option>
              <option value="buyer">buyer</option>
            </select>
            <select value={filters.status} onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))}>
              <option value="">All status</option>
              <option value="open">approved</option>
              <option value="paused">paused</option>
              <option value="closed">closed</option>
            </select>
            <button className="btn ghost small" type="button" onClick={loadListings}>
              Apply
            </button>
          </div>
        </div>

        <div className="admin-chip-row">
          {queueDefinitions.map((queue) => (
            <button
              key={queue.id || "all"}
              type="button"
              className={`admin-role-chip ${filters.queue === queue.id ? "active" : ""}`}
              onClick={() => setFilters((prev) => ({ ...prev, queue: queue.id }))}
            >
              {queue.label}
            </button>
          ))}
        </div>

        <div className="admin-bulk-bar">
          <span className="admin-meta">{selectedIds.length} selected</span>
          <button className="btn ghost small" type="button" onClick={() => setSelectedIds(visibleListings.map((item) => item.id))}>
            Select all visible
          </button>
          <button className="btn ghost small" type="button" onClick={() => setSelectedIds([])}>
            Clear
          </button>
          <button className="btn ghost small" type="button" disabled={!selectedIds.length || saving} onClick={() => handleBulkStatus("open")}>
            Approve selected
          </button>
          <button className="btn ghost small" type="button" disabled={!selectedIds.length || saving} onClick={() => handleBulkStatus("paused")}>
            Pause selected
          </button>
          <button className="btn ghost small" type="button" disabled={!selectedIds.length || saving} onClick={() => handleBulkStatus("closed")}>
            Close selected
          </button>
        </div>
      </section>

      <section className="admin-listings-layout">
        <div className="admin-card">
          {visibleListings.length === 0 ? (
            <p className="admin-empty">No listings match the current filters.</p>
          ) : (
            <div className="admin-listing-list">
              {visibleListings.map((listing) => {
                const noMedia = (listing.media_urls?.length ?? 0) === 0;
                const noContact = !listing.contact_phone && !listing.contact_whatsapp;
                const stale = isOlderThan(listing.created_at, 14);
                const missingPrice = listing.price == null;

                return (
                  <article
                    key={listing.id}
                    className={`admin-listing-card ${focusedListing?.id === listing.id ? "active" : ""}`}
                    onClick={() => setFocusedId(listing.id)}
                  >
                    <div className="admin-listing-card-head">
                      <label className="admin-check">
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(listing.id)}
                          onChange={() => toggleSelected(listing.id)}
                          onClick={(event) => event.stopPropagation()}
                        />
                        <span />
                      </label>
                      <div>
                        <strong>{listing.crop}</strong>
                        <p>
                          {listing.role} | {listing.location?.district ?? "--"} | Published {formatDate(listing.created_at)}
                        </p>
                      </div>
                      <span className={`pill ${listing.status === "open" ? "" : "pill-muted"}`}>
                        {moderationStatusLabel(listing.status)}
                      </span>
                    </div>

                    <div className="admin-listing-metrics">
                      <div>
                        <span>Quantity</span>
                        <strong>{listing.quantity ? `${listing.quantity} ${listing.unit ?? ""}`.trim() : "--"}</strong>
                      </div>
                      <div>
                        <span>Price</span>
                        <strong>{formatCurrency(listing.price, listing.currency ?? "UGX")}</strong>
                      </div>
                      <div>
                        <span>Evidence</span>
                        <strong>{listing.media_urls?.length ?? 0} files</strong>
                      </div>
                    </div>

                    <p className="admin-listing-description">{listing.description || "No description added."}</p>

                    <div className="admin-chip-row">
                      {noMedia && <span className="admin-filter-chip">No media</span>}
                      {noContact && <span className="admin-filter-chip">No contact</span>}
                      {stale && <span className="admin-filter-chip">Stale</span>}
                      {missingPrice && <span className="admin-filter-chip">No price</span>}
                    </div>

                    <div className="admin-actions">
                      <button
                        className={`btn ghost small ${listing.status === "open" ? "btn-state-active" : ""}`}
                        type="button"
                        disabled={saving || listing.status === "open"}
                        onClick={(event) => {
                          event.stopPropagation();
                          handleStatus(listing.id, "open");
                        }}
                      >
                        Approve
                      </button>
                      <button
                        className={`btn ghost small ${listing.status === "paused" ? "btn-state-active" : ""}`}
                        type="button"
                        disabled={saving || listing.status === "paused"}
                        onClick={(event) => {
                          event.stopPropagation();
                          handleStatus(listing.id, "paused");
                        }}
                      >
                        Pause
                      </button>
                      <button
                        className={`btn ghost small ${listing.status === "closed" ? "btn-state-active" : ""}`}
                        type="button"
                        disabled={saving || listing.status === "closed"}
                        onClick={(event) => {
                          event.stopPropagation();
                          handleStatus(listing.id, "closed");
                        }}
                      >
                        Close
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>

        <aside className="admin-card admin-listing-detail">
          {!focusedListing ? (
            <p className="admin-empty">Select a listing to inspect it.</p>
          ) : (
            <>
              <div className="admin-card-header">
                <div>
                  <div className="label">Listing detail</div>
                  <h3>{focusedListing.crop}</h3>
                </div>
                <span className={`pill ${focusedListing.status === "open" ? "" : "pill-muted"}`}>
                  {moderationStatusLabel(focusedListing.status)}
                </span>
              </div>

              <div className="admin-detail-grid">
                <div>
                  <span className="label">Owner</span>
                  <strong>{focusedListing.user_id}</strong>
                </div>
                <div>
                  <span className="label">Location</span>
                  <strong>
                    {focusedListing.location?.district ?? "--"}
                    {focusedListing.location?.parish ? `, ${focusedListing.location.parish}` : ""}
                  </strong>
                </div>
                <div>
                  <span className="label">Contact</span>
                  <strong>{focusedListing.contact_phone || focusedListing.contact_whatsapp || "--"}</strong>
                </div>
                <div>
                  <span className="label">Availability</span>
                  <strong>{focusedListing.availability_start ? formatDate(focusedListing.availability_start) : "--"}</strong>
                </div>
              </div>

              <div className="admin-detail-block">
                <div className="label">Description</div>
                <p>{focusedListing.description || "No description added."}</p>
              </div>

              {!!focusedListing.media_urls?.length && (
                <div className="admin-detail-block">
                  <div className="label">Evidence</div>
                  <div className="admin-media-strip">
                    {focusedListing.media_urls.map((url, index) => (
                      <a key={`${url}-${index}`} href={url} target="_blank" rel="noreferrer" className="admin-media-thumb">
                        <img src={url} alt={`${focusedListing.crop} evidence ${index + 1}`} />
                      </a>
                    ))}
                  </div>
                </div>
              )}

              <div className="admin-detail-block">
                <div className="label">Editable moderation fields</div>
                <div className="admin-detail-form">
                  <label className="field">
                    Price
                    <input
                      type="number"
                      value={draft.price}
                      onChange={(event) => setDraft((prev) => ({ ...prev, price: event.target.value }))}
                    />
                  </label>
                  <label className="field">
                    Quantity
                    <input
                      type="number"
                      value={draft.quantity}
                      onChange={(event) => setDraft((prev) => ({ ...prev, quantity: event.target.value }))}
                    />
                  </label>
                  <label className="field">
                    Unit
                    <input value={draft.unit} onChange={(event) => setDraft((prev) => ({ ...prev, unit: event.target.value }))} />
                  </label>
                  <label className="field">
                    Currency
                    <input
                      value={draft.currency}
                      onChange={(event) => setDraft((prev) => ({ ...prev, currency: event.target.value }))}
                    />
                  </label>
                  <label className="field">
                    Grade
                    <input
                      value={draft.grade}
                      onChange={(event) => setDraft((prev) => ({ ...prev, grade: event.target.value }))}
                    />
                  </label>
                </div>
                <div className="admin-actions">
                  <button className="btn ghost small" type="button" disabled={saving} onClick={handleSaveDetails}>
                    Save details
                  </button>
                </div>
              </div>

              <div className="admin-detail-block">
                <div className="label">Moderation notes</div>
                <div className="admin-chip-row">
                  {(focusedListing.media_urls?.length ?? 0) === 0 && <span className="admin-filter-chip">Add evidence request</span>}
                  {!focusedListing.contact_phone && !focusedListing.contact_whatsapp && (
                    <span className="admin-filter-chip">Contact missing</span>
                  )}
                  {focusedListing.price == null && <span className="admin-filter-chip">Price missing</span>}
                  {isOlderThan(focusedListing.created_at, 14) && <span className="admin-filter-chip">Stale listing</span>}
                </div>
              </div>
            </>
          )}
        </aside>
      </section>
    </section>
  );
}
