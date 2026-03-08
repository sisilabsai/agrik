import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { api } from "../lib/api";
import AdminActiveDateChips from "../components/AdminActiveDateChips";

type Price = {
  id: number;
  crop: string;
  price: number;
  district?: string;
  market?: string;
  currency?: string;
  source?: string;
  captured_at?: string;
};

type Metadata = {
  crops: string[];
  districts: string[];
  markets: string[];
  currencies: string[];
  price_sources: string[];
};

type PriceFilters = {
  crop: string;
  district: string;
  market: string;
};

type DateRangeFilter = {
  from: string;
  to: string;
};

type PriceDraft = {
  crop: string;
  district: string;
  market: string;
  price: string;
  currency: string;
  source: string;
  captured_at: string;
};

const defaultDraft: PriceDraft = {
  crop: "",
  district: "",
  market: "",
  price: "",
  currency: "UGX",
  source: "manual",
  captured_at: "",
};

function parsePricesQuery(search: string): {
  filters: PriceFilters;
  dateRange: DateRangeFilter;
} {
  const params = new URLSearchParams(search);
  return {
    filters: {
      crop: params.get("crop") ?? "",
      district: params.get("district") ?? "",
      market: params.get("market") ?? "",
    },
    dateRange: {
      from: params.get("created_from") ?? params.get("captured_from") ?? "",
      to: params.get("created_to") ?? params.get("captured_to") ?? "",
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

function uniqueSorted(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((item) => (item || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function normalizeKey(value?: string | null): string {
  return (value || "").trim().toLowerCase();
}

function exportPricesCsv(items: Price[]) {
  const headers = ["id", "crop", "district", "market", "price", "currency", "source", "captured_at"];
  const csv = [
    headers.join(","),
    ...items.map((item) =>
      [item.id, item.crop, item.district ?? "", item.market ?? "", item.price, item.currency ?? "UGX", item.source ?? "", item.captured_at ?? ""]
        .map((value) => `"${String(value).replace(/"/g, '""')}"`)
        .join(",")
    ),
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = `admin-prices-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.csv`;
  anchor.click();
  URL.revokeObjectURL(href);
}

export default function AdminPrices() {
  const location = useLocation();
  const queryInit = useMemo(() => parsePricesQuery(location.search), [location.search]);
  const syncSearchRef = useRef(location.search);
  const [prices, setPrices] = useState<Price[]>([]);
  const [metadata, setMetadata] = useState<Metadata | null>(null);
  const [filters, setFilters] = useState<PriceFilters>(queryInit.filters);
  const [dateRange, setDateRange] = useState<DateRangeFilter>(queryInit.dateRange);
  const [draft, setDraft] = useState<PriceDraft>(defaultDraft);
  const [editingPriceId, setEditingPriceId] = useState<number | null>(null);
  const [selectedPriceId, setSelectedPriceId] = useState<number | null>(null);
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
      .then((res) => {
        setMetadata(res as Metadata);
      })
      .catch(() => {
        setMetadata(null);
      });
  }, []);

  const loadPrices = useCallback(() => {
    setError(null);
    const query = buildQuery({
      crop: filters.crop,
      district: filters.district,
      market: filters.market,
      limit: "2000",
    });
    api
      .adminPrices(query)
      .then((res) => {
        const rows = (res as { items: Price[] }).items || [];
        setPrices(rows);
        setSelectedPriceId((current) => (current && rows.some((item) => item.id === current) ? current : rows[0]?.id ?? null));
      })
      .catch(() => setError("Unable to load prices."));
  }, [filters]);

  useEffect(() => {
    loadMetadata();
  }, [loadMetadata]);

  useEffect(() => {
    loadPrices();
  }, [loadPrices]);

  useEffect(() => {
    if (location.search === syncSearchRef.current) return;
    syncSearchRef.current = location.search;
    const query = parsePricesQuery(location.search);
    setFilters(query.filters);
    setDateRange(query.dateRange);
  }, [location.search]);

  const cropOptions = useMemo(
    () => uniqueSorted([...(metadata?.crops ?? []), ...prices.map((item) => item.crop), draft.crop, filters.crop]),
    [draft.crop, filters.crop, metadata, prices]
  );
  const districtOptions = useMemo(
    () => uniqueSorted([...(metadata?.districts ?? []), ...prices.map((item) => item.district), draft.district, filters.district]),
    [draft.district, filters.district, metadata, prices]
  );
  const marketOptions = useMemo(
    () => uniqueSorted([...(metadata?.markets ?? []), ...prices.map((item) => item.market), draft.market, filters.market]),
    [draft.market, filters.market, metadata, prices]
  );
  const currencyOptions = useMemo(
    () => uniqueSorted(["UGX", ...(metadata?.currencies ?? []), ...prices.map((item) => item.currency), draft.currency]),
    [draft.currency, metadata, prices]
  );
  const sourceOptions = useMemo(
    () => uniqueSorted(["manual", ...(metadata?.price_sources ?? []), ...prices.map((item) => item.source), draft.source]),
    [draft.source, metadata, prices]
  );

  const filteredPrices = useMemo(() => {
    const fromMs = parseDateBoundary(dateRange.from, false);
    const toMs = parseDateBoundary(dateRange.to, true);
    return prices.filter((price) => {
      if (filters.market === "__missing__" && price.market) return false;
      const capturedMs = Date.parse(price.captured_at ?? "");
      if (fromMs == null && toMs == null) return true;
      if (Number.isNaN(capturedMs)) return false;
      if (fromMs != null && capturedMs < fromMs) return false;
      if (toMs != null && capturedMs > toMs) return false;
      return true;
    });
  }, [dateRange.from, dateRange.to, filters.market, prices]);

  const existingMatch = useMemo(() => {
    if (editingPriceId != null) return null;
    if (!draft.crop || !draft.district || !draft.market) return null;
    const crop = normalizeKey(draft.crop);
    const district = normalizeKey(draft.district);
    const market = normalizeKey(draft.market);
    return (
      prices.find(
        (item) =>
          normalizeKey(item.crop) === crop &&
          normalizeKey(item.district) === district &&
          normalizeKey(item.market) === market
      ) || null
    );
  }, [draft.crop, draft.district, draft.market, editingPriceId, prices]);

  const startEdit = (price: Price) => {
    setEditingPriceId(price.id);
    setDraft({
      crop: price.crop || "",
      district: price.district || "",
      market: price.market || "",
      price: String(price.price ?? ""),
      currency: price.currency || "UGX",
      source: price.source || "manual",
      captured_at: price.captured_at ? price.captured_at.slice(0, 16) : "",
    });
    setError(null);
  };

  const cancelEdit = () => {
    setEditingPriceId(null);
    setDraft(defaultDraft);
  };

  const resetFilters = () => {
    setFilters({ crop: "", district: "", market: "" });
  };

  const handlePublish = async () => {
    setError(null);
    setStatusMessage(null);
    const numericPrice = Number(draft.price);
    if (!draft.crop || !draft.district || !draft.market || !Number.isFinite(numericPrice) || numericPrice <= 0) {
      setError("Crop, district, market, and a valid price are required.");
      return;
    }
    const payload = {
      crop: draft.crop,
      district: draft.district,
      market: draft.market,
      price: numericPrice,
      currency: draft.currency || "UGX",
      source: draft.source || "manual",
      captured_at: draft.captured_at ? new Date(draft.captured_at).toISOString() : null,
    };
    setSaving(true);
    try {
      if (editingPriceId != null) {
        await api.adminUpdatePrice(editingPriceId, payload);
        setStatusMessage(`Price record #${editingPriceId} updated.`);
      } else {
        await api.adminCreatePrice(payload);
        setStatusMessage("Price published.");
      }
      await Promise.all([loadPrices(), loadMetadata()]);
      setEditingPriceId(null);
      setDraft(defaultDraft);
    } catch {
      setError(editingPriceId != null ? "Unable to update price." : "Unable to publish price.");
    } finally {
      setSaving(false);
    }
  };

  const selectedPrice = useMemo(
    () => filteredPrices.find((price) => price.id === selectedPriceId) ?? filteredPrices[0] ?? null,
    [filteredPrices, selectedPriceId]
  );

  const priceSummary = useMemo(
    () => ({
      total: filteredPrices.length,
      fresh: filteredPrices.filter((price) => {
        const captured = Date.parse(price.captured_at ?? "");
        return !Number.isNaN(captured) && Date.now() - captured <= 5 * 24 * 60 * 60 * 1000;
      }).length,
      stale: filteredPrices.filter((price) => {
        const captured = Date.parse(price.captured_at ?? "");
        return Number.isNaN(captured) || Date.now() - captured > 5 * 24 * 60 * 60 * 1000;
      }).length,
      markets: new Set(filteredPrices.map((price) => `${price.district || ""}:${price.market || ""}`)).size,
    }),
    [filteredPrices]
  );

  return (
    <section className="admin-page">
      <div className="admin-page-header">
        <div>
          <div className="label">Prices</div>
          <h1>Market pricing desk</h1>
          <p className="muted">Use real-data dropdowns to publish or update prices faster and consistently.</p>
        </div>
      </div>

      {error && <p className="status error">{error}</p>}
      {statusMessage && <p className="status">{statusMessage}</p>}
      <AdminActiveDateChips from={dateRange.from} to={dateRange.to} label="Captured date filter" />

      <div className="admin-kpi-grid">
        {[
          { label: "Records", value: priceSummary.total, meta: "Current filtered set" },
          { label: "Fresh", value: priceSummary.fresh, meta: "Updated within 5 days" },
          { label: "Stale", value: priceSummary.stale, meta: "Needs a new publish cycle" },
          { label: "Coverage", value: priceSummary.markets, meta: "District/market combinations" },
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
            <h3>Price records</h3>
          </div>
          <div className="admin-filter-bar admin-price-filter-bar">
            <button className="btn ghost small" type="button" onClick={() => exportPricesCsv(filteredPrices)}>
              Export filtered
            </button>
            <select value={filters.crop} onChange={(event) => setFilters((prev) => ({ ...prev, crop: event.target.value }))}>
              <option value="">All crops</option>
              {cropOptions.map((item) => (
                <option key={`f-crop-${item}`} value={item}>
                  {item}
                </option>
              ))}
            </select>
            <select
              value={filters.district}
              onChange={(event) => setFilters((prev) => ({ ...prev, district: event.target.value }))}
            >
              <option value="">All districts</option>
              {districtOptions.map((item) => (
                <option key={`f-district-${item}`} value={item}>
                  {item}
                </option>
              ))}
            </select>
            <select value={filters.market} onChange={(event) => setFilters((prev) => ({ ...prev, market: event.target.value }))}>
              <option value="">All markets</option>
              {marketOptions.map((item) => (
                <option key={`f-market-${item}`} value={item}>
                  {item}
                </option>
              ))}
            </select>
            <button className="btn ghost small" type="button" onClick={loadPrices}>
              Apply
            </button>
            <button className="btn ghost small" type="button" onClick={resetFilters}>
              Reset
            </button>
          </div>
        </div>

        <div className="admin-chip-row">
          <button className={`admin-role-chip ${filters.market === "__missing__" ? "active" : ""}`} type="button" onClick={() => setFilters((prev) => ({ ...prev, market: prev.market === "__missing__" ? "" : "__missing__" }))}>
            Missing market
          </button>
          <button className="admin-role-chip" type="button" onClick={() => setFilters((prev) => ({ ...prev, crop: "", district: "", market: "" }))}>
            Reset queue chips
          </button>
        </div>

        {editingPriceId != null && (
          <div className="admin-price-mode">
            Editing existing price entry <strong>#{editingPriceId}</strong>.
            <button className="btn tiny ghost" type="button" onClick={cancelEdit}>
              Cancel
            </button>
          </div>
        )}

        {existingMatch && (
          <div className="admin-price-match">
            Matching record found: <strong>{existingMatch.crop}</strong> in{" "}
            <strong>{existingMatch.market || existingMatch.district || "--"}</strong>. Update it instead of creating a duplicate.
            <button className="btn tiny ghost" type="button" onClick={() => startEdit(existingMatch)}>
              Edit existing
            </button>
          </div>
        )}

        <div className="settings-grid admin-form-grid admin-price-form-grid">
          <label className="field">
            Crop
            <select value={draft.crop} onChange={(event) => setDraft((prev) => ({ ...prev, crop: event.target.value }))}>
              <option value="">Select crop</option>
              {cropOptions.map((item) => (
                <option key={`crop-${item}`} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            District
            <select value={draft.district} onChange={(event) => setDraft((prev) => ({ ...prev, district: event.target.value }))}>
              <option value="">Select district</option>
              {districtOptions.map((item) => (
                <option key={`district-${item}`} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Market
            <select value={draft.market} onChange={(event) => setDraft((prev) => ({ ...prev, market: event.target.value }))}>
              <option value="">Select market</option>
              {marketOptions.map((item) => (
                <option key={`market-${item}`} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Price
            <input
              type="number"
              min={0}
              step="0.01"
              value={draft.price}
              onChange={(event) => setDraft((prev) => ({ ...prev, price: event.target.value }))}
            />
          </label>
          <label className="field">
            Currency
            <select value={draft.currency} onChange={(event) => setDraft((prev) => ({ ...prev, currency: event.target.value }))}>
              {currencyOptions.map((item) => (
                <option key={`currency-${item}`} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Source
            <select value={draft.source} onChange={(event) => setDraft((prev) => ({ ...prev, source: event.target.value }))}>
              {sourceOptions.map((item) => (
                <option key={`source-${item}`} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Captured at
            <input
              type="datetime-local"
              value={draft.captured_at}
              onChange={(event) => setDraft((prev) => ({ ...prev, captured_at: event.target.value }))}
            />
          </label>
          <div className="admin-price-actions">
            <button className="btn" type="button" onClick={handlePublish} disabled={saving}>
              {saving ? "Saving..." : editingPriceId != null ? "Update price" : "Publish price"}
            </button>
            {editingPriceId != null && (
              <button className="btn ghost" type="button" onClick={cancelEdit}>
                Cancel edit
              </button>
            )}
          </div>
        </div>
      </section>

      <section className="admin-listings-layout">
      <section className="admin-card">
        <div className="admin-card-header">
          <div>
            <div className="label">History</div>
            <h3>Recent prices</h3>
          </div>
          <span className="admin-list-meta">{filteredPrices.length} records</span>
        </div>
        {filteredPrices.length === 0 ? (
          <p className="admin-empty">No prices to display.</p>
        ) : (
          <div className="admin-table admin-price-history">
            {filteredPrices.map((price) => (
              <div
                key={price.id}
                className={`admin-row admin-price-row ${editingPriceId === price.id || selectedPrice?.id === price.id ? "active" : ""}`}
                onClick={() => setSelectedPriceId(price.id)}
              >
                <div className="admin-row-main">
                  <div className="tile-title">{price.crop}</div>
                  <div className="tile-meta">
                    {price.district || "--"} | {price.market || "--"} | {price.currency ?? "UGX"} {price.price}
                  </div>
                  <div className="admin-row-meta">Captured {formatDate(price.captured_at)}</div>
                </div>
                <div className="admin-actions">
                  <span className={`pill ${price.captured_at && Date.now() - Date.parse(price.captured_at) <= 5 * 24 * 60 * 60 * 1000 ? "" : "pill-muted"}`}>
                    {price.source ?? "manual"}
                  </span>
                  <button className="btn ghost small" type="button" onClick={(event) => { event.stopPropagation(); startEdit(price); }}>
                    Edit
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <aside className="admin-card admin-listing-detail">
        {!selectedPrice ? (
          <p className="admin-empty">Select a price record to inspect coverage and freshness.</p>
        ) : (
          <>
            <div className="admin-card-header">
              <div>
                <div className="label">Price detail</div>
                <h3>{selectedPrice.crop}</h3>
              </div>
              <span className={`pill ${selectedPrice.captured_at && Date.now() - Date.parse(selectedPrice.captured_at) <= 5 * 24 * 60 * 60 * 1000 ? "" : "pill-muted"}`}>
                {selectedPrice.captured_at && Date.now() - Date.parse(selectedPrice.captured_at) <= 5 * 24 * 60 * 60 * 1000 ? "Fresh" : "Stale"}
              </span>
            </div>

            <div className="admin-detail-grid">
              <div>
                <span className="label">District</span>
                <strong>{selectedPrice.district || "--"}</strong>
              </div>
              <div>
                <span className="label">Market</span>
                <strong>{selectedPrice.market || "--"}</strong>
              </div>
              <div>
                <span className="label">Price</span>
                <strong>{selectedPrice.currency ?? "UGX"} {selectedPrice.price}</strong>
              </div>
              <div>
                <span className="label">Captured</span>
                <strong>{formatDate(selectedPrice.captured_at)}</strong>
              </div>
            </div>

            <div className="admin-detail-block">
              <div className="label">Publishing notes</div>
              <div className="admin-chip-row">
                <span className="admin-filter-chip">{selectedPrice.source ?? "manual"}</span>
                {selectedPrice.captured_at && Date.now() - Date.parse(selectedPrice.captured_at) > 5 * 24 * 60 * 60 * 1000 && (
                  <span className="admin-filter-chip">Needs refresh</span>
                )}
                {!selectedPrice.market && <span className="admin-filter-chip">Market missing</span>}
              </div>
            </div>
          </>
        )}
      </aside>
      </section>
    </section>
  );
}
