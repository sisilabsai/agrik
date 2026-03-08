import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Icon } from "../components/Visuals";
import { api } from "../lib/api";
import { useAuth } from "../state/auth";

type ProfileDetails = {
  settings: {
    district?: string | null;
    parish?: string | null;
  };
  farm: {
    crops: string[];
  };
};

type MarketLocation = {
  district?: string | null;
  parish?: string | null;
};

type MarketListing = {
  id: number;
  userId: string;
  role: string;
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
  mediaUrls: string[];
  status: string;
  createdAt: string;
  location: MarketLocation;
};

type MarketService = {
  id: number;
  serviceType: string;
  description: string;
  mediaUrls: string[];
  coverageRadiusKm: number | null;
  price: number | null;
  currency: string;
  status: string;
  createdAt: string;
  location: MarketLocation;
};

type MarketPrediction = {
  crop: string;
  district: string;
  predictedPrice: number | null;
  currency: string;
  direction: "up" | "down" | "flat";
  confidence: number | null;
};

type ListingFormState = {
  crop: string;
  quantity: string;
  unit: string;
  price: string;
  currency: string;
  grade: string;
  description: string;
  contactName: string;
  contactPhone: string;
  contactWhatsapp: string;
  district: string;
  parish: string;
};

const CROP_OPTIONS = [
  "Maize",
  "Beans",
  "Cassava",
  "Rice",
  "Groundnuts",
  "Sorghum",
  "Millet",
  "Bananas",
  "Coffee",
  "Cotton",
  "Soybeans",
  "Sunflower",
  "Tomatoes",
  "Onions",
  "Cabbage",
];

const UNIT_OPTIONS = ["kg", "bags", "tons", "crates", "liters"];
const CURRENCY_OPTIONS = ["UGX", "USD", "KES", "TZS"];
const GRADE_OPTIONS = ["Premium", "Standard", "Mixed"];

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
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

function toOptionalNumberInput(value: string): number | undefined {
  const parsed = toNumberValue(value);
  return parsed == null ? undefined : parsed;
}

function toMediaUrlList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    const text = toStringValue(item);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
}

function formatDate(value: string): string {
  if (!value) return "--";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "--";
  return parsed.toLocaleDateString();
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

function normalizeListing(raw: unknown): MarketListing | null {
  const data = asRecord(raw);
  const id = toNumberValue(data.id);
  if (id == null) return null;
  const location = asRecord(data.location);
  return {
    id,
    userId: toStringValue(data.user_id),
    role: toStringValue(data.role),
    crop: toStringValue(data.crop),
    quantity: toNumberValue(data.quantity),
    unit: toStringValue(data.unit),
    price: toNumberValue(data.price),
    currency: toStringValue(data.currency) || "UGX",
    grade: toStringValue(data.grade),
    description: toStringValue(data.description),
    contactName: toStringValue(data.contact_name),
    contactPhone: toStringValue(data.contact_phone),
    contactWhatsapp: toStringValue(data.contact_whatsapp),
    mediaUrls: toMediaUrlList(data.media_urls),
    status: toStringValue(data.status) || "open",
    createdAt: toStringValue(data.created_at),
    location: {
      district: toStringValue(location.district) || null,
      parish: toStringValue(location.parish) || null,
    },
  };
}

function normalizeService(raw: unknown): MarketService | null {
  const data = asRecord(raw);
  const id = toNumberValue(data.id);
  if (id == null) return null;
  const location = asRecord(data.location);
  return {
    id,
    serviceType: toStringValue(data.service_type),
    description: toStringValue(data.description),
    mediaUrls: toMediaUrlList(data.media_urls),
    coverageRadiusKm: toNumberValue(data.coverage_radius_km),
    price: toNumberValue(data.price),
    currency: toStringValue(data.currency) || "UGX",
    status: toStringValue(data.status) || "open",
    createdAt: toStringValue(data.created_at),
    location: {
      district: toStringValue(location.district) || null,
      parish: toStringValue(location.parish) || null,
    },
  };
}

function normalizePrediction(raw: unknown): MarketPrediction | null {
  const data = asRecord(raw);
  const crop = toStringValue(data.crop);
  if (!crop) return null;
  const directionValue = toStringValue(data.direction).toLowerCase();
  const direction: "up" | "down" | "flat" = directionValue === "up" || directionValue === "down" ? directionValue : "flat";
  return {
    crop,
    district: toStringValue(data.district),
    predictedPrice: toNumberValue(data.predicted_price),
    currency: toStringValue(data.currency) || "UGX",
    direction,
    confidence: toNumberValue(data.confidence),
  };
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const clean = value.trim();
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(clean);
  }
  return result;
}

