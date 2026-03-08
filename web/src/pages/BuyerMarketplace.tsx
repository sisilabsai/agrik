import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Icon } from "../components/Visuals";
import { api } from "../lib/api";
import { useAuth } from "../state/auth";

type MarketListing = {
  id: number;
  userId: string;
  crop: string;
  quantity: number | null;
  unit: string;
  price: number | null;
  currency: string;
  grade: string;
  description: string;
  contactName: string;
  contactPhone: string;
  contactWhatsapp: string;
  status: string;
  district: string;
  parish: string;
  mediaUrls: string[];
  createdAt: string;
};

type MarketOffer = {
  id: number;
  listingId: number;
  price: number | null;
  quantity: number | null;
  status: string;
  createdAt: string;
};

type DemandDraft = {
  crop: string;
  quantity: string;
  unit: string;
  targetPrice: string;
  currency: string;
  description: string;
  contactName: string;
  contactPhone: string;
  contactWhatsapp: string;
  district: string;
  parish: string;
};

type OfferDraft = {
  price: string;
  quantity: string;
};

const UNIT_OPTIONS = ["kg", "bags", "tons", "crates", "liters"];
const CURRENCY_OPTIONS = ["UGX", "USD", "KES", "TZS"];

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return {};
}

function toStringValue(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value == null) return "";
  return String(value).trim();
}

function toNumberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const cleaned = value.replace(/,/g, "").trim();
    if (!cleaned) return null;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toMediaUrlList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const item of value) {
    const text = toStringValue(item);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    urls.push(text);
  }
  return urls;
}

function toOptionalNumber(value: string): number | undefined {
  const parsed = toNumberValue(value);
  return parsed == null ? undefined : parsed;
}

function normalizeListing(raw: unknown): MarketListing | null {
  const row = asRecord(raw);
  const location = asRecord(row.location);
  const id = toNumberValue(row.id);
  if (id == null) return null;
  return {
    id,
    userId: toStringValue(row.user_id),
    crop: toStringValue(row.crop),
    quantity: toNumberValue(row.quantity),
    unit: toStringValue(row.unit),
    price: toNumberValue(row.price),
    currency: toStringValue(row.currency) || "UGX",
    grade: toStringValue(row.grade),
    description: toStringValue(row.description),
    contactName: toStringValue(row.contact_name),
    contactPhone: toStringValue(row.contact_phone),
    contactWhatsapp: toStringValue(row.contact_whatsapp),
    status: toStringValue(row.status) || "open",
    district: toStringValue(location.district),
    parish: toStringValue(location.parish),
    mediaUrls: toMediaUrlList(row.media_urls),
    createdAt: toStringValue(row.created_at),
  };
}

function normalizeOffer(raw: unknown): MarketOffer | null {
  const row = asRecord(raw);
  const id = toNumberValue(row.id);
  const listingId = toNumberValue(row.listing_id);
  if (id == null || listingId == null) return null;
  return {
    id,
    listingId,
    price: toNumberValue(row.price),
    quantity: toNumberValue(row.quantity),
    status: toStringValue(row.status) || "open",
    createdAt: toStringValue(row.created_at),
  };
}

