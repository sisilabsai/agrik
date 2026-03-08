import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Icon } from "../components/Visuals";
import { api } from "../lib/api";
import { useAuth } from "../state/auth";
import {
  daysAgo,
  formatCompactDate,
  formatMoney,
  normalizeProviderLead,
  normalizeProviderOffer,
  normalizeProviderService,
  toStringList,
  uniqueValues,
  type ProviderLead,
  type ProviderOffer,
  type ProviderServiceListing,
} from "./providerUtils";

type SortMode = "score" | "newest" | "price_desc" | "price_asc";

type OfferDraft = {
  price: string;
  quantity: string;
};

const PAGE_SIZE_OPTIONS = [10, 15, 25];

function computeLeadScore(
  lead: ProviderLead,
  serviceDistricts: Set<string>,
  focusCropSet: Set<string>,
  contacted: Set<number>,
  starred: Set<number>
): number {
  let score = 0;
  if (lead.district && serviceDistricts.has(lead.district)) score += 35;
  if (lead.crop && focusCropSet.has(lead.crop.toLowerCase())) score += 20;
  if (lead.mediaUrls.length > 0) score += 15;
  if (lead.price != null) score += 10;
  const age = daysAgo(lead.createdAt);
  if (age != null) {
    if (age <= 2) score += 20;
    else if (age <= 7) score += 10;
  }
  if (contacted.has(lead.id)) score -= 15;
  if (starred.has(lead.id)) score += 8;
  return score;
}

function toOptionalNumber(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return undefined;
  return parsed;
}