export default function FarmerMarketHub() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [profileDistrict, setProfileDistrict] = useState("");
  const [profileParish, setProfileParish] = useState("");
  const [profileCrops, setProfileCrops] = useState<string[]>([]);

  const [myListings, setMyListings] = useState<MarketListing[]>([]);
  const [marketListings, setMarketListings] = useState<MarketListing[]>([]);
  const [serviceFeed, setServiceFeed] = useState<MarketService[]>([]);
  const [predictions, setPredictions] = useState<MarketPrediction[]>([]);

  const [listingFilterCrop, setListingFilterCrop] = useState("");
  const [listingFilterDistrict, setListingFilterDistrict] = useState("");

  const [listingDraft, setListingDraft] = useState<ListingFormState>({
    crop: "",
    quantity: "",
    unit: "kg",
    price: "",
    currency: "UGX",
    grade: "",
    description: "",
    contactName: "",
    contactPhone: user?.phone || "",
    contactWhatsapp: user?.phone || "",
    district: "",
    parish: "",
  });
  const [listingMediaUrls, setListingMediaUrls] = useState<string[]>([]);

  const cropOptions = useMemo(() => {
    const pool = [
      ...CROP_OPTIONS,
      ...profileCrops,
      ...myListings.map((item) => item.crop),
      ...marketListings.map((item) => item.crop),
      ...predictions.map((item) => item.crop),
    ];
    return uniqueStrings(pool);
  }, [marketListings, myListings, predictions, profileCrops]);

  const myUserIds = useMemo(() => new Set(myListings.map((item) => item.userId).filter(Boolean)), [myListings]);

  const discoverListings = useMemo(() => {
    return marketListings
      .filter((item) => !myUserIds.has(item.userId))
      .filter((item) => item.status.toLowerCase() === "open")
      .filter((item) => {
        if (!listingFilterCrop.trim()) return true;
        return item.crop.toLowerCase().includes(listingFilterCrop.trim().toLowerCase());
      })
      .filter((item) => {
        if (!listingFilterDistrict.trim()) return true;
        return (item.location.district || "").toLowerCase().includes(listingFilterDistrict.trim().toLowerCase());
      });
  }, [listingFilterCrop, listingFilterDistrict, marketListings, myUserIds]);

  const openMyListings = useMemo(() => myListings.filter((item) => item.status.toLowerCase() === "open").length, [myListings]);
  const mediaReadyListings = useMemo(() => myListings.filter((item) => item.mediaUrls.length > 0).length, [myListings]);
  const publishChecklist = useMemo(
    () => [
      { label: "Crop", ready: Boolean(listingDraft.crop.trim()), detail: listingDraft.crop.trim() || "Select produce" },
      {
        label: "Pricing",
        ready: Boolean(listingDraft.price.trim() && listingDraft.quantity.trim()),
        detail: listingDraft.price.trim() && listingDraft.quantity.trim() ? "Price and quantity set" : "Add price and quantity",
      },
      {
        label: "Contacts",
        ready: Boolean(listingDraft.contactPhone.trim() || listingDraft.contactWhatsapp.trim()),
        detail: listingDraft.contactPhone.trim() || listingDraft.contactWhatsapp.trim() ? "Buyer can reach you" : "Add phone or WhatsApp",
      },
      {
        label: "Location",
        ready: Boolean((listingDraft.district || profileDistrict).trim()),
        detail: (listingDraft.district || profileDistrict).trim() ? "Discovery location ready" : "Add district",
      },
      {
        label: "Evidence",
        ready: listingMediaUrls.length > 0,
        detail: listingMediaUrls.length > 0 ? `${listingMediaUrls.length} file(s) attached` : "Add listing media",
      },
    ],
    [listingDraft.contactPhone, listingDraft.contactWhatsapp, listingDraft.crop, listingDraft.district, listingDraft.price, listingDraft.quantity, listingMediaUrls.length, profileDistrict]
  );
  const publishReadyCount = publishChecklist.filter((item) => item.ready).length;
  const leadPrediction = predictions[0] ?? null;

  const loadHubData = () => {
    if (!user?.phone) return;
    setLoading(true);
    setError(null);

    const ownListingsQuery = `?phone=${encodeURIComponent(user.phone)}&limit=30`;
    const openSellerListingsQuery = "?status=open&role=seller&limit=50";

    Promise.allSettled([
      api.profileDetails(),
      api.marketListings(ownListingsQuery),
      api.marketListings(openSellerListingsQuery),
      api.marketServices("?status=open&limit=20"),
      api.marketIntel("?limit=6"),
    ])
      .then(([profileRes, myListingRes, listingRes, serviceRes, intelRes]) => {
        if (profileRes.status === "fulfilled") {
          const profile = profileRes.value as ProfileDetails;
          const district = profile.settings.district ?? "";
          const parish = profile.settings.parish ?? "";
          const crops = profile.farm.crops ?? [];
          setProfileDistrict(district);
          setProfileParish(parish);
          setProfileCrops(crops);
          setListingDraft((prev) => ({
            ...prev,
            crop: prev.crop || crops[0] || "",
            contactPhone: prev.contactPhone || user.phone,
            contactWhatsapp: prev.contactWhatsapp || user.phone,
            district: prev.district || district,
            parish: prev.parish || parish,
          }));
        }

        if (myListingRes.status === "fulfilled") {
          const rows = (myListingRes.value.items ?? [])
            .map((item) => normalizeListing(item))
            .filter((item): item is MarketListing => item != null);
          setMyListings(rows);
        } else {
          setMyListings([]);
        }

        if (listingRes.status === "fulfilled") {
          const rows = (listingRes.value.items ?? [])
            .map((item) => normalizeListing(item))
            .filter((item): item is MarketListing => item != null);
          setMarketListings(rows);
        } else {
          setMarketListings([]);
        }

        if (serviceRes.status === "fulfilled") {
          const rows = (serviceRes.value.items ?? [])
            .map((item) => normalizeService(item))
            .filter((item): item is MarketService => item != null);
          setServiceFeed(rows);
        } else {
          setServiceFeed([]);
        }

        if (intelRes.status === "fulfilled") {
          const raw = (intelRes.value.predictions ?? []) as unknown[];
          const rows = raw.map((item) => normalizePrediction(item)).filter((item): item is MarketPrediction => item != null);
          setPredictions(rows);
        } else {
          setPredictions([]);
        }
      })
      .catch(() => setError("Unable to load market hub data."))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!user?.phone) return;
    loadHubData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.phone]);

  const onDraftChange = <K extends keyof ListingFormState>(field: K, value: ListingFormState[K]) => {
    setListingDraft((prev) => ({ ...prev, [field]: value }));
  };

  const removeMedia = (url: string) => {
    setListingMediaUrls((prev) => prev.filter((item) => item !== url));
  };

  const onUploadListingMedia = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!user?.phone || files.length === 0) return;
    setUploadingMedia(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api.marketUploadMedia({ files });
      const uploaded = (result.items ?? [])
        .map((item) => toStringValue(asRecord(item).url))
        .filter(Boolean);
      setListingMediaUrls((prev) => uniqueStrings([...prev, ...uploaded]));
      if (uploaded.length > 0) {
        setMessage(`${uploaded.length} media file${uploaded.length === 1 ? "" : "s"} uploaded.`);
      }
    } catch {
      setError("Unable to upload media. Use image files only.");
    } finally {
      setUploadingMedia(false);
    }
  };

  const handleCreateListing = async (event: FormEvent) => {
    event.preventDefault();
    if (!user?.phone) return;

    const crop = listingDraft.crop.trim();
    const district = listingDraft.district.trim() || profileDistrict.trim();
    const parish = listingDraft.parish.trim() || profileParish.trim();

    if (!crop) {
      setError("Crop is required to publish a listing.");
      return;
    }
    if (!district) {
      setError("District is required so buyers can discover your listing.");
      return;
    }

    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      await api.marketCreateListing({
        phone: user.phone,
        role: "seller",
        crop,
        quantity: toOptionalNumberInput(listingDraft.quantity),
        unit: listingDraft.unit.trim() || undefined,
        price: toOptionalNumberInput(listingDraft.price),
        currency: listingDraft.currency || "UGX",
        grade: listingDraft.grade.trim() || undefined,
        description: listingDraft.description.trim() || undefined,
        contact_name: listingDraft.contactName.trim() || undefined,
        contact_phone: listingDraft.contactPhone.trim() || undefined,
        contact_whatsapp: listingDraft.contactWhatsapp.trim() || undefined,
        media_urls: listingMediaUrls,
        status: "open",
        location: {
          district,
          parish: parish || undefined,
        },
      });
      setMessage("Listing published to Market Hub.");
      setListingDraft((prev) => ({
        ...prev,
        quantity: "",
        price: "",
        grade: "",
        description: "",
      }));
      setListingMediaUrls([]);
      loadHubData();
    } catch {
      setError("Unable to publish listing right now.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <section className="farmer-page">Loading market hub...</section>;

  return (
    <section className="farmer-page">
      <div className="farmer-page-header farmer-command-header">
        <div className="section-title-with-icon">
          <span className="section-icon">
            <Icon name="market" size={18} />
          </span>
          <div>
            <div className="label">Market hub</div>
            <h1>Publish produce, track price signals, and monitor buyer-facing readiness</h1>
            <p className="muted">This workspace now helps farmers publish stronger listings, review demand signals, and prepare for better marketplace visibility.</p>
          </div>
        </div>
        <div className="farmer-command-actions">
          <button className="btn ghost small" type="button" onClick={loadHubData}>
            Refresh hub
          </button>
          <Link className="btn small" to="/marketplace">
            Browse public market
          </Link>
        </div>
      </div>

      {(message || error) && <p className={`status ${error ? "error" : ""}`}>{error ?? message}</p>}

      <section className="farmer-card farmer-command-hero">
        <div className="farmer-command-hero-copy">
          <div className="label">Market posture</div>
          <h3>{openMyListings > 0 ? `${openMyListings} listing(s) are currently live from your farm` : "You have not published a live produce listing yet"}</h3>
          <p className="muted">
            {leadPrediction
              ? `${leadPrediction.crop} in ${leadPrediction.district || "your area"} is trending ${leadPrediction.direction}.`
              : "Price predictions are still limited, so strong listing quality matters even more."}
          </p>
          <div className="farmer-chip-row">
            <span className="chip">Profile district: {profileDistrict || "Not set"}</span>
            <span className="chip">Profile crops: {profileCrops.length}</span>
            <span className="chip">Evidence-ready listings: {mediaReadyListings}</span>
          </div>
        </div>
        <div className="farmer-command-hero-side">
          <article className="farmer-command-mini-card">
            <span className="label">My listings</span>
            <strong>{myListings.length}</strong>
            <span className="muted">Published records</span>
          </article>
          <article className="farmer-command-mini-card">
            <span className="label">Open market</span>
            <strong>{discoverListings.length}</strong>
            <span className="muted">Matching external listings</span>
          </article>
        </div>
      </section>

      <div className="farmer-kpi-grid">
        <div className="farmer-kpi-card">
          <div className="farmer-kpi-head">
            <span className="kpi-icon">
              <Icon name="listings" size={16} />
            </span>
            <div className="farmer-kpi-label">Open listings</div>
          </div>
          <div className="farmer-kpi-value">{openMyListings}</div>
          <div className="farmer-kpi-meta">Currently visible to buyers</div>
        </div>
        <div className="farmer-kpi-card">
          <div className="farmer-kpi-head">
            <span className="kpi-icon">
              <Icon name="upload" size={16} />
            </span>
            <div className="farmer-kpi-label">Publish readiness</div>
          </div>
          <div className="farmer-kpi-value">{publishReadyCount}/5</div>
          <div className="farmer-kpi-meta">Current draft quality checks</div>
        </div>
        <div className="farmer-kpi-card">
          <div className="farmer-kpi-head">
            <span className="kpi-icon">
              <Icon name="prices" size={16} />
            </span>
            <div className="farmer-kpi-label">Price signals</div>
          </div>
          <div className="farmer-kpi-value">{predictions.length}</div>
          <div className="farmer-kpi-meta">Current market intelligence rows</div>
        </div>
        <div className="farmer-kpi-card">
          <div className="farmer-kpi-head">
            <span className="kpi-icon">
              <Icon name="services" size={16} />
            </span>
            <div className="farmer-kpi-label">Provider feed</div>
          </div>
          <div className="farmer-kpi-value">{serviceFeed.length}</div>
          <div className="farmer-kpi-meta">Visible service records</div>
        </div>
      </div>

      <section className="farmer-card">
        <div className="farmer-card-header">
          <div className="section-title-with-icon">
            <span className="section-icon">
              <Icon name="overview" size={18} />
            </span>
            <div>
              <div className="label">Operations view</div>
              <h3>Market rollout and listing quality</h3>
            </div>
          </div>
        </div>
        <div className="farmer-dashboard-grid market-publish-grid">
          <div className="farmer-side-summary">
            {publishChecklist.map((item) => (
              <div key={item.label} className="farmer-side-summary-item">
                <span>{item.label}</span>
                <strong>{item.ready ? "Ready" : "Pending"}</strong>
              </div>
            ))}
          </div>
          <div className="market-phase-note">
            <strong>Rollout path</strong>
            <p>Farmers listing produce is live. Provider catalog depth is growing next, followed by stronger buyer and offer workflows.</p>
            <p>{leadPrediction ? `Lead signal: ${leadPrediction.crop} is trending ${leadPrediction.direction} with ${Math.round((leadPrediction.confidence ?? 0) * 100)}% confidence.` : "No lead price signal is available yet."}</p>
          </div>
        </div>
      </section>

      <section className="farmer-card">
        <div className="farmer-card-header">
          <div className="section-title-with-icon">
            <span className="section-icon">
              <Icon name="plus" size={18} />
            </span>
            <div>
              <div className="label">Farmer listing</div>
              <h3>Publish a stronger produce listing</h3>
            </div>
          </div>
        </div>
        <div className="farmer-chip-row">
          {publishChecklist.map((item) => (
            <span key={item.label} className="chip">
              {item.label}: {item.ready ? "Ready" : "Pending"}
            </span>
          ))}
        </div>
        <form className="farmer-form-grid" onSubmit={handleCreateListing}>
          <label className="field">
            Crop
            <input
              list="market-crop-options"
              value={listingDraft.crop}
              onChange={(event) => onDraftChange("crop", event.target.value)}
              placeholder="Maize"
            />
            <datalist id="market-crop-options">
              {cropOptions.map((crop) => (
                <option key={crop} value={crop} />
              ))}
            </datalist>
          </label>
          <label className="field">
            Quantity
            <input
              type="number"
              value={listingDraft.quantity}
              onChange={(event) => onDraftChange("quantity", event.target.value)}
              placeholder="300"
            />
          </label>
          <label className="field">
            Unit
            <select value={listingDraft.unit} onChange={(event) => onDraftChange("unit", event.target.value)}>
              {UNIT_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Price
            <input
              type="number"
              value={listingDraft.price}
              onChange={(event) => onDraftChange("price", event.target.value)}
              placeholder="1200"
            />
          </label>
          <label className="field">
            Currency
            <select value={listingDraft.currency} onChange={(event) => onDraftChange("currency", event.target.value)}>
              {CURRENCY_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Grade
            <select value={listingDraft.grade} onChange={(event) => onDraftChange("grade", event.target.value)}>
              <option value="">Select grade</option>
              {GRADE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="field farmer-form-span">
            Listing description
            <textarea
              rows={2}
              value={listingDraft.description}
              onChange={(event) => onDraftChange("description", event.target.value)}
              placeholder="Describe quality, harvest date, packaging, and delivery options."
            />
          </label>
          <label className="field">
            Contact name
            <input
              value={listingDraft.contactName}
              onChange={(event) => onDraftChange("contactName", event.target.value)}
              placeholder="Okello Moses"
            />
          </label>
          <label className="field">
            Contact phone
            <input
              value={listingDraft.contactPhone}
              onChange={(event) => onDraftChange("contactPhone", event.target.value)}
              placeholder="+256700000000"
            />
          </label>
          <label className="field">
            WhatsApp number
            <input
              value={listingDraft.contactWhatsapp}
              onChange={(event) => onDraftChange("contactWhatsapp", event.target.value)}
              placeholder="+256700000000"
            />
          </label>
          <label className="field">
            District
            <input
              value={listingDraft.district}
              onChange={(event) => onDraftChange("district", event.target.value)}
              placeholder="Lira"
            />
          </label>
          <label className="field">
            Parish
            <input
              value={listingDraft.parish}
              onChange={(event) => onDraftChange("parish", event.target.value)}
              placeholder="Aromo"
            />
          </label>
          <label className="field farmer-form-span">
            Upload listing media evidence
            <input type="file" multiple accept="image/*" onChange={onUploadListingMedia} disabled={uploadingMedia} />
            <span className="field-note">Upload photos from web/mobile. Buyers will see this evidence in marketplace feeds.</span>
          </label>
          {listingMediaUrls.length > 0 ? (
            <div className="market-media-manager farmer-form-span">
              <div className="field-note">Uploaded media ({listingMediaUrls.length})</div>
              <div className="market-media-grid">
                {listingMediaUrls.map((url, index) => (
                  <div key={`${url}-${index}`} className="market-media-item">
                    <a href={url} target="_blank" rel="noreferrer" className="market-media-thumb">
                      <img src={url} alt={`Listing upload ${index + 1}`} loading="lazy" />
                    </a>
                    <button className="btn ghost tiny market-media-remove" type="button" onClick={() => removeMedia(url)}>
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          <div className="market-form-actions">
            <button className="btn" type="submit" disabled={saving || uploadingMedia}>
              {saving ? "Publishing..." : uploadingMedia ? "Uploading media..." : "Publish listing"}
            </button>
            <span className="field-note">
              Publish with price, quantity, location, and media so buyers trust the listing faster.
            </span>
          </div>
        </form>
      </section>

      <section className="farmer-card">
        <div className="farmer-card-header">
          <div className="section-title-with-icon">
            <span className="section-icon">
              <Icon name="prices" size={18} />
            </span>
            <div>
              <div className="label">Price pulse</div>
              <h3>Current prediction signals</h3>
            </div>
          </div>
        </div>
        {predictions.length === 0 ? (
          <p className="muted">No strong prediction signals yet.</p>
        ) : (
          <div className="market-pulse-grid">
            {predictions.slice(0, 6).map((item, index) => (
              <article key={`${item.crop}-${item.district}-${index}`} className="market-pulse-card">
                <div className="market-pulse-top">
                  <strong>{item.crop}</strong>
                  <span className={`pill ${item.direction === "down" ? "pill-muted" : ""}`}>{item.direction}</span>
                </div>
                <div className="market-pulse-value">
                  {item.predictedPrice != null ? formatMoney(item.predictedPrice, item.currency || "UGX") : "--"}
                </div>
                <div className="farmer-inline-meta">
                  {[item.district || "District n/a", item.confidence != null ? `${Math.round(item.confidence * 100)}% confidence` : "confidence n/a"].join(
                    " | "
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="farmer-card">
        <div className="farmer-card-header">
          <div className="section-title-with-icon">
            <span className="section-icon">
              <Icon name="farm" size={18} />
            </span>
            <div>
              <div className="label">My listings</div>
              <h3>Your current produce listings</h3>
            </div>
          </div>
        </div>
        {myListings.length === 0 ? (
          <p className="muted">You have not published any listing yet.</p>
        ) : (
          <div className="market-list-grid">
            {myListings.map((item) => (
              <article key={item.id} className="market-list-item">
                <div className="market-list-top">
                  <strong>{item.crop}</strong>
                  <span className="pill">{item.status || "open"}</span>
                </div>
                <div className="market-list-meta">
                  {item.quantity != null ? `${item.quantity} ${item.unit || "units"}` : "Quantity --"} |{" "}
                  {item.price != null ? formatMoney(item.price, item.currency || "UGX") : "Price --"}
                </div>
                <div className="market-list-meta">{item.description || "No listing description provided."}</div>
                <div className="market-list-meta">{[item.location.parish, item.location.district].filter(Boolean).join(", ") || "Location --"}</div>
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
                <div className="farmer-inline-meta">Published {formatDate(item.createdAt)}</div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="farmer-card">
        <div className="farmer-card-header">
          <div className="section-title-with-icon">
            <span className="section-icon">
              <Icon name="listings" size={18} />
            </span>
            <div>
              <div className="label">Discover</div>
              <h3>Open produce listings from market</h3>
            </div>
          </div>
        </div>
        <div className="market-filter-grid">
          <label className="field">
            Filter by crop
            <input value={listingFilterCrop} onChange={(event) => setListingFilterCrop(event.target.value)} placeholder="Maize" />
          </label>
          <label className="field">
            Filter by district
            <input value={listingFilterDistrict} onChange={(event) => setListingFilterDistrict(event.target.value)} placeholder="Lira" />
          </label>
        </div>
        {discoverListings.length === 0 ? (
          <p className="muted">No matching listings found.</p>
        ) : (
          <div className="market-list-grid">
            {discoverListings.slice(0, 20).map((item) => (
              <article key={item.id} className="market-list-item">
                <div className="market-list-top">
                  <strong>{item.crop}</strong>
                  <span className="pill">{item.status || "open"}</span>
                </div>
                <div className="market-list-meta">
                  {item.quantity != null ? `${item.quantity} ${item.unit || "units"}` : "Quantity --"} |{" "}
                  {item.price != null ? formatMoney(item.price, item.currency || "UGX") : "Price --"}
                </div>
                <div className="market-list-meta">{item.description || "No listing description provided."}</div>
                <div className="market-list-meta">{[item.location.parish, item.location.district].filter(Boolean).join(", ") || "Location --"}</div>
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
                <div className="farmer-inline-meta">Published {formatDate(item.createdAt)}</div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="farmer-card">
        <div className="farmer-card-header">
          <div className="section-title-with-icon">
            <span className="section-icon">
              <Icon name="services" size={18} />
            </span>
            <div>
              <div className="label">Service providers</div>
              <h3>Directory and next onboarding phase</h3>
            </div>
          </div>
        </div>
        <p className="muted">
          Next onboarding wave includes mechanics, transporters, input suppliers, and equipment providers listing their services and catalogs.
        </p>
        {serviceFeed.length === 0 ? (
          <p className="muted">No service providers listed yet.</p>
        ) : (
          <div className="market-list-grid">
            {serviceFeed.slice(0, 12).map((item) => (
              <article key={item.id} className="market-list-item">
                <div className="market-list-top">
                  <strong>{item.serviceType}</strong>
                  <span className="pill">{item.status || "open"}</span>
                </div>
                <div className="market-list-meta">{item.description || "Service details will be expanded as provider onboarding launches."}</div>
                <div className="market-list-meta">
                  {item.price != null ? formatMoney(item.price, item.currency || "UGX") : "Price by quote"} |{" "}
                  {item.coverageRadiusKm != null ? `${item.coverageRadiusKm} km radius` : "Coverage n/a"}
                </div>
                {item.mediaUrls.length > 0 ? (
                  <div className="market-media-grid">
                    {item.mediaUrls.slice(0, 4).map((url, index) => (
                      <a key={`${item.id}-${index}`} href={url} target="_blank" rel="noreferrer" className="market-media-thumb">
                        <img src={url} alt={`${item.serviceType} evidence ${index + 1}`} loading="lazy" />
                      </a>
                    ))}
                  </div>
                ) : (
                  <div className="farmer-inline-meta">No media evidence attached.</div>
                )}
                <div className="farmer-inline-meta">{[item.location.parish, item.location.district].filter(Boolean).join(", ") || "Location --"}</div>
              </article>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}
