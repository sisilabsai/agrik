import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import {
  MarketListingRecord,
  asRecord,
  buildTelHref,
  buildWhatsappHref,
  compactText,
  formatDate,
  formatMoney,
  listingLocationLabel,
  normalizeListing,
  toMediaUrls,
  toNumberValue,
  toStringValue,
} from "../lib/marketplace";
import { useAuth } from "../state/auth";

type PublicService = {
  id: number;
  serviceType: string;
  description: string;
  price: number | null;
  currency: string;
  district: string;
  parish: string;
  mediaUrls: string[];
  status: string;
};

type FeedView = "all" | "listings" | "services";

function normalizeService(raw: unknown): PublicService | null {
  const row = asRecord(raw);
  const location = asRecord(row.location);
  const id = toNumberValue(row.id);
  if (id == null) return null;
  return {
    id,
    serviceType: toStringValue(row.service_type),
    description: toStringValue(row.description),
    price: toNumberValue(row.price),
    currency: toStringValue(row.currency) || "UGX",
    district: toStringValue(location.district),
    parish: toStringValue(location.parish),
    mediaUrls: toMediaUrls(row.media_urls),
    status: toStringValue(row.status) || "open",
  };
}

function asOptionalNumber(value: string) {
  const parsed = toNumberValue(value);
  return parsed == null ? null : parsed;
}

function joinLocation(parish: string, district: string) {
  return [parish, district].filter(Boolean).join(", ") || "Location unavailable";
}

