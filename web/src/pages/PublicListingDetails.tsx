import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
import {
  MarketListingRecord,
  buildSmsHref,
  buildTelHref,
  buildWhatsappHref,
  formatDate,
  formatMoney,
  listingContactName,
  listingLocationLabel,
  normalizeListing,
} from "../lib/marketplace";
import { useAuth } from "../state/auth";

export default function PublicListingDetails() {
  const { user } = useAuth();
  const params = useParams<{ listingId: string }>();
  const listingId = Number(params.listingId);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [listing, setListing] = useState<MarketListingRecord | null>(null);
  const [activeMedia, setActiveMedia] = useState(0);
  const [hiddenMediaUrls, setHiddenMediaUrls] = useState<string[]>([]);

  useEffect(() => {
    if (!Number.isFinite(listingId) || listingId <= 0) {
      setError("Invalid listing id.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    api
      .marketListingById(listingId)
      .then((raw) => {
        const normalized = normalizeListing(raw);
        if (!normalized) {
          setListing(null);
          setError("Listing not found.");
          return;
        }
        setListing(normalized);
      })
      .catch(() => setError("Unable to load listing details."))
      .finally(() => setLoading(false));
  }, [listingId, user?.id]);

  useEffect(() => {
    setActiveMedia(0);
    setHiddenMediaUrls([]);
  }, [listing?.id]);

  const availableMedia = useMemo(() => {
    if (!listing) return [];
    if (!hiddenMediaUrls.length) return listing.mediaUrls;
    const hidden = new Set(hiddenMediaUrls);
    return listing.mediaUrls.filter((url) => !hidden.has(url));
  }, [hiddenMediaUrls, listing]);

  const contactLinks = useMemo(() => {
    if (!listing || !listing.contactUnlocked) return { tel: null, whatsapp: null, sms: null };
    const message = `Hello, I am interested in your ${listing.crop} listing on AGRIK marketplace.`;
    return {
      tel: buildTelHref(listing.contactPhone),
      whatsapp: buildWhatsappHref(listing.contactWhatsapp || listing.contactPhone, message),
      sms: buildSmsHref(listing.contactPhone, message),
    };
  }, [listing]);

  function hideBrokenMedia(url: string) {
    if (!url) return;
    setHiddenMediaUrls((current) => (current.includes(url) ? current : [...current, url]));
  }

  if (loading) return <section className="page">Loading listing details...</section>;
  if (error || !listing) {
    return (
      <section className="page">
        <p className="status error">{error || "Listing not found."}</p>
        <Link className="btn ghost" to="/marketplace">
          Back to marketplace
        </Link>
      </section>
    );
  }

  const activeUrl = availableMedia[Math.min(activeMedia, Math.max(availableMedia.length - 1, 0))] || "";
  const locationLabel = listingLocationLabel(listing);
  const contactName = listing.contactUnlocked ? listingContactName(listing) : "Protected marketplace contact";
  const roleLabel = listing.role === "buyer" ? "Buyer demand" : "Seller supply";
  const quantityLabel = listing.quantity != null ? `${listing.quantity} ${listing.unit || "units"}` : "Not specified";
  const priceLabel = listing.price != null ? formatMoney(listing.price, listing.currency || "UGX") : "Negotiable";
  const gradeLabel = listing.grade || "Not specified";
  const hasMedia = availableMedia.length > 0;

  return (
    <section className="market-detail-shell">
      <div className="market-detail-top">
        <Link className="btn ghost small" to="/marketplace">
          Back to marketplace
        </Link>
        <span className="market-detail-id">Listing #{listing.id}</span>
      </div>

      <section className="market-detail-hero">
        <div className="market-detail-hero-main">
          <p className="eyebrow">Listing details</p>
          <h1>{listing.crop || "Marketplace listing"}</h1>
          <p className="market-detail-lead">
            {listing.description || (listing.role === "buyer" ? "Buyer demand listing with protected contact access." : "Seller supply listing with protected contact access.")}
          </p>
          <div className="market-detail-chip-row">
            <span className={`market-detail-chip market-detail-role ${listing.role === "buyer" ? "role-buyer" : "role-seller"}`}>{roleLabel}</span>
            <span className="market-detail-chip">{locationLabel}</span>
            <span className={`market-detail-chip ${listing.contactUnlocked ? "is-open" : "is-locked"}`}>
              {listing.contactUnlocked ? "Contact" : "Contact hidden"}
            </span>
          </div>
        </div>
        <div className="market-detail-hero-stats">
          <div className="market-detail-stat"><span className="market-detail-stat-label">Price</span><strong className="market-detail-stat-value">{priceLabel}</strong></div>
          <div className="market-detail-stat"><span className="market-detail-stat-label">Quantity</span><strong className="market-detail-stat-value">{quantityLabel}</strong></div>
          <div className="market-detail-stat"><span className="market-detail-stat-label">Grade</span><strong className="market-detail-stat-value">{gradeLabel}</strong></div>
          <div className="market-detail-stat"><span className="market-detail-stat-label">Published</span><strong className="market-detail-stat-value">{formatDate(listing.createdAt)}</strong></div>
        </div>
      </section>

      <section className="market-detail-layout modern">
        <div className="market-detail-main-column">
          <article className="market-detail-card market-detail-media-card">
            <div className="market-detail-card-head">
              <h3>Media evidence</h3>
              <span>{hasMedia ? `${availableMedia.length} file${availableMedia.length === 1 ? "" : "s"}` : "No media"}</span>
            </div>
            <div className="market-detail-media">
              {hasMedia ? (
                <>
                  <a href={activeUrl} target="_blank" rel="noreferrer" className="market-detail-main-image">
                    <img src={activeUrl} alt={`${listing.crop} media evidence`} onError={() => hideBrokenMedia(activeUrl)} />
                  </a>
                  <div className="market-detail-thumbs">
                    {availableMedia.map((url, index) => (
                      <button
                        key={`${url}-${index}`}
                        type="button"
                        className={`market-detail-thumb ${index === activeMedia ? "active" : ""}`}
                        onClick={() => setActiveMedia(index)}
                      >
                        <img src={url} alt={`${listing.crop} evidence ${index + 1}`} loading="lazy" onError={() => hideBrokenMedia(url)} />
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <div className="market-detail-empty">No media evidence uploaded for this listing.</div>
              )}
            </div>
          </article>

          <article className="market-detail-card">
            <h3>Listing notes</h3>
            <p className="market-detail-notes">{listing.description || "No additional notes were provided by the publisher for this listing."}</p>
          </article>
        </div>

        <aside className="market-detail-side">
          <article className={`market-detail-card market-detail-contact-card gate${listing.contactUnlocked ? " unlocked" : ""}`}>
            <span className="label">{listing.contactUnlocked ? "Contact details" : "Contact details"}</span>
            <h3>{listing.contactUnlocked ? `Reach ${contactName}` : "Sign in to view contact details."}</h3>
            <p className="muted">
              {listing.contactUnlocked
                ? "Use call, WhatsApp, or SMS."
                : "Phone, WhatsApp, and SMS are hidden for guests."}
            </p>
            {listing.contactUnlocked ? (
              <>
                <div className="market-contact-actions">
                  {contactLinks.tel ? <a className="btn small" href={contactLinks.tel}>Call now</a> : null}
                  {contactLinks.whatsapp ? <a className="btn ghost small" href={contactLinks.whatsapp} target="_blank" rel="noreferrer">WhatsApp</a> : null}
                  {contactLinks.sms ? <a className="btn ghost small" href={contactLinks.sms}>SMS</a> : null}
                </div>
                <div className="market-detail-contact-meta">
                  <div><span className="label">Phone</span><p>{listing.contactPhone || "--"}</p></div>
                  <div><span className="label">WhatsApp</span><p>{listing.contactWhatsapp || listing.contactPhone || "--"}</p></div>
                  <div><span className="label">Location</span><p>{locationLabel}</p></div>
                </div>
              </>
            ) : (
              <div className="market-locked-panel">
                <div className="market-locked-list">
                  <span>Phone number hidden</span>
                  <span>WhatsApp action hidden</span>
                  <span>SMS shortcut hidden</span>
                </div>
                <div className="cta-row">
                  <Link className="btn" to="/auth">
                    Sign in
                  </Link>
                  <Link className="btn ghost" to="/auth">
                    Create account
                  </Link>
                </div>
              </div>
            )}
          </article>

          <article className="market-detail-card">
            <h3>Listing summary</h3>
            <div className="market-detail-kv"><span>Role</span><strong>{roleLabel}</strong></div>
            <div className="market-detail-kv"><span>Status</span><strong>{listing.status || "open"}</strong></div>
            <div className="market-detail-kv"><span>Quantity</span><strong>{quantityLabel}</strong></div>
            <div className="market-detail-kv"><span>Price</span><strong>{priceLabel}</strong></div>
            <div className="market-detail-kv"><span>Grade</span><strong>{gradeLabel}</strong></div>
            <div className="market-detail-kv"><span>Published</span><strong>{formatDate(listing.createdAt)}</strong></div>
          </article>
        </aside>
      </section>
    </section>
  );
}
