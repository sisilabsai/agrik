import { useEffect, useMemo, useState } from "react";
import { NavLink } from "react-router-dom";
import { api } from "../lib/api";
import { Icon } from "../components/Visuals";

type PlatformService = {
  id: number;
  service_type: string;
  description?: string | null;
  price?: number | null;
  currency?: string | null;
  status: string;
};

type Subscription = {
  plan: string;
  status: string;
  ends_at?: string | null;
};

const formatStatus = (value: string) => {
  if (value === "open") return "active";
  if (value === "closed") return "retired";
  return value;
};

function formatMoney(value?: number | null, currency?: string | null) {
  if (value == null) return "Price on request";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "UGX",
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${currency || "UGX"} ${value}`;
  }
}

export default function FarmerServices() {
  const [services, setServices] = useState<PlatformService[]>([]);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingPlan, setSavingPlan] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const loadAll = () => {
    setLoading(true);
    setError(null);
    Promise.allSettled([api.platformServices("?status=open&limit=100"), api.subscription()])
      .then(([servicesRes, subscriptionRes]) => {
        if (servicesRes.status === "fulfilled") {
          setServices(servicesRes.value as PlatformService[]);
        } else {
          setServices([]);
          setError("Unable to load platform services.");
        }

        if (subscriptionRes.status === "fulfilled") {
          setSubscription(subscriptionRes.value as Subscription);
        } else {
          setSubscription(null);
        }
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadAll();
  }, []);

  const subscribeToService = async (serviceType: string) => {
    setSavingPlan(serviceType);
    setMessage(null);
    setError(null);
    try {
      await api.startSubscription({
        plan: serviceType,
        status: "trial",
        provider: "platform",
      });
      setMessage(`Subscribed to ${serviceType}.`);
      loadAll();
    } catch {
      setError("Unable to start subscription for this service.");
    } finally {
      setSavingPlan(null);
    }
  };

  const filteredServices = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return services;
    return services.filter((service) => {
      return service.service_type.toLowerCase().includes(query) || (service.description || "").toLowerCase().includes(query);
    });
  }, [search, services]);

  const pricedServices = services.filter((service) => service.price != null).length;
  const recommendation = filteredServices.find((service) => service.service_type !== subscription?.plan) ?? filteredServices[0] ?? null;

  if (loading) return <section className="farmer-page">Loading service catalog...</section>;

  return (
    <section className="farmer-page">
      <div className="farmer-page-header farmer-command-header">
        <div>
          <div className="label">Services</div>
          <h1>Choose the operating support your farm needs</h1>
          <p className="muted">Compare platform services, activate trials, and keep subscriptions aligned to the season.</p>
        </div>
        <div className="farmer-command-actions">
          <button className="btn ghost small" type="button" onClick={loadAll}>
            Refresh
          </button>
          <NavLink to="/dashboard/subscriptions" className="btn small">
            <Icon name="subscriptions" size={14} />
            Open plans
          </NavLink>
        </div>
      </div>

      {(message || error) ? <p className={`status ${error ? "error" : ""}`}>{error ?? message}</p> : null}

      <section className="farmer-card farmer-command-hero">
        <div className="farmer-command-hero-copy">
          <div className="label">Current service posture</div>
          <h3>{subscription?.plan ? `${subscription.plan} is active for this account` : "No service plan is active yet"}</h3>
          <p className="muted">
            {subscription?.ends_at
              ? `Current plan runs until ${new Date(subscription.ends_at).toLocaleDateString()}.`
              : "Start with a trial to activate advisory, weather, or market support quickly."}
          </p>
        </div>
        <div className="farmer-command-hero-side">
          <article className="farmer-command-mini-card">
            <span className="label">Catalog</span>
            <strong>{services.length}</strong>
            <span className="muted">Available services</span>
          </article>
          <article className="farmer-command-mini-card">
            <span className="label">Priced</span>
            <strong>{pricedServices}</strong>
            <span className="muted">Services with visible pricing</span>
          </article>
        </div>
      </section>

      <div className="farmer-kpi-grid">
        <div className="farmer-kpi-card">
          <div className="farmer-kpi-head">
            <span className="kpi-icon">
              <Icon name="subscriptions" size={16} />
            </span>
            <div className="farmer-kpi-label">Current plan</div>
          </div>
          <div className="farmer-kpi-value">{subscription?.plan ?? "None"}</div>
          <div className="farmer-kpi-meta">{subscription?.status ?? "not subscribed"}</div>
        </div>
        <div className="farmer-kpi-card">
          <div className="farmer-kpi-head">
            <span className="kpi-icon">
              <Icon name="services" size={16} />
            </span>
            <div className="farmer-kpi-label">Catalog size</div>
          </div>
          <div className="farmer-kpi-value">{services.length}</div>
          <div className="farmer-kpi-meta">Support tools ready to activate</div>
        </div>
        <div className="farmer-kpi-card">
          <div className="farmer-kpi-head">
            <span className="kpi-icon">
              <Icon name="finance" size={16} />
            </span>
            <div className="farmer-kpi-label">Priced offers</div>
          </div>
          <div className="farmer-kpi-value">{pricedServices}</div>
          <div className="farmer-kpi-meta">Services with listed pricing</div>
        </div>
      </div>

      <div className="farmer-dashboard-grid">
        <section className="farmer-card">
          <div className="farmer-card-header">
            <div>
              <div className="label">Recommendation</div>
              <h3>Suggested next service</h3>
            </div>
          </div>
          {recommendation ? (
            <div className="farmer-recommendation-card static">
              <div>
                <strong>{recommendation.service_type}</strong>
                <p>{recommendation.description || "Platform support service available to extend your operating coverage."}</p>
              </div>
              <span>{formatMoney(recommendation.price, recommendation.currency)}</span>
            </div>
          ) : (
            <p className="muted">No recommendation available right now.</p>
          )}
        </section>

        <section className="farmer-card">
          <div className="farmer-card-header">
            <div>
              <div className="label">Search catalog</div>
              <h3>Find the right support</h3>
            </div>
          </div>
          <label className="field">
            Search services
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search advisory, weather, market..." />
          </label>
          <div className="farmer-side-summary">
            <div className="farmer-side-summary-item">
              <span>Matches</span>
              <strong>{filteredServices.length}</strong>
            </div>
            <div className="farmer-side-summary-item">
              <span>Current subscription</span>
              <strong>{subscription?.plan ?? "None"}</strong>
            </div>
          </div>
        </section>
      </div>

      <div className="farmer-service-grid">
        {filteredServices.length === 0 ? (
          <section className="farmer-card">
            <p>No platform services match your search right now.</p>
          </section>
        ) : (
          filteredServices.map((service) => {
            const isCurrent = subscription?.plan === service.service_type;
            return (
              <section key={service.id} className={`farmer-card farmer-service-card ${isCurrent ? "is-current" : ""}`}>
                <div className="farmer-card-header">
                  <div className="section-title-with-icon">
                    <span className="section-icon">
                      <Icon name="services" size={18} />
                    </span>
                    <div>
                      <h3>{service.service_type}</h3>
                      <div className="farmer-inline-meta">{formatMoney(service.price, service.currency)}</div>
                    </div>
                  </div>
                  <span className="pill">{formatStatus(service.status)}</span>
                </div>
                <p className="muted">{service.description || "Subscription service provided by AGRIK platform."}</p>
                <div className="farmer-chip-row">
                  <span className="chip">{isCurrent ? "Current plan" : "Available"}</span>
                  <span className="chip">{service.currency ?? "UGX"}</span>
                </div>
                <button className="btn" type="button" disabled={Boolean(savingPlan) || isCurrent} onClick={() => subscribeToService(service.service_type)}>
                  {isCurrent ? "Current plan" : savingPlan === service.service_type ? "Subscribing..." : "Start trial"}
                </button>
              </section>
            );
          })
        )}
      </div>
    </section>
  );
}