function formatMoney(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "UGX",
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${currency || "UGX"} ${value.toFixed(0)}`;
  }
}

function formatDate(value: string): string {
  if (!value) return "--";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "--";
  return parsed.toLocaleDateString();
}

export default function BuyerMarketplace() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [savingDemand, setSavingDemand] = useState(false);
  const [uploadingDemandMedia, setUploadingDemandMedia] = useState(false);
  const [submittingOfferFor, setSubmittingOfferFor] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [sellerListings, setSellerListings] = useState<MarketListing[]>([]);
  const [myDemandListings, setMyDemandListings] = useState<MarketListing[]>([]);
  const [myOffers, setMyOffers] = useState<MarketOffer[]>([]);

  const [filterCrop, setFilterCrop] = useState("");
  const [filterDistrict, setFilterDistrict] = useState("");
  const [demandDraft, setDemandDraft] = useState<DemandDraft>({
    crop: "",
    quantity: "",
    unit: "kg",
    targetPrice: "",
    currency: "UGX",
    description: "",
    contactName: "",
    contactPhone: user?.phone || "",
    contactWhatsapp: user?.phone || "",
    district: "",
    parish: "",
  });
  const [demandMediaUrls, setDemandMediaUrls] = useState<string[]>([]);
  const [offerDrafts, setOfferDrafts] = useState<Record<number, OfferDraft>>({});

  const loadData = () => {
    if (!user?.phone) return;
    setLoading(true);
    setError(null);
    Promise.allSettled([
      api.profileDetails(),
      api.marketListings("?status=open&role=seller&limit=120"),
      api.marketListings(`?phone=${encodeURIComponent(user.phone)}&role=buyer&limit=60`),
      api.marketOffers(`?phone=${encodeURIComponent(user.phone)}&limit=120`),
    ])
      .then(([profileRes, listingsRes, demandRes, offersRes]) => {
        if (profileRes.status === "fulfilled") {
          const profile = profileRes.value as { settings?: { district?: string | null; parish?: string | null } };
          const district = profile.settings?.district ?? "";
          const parish = profile.settings?.parish ?? "";
          setDemandDraft((prev) => ({
            ...prev,
            contactPhone: prev.contactPhone || user.phone,
            contactWhatsapp: prev.contactWhatsapp || user.phone,
            district: prev.district || district,
            parish: prev.parish || parish,
          }));
        }

        if (listingsRes.status === "fulfilled") {
          setSellerListings((listingsRes.value.items ?? []).map((item) => normalizeListing(item)).filter((item): item is MarketListing => item != null));
        } else {
          setSellerListings([]);
        }

        if (demandRes.status === "fulfilled") {
          setMyDemandListings((demandRes.value.items ?? []).map((item) => normalizeListing(item)).filter((item): item is MarketListing => item != null));
        } else {
          setMyDemandListings([]);
        }

        if (offersRes.status === "fulfilled") {
          setMyOffers((offersRes.value.items ?? []).map((item) => normalizeOffer(item)).filter((item): item is MarketOffer => item != null));
        } else {
          setMyOffers([]);
        }
      })
      .catch(() => setError("Unable to load buyer marketplace."))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!user?.phone) return;
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.phone]);

  const filteredListings = useMemo(() => {
    return sellerListings
      .filter((item) => item.status.toLowerCase() === "open")
      .filter((item) => {
        if (!filterCrop.trim()) return true;
        return item.crop.toLowerCase().includes(filterCrop.trim().toLowerCase());
      })
      .filter((item) => {
        if (!filterDistrict.trim()) return true;
        return item.district.toLowerCase().includes(filterDistrict.trim().toLowerCase());
      });
  }, [filterCrop, filterDistrict, sellerListings]);

  const onDemandChange = <K extends keyof DemandDraft>(field: K, value: DemandDraft[K]) => {
    setDemandDraft((prev) => ({ ...prev, [field]: value }));
  };

  const removeDemandMedia = (url: string) => {
    setDemandMediaUrls((prev) => prev.filter((item) => item !== url));
  };

  const onUploadDemandMedia = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!user?.phone || files.length === 0) return;
    setUploadingDemandMedia(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api.marketUploadMedia({ files });
      const uploaded = (result.items ?? [])
        .map((item) => toStringValue(asRecord(item).url))
        .filter(Boolean);
      setDemandMediaUrls((prev) => Array.from(new Set([...prev, ...uploaded])));
      if (uploaded.length > 0) {
        setMessage(`${uploaded.length} media file${uploaded.length === 1 ? "" : "s"} uploaded.`);
      }
    } catch {
      setError("Unable to upload demand media.");
    } finally {
      setUploadingDemandMedia(false);
    }
  };

  const onOfferChange = (listingId: number, field: keyof OfferDraft, value: string) => {
    setOfferDrafts((prev) => ({
      ...prev,
      [listingId]: {
        price: prev[listingId]?.price ?? "",
        quantity: prev[listingId]?.quantity ?? "",
        [field]: value,
      },
    }));
  };

  const handlePublishDemand = async (event: FormEvent) => {
    event.preventDefault();
    if (!user?.phone) return;
    if (!demandDraft.crop.trim()) {
      setError("Demand crop is required.");
      return;
    }
    if (!demandDraft.district.trim()) {
      setError("District is required for demand matching.");
      return;
    }

    setSavingDemand(true);
    setError(null);
    setMessage(null);
    try {
      await api.marketCreateListing({
        phone: user.phone,
        role: "buyer",
        crop: demandDraft.crop.trim(),
        quantity: toOptionalNumber(demandDraft.quantity),
        unit: demandDraft.unit || "kg",
        price: toOptionalNumber(demandDraft.targetPrice),
        currency: demandDraft.currency || "UGX",
        description: demandDraft.description.trim() || undefined,
        contact_name: demandDraft.contactName.trim() || undefined,
        contact_phone: demandDraft.contactPhone.trim() || undefined,
        contact_whatsapp: demandDraft.contactWhatsapp.trim() || undefined,
        status: "open",
        media_urls: demandMediaUrls,
        location: {
          district: demandDraft.district.trim(),
          parish: demandDraft.parish.trim() || undefined,
        },
      });
      setMessage("Demand listing published.");
      setDemandDraft((prev) => ({
        ...prev,
        quantity: "",
        targetPrice: "",
        description: "",
      }));
      setDemandMediaUrls([]);
      loadData();
    } catch {
      setError("Unable to publish demand listing.");
    } finally {
      setSavingDemand(false);
    }
  };

  const handleSubmitOffer = async (listingId: number) => {
    if (!user?.phone) return;
    const draft = offerDrafts[listingId] ?? { price: "", quantity: "" };
    const price = toOptionalNumber(draft.price);
    const quantity = toOptionalNumber(draft.quantity);
    if (price == null && quantity == null) {
      setError("Set offer price or quantity before submitting.");
      return;
    }

    setSubmittingOfferFor(listingId);
    setError(null);
    setMessage(null);
    try {
      await api.marketCreateOffer({
        phone: user.phone,
        listing_id: listingId,
        price,
        quantity,
      });
      setMessage("Offer submitted.");
      setOfferDrafts((prev) => ({ ...prev, [listingId]: { price: "", quantity: "" } }));
      loadData();
    } catch {
      setError("Unable to submit offer.");
    } finally {
      setSubmittingOfferFor(null);
    }
  };

  if (loading) return <section className="farmer-page">Loading buyer marketplace...</section>;

  return (
    <section className="farmer-page">
      <div className="farmer-page-header">
        <div className="section-title-with-icon">
          <span className="section-icon">
            <Icon name="market" size={18} />
          </span>
          <div>
            <div className="label">Marketplace</div>
            <h1>Buyer and offtaker marketplace</h1>
            <p className="muted">Find produce with evidence images, publish demand, and submit offers.</p>
          </div>
        </div>
      </div>

      {(message || error) && <p className={`status ${error ? "error" : ""}`}>{error ?? message}</p>}

      <section className="farmer-card">
        <div className="farmer-card-header">
          <div>
            <div className="label">Demand listing</div>
            <h3>Post what you need to buy</h3>
          </div>
        </div>
        <form className="farmer-form-grid" onSubmit={handlePublishDemand}>
          <label className="field">
            Crop
            <input value={demandDraft.crop} onChange={(event) => onDemandChange("crop", event.target.value)} placeholder="Maize" />
          </label>
          <label className="field">
            Quantity needed
            <input
              type="number"
              value={demandDraft.quantity}
              onChange={(event) => onDemandChange("quantity", event.target.value)}
              placeholder="500"
            />
          </label>
          <label className="field">
            Unit
            <select value={demandDraft.unit} onChange={(event) => onDemandChange("unit", event.target.value)}>
              {UNIT_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Target price
            <input
              type="number"
              value={demandDraft.targetPrice}
              onChange={(event) => onDemandChange("targetPrice", event.target.value)}
              placeholder="1200"
            />
          </label>
          <label className="field">
            Currency
            <select value={demandDraft.currency} onChange={(event) => onDemandChange("currency", event.target.value)}>
              {CURRENCY_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="field farmer-form-span">
            Requirement description
            <textarea
              rows={2}
              value={demandDraft.description}
              onChange={(event) => onDemandChange("description", event.target.value)}
              placeholder="Describe quality specs, moisture requirements, delivery terms, and timelines."
            />
          </label>
          <label className="field">
            Contact name
            <input value={demandDraft.contactName} onChange={(event) => onDemandChange("contactName", event.target.value)} placeholder="Procurement lead" />
          </label>
          <label className="field">
            Contact phone
            <input value={demandDraft.contactPhone} onChange={(event) => onDemandChange("contactPhone", event.target.value)} placeholder="+256700000000" />
          </label>
          <label className="field">
            WhatsApp number
            <input
              value={demandDraft.contactWhatsapp}
              onChange={(event) => onDemandChange("contactWhatsapp", event.target.value)}
              placeholder="+256700000000"
            />
          </label>
          <label className="field">
            District
            <input value={demandDraft.district} onChange={(event) => onDemandChange("district", event.target.value)} placeholder="Lira" />
          </label>
          <label className="field">
            Parish
            <input value={demandDraft.parish} onChange={(event) => onDemandChange("parish", event.target.value)} placeholder="Aromo" />
          </label>
          <label className="field farmer-form-span">
            Upload demand media evidence
            <input type="file" multiple accept="image/*" onChange={onUploadDemandMedia} disabled={uploadingDemandMedia} />
            <span className="field-note">Upload requirement photos/specs from web or mobile for better supplier matching.</span>
          </label>
          {demandMediaUrls.length > 0 ? (
            <div className="market-media-manager farmer-form-span">
              <div className="field-note">Uploaded media ({demandMediaUrls.length})</div>
              <div className="market-media-grid">
                {demandMediaUrls.map((url, index) => (
                  <div key={`${url}-${index}`} className="market-media-item">
                    <a href={url} target="_blank" rel="noreferrer" className="market-media-thumb">
                      <img src={url} alt={`Demand upload ${index + 1}`} loading="lazy" />
                    </a>
                    <button className="btn ghost tiny market-media-remove" type="button" onClick={() => removeDemandMedia(url)}>
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          <div className="market-form-actions">
            <button className="btn" type="submit" disabled={savingDemand || uploadingDemandMedia}>
              {savingDemand ? "Publishing..." : uploadingDemandMedia ? "Uploading media..." : "Publish demand listing"}
            </button>
          </div>
        </form>
      </section>

      <section className="farmer-card">
        <div className="farmer-card-header">
          <div>
            <div className="label">Discover supply</div>
            <h3>Open farmer listings</h3>
          </div>
        </div>
        <div className="market-filter-grid">
          <label className="field">
            Filter crop
            <input value={filterCrop} onChange={(event) => setFilterCrop(event.target.value)} placeholder="Maize" />
          </label>
          <label className="field">
            Filter district
            <input value={filterDistrict} onChange={(event) => setFilterDistrict(event.target.value)} placeholder="Lira" />
          </label>
        </div>
        {filteredListings.length === 0 ? (
          <p className="muted">No matching listings found.</p>
        ) : (
          <div className="market-list-grid">
            {filteredListings.slice(0, 40).map((item) => {
              const draft = offerDrafts[item.id] ?? { price: "", quantity: "" };
              return (
                <article key={item.id} className="market-list-item">
                  <div className="market-list-top">
                    <strong>{item.crop}</strong>
                    <span className="pill">{item.status}</span>
                  </div>
                  <div className="market-list-meta">
                    {item.quantity != null ? `${item.quantity} ${item.unit || "units"}` : "Quantity --"} |{" "}
                    {item.price != null ? formatMoney(item.price, item.currency || "UGX") : "Price --"}
                  </div>
                  <div className="market-list-meta">{item.description || "No listing description provided."}</div>
                  <div className="market-list-meta">{[item.parish, item.district].filter(Boolean).join(", ") || "Location --"}</div>
                  {item.mediaUrls.length > 0 ? (
                    <div className="market-media-grid">
                      {item.mediaUrls.slice(0, 4).map((url, index) => (
                        <a key={`${item.id}-${index}`} href={url} target="_blank" rel="noreferrer" className="market-media-thumb">
                          <img src={url} alt={`${item.crop} evidence ${index + 1}`} loading="lazy" />
                        </a>
                      ))}
                    </div>
                  ) : (
                    <div className="farmer-inline-meta">No media evidence attached.</div>
                  )}
                  <div className="market-inline-actions">
                    <Link className="btn ghost tiny" to={`/marketplace/listings/${item.id}`}>
                      View details
                    </Link>
                  </div>
                  <div className="farmer-form-grid">
                    <label className="field">
                      Offer price
                      <input type="number" value={draft.price} onChange={(event) => onOfferChange(item.id, "price", event.target.value)} placeholder="1150" />
                    </label>
                    <label className="field">
                      Offer quantity
                      <input
                        type="number"
                        value={draft.quantity}
                        onChange={(event) => onOfferChange(item.id, "quantity", event.target.value)}
                        placeholder="300"
                      />
                    </label>
                  </div>
                  <button className="btn small" type="button" disabled={submittingOfferFor === item.id} onClick={() => handleSubmitOffer(item.id)}>
                    {submittingOfferFor === item.id ? "Submitting..." : "Submit offer"}
                  </button>
                  <div className="farmer-inline-meta">Published {formatDate(item.createdAt)}</div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="farmer-card">
        <div className="farmer-card-header">
          <div>
            <div className="label">Offer ledger</div>
            <h3>My submitted offers</h3>
          </div>
        </div>
        {myOffers.length === 0 ? (
          <p className="muted">No offers submitted yet.</p>
        ) : (
          <div className="market-list-grid">
            {myOffers.slice(0, 40).map((item) => (
              <article key={item.id} className="market-list-item">
                <div className="market-list-top">
                  <strong>Listing #{item.listingId}</strong>
                  <span className="pill">{item.status}</span>
                </div>
                <div className="market-list-meta">
                  {item.quantity != null ? `${item.quantity} units` : "Quantity --"} | {item.price != null ? `Offer ${item.price}` : "Price --"}
                </div>
                <div className="farmer-inline-meta">Submitted {formatDate(item.createdAt)}</div>
              </article>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}
