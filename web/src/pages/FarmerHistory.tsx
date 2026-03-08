import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "../state/auth";
import { Icon } from "../components/Visuals";

type ChatMessage = {
  id: number;
  role: "user" | "assistant";
  message: string;
  created_at: string;
};

type Subscription = {
  id: number;
  plan: string;
  status: string;
  starts_at: string;
};

type Alert = {
  id: number;
  alert_type: string;
  active: boolean;
  created_at: string;
};

type Listing = {
  id: number;
  crop: string;
  status: string;
  created_at?: string;
};

type TimelineKind = "all" | "advice" | "subscription" | "alert" | "listing";

type TimelineItem = {
  id: string;
  kind: Exclude<TimelineKind, "all">;
  title: string;
  detail: string;
  date: string;
  status: string;
};

export default function FarmerHistory() {
  const { user } = useAuth();
  const [chats, setChats] = useState<ChatMessage[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState<TimelineKind>("all");
  const [search, setSearch] = useState("");

  const loadHistory = () => {
    if (!user) return;
    const params = `?phone=${encodeURIComponent(user.phone)}&limit=20`;
    setLoading(true);
    setError(null);
    Promise.allSettled([api.chatHistory(50), api.subscriptionHistory(50), api.marketAlerts(params), api.marketListings(params)])
      .then(([chatRes, subRes, alertRes, listingRes]) => {
        if (chatRes.status === "fulfilled") {
          setChats((chatRes.value.items ?? []) as ChatMessage[]);
        } else {
          setChats([]);
          setError("Unable to load full history.");
        }
        if (subRes.status === "fulfilled") {
          setSubscriptions(subRes.value as Subscription[]);
        } else {
          setSubscriptions([]);
        }
        if (alertRes.status === "fulfilled") {
          setAlerts(((alertRes.value.items ?? []) as Alert[]).slice(0, 20));
        } else {
          setAlerts([]);
        }
        if (listingRes.status === "fulfilled") {
          setListings(((listingRes.value.items ?? []) as Listing[]).slice(0, 20));
        } else {
          setListings([]);
        }
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadHistory();
  }, [user]);

  const timeline = useMemo<TimelineItem[]>(() => {
    const items: TimelineItem[] = [
      ...chats.map((item) => ({
        id: `chat-${item.id}`,
        kind: "advice" as const,
        title: item.role === "assistant" ? "GRIK response" : "Your question",
        detail: item.message,
        date: item.created_at,
        status: item.role,
      })),
      ...subscriptions.map((item) => ({
        id: `subscription-${item.id}`,
        kind: "subscription" as const,
        title: item.plan,
        detail: `Subscription event started ${new Date(item.starts_at).toLocaleDateString()}`,
        date: item.starts_at,
        status: item.status,
      })),
      ...alerts.map((item) => ({
        id: `alert-${item.id}`,
        kind: "alert" as const,
        title: item.alert_type,
        detail: `Alert created ${new Date(item.created_at).toLocaleDateString()}`,
        date: item.created_at,
        status: item.active ? "active" : "paused",
      })),
      ...listings.map((item) => ({
        id: `listing-${item.id}`,
        kind: "listing" as const,
        title: item.crop,
        detail: `Listing record ${item.created_at ? new Date(item.created_at).toLocaleDateString() : "--"}`,
        date: item.created_at ?? "",
        status: item.status,
      })),
    ];
    return items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [alerts, chats, listings, subscriptions]);

  const filteredTimeline = useMemo(() => {
    const query = search.trim().toLowerCase();
    return timeline.filter((item) => {
      if (kindFilter !== "all" && item.kind !== kindFilter) return false;
      if (!query) return true;
      return item.title.toLowerCase().includes(query) || item.detail.toLowerCase().includes(query) || item.status.toLowerCase().includes(query);
    });
  }, [kindFilter, search, timeline]);

  if (loading) return <section className="farmer-page">Loading your history...</section>;

  return (
    <section className="farmer-page">
      <div className="farmer-page-header farmer-command-header">
        <div>
          <div className="label">History</div>
          <h1>One activity timeline for advisory, alerts, subscriptions, and market work</h1>
          <p className="muted">Search across activity, focus by type, and review your most recent farmer actions in one place.</p>
        </div>
        <div className="farmer-command-actions">
          <button className="btn ghost small" type="button" onClick={loadHistory}>
            Refresh
          </button>
        </div>
      </div>

      {error ? <p className="status error">{error}</p> : null}

      <div className="farmer-kpi-grid">
        <div className="farmer-kpi-card">
          <div className="farmer-kpi-head">
            <span className="kpi-icon">
              <Icon name="brain" size={16} />
            </span>
            <div className="farmer-kpi-label">Advisory</div>
          </div>
          <div className="farmer-kpi-value">{chats.length}</div>
          <div className="farmer-kpi-meta">Recorded messages</div>
        </div>
        <div className="farmer-kpi-card">
          <div className="farmer-kpi-head">
            <span className="kpi-icon">
              <Icon name="subscriptions" size={16} />
            </span>
            <div className="farmer-kpi-label">Subscriptions</div>
          </div>
          <div className="farmer-kpi-value">{subscriptions.length}</div>
          <div className="farmer-kpi-meta">Plan events</div>
        </div>
        <div className="farmer-kpi-card">
          <div className="farmer-kpi-head">
            <span className="kpi-icon">
              <Icon name="alerts" size={16} />
            </span>
            <div className="farmer-kpi-label">Alerts</div>
          </div>
          <div className="farmer-kpi-value">{alerts.length}</div>
          <div className="farmer-kpi-meta">Alert records</div>
        </div>
        <div className="farmer-kpi-card">
          <div className="farmer-kpi-head">
            <span className="kpi-icon">
              <Icon name="listings" size={16} />
            </span>
            <div className="farmer-kpi-label">Listings</div>
          </div>
          <div className="farmer-kpi-value">{listings.length}</div>
          <div className="farmer-kpi-meta">Market records</div>
        </div>
      </div>

      <section className="farmer-card">
        <div className="farmer-card-header">
          <div>
            <div className="label">Timeline filters</div>
            <h3>Search and narrow activity</h3>
          </div>
        </div>
        <div className="farmer-dashboard-grid">
          <label className="field">
            Search timeline
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search crop, plan, alert, question..." />
          </label>
          <div className="farmer-filter-chip-row">
            {(["all", "advice", "subscription", "alert", "listing"] as TimelineKind[]).map((item) => (
              <button
                key={item}
                type="button"
                className={`btn small ${kindFilter === item ? "" : "ghost"}`}
                onClick={() => setKindFilter(item)}
              >
                {item === "all" ? "All activity" : item}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="farmer-card">
        <div className="farmer-card-header">
          <div>
            <div className="label">Unified timeline</div>
            <h3>Recent farmer activity</h3>
          </div>
        </div>
        {filteredTimeline.length === 0 ? (
          <p className="muted">No activity matches the current filter.</p>
        ) : (
          <div className="farmer-timeline-list">
            {filteredTimeline.map((item) => (
              <article key={item.id} className="farmer-timeline-item">
                <div className="farmer-timeline-dot" aria-hidden="true" />
                <div className="farmer-timeline-content">
                  <div className="farmer-card-header">
                    <div>
                      <strong>{item.title}</strong>
                      <div className="farmer-inline-meta">{item.date ? new Date(item.date).toLocaleString() : "--"}</div>
                    </div>
                    <span className="pill">{item.kind}</span>
                  </div>
                  <p className="muted">{item.detail}</p>
                  <div className="farmer-inline-meta">Status: {item.status}</div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}