export default function ProviderLeads() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [savingOfferFor, setSavingOfferFor] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [focusCrops, setFocusCrops] = useState<string[]>([]);
  const [myServices, setMyServices] = useState<ProviderServiceListing[]>([]);
  const [farmerLeads, setFarmerLeads] = useState<ProviderLead[]>([]);
  const [myOffers, setMyOffers] = useState<ProviderOffer[]>([]);

  const [search, setSearch] = useState("");
  const [cropFilter, setCropFilter] = useState(searchParams.get("crop") ?? "all");
  const [districtFilter, setDistrictFilter] = useState(searchParams.get("district") ?? "all");
  const [mediaOnly, setMediaOnly] = useState(false);
  const [uncontactedOnly, setUncontactedOnly] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("score");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);

  const [activeOfferLeadId, setActiveOfferLeadId] = useState<number | null>(null);
  const [offerDrafts, setOfferDrafts] = useState<Record<number, OfferDraft>>({});
  const [starredLeadIds, setStarredLeadIds] = useState<Set<number>>(new Set());

  const loadData = () => {
    if (!user?.phone) return;
    setLoading(true);
    setError(null);
    Promise.allSettled([
      api.profileDetails(),
      api.marketServices(`?phone=${encodeURIComponent(user.phone)}&limit=280`),
      api.marketListings("?status=open&role=seller&limit=420"),
      api.marketOffers(`?phone=${encodeURIComponent(user.phone)}&limit=320`),
    ])
      .then(([profileRes, servicesRes, leadsRes, offersRes]) => {
        if (profileRes.status === "fulfilled") {
          setFocusCrops(toStringList(profileRes.value.identity?.focus_crops ?? profileRes.value.identity?.crops ?? []));
        } else {
          setFocusCrops([]);
        }
        if (servicesRes.status === "fulfilled") {
          setMyServices((servicesRes.value.items ?? []).map((item) => normalizeProviderService(item)).filter((item): item is ProviderServiceListing => item != null));
        } else {
          setMyServices([]);
        }
        if (leadsRes.status === "fulfilled") {
          setFarmerLeads((leadsRes.value.items ?? []).map((item) => normalizeProviderLead(item)).filter((item): item is ProviderLead => item != null));
        } else {
          setFarmerLeads([]);
        }
        if (offersRes.status === "fulfilled") {
          setMyOffers((offersRes.value.items ?? []).map((item) => normalizeProviderOffer(item)).filter((item): item is ProviderOffer => item != null));
        } else {
          setMyOffers([]);
        }
      })
      .catch(() => setError("Unable to load provider leads workspace."))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!user?.phone) return;
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.phone]);

  useEffect(() => {
    const key = user?.id ? `agrik_provider_starred_leads_${user.id}` : user?.phone ? `agrik_provider_starred_leads_${user.phone}` : "";
    if (!key) return;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) {
        setStarredLeadIds(new Set());
        return;
      }
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        setStarredLeadIds(new Set());
        return;
      }
      const ids = parsed
        .map((item) => Number(item))
        .filter((value) => Number.isFinite(value))
        .map((value) => Math.trunc(value));
      setStarredLeadIds(new Set(ids));
    } catch {
      setStarredLeadIds(new Set());
    }
  }, [user?.id, user?.phone]);

  useEffect(() => {
    const key = user?.id ? `agrik_provider_starred_leads_${user.id}` : user?.phone ? `agrik_provider_starred_leads_${user.phone}` : "";
    if (!key) return;
    localStorage.setItem(key, JSON.stringify([...starredLeadIds]));
  }, [starredLeadIds, user?.id, user?.phone]);

  useEffect(() => {
    setPage(1);
    const next = new URLSearchParams(searchParams);
    if (cropFilter !== "all") next.set("crop", cropFilter);
    else next.delete("crop");
    if (districtFilter !== "all") next.set("district", districtFilter);
    else next.delete("district");
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cropFilter, districtFilter, pageSize, sortMode, mediaOnly, uncontactedOnly, search]);

  const serviceDistricts = useMemo(() => new Set(myServices.map((item) => item.district).filter(Boolean)), [myServices]);
  const focusCropSet = useMemo(() => new Set(focusCrops.map((item) => item.toLowerCase())), [focusCrops]);
  const contactedLeadIds = useMemo(() => new Set(myOffers.map((item) => item.listingId)), [myOffers]);

  const districtOptions = useMemo(() => uniqueValues(farmerLeads.map((item) => item.district).filter(Boolean)), [farmerLeads]);
  const cropOptions = useMemo(() => uniqueValues(farmerLeads.map((item) => item.crop).filter(Boolean)), [farmerLeads]);

  const rankedLeads = useMemo(() => {
    const text = search.trim().toLowerCase();
    const filtered = farmerLeads
      .filter((item) => (cropFilter === "all" ? true : item.crop === cropFilter))
      .filter((item) => (districtFilter === "all" ? true : item.district === districtFilter))
      .filter((item) => (mediaOnly ? item.mediaUrls.length > 0 : true))
      .filter((item) => (uncontactedOnly ? !contactedLeadIds.has(item.id) : true))
      .filter((item) => {
        if (!text) return true;
        return [item.crop, item.description, item.district, item.parish, item.contactName].some((value) => value.toLowerCase().includes(text));
      })
      .map((item) => ({
        item,
        score: computeLeadScore(item, serviceDistricts, focusCropSet, contactedLeadIds, starredLeadIds),
      }));

    return filtered.sort((left, right) => {
      if (sortMode === "newest") return Date.parse(right.item.createdAt || "") - Date.parse(left.item.createdAt || "");
      if (sortMode === "price_desc") return (right.item.price ?? -1) - (left.item.price ?? -1);
      if (sortMode === "price_asc") return (left.item.price ?? Number.MAX_SAFE_INTEGER) - (right.item.price ?? Number.MAX_SAFE_INTEGER);
      return right.score - left.score;
    });
  }, [contactedLeadIds, cropFilter, districtFilter, farmerLeads, focusCropSet, mediaOnly, search, serviceDistricts, sortMode, starredLeadIds, uncontactedOnly]);

  const totalPages = Math.max(1, Math.ceil(rankedLeads.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageItems = rankedLeads.slice((safePage - 1) * pageSize, safePage * pageSize);

  const matchedLeadsCount = useMemo(
    () =>
      farmerLeads.filter((lead) => {
        if (lead.district && serviceDistricts.has(lead.district)) return true;
        if (lead.crop && focusCropSet.has(lead.crop.toLowerCase())) return true;
        return false;
      }).length,
    [farmerLeads, focusCropSet, serviceDistricts]
  );
  const evidenceLeadCount = useMemo(() => farmerLeads.filter((item) => item.mediaUrls.length > 0).length, [farmerLeads]);
  const uncontactedLeadCount = useMemo(() => farmerLeads.filter((item) => !contactedLeadIds.has(item.id)).length, [farmerLeads, contactedLeadIds]);
  const topLeadQueue = useMemo(() => rankedLeads.slice(0, 3), [rankedLeads]);
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (search.trim()) count += 1;
    if (cropFilter !== "all") count += 1;
    if (districtFilter !== "all") count += 1;
    if (mediaOnly) count += 1;
    if (uncontactedOnly) count += 1;
    if (sortMode !== "score") count += 1;
    return count;
  }, [cropFilter, districtFilter, mediaOnly, search, sortMode, uncontactedOnly]);

  const onOfferDraftChange = (leadId: number, patch: Partial<OfferDraft>) => {
    setOfferDrafts((prev) => ({
      ...prev,
      [leadId]: {
        price: prev[leadId]?.price ?? "",
        quantity: prev[leadId]?.quantity ?? "",
        ...patch,
      },
    }));
  };

  const submitOffer = async (event: FormEvent, lead: ProviderLead) => {
    event.preventDefault();
    if (!user?.phone) return;
    const draft = offerDrafts[lead.id] ?? { price: "", quantity: "" };
    const payload = {
      phone: user.phone,
      listing_id: lead.id,
      price: toOptionalNumber(draft.price),
      quantity: toOptionalNumber(draft.quantity),
    };
    setSavingOfferFor(lead.id);
    setError(null);
    setMessage(null);
    try {
      await api.marketCreateOffer(payload);
      setMessage("Offer sent to lead.");
      setActiveOfferLeadId(null);
      setOfferDrafts((prev) => {
        const next = { ...prev };
        delete next[lead.id];
        return next;
      });
      const offersRes = await api.marketOffers(`?phone=${encodeURIComponent(user.phone)}&limit=320`);
      setMyOffers((offersRes.items ?? []).map((item) => normalizeProviderOffer(item)).filter((item): item is ProviderOffer => item != null));
    } catch {
      setError("Unable to send offer.");
    } finally {
      setSavingOfferFor(null);
    }
  };

  const toggleStar = (leadId: number) => {
    setStarredLeadIds((prev) => {
      const next = new Set(prev);
      if (next.has(leadId)) next.delete(leadId);
      else next.add(leadId);
      return next;
    });
  };

  const resetFilters = () => {
    setSearch("");
    setCropFilter("all");
    setDistrictFilter("all");
    setMediaOnly(false);
    setUncontactedOnly(false);
    setSortMode("score");
    setPage(1);
  };

  if (loading) return <section className="farmer-page provider-page">Loading provider leads...</section>;

  return (
    <section className="farmer-page provider-page provider-workspace-neo provider-leads-neo">
      <section className="provider-workspace-hero">
        <div className="provider-workspace-hero-main">
          <div className="section-title-with-icon">
            <span className="section-icon">
              <Icon name="market" size={18} />
            </span>
            <div>
              <div className="label">Lead pipeline</div>
              <h1>Work the best opportunities first.</h1>
              <p className="muted">Use score, location, crop fit, and media evidence to move through demand faster and send cleaner offers.</p>
            </div>
          </div>
          <div className="provider-header-actions">
            <Link className="btn ghost small" to="/provider/services">
              Service catalog
            </Link>
            <Link className="btn small" to="/provider/marketing">
              Marketing studio
            </Link>
          </div>
          <div className="provider-overview-tags">
            <span>{matchedLeadsCount} matched</span>
            <span>{uncontactedLeadCount} uncontacted</span>
            <span>{starredLeadIds.size} starred</span>
          </div>
        </div>
        <aside className="provider-workspace-sidecard">
          <div className="provider-panel-header">
            <div>
              <div className="label">Priority queue</div>
              <h3>Start here</h3>
            </div>
          </div>
          <div className="provider-priority-list provider-priority-list-light">
            {topLeadQueue.length === 0 ? (
              <p className="muted">No leads are available yet.</p>
            ) : (
              topLeadQueue.map(({ item, score }) => (
                <Link key={item.id} to={`/provider/leads?district=${encodeURIComponent(item.district || "")}`} className="provider-priority-card provider-priority-card-light">
                  <span className="provider-priority-icon">
                    <Icon name="market" size={18} />
                  </span>
                  <div>
                    <strong>{item.crop || "Lead"}</strong>
                    <p>{[item.parish, item.district].filter(Boolean).join(", ") || "Location open"}</p>
                    <span>Score {score}</span>
                  </div>
                </Link>
              ))
            )}
          </div>
        </aside>
      </section>

      {(message || error) && <p className={`status ${error ? "error" : ""}`}>{error ?? message}</p>}

      <div className="provider-kpi-grid">
        <article className="provider-kpi-card">
          <div className="provider-kpi-label">Open leads</div>
          <div className="provider-kpi-value">{farmerLeads.length}</div>
          <div className="provider-kpi-meta">Live marketplace demand</div>
        </article>
        <article className="provider-kpi-card">
          <div className="provider-kpi-label">Matched leads</div>
          <div className="provider-kpi-value">{matchedLeadsCount}</div>
          <div className="provider-kpi-meta">District or crop aligned</div>
        </article>
        <article className="provider-kpi-card">
          <div className="provider-kpi-label">Contacted leads</div>
          <div className="provider-kpi-value">{contactedLeadIds.size}</div>
          <div className="provider-kpi-meta">{myOffers.length} offers sent</div>
        </article>
        <article className="provider-kpi-card">
          <div className="provider-kpi-label">Evidence leads</div>
          <div className="provider-kpi-value">{evidenceLeadCount}</div>
          <div className="provider-kpi-meta">Media-backed trust</div>
        </article>
      </div>

      <section className="farmer-card provider-panel">
        <div className="provider-panel-header">
          <div>
            <div className="label">Priority board</div>
            <h3>Best-fit leads right now</h3>
          </div>
        </div>
        {topLeadQueue.length === 0 ? (
          <p className="muted">No leads available right now.</p>
        ) : (
          <div className="provider-focus-list">
            {topLeadQueue.map(({ item, score }) => (
              <article key={item.id} className="provider-focus-card">
                <div className="provider-focus-head">
                  <div>
                    <strong>{item.crop || "Lead"}</strong>
                    <p>{[item.parish, item.district].filter(Boolean).join(", ") || "Location open"}</p>
                  </div>
                  <span className="provider-score-pill">Score {score}</span>
                </div>
                <div className="provider-focus-meta">
                  <span>{item.quantity != null ? `${item.quantity} ${item.unit || "units"}` : "Quantity open"}</span>
                  <span>{item.price != null ? formatMoney(item.price, item.currency || "UGX") : "Negotiable"}</span>
                  <span>{item.mediaUrls.length > 0 ? "With media" : "No media"}</span>
                </div>
                <div className="provider-focus-actions">
                  <Link className="btn ghost tiny" to={`/marketplace/listings/${item.id}`}>
                    View listing
                  </Link>
                  <button type="button" className="btn ghost tiny" onClick={() => setActiveOfferLeadId(item.id)}>
                    Send offer
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="farmer-card provider-panel">
        <div className="provider-panel-header">
          <div>
            <div className="label">Filters</div>
            <h3>Find high-fit leads quickly</h3>
          </div>
          <button className="btn ghost tiny" type="button" onClick={resetFilters}>
            Reset filters
          </button>
        </div>
        <div className="provider-filter-row">
          <label className="field">
            Search
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Crop, district, contact, notes" />
          </label>
          <label className="field">
            Crop
            <select value={cropFilter} onChange={(event) => setCropFilter(event.target.value)}>
              <option value="all">All crops</option>
              {cropOptions.map((crop) => (
                <option key={crop} value={crop}>
                  {crop}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            District
            <select value={districtFilter} onChange={(event) => setDistrictFilter(event.target.value)}>
              <option value="all">All districts</option>
              {districtOptions.map((district) => (
                <option key={district} value={district}>
                  {district}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Sort
            <select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)}>
              <option value="score">Best fit score</option>
              <option value="newest">Newest</option>
              <option value="price_desc">Price high-low</option>
              <option value="price_asc">Price low-high</option>
            </select>
          </label>
        </div>
        <div className="provider-toggle-row">
          <label className="provider-switch">
            <input type="checkbox" checked={mediaOnly} onChange={(event) => setMediaOnly(event.target.checked)} />
            <span>Media only</span>
          </label>
          <label className="provider-switch">
            <input type="checkbox" checked={uncontactedOnly} onChange={(event) => setUncontactedOnly(event.target.checked)} />
            <span>Uncontacted only</span>
          </label>
        </div>
        <div className="provider-submeta-row">
          <span>{rankedLeads.length} leads in view</span>
          <span>{activeFilterCount ? `${activeFilterCount} filters applied` : "No filters applied"}</span>
        </div>
      </section>

      <section className="farmer-card provider-panel">
        <div className="provider-panel-header">
          <div>
            <div className="label">Lead directory</div>
            <h3>Ranked by opportunity score</h3>
          </div>
        </div>

        {pageItems.length === 0 ? (
          <p className="muted">No leads match your current filters.</p>
        ) : (
          <div className="provider-lead-list">
            {pageItems.map(({ item, score }) => {
              const isContacted = contactedLeadIds.has(item.id);
              const isStarred = starredLeadIds.has(item.id);
              const draft = offerDrafts[item.id] ?? { price: "", quantity: "" };
              const offerOpen = activeOfferLeadId === item.id;
              const contactPhone = item.contactPhone || "";
              const whatsapp = item.contactWhatsapp || item.contactPhone || "";
              const whatsappLink = whatsapp ? `https://wa.me/${whatsapp.replace(/[^\\d]/g, "")}` : "";

              return (
                <article key={item.id} className={`provider-lead-item ${isStarred ? "starred" : ""}`}>
                  <div className="provider-lead-main">
                    <div className="provider-lead-top">
                      <div className="provider-lead-titleblock">
                        <strong>{item.crop || "Unspecified crop"}</strong>
                        <span>{[item.parish, item.district].filter(Boolean).join(", ") || "Location not set"}</span>
                      </div>
                      <span className="provider-score-pill">Score {score}</span>
                    </div>
                    <div className="provider-lead-metrics">
                      <div className="provider-lead-metric">
                        <span>Quantity</span>
                        <strong>{item.quantity != null ? `${item.quantity} ${item.unit || "units"}` : "Open"}</strong>
                      </div>
                      <div className="provider-lead-metric">
                        <span>Price</span>
                        <strong>{item.price != null ? formatMoney(item.price, item.currency || "UGX") : "Negotiable"}</strong>
                      </div>
                      <div className="provider-lead-metric">
                        <span>Media</span>
                        <strong>{item.mediaUrls.length > 0 ? `${item.mediaUrls.length} file${item.mediaUrls.length === 1 ? "" : "s"}` : "None"}</strong>
                      </div>
                      <div className="provider-lead-metric">
                        <span>Published</span>
                        <strong>{formatCompactDate(item.createdAt)}</strong>
                      </div>
                    </div>
                    <p className="provider-lead-description">{item.description || "No description provided."}</p>
                    <div className="provider-chip-row">
                      {isContacted ? <span className="provider-status-pill status-open">Contacted</span> : <span className="provider-status-pill status-paused">New</span>}
                      {item.mediaUrls.length > 0 ? <span className="provider-status-pill status-open">Evidence</span> : null}
                      {item.district && serviceDistricts.has(item.district) ? <span className="provider-status-pill status-open">District fit</span> : null}
                      {item.crop && focusCrops.map((crop) => crop.toLowerCase()).includes(item.crop.toLowerCase()) ? (
                        <span className="provider-status-pill status-open">Crop fit</span>
                      ) : null}
                    </div>
                  </div>

                  <div className="provider-lead-actions">
                    <button type="button" className={`btn ghost tiny ${isStarred ? "active" : ""}`} onClick={() => toggleStar(item.id)}>
                      {isStarred ? "Starred" : "Star"}
                    </button>
                    <button type="button" className="btn ghost tiny" onClick={() => setActiveOfferLeadId((prev) => (prev === item.id ? null : item.id))}>
                      {offerOpen ? "Close offer" : "Send offer"}
                    </button>
                    <Link className="btn ghost tiny" to={`/marketplace/listings/${item.id}`}>
                      Details
                    </Link>
                    {contactPhone ? (
                      <a className="btn ghost tiny" href={`tel:${contactPhone}`}>
                        Call
                      </a>
                    ) : null}
                    {whatsappLink ? (
                      <a className="btn ghost tiny" href={whatsappLink} target="_blank" rel="noreferrer">
                        WhatsApp
                      </a>
                    ) : null}
                  </div>

                  {offerOpen ? (
                    <form className="provider-offer-form" onSubmit={(event) => submitOffer(event, item)}>
                      <label className="field">
                        Offer price
                        <input
                          type="number"
                          value={draft.price}
                          onChange={(event) => onOfferDraftChange(item.id, { price: event.target.value })}
                          placeholder={item.price != null ? String(item.price) : "150000"}
                        />
                      </label>
                      <label className="field">
                        Quantity
                        <input
                          type="number"
                          value={draft.quantity}
                          onChange={(event) => onOfferDraftChange(item.id, { quantity: event.target.value })}
                          placeholder={item.quantity != null ? String(item.quantity) : "100"}
                        />
                      </label>
                      <button className="btn small" type="submit" disabled={savingOfferFor === item.id}>
                        {savingOfferFor === item.id ? "Sending..." : "Send offer"}
                      </button>
                    </form>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}

        <div className="provider-pagination">
          <div className="provider-pagination-meta">
            Showing {pageItems.length === 0 ? 0 : (safePage - 1) * pageSize + 1}-{Math.min(safePage * pageSize, rankedLeads.length)} of {rankedLeads.length}
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