export default function PublicMarketplace() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [listings, setListings] = useState<MarketListingRecord[]>([]);
  const [services, setServices] = useState<PublicService[]>([]);
  const [feedView, setFeedView] = useState<FeedView>("all");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [filterCrop, setFilterCrop] = useState("");
  const [filterDistrict, setFilterDistrict] = useState("");
  const [filterRole, setFilterRole] = useState<"all" | "seller" | "buyer">("all");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [mediaOnly, setMediaOnly] = useState(false);
  const [sortBy, setSortBy] = useState<"newest" | "price_asc" | "price_desc" | "media_desc">("newest");

  useEffect(() => {
    setLoading(true);
    setError(null);
    Promise.allSettled([api.marketListings("?status=open&limit=240"), api.marketServices("?status=open&limit=120")])
      .then(([listingRes, serviceRes]) => {
        setListings(
          listingRes.status === "fulfilled"
            ? (listingRes.value.items ?? []).map(normalizeListing).filter((item): item is MarketListingRecord => item != null)
            : []
        );
        setServices(
          serviceRes.status === "fulfilled"
            ? (serviceRes.value.items ?? []).map(normalizeService).filter((item): item is PublicService => item != null)
            : []
        );
      })
      .catch(() => setError("Unable to load marketplace feed."))
      .finally(() => setLoading(false));
  }, [user?.id]);

  const filteredListings = useMemo(() => {
    const min = asOptionalNumber(minPrice);
    const max = asOptionalNumber(maxPrice);
    const query = search.trim().toLowerCase();
    const output = listings
      .filter((item) => (filterRole === "all" ? true : item.role === filterRole))
      .filter((item) => (filterCrop.trim() ? item.crop.toLowerCase().includes(filterCrop.trim().toLowerCase()) : true))
      .filter((item) => {
        if (!filterDistrict.trim()) return true;
        const target = filterDistrict.trim().toLowerCase();
        return item.location.district.toLowerCase().includes(target) || item.location.parish.toLowerCase().includes(target);
      })
      .filter((item) => (!query ? true : [item.crop, item.grade, item.description, item.location.district, item.location.parish].join(" ").toLowerCase().includes(query)))
      .filter((item) => (mediaOnly ? item.mediaUrls.length > 0 : true))
      .filter((item) => (min != null ? (item.price ?? Number.NEGATIVE_INFINITY) >= min : true))
      .filter((item) => (max != null ? (item.price ?? Number.POSITIVE_INFINITY) <= max : true));
    output.sort((a, b) => {
      if (sortBy === "price_asc") return (a.price ?? Number.POSITIVE_INFINITY) - (b.price ?? Number.POSITIVE_INFINITY);
      if (sortBy === "price_desc") return (b.price ?? Number.NEGATIVE_INFINITY) - (a.price ?? Number.NEGATIVE_INFINITY);
      if (sortBy === "media_desc") return b.mediaUrls.length - a.mediaUrls.length;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
    return output.slice(0, 120);
  }, [filterCrop, filterDistrict, filterRole, listings, maxPrice, mediaOnly, minPrice, search, sortBy]);

  const filteredServices = useMemo(() => {
    const min = asOptionalNumber(minPrice);
    const max = asOptionalNumber(maxPrice);
    const query = search.trim().toLowerCase();
    return services
      .filter((item) => (mediaOnly ? item.mediaUrls.length > 0 : true))
      .filter((item) => {
        if (!filterDistrict.trim()) return true;
        const target = filterDistrict.trim().toLowerCase();
        return item.district.toLowerCase().includes(target) || item.parish.toLowerCase().includes(target);
      })
      .filter((item) => (min != null ? (item.price ?? Number.NEGATIVE_INFINITY) >= min : true))
      .filter((item) => (max != null ? (item.price ?? Number.POSITIVE_INFINITY) <= max : true))
      .filter((item) => (!query ? true : [item.serviceType, item.description, item.district, item.parish].join(" ").toLowerCase().includes(query)))
      .slice(0, 80);
  }, [filterDistrict, maxPrice, mediaOnly, minPrice, search, services]);

  const districts = useMemo(
    () => Array.from(new Set([...filteredListings.map((item) => item.location.district), ...filteredServices.map((item) => item.district)].filter(Boolean))).slice(0, 5),
    [filteredListings, filteredServices]
  );
  const activeFilterCount = [search, filterCrop, filterDistrict, minPrice, maxPrice].filter((item) => item.trim()).length + (filterRole !== "all" ? 1 : 0) + (mediaOnly ? 1 : 0) + (sortBy !== "newest" ? 1 : 0);
  const mediaBackedPct = listings.length ? `${Math.round((listings.filter((item) => item.mediaUrls.length > 0).length / listings.length) * 100)}%` : "0%";

  function resetFilters() {
    setSearch("");
    setFilterCrop("");
    setFilterDistrict("");
    setFilterRole("all");
    setMinPrice("");
    setMaxPrice("");
    setMediaOnly(false);
    setSortBy("newest");
  }

  return (
    <section className="market-hub-shell">
      <div className={`market-hub-backdrop${sidebarOpen ? " open" : ""}`} onClick={() => setSidebarOpen(false)} />
      <aside className={`market-hub-sidebar${sidebarOpen ? " open" : ""}`}>
        <div className="market-hub-sidebar-head">
          <p className="eyebrow">Marketplace navigator</p>
          <h2>Browse marketplace</h2>
          <p>Filter produce, buyers, and services.</p>
          <button type="button" className="market-hub-close" onClick={() => setSidebarOpen(false)}>Close</button>
        </div>
        <div className="market-hub-segmented">
          <button type="button" className={feedView === "all" ? "active" : ""} onClick={() => setFeedView("all")}>All</button>
          <button type="button" className={feedView === "listings" ? "active" : ""} onClick={() => setFeedView("listings")}>Produce</button>
          <button type="button" className={feedView === "services" ? "active" : ""} onClick={() => setFeedView("services")}>Services</button>
        </div>
        <nav className="market-hub-nav">
          <a href="#market-overview" onClick={() => setSidebarOpen(false)}><span>Overview</span><strong>{filteredListings.length + filteredServices.length}</strong></a>
          <a href="#market-listings" onClick={() => setSidebarOpen(false)}><span>Produce feed</span><strong>{filteredListings.length}</strong></a>
          <a href="#market-services" onClick={() => setSidebarOpen(false)}><span>Service network</span><strong>{filteredServices.length}</strong></a>
          <a href="#market-guide" onClick={() => setSidebarOpen(false)}><span>Access rules</span><strong>{user ? "Open" : "Locked"}</strong></a>
        </nav>
        <section className="market-filter-panel">
          <div className="market-filter-panel-head">
            <div><span className="label">Filter stack</span><h3>Filters</h3></div>
            <button type="button" className="market-link-button" onClick={resetFilters}>Reset</button>
          </div>
          <label className="field market-filter-field"><span>Search</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Maize, sorghum, transport..." /></label>
          <div className="market-filter-two-up">
            <label className="field market-filter-field"><span>Crop</span><input value={filterCrop} onChange={(event) => setFilterCrop(event.target.value)} placeholder="Beans" /></label>
            <label className="field market-filter-field"><span>Role</span><select value={filterRole} onChange={(event) => setFilterRole(event.target.value as "all" | "seller" | "buyer")}><option value="all">All listings</option><option value="seller">Seller supply</option><option value="buyer">Buyer demand</option></select></label>
          </div>
          <label className="field market-filter-field"><span>District or parish</span><input value={filterDistrict} onChange={(event) => setFilterDistrict(event.target.value)} placeholder="Gulu" /></label>
          <div className="market-filter-two-up">
            <label className="field market-filter-field"><span>Min price</span><input type="number" value={minPrice} onChange={(event) => setMinPrice(event.target.value)} placeholder="1000" /></label>
            <label className="field market-filter-field"><span>Max price</span><input type="number" value={maxPrice} onChange={(event) => setMaxPrice(event.target.value)} placeholder="5000" /></label>
          </div>
          <label className="field market-filter-field"><span>Sort by</span><select value={sortBy} onChange={(event) => setSortBy(event.target.value as "newest" | "price_asc" | "price_desc" | "media_desc")}><option value="newest">Newest</option><option value="price_asc">Price low to high</option><option value="price_desc">Price high to low</option><option value="media_desc">Most media</option></select></label>
          <label className="market-inline-check"><input type="checkbox" checked={mediaOnly} onChange={(event) => setMediaOnly(event.target.checked)} /><span>Media evidence only</span></label>
        </section>
        <section className={`market-access-panel${user ? " unlocked" : ""}`}>
          <span className="label">{user ? "Signed in" : "Contact access"}</span>
          <h3>{user ? "Contact details are available." : "Sign in to view contact details."}</h3>
          <p>{user ? "Call and WhatsApp actions are shown on listings." : "Phone, WhatsApp, and SMS are hidden for guests."}</p>
          {!user ? <Link className="btn" to="/auth">Sign in</Link> : null}
        </section>
      </aside>

      <div className="market-hub-main">
        <section id="market-overview" className="market-hub-hero">
          <div className="market-hub-hero-copy">
            <p className="eyebrow">Marketplace</p>
            <h1>Buy, sell, and find services.</h1>
            <p className="market-hub-lead">Browse produce, buyer demand, and service listings in one place.</p>
            <div className="cta-row">
              <a className="btn" href="#market-listings">Browse produce</a>
              <a className="btn ghost" href="#market-services">View services</a>
              <button type="button" className="btn ghost market-mobile-filters" onClick={() => setSidebarOpen(true)}>Filters and navigation</button>
            </div>
            <div className="market-hub-chip-row">{districts.length ? districts.map((district) => <span key={district}>{district}</span>) : <span>Live listings</span>}<span>{user ? "Signed in" : "Guest"}</span></div>
          </div>
          <div className="market-pulse-grid">
            <article className="market-pulse-card"><span className="label">Produce listings</span><strong>{filteredListings.length}</strong><p>Buyers and sellers</p></article>
            <article className="market-pulse-card"><span className="label">Service providers</span><strong>{filteredServices.length}</strong><p>Support and logistics</p></article>
            <article className="market-pulse-card"><span className="label">With media</span><strong>{mediaBackedPct}</strong><p>Proof uploaded</p></article>
            <article className="market-pulse-card"><span className="label">Filters</span><strong>{activeFilterCount}</strong><p>Now applied</p></article>
          </div>
        </section>

        <section className="market-results-strip">
          <div><span className="label">Results</span><h2>{filteredListings.length} produce listings and {filteredServices.length} services</h2><p>{activeFilterCount ? "Filtered results" : "All open results"}</p></div>
          <div className="market-results-actions"><button type="button" className="btn ghost" onClick={() => setSidebarOpen(true)}>Edit filters</button>{activeFilterCount ? <button type="button" className="btn ghost" onClick={resetFilters}>Clear filters</button> : null}</div>
        </section>

        {error ? <p className="status error">{error}</p> : null}

        {feedView !== "services" ? (
          <section id="market-listings" className="market-content-section">
            <div className="market-section-head"><div><span className="label">Produce and demand listings</span><h2>Produce listings</h2></div><p>Open a listing to view full details.</p></div>
            {loading ? <p>Loading produce listings...</p> : filteredListings.length === 0 ? <p>No public listings match your filters.</p> : (
              <div className="market-card-grid">
                {filteredListings.map((item) => {
                  const telHref = item.contactUnlocked ? buildTelHref(item.contactPhone) : null;
                  const whatsappHref = item.contactUnlocked ? buildWhatsappHref(item.contactWhatsapp || item.contactPhone, `Hello, I am interested in your ${item.crop} listing on AGRIK marketplace.`) : null;
                  return (
                    <article key={item.id} className="market-card">
                      <Link className="market-card-media" to={`/marketplace/listings/${item.id}`}>
                        {item.mediaUrls[0] ? <img src={item.mediaUrls[0]} alt={`${item.crop} listing evidence`} loading="lazy" /> : <div className="market-card-placeholder"><span>No media evidence</span></div>}
                        <span className="market-card-media-pill">{item.mediaUrls.length ? `${item.mediaUrls.length} media` : "No media"}</span>
                      </Link>
                      <div className="market-card-body">
                        <div className="market-card-topline"><span className={`market-role-tag ${item.role === "buyer" ? "buyer" : "seller"}`}>{item.role === "buyer" ? "Buyer demand" : "Seller supply"}</span><span className={`market-contact-state${item.contactUnlocked ? " unlocked" : ""}`}>{item.contactUnlocked ? "Contact" : "Sign in for contact"}</span></div>
                        <div className="market-card-heading"><div><h3>{item.crop || "Listing"}</h3><p>{listingLocationLabel(item)}</p></div><strong>{item.price != null ? formatMoney(item.price, item.currency || "UGX") : "Negotiable"}</strong></div>
                        <div className="market-card-metrics"><div><span>Quantity</span><strong>{item.quantity != null ? `${item.quantity} ${item.unit || "units"}` : "Open"}</strong></div><div><span>Grade</span><strong>{item.grade || "Mixed"}</strong></div><div><span>Published</span><strong>{formatDate(item.createdAt)}</strong></div></div>
                        <p className="market-card-description">{compactText(item.description || (item.role === "buyer" ? "Buyer demand requirement posted." : "Seller supply listing posted."), 138)}</p>
                        <div className="market-card-footer"><div className="market-card-publisher"><span className="label">Publisher</span><strong>{item.contactUnlocked ? item.contactName || "Marketplace contact" : "Hidden"}</strong></div><div className="market-card-actions"><Link className="btn ghost small" to={`/marketplace/listings/${item.id}`}>View details</Link>{telHref ? <a className="btn ghost small" href={telHref}>Call</a> : null}{whatsappHref ? <a className="btn ghost small" href={whatsappHref} target="_blank" rel="noreferrer">WhatsApp</a> : !item.contactUnlocked ? <Link className="btn small" to="/auth">Sign in</Link> : null}</div></div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        ) : null}

        {feedView !== "listings" ? (
          <section id="market-services" className="market-content-section">
            <div className="market-section-head"><div><span className="label">Service providers</span><h2>Service providers</h2></div><p>Support services across locations.</p></div>
            {loading ? <p>Loading service providers...</p> : filteredServices.length === 0 ? <p>No public service providers match your filters.</p> : (
              <div className="market-service-grid-neo">
                {filteredServices.map((item) => (
                  <article key={item.id} className="market-service-card">
                    <div className="market-service-card-top"><div><span className="label">Service listing</span><h3>{item.serviceType || "Service"}</h3></div><span className="market-service-status">{item.status || "open"}</span></div>
                    <p>{compactText(item.description || "Service listing", 150)}</p>
                    <div className="market-service-meta"><strong>{item.price != null ? formatMoney(item.price, item.currency || "UGX") : "Quote on request"}</strong><span>{joinLocation(item.parish, item.district)}</span></div>
                    <div className="market-service-proof"><span>{item.mediaUrls.length ? `${item.mediaUrls.length} proof files` : "No proof files"}</span>{item.mediaUrls[0] ? <a href={item.mediaUrls[0]} target="_blank" rel="noreferrer">Open evidence</a> : null}</div>
                  </article>
                ))}
              </div>
            )}
          </section>
        ) : null}

        <section id="market-guide" className="market-guide-panel">
          <div><span className="label">Contact access</span><h2>Listing details are open. Contact is for signed-in users.</h2><p>Browse first. Sign in when you are ready to contact the publisher.</p></div>
          <div className="market-guide-steps"><article><strong>1</strong><h3>Browse</h3><p>Search listings and services.</p></article><article><strong>2</strong><h3>Review</h3><p>Open details, price, and media.</p></article><article><strong>3</strong><h3>Contact</h3><p>Sign in to reveal contact details.</p></article></div>
          {!user ? <Link className="btn" to="/auth">Sign in</Link> : null}
        </section>
      </div>
    </section>
  );
}
