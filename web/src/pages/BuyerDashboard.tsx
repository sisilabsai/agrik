import { useEffect, useMemo, useState } from "react";
import { NavLink } from "react-router-dom";
import { Icon } from "../components/Visuals";
import { api } from "../lib/api";
import { useAuth } from "../state/auth";

type MarketListing = {
  id: number;
  crop: string;
  status: string;
  district: string;
};

type MarketOffer = {
  id: number;
  listingId: number;
  status: string;
  createdAt: string;
};

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
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeListing(raw: unknown): MarketListing | null {
  const row = asRecord(raw);
  const id = toNumberValue(row.id);
  if (id == null) return null;
  const location = asRecord(row.location);
  return {
    id,
    crop: toStringValue(row.crop),
    status: toStringValue(row.status) || "open",
    district: toStringValue(location.district),
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
    status: toStringValue(row.status) || "open",
    createdAt: toStringValue(row.created_at),
  };
}

export default function BuyerDashboard() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sellerListings, setSellerListings] = useState<MarketListing[]>([]);
  const [myDemandListings, setMyDemandListings] = useState<MarketListing[]>([]);
  const [myOffers, setMyOffers] = useState<MarketOffer[]>([]);

  useEffect(() => {
    if (!user?.phone) return;
    setLoading(true);
    setError(null);
    Promise.allSettled([
      api.marketListings("?status=open&role=seller&limit=80"),
      api.marketListings(`?phone=${encodeURIComponent(user.phone)}&role=buyer&limit=40`),
      api.marketOffers(`?phone=${encodeURIComponent(user.phone)}&limit=80`),
    ])
      .then(([sellerRes, demandRes, offerRes]) => {
        if (sellerRes.status === "fulfilled") {
          setSellerListings((sellerRes.value.items ?? []).map((item) => normalizeListing(item)).filter((item): item is MarketListing => item != null));
        } else {
          setSellerListings([]);
        }
        if (demandRes.status === "fulfilled") {
          setMyDemandListings((demandRes.value.items ?? []).map((item) => normalizeListing(item)).filter((item): item is MarketListing => item != null));
        } else {
          setMyDemandListings([]);
        }
        if (offerRes.status === "fulfilled") {
          setMyOffers((offerRes.value.items ?? []).map((item) => normalizeOffer(item)).filter((item): item is MarketOffer => item != null));
        } else {
          setMyOffers([]);
        }
      })
      .catch(() => setError("Unable to load buyer dashboard."))
      .finally(() => setLoading(false));
  }, [user?.phone]);

  const activeOffers = useMemo(() => myOffers.filter((item) => item.status.toLowerCase() === "open").length, [myOffers]);
  const uniqueDistricts = useMemo(() => new Set(sellerListings.map((item) => item.district).filter(Boolean)).size, [sellerListings]);

  if (loading) return <section className="farmer-page">Loading buyer dashboard...</section>;

  return (
    <section className="farmer-page">
      <div className="farmer-page-header">
        <div className="section-title-with-icon">
          <span className="section-icon">
            <Icon name="market" size={18} />
          </span>
          <div>
            <div className="label">Buyer dashboard</div>
            <h1>Buyer and offtaker command center</h1>
            <p className="muted">Track supply, publish demand, and manage offers with media-backed listing evidence.</p>
          </div>
        </div>
      </div>

      {error && <p className="status error">{error}</p>}

      <div className="farmer-kpi-grid">
        <article className="farmer-kpi-card">
          <div className="farmer-kpi-label">Open seller listings</div>
          <div className="farmer-kpi-value">{sellerListings.length}</div>
          <div className="farmer-kpi-meta">Available produce listings now</div>
        </article>
        <article className="farmer-kpi-card">
          <div className="farmer-kpi-label">Supply districts</div>
          <div className="farmer-kpi-value">{uniqueDistricts}</div>
          <div className="farmer-kpi-meta">Geographic spread in current feed</div>
        </article>
        <article className="farmer-kpi-card">
          <div className="farmer-kpi-label">My demand listings</div>
          <div className="farmer-kpi-value">{myDemandListings.length}</div>
          <div className="farmer-kpi-meta">Requests posted by your account</div>
        </article>
        <article className="farmer-kpi-card">
          <div className="farmer-kpi-label">Open offers</div>
          <div className="farmer-kpi-value">{activeOffers}</div>
          <div className="farmer-kpi-meta">Offers awaiting seller response</div>
        </article>
      </div>

      <section className="farmer-card">
        <div className="farmer-card-header">
          <div>
            <div className="label">Next step</div>
            <h3>Use marketplace workspace</h3>
          </div>
        </div>
        <div className="farmer-action-grid">
          <NavLink to="/buyer/market" className="farmer-action-card">
            <span className="action-icon">
              <Icon name="market" size={18} />
            </span>
            <h4>Find produce supply</h4>
            <p>Browse open seller listings with image evidence and district filters.</p>
          </NavLink>
          <NavLink to="/buyer/market" className="farmer-action-card">
            <span className="action-icon">
              <Icon name="plus" size={18} />
            </span>
            <h4>Publish demand listing</h4>
            <p>Post what you need to buy and attach requirements as media links.</p>
          </NavLink>
          <NavLink to="/buyer/market" className="farmer-action-card">
            <span className="action-icon">
              <Icon name="finance" size={18} />
            </span>
            <h4>Manage offers</h4>
            <p>Submit and track offers against farmer listings.</p>
          </NavLink>
        </div>
      </section>
    </section>
  );
}
