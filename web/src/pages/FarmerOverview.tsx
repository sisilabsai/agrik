import { useEffect, useMemo, useState } from "react";
import { NavLink } from "react-router-dom";
import { api } from "../lib/api";
import { Icon } from "../components/Visuals";

type ProfileDetails = {
  user: { phone: string; verification_status: string };
  settings: { district?: string | null; parish?: string | null; preferred_language?: string | null };
  farm: { crops: string[]; updated_at?: string | null };
};

type Subscription = {
  plan: string;
  status: string;
  ends_at?: string | null;
};

type PlatformService = {
  id: number;
  service_type: string;
  description?: string | null;
  status: string;
};

type WeatherSummary = {
  location_name?: string | null;
  next_rain_date?: string | null;
};

type Recommendation = {
  id: string;
  title: string;
  detail: string;
  to: string;
  action: string;
};

export default function FarmerOverview() {
  const [profile, setProfile] = useState<ProfileDetails | null>(null);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [services, setServices] = useState<PlatformService[]>([]);
  const [recentMessages, setRecentMessages] = useState(0);
  const [weather, setWeather] = useState<WeatherSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadOverview = () => {
    setLoading(true);
    setError(null);
    Promise.allSettled([api.profileDetails(), api.subscription(), api.platformServices("?status=open&limit=6"), api.chatHistory(8)])
      .then(([profileRes, subscriptionRes, servicesRes, chatRes]) => {
        if (profileRes.status === "fulfilled") {
          setProfile(profileRes.value as ProfileDetails);
        } else {
          setProfile(null);
          setError("Unable to load profile details.");
        }

        if (subscriptionRes.status === "fulfilled") {
          setSubscription(subscriptionRes.value as Subscription);
        } else {
          setSubscription(null);
        }

        if (servicesRes.status === "fulfilled") {
          setServices(servicesRes.value as PlatformService[]);
        } else {
          setServices([]);
        }

        if (chatRes.status === "fulfilled") {
          setRecentMessages((chatRes.value.items ?? []).length);
        } else {
          setRecentMessages(0);
        }
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadOverview();
  }, []);

  useEffect(() => {
    const hasLocation = profile?.settings?.district || profile?.settings?.parish;
    if (!hasLocation) {
      setWeather(null);
      return;
    }
    api.weatherSummary().then((res) => setWeather(res as WeatherSummary)).catch(() => setWeather(null));
  }, [profile?.settings?.district, profile?.settings?.parish]);

  const farmRegistered = (profile?.farm?.crops?.length ?? 0) > 0;
  const hasLocation = Boolean(profile?.settings?.district || profile?.settings?.parish);
  const hasSubscription = Boolean(subscription?.plan);
  const readinessScore = [farmRegistered, hasLocation, hasSubscription, recentMessages > 0].filter(Boolean).length;
  const locationLabel = [profile?.settings?.parish, profile?.settings?.district].filter(Boolean).join(", ") || "Not set";
  const featuredServices = services.slice(0, 3);

  const cards = useMemo(
    () => [
      { label: "Readiness", value: `${readinessScore}/4`, meta: "Farm, location, plan, and advisory activity", icon: "overview" as const },
      { label: "Farm profile", value: farmRegistered ? "Ready" : "Needs work", meta: `Crops tracked: ${profile?.farm.crops.length ?? 0}`, icon: "farm" as const },
      { label: "Current plan", value: subscription?.plan ?? "No plan", meta: subscription?.status ?? "not subscribed", icon: "subscriptions" as const },
      { label: "Brain activity", value: String(recentMessages), meta: "Recent advisory messages", icon: "brain" as const },
    ],
    [farmRegistered, profile?.farm.crops.length, readinessScore, recentMessages, subscription?.plan, subscription?.status]
  );

  const recommendations = useMemo<Recommendation[]>(() => {
    const items: Recommendation[] = [];
    if (!farmRegistered) {
      items.push({
        id: "farm",
        title: "Complete the farm profile",
        detail: "Add crops, field details, and planning data so pricing, alerts, and advisory guidance stay relevant.",
        to: "/dashboard/farm",
        action: "Open farm profile",
      });
    }
    if (!hasSubscription) {
      items.push({
        id: "services",
        title: "Activate a support service",
        detail: "Pick a plan so weather support, advisory flows, and market tools can work together.",
        to: "/dashboard/services",
        action: "Review services",
      });
    }
    if (!hasLocation) {
      items.push({
        id: "location",
        title: "Add district and parish",
        detail: "Your weather and market context gets stronger once your location is set correctly.",
        to: "/dashboard/farm",
        action: "Update location",
      });
    }
    if (recentMessages === 0) {
      items.push({
        id: "brain",
        title: "Start using GRIK Brain",
        detail: "Ask a crop, weather, or market question and create your first advisory thread.",
        to: "/dashboard/brain",
        action: "Open brain",
      });
    }
    if (items.length === 0) {
      items.push({
        id: "market",
        title: "Push into market activity",
        detail: "Your dashboard is ready. Publish a listing or review market opportunities next.",
        to: "/dashboard/market",
        action: "Open market hub",
      });
    }
    return items.slice(0, 4);
  }, [farmRegistered, hasLocation, hasSubscription, recentMessages]);

  if (loading) return <section className="farmer-page">Loading your portal...</section>;

  return (
    <section className="farmer-page">
      <div className="farmer-page-header farmer-command-header">
        <div>
          <div className="label">Farmer command center</div>
          <h1>Run your farm, market, and support tools from one workspace</h1>
          <p className="muted">Track readiness, move on next actions quickly, and keep weather, services, and advisory work connected.</p>
        </div>
        <div className="farmer-command-actions">
          <NavLink to="/dashboard/brain" className="btn small">
            <Icon name="brain" size={14} />
            Open brain
          </NavLink>
          <NavLink to="/dashboard/market" className="btn ghost small">
            <Icon name="market" size={14} />
            Open market
          </NavLink>
        </div>
      </div>

      {error ? <p className="status error">{error}</p> : null}

      <section className="farmer-card farmer-command-hero">
        <div className="farmer-command-hero-copy">
          <div className="label">Workspace status</div>
          <h3>{profile?.user.phone ?? "Farmer"} is {readinessScore >= 3 ? "in a strong operating state" : "still setting up the dashboard"}</h3>
          <p className="muted">
            {weather?.location_name || locationLabel !== "Not set"
              ? `Location context is ${weather?.location_name ?? locationLabel}.`
              : "Location context is still missing."}{" "}
            {subscription?.plan ? `Current plan: ${subscription.plan}.` : "No active plan yet."}
          </p>
          <div className="farmer-chip-row">
            <span className="chip">Verification: {profile?.user.verification_status ?? "unknown"}</span>
            <span className="chip">Language: {profile?.settings.preferred_language ?? "auto"}</span>
            <span className="chip">Crops: {profile?.farm.crops.length ?? 0}</span>
          </div>
        </div>
        <div className="farmer-command-hero-side">
          <article className="farmer-command-mini-card">
            <span className="label">Weather</span>
            <strong>{weather?.next_rain_date ? new Date(weather.next_rain_date).toLocaleDateString() : "Set profile location"}</strong>
            <span className="muted">Next significant rain window</span>
          </article>
          <article className="farmer-command-mini-card">
            <span className="label">Services</span>
            <strong>{services.length}</strong>
            <span className="muted">Support tools available now</span>
          </article>
        </div>
      </section>

      <div className="farmer-kpi-grid">
        {cards.map((item) => (
          <div key={item.label} className="farmer-kpi-card">
            <div className="farmer-kpi-head">
              <span className="kpi-icon">
                <Icon name={item.icon} size={16} />
              </span>
              <div className="farmer-kpi-label">{item.label}</div>
            </div>
            <div className="farmer-kpi-value">{item.value}</div>
            <div className="farmer-kpi-meta">{item.meta}</div>
          </div>
        ))}
      </div>

      <div className="farmer-dashboard-grid">
        <section className="farmer-card">
          <div className="farmer-card-header">
            <div>
              <div className="label">Next best moves</div>
              <h3>Recommended actions</h3>
            </div>
          </div>
          <div className="farmer-recommendation-list">
            {recommendations.map((item) => (
              <NavLink key={item.id} to={item.to} className="farmer-recommendation-card">
                <div>
                  <strong>{item.title}</strong>
                  <p>{item.detail}</p>
                </div>
                <span>{item.action}</span>
              </NavLink>
            ))}
          </div>
        </section>

        <section className="farmer-card">
          <div className="farmer-card-header">
            <div>
              <div className="label">Context snapshot</div>
              <h3>Local operating view</h3>
            </div>
          </div>
          <div className="farmer-side-summary">
            <div className="farmer-side-summary-item">
              <span>Location</span>
              <strong>{locationLabel}</strong>
            </div>
            <div className="farmer-side-summary-item">
              <span>Weather signal</span>
              <strong>{weather?.next_rain_date ? new Date(weather.next_rain_date).toLocaleDateString() : "No rain signal"}</strong>
            </div>
            <div className="farmer-side-summary-item">
              <span>Current plan</span>
              <strong>{subscription?.plan ?? "Not active"}</strong>
            </div>
            <div className="farmer-side-summary-item">
              <span>Support catalog</span>
              <strong>{services.length} services</strong>
            </div>
          </div>
        </section>
      </div>

      <section className="farmer-card">
        <div className="farmer-card-header">
          <div>
            <div className="label">Quick actions</div>
            <h3>Move across the dashboard</h3>
          </div>
        </div>
        <div className="farmer-action-grid">
          <NavLink to="/dashboard/farm" className="farmer-action-card">
            <span className="action-icon">
              <Icon name="farm" size={18} />
            </span>
            <h4>Farm profile</h4>
            <p>Update production, risk, finance, and field operating details.</p>
          </NavLink>
          <NavLink to="/dashboard/market" className="farmer-action-card">
            <span className="action-icon">
              <Icon name="market" size={18} />
            </span>
            <h4>Market hub</h4>
            <p>Publish produce, review price signals, and scan buyer activity.</p>
          </NavLink>
          <NavLink to="/dashboard/services" className="farmer-action-card">
            <span className="action-icon">
              <Icon name="services" size={18} />
            </span>
            <h4>Services</h4>
            <p>Pick advisory, weather, and market support tools that fit your season.</p>
          </NavLink>
          <NavLink to="/dashboard/history" className="farmer-action-card">
            <span className="action-icon">
              <Icon name="history" size={18} />
            </span>
            <h4>History</h4>
            <p>See one timeline of advisory, alerts, subscriptions, and listings.</p>
          </NavLink>
        </div>
      </section>

      <section className="farmer-card">
        <div className="farmer-card-header">
          <div>
            <div className="label">Featured services</div>
            <h3>Good next additions</h3>
          </div>
        </div>
        {featuredServices.length === 0 ? (
          <p className="muted">No service recommendations are available right now.</p>
        ) : (
          <div className="farmer-service-preview-grid">
            {featuredServices.map((service) => (
              <div key={service.id} className="farmer-service-preview-card">
                <strong>{service.service_type}</strong>
                <p>{service.description || "Platform support service available from AGRIK."}</p>
                <span className="pill">{service.status}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}
