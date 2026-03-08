import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { Icon } from "../components/Visuals";

type Subscription = {
  id: number;
  plan: string;
  status: string;
  starts_at: string;
  ends_at?: string | null;
  provider?: string | null;
};

const planOptions = [
  {
    id: "basic",
    title: "Basic Advisory",
    summary: "SMS and voice guidance for day-to-day farming decisions.",
    bestFor: "Farmers getting started with routine decision support",
    includes: ["Advisory prompts", "Voice and SMS access", "Starter guidance"],
  },
  {
    id: "weather-plus",
    title: "Weather Plus",
    summary: "Localized weather farming alerts and climate planning support.",
    bestFor: "Farmers who need stronger timing and risk planning",
    includes: ["Localized weather view", "Climate signals", "Planning support"],
  },
  {
    id: "pro-intelligence",
    title: "Pro Intelligence",
    summary: "AI advisory, pest and disease alerts, and market intelligence bundle.",
    bestFor: "Farmers running a more active advisory and market workflow",
    includes: ["GRIK Brain tools", "Market support", "Pest and disease guidance"],
  },
];

export default function FarmerSubscriptions() {
  const [current, setCurrent] = useState<Subscription | null>(null);
  const [history, setHistory] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingPlan, setSavingPlan] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadAll = () => {
    setLoading(true);
    Promise.allSettled([api.subscription(), api.subscriptionHistory(50)])
      .then(([currentRes, historyRes]) => {
        if (currentRes.status === "fulfilled") {
          setCurrent(currentRes.value as Subscription);
        } else {
          setCurrent(null);
        }

        if (historyRes.status === "fulfilled") {
          setHistory(historyRes.value as Subscription[]);
        } else {
          setHistory([]);
        }
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadAll();
  }, []);

  const subscribe = async (plan: string) => {
    setSavingPlan(plan);
    setMessage(null);
    setError(null);
    try {
      await api.startSubscription({
        plan,
        status: "trial",
        provider: "platform",
      });
      setMessage(`Subscription started for ${plan}.`);
      loadAll();
    } catch {
      setError("Unable to start subscription.");
    } finally {
      setSavingPlan(null);
    }
  };

  const activeHistoryCount = history.filter((item) => item.status.toLowerCase() === "active" || item.status.toLowerCase() === "trial").length;
  const recommendedPlan = useMemo(() => {
    if (!current?.plan) return planOptions[0];
    return planOptions.find((plan) => plan.id !== current.plan) ?? planOptions[0];
  }, [current?.plan]);

  if (loading) return <section className="farmer-page">Loading subscriptions...</section>;

  return (
    <section className="farmer-page">
      <div className="farmer-page-header farmer-command-header">
        <div>
          <div className="label">Subscriptions</div>
          <h1>Plan management and subscription history</h1>
          <p className="muted">Compare plans, activate trials, and keep a clean view of what has been started before.</p>
        </div>
        <div className="farmer-command-actions">
          <button className="btn ghost small" type="button" onClick={loadAll}>
            Refresh
          </button>
        </div>
      </div>

      {(message || error) ? <p className={`status ${error ? "error" : ""}`}>{error ?? message}</p> : null}

      <section className="farmer-card farmer-command-hero">
        <div className="farmer-command-hero-copy">
          <div className="label">Current subscription</div>
          <h3>{current?.plan ?? "No active plan"}</h3>
          <p className="muted">
            {current?.ends_at
              ? `Current plan ends on ${new Date(current.ends_at).toLocaleDateString()}.`
              : "Activate a plan when you are ready to extend advisory, weather, or market support."}
          </p>
        </div>
        <div className="farmer-command-hero-side">
          <article className="farmer-command-mini-card">
            <span className="label">Status</span>
            <strong>{current?.status ?? "inactive"}</strong>
            <span className="muted">Current plan state</span>
          </article>
          <article className="farmer-command-mini-card">
            <span className="label">History</span>
            <strong>{history.length}</strong>
            <span className="muted">Recorded plan events</span>
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
          <div className="farmer-kpi-value">{current?.plan ?? "None"}</div>
          <div className="farmer-kpi-meta">{current?.status ?? "inactive"}</div>
        </div>
        <div className="farmer-kpi-card">
          <div className="farmer-kpi-head">
            <span className="kpi-icon">
              <Icon name="history" size={16} />
            </span>
            <div className="farmer-kpi-label">History depth</div>
          </div>
          <div className="farmer-kpi-value">{history.length}</div>
          <div className="farmer-kpi-meta">Past plan records</div>
        </div>
        <div className="farmer-kpi-card">
          <div className="farmer-kpi-head">
            <span className="kpi-icon">
              <Icon name="overview" size={16} />
            </span>
            <div className="farmer-kpi-label">Active history</div>
          </div>
          <div className="farmer-kpi-value">{activeHistoryCount}</div>
          <div className="farmer-kpi-meta">Active or trial records</div>
        </div>
      </div>

      <div className="farmer-dashboard-grid">
        <section className="farmer-card">
          <div className="farmer-card-header">
            <div>
              <div className="label">Suggested next plan</div>
              <h3>{recommendedPlan.title}</h3>
            </div>
          </div>
          <div className="farmer-recommendation-card static">
            <div>
              <strong>{recommendedPlan.bestFor}</strong>
              <p>{recommendedPlan.summary}</p>
            </div>
            <span>Recommended</span>
          </div>
        </section>

        <section className="farmer-card">
          <div className="farmer-card-header">
            <div>
              <div className="label">Plan status</div>
              <h3>Current coverage</h3>
            </div>
          </div>
          <div className="farmer-side-summary">
            <div className="farmer-side-summary-item">
              <span>Provider</span>
              <strong>{current?.provider ?? "platform"}</strong>
            </div>
            <div className="farmer-side-summary-item">
              <span>Ends at</span>
              <strong>{current?.ends_at ? new Date(current.ends_at).toLocaleDateString() : "Not scheduled"}</strong>
            </div>
          </div>
        </section>
      </div>

      <div className="farmer-service-grid">
        {planOptions.map((plan) => {
          const isCurrent = current?.plan === plan.id;
          return (
            <section key={plan.id} className={`farmer-card farmer-plan-card ${isCurrent ? "is-current" : ""}`}>
              <div className="farmer-card-header">
                <div className="section-title-with-icon">
                  <span className="section-icon">
                    <Icon name="subscriptions" size={18} />
                  </span>
                  <div>
                    <h3>{plan.title}</h3>
                    <div className="farmer-inline-meta">{plan.bestFor}</div>
                  </div>
                </div>
                <span className="pill">{isCurrent ? "current" : "available"}</span>
              </div>
              <p className="muted">{plan.summary}</p>
              <div className="farmer-chip-row">
                {plan.includes.map((item) => (
                  <span key={item} className="chip">
                    {item}
                  </span>
                ))}
              </div>
              <button className="btn" type="button" disabled={Boolean(savingPlan) || isCurrent} onClick={() => subscribe(plan.id)}>
                {isCurrent ? "Current plan" : savingPlan === plan.id ? "Subscribing..." : "Start plan"}
              </button>
            </section>
          );
        })}
      </div>

      <section className="farmer-card">
        <div className="farmer-card-header">
          <div>
            <div className="label">History</div>
            <h3>Past subscriptions</h3>
          </div>
        </div>
        {history.length === 0 ? (
          <p className="muted">No subscription history yet.</p>
        ) : (
          <div className="farmer-timeline-list">
            {history.map((item) => (
              <article key={item.id} className="farmer-timeline-item">
                <div className="farmer-timeline-dot" aria-hidden="true" />
                <div className="farmer-timeline-content">
                  <div className="farmer-card-header">
                    <div>
                      <strong>{item.plan}</strong>
                      <div className="farmer-inline-meta">
                        Started {new Date(item.starts_at).toLocaleDateString()}
                        {item.ends_at ? ` | Ended ${new Date(item.ends_at).toLocaleDateString()}` : ""}
                      </div>
                    </div>
                    <span className="pill">{item.status}</span>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}
