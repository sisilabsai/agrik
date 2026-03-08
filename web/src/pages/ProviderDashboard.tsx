import { useEffect, useMemo, useState } from "react";
import { NavLink } from "react-router-dom";
import { Icon } from "../components/Visuals";
import { api } from "../lib/api";
import { useAuth } from "../state/auth";
import {
  asRecord,
  average,
  daysAgo,
  formatCompactDate,
  formatMoney,
  normalizeProviderLead,
  normalizeProviderOffer,
  normalizeProviderService,
  toNumberValue,
  toStringList,
  toStringValue,
  type ProviderLead,
  type ProviderOffer,
  type ProviderServiceListing,
} from "./providerUtils";

type PricePulse = {
  crop: string;
  district: string;
  price: number;
  currency: string;
  capturedAt: string;
};

type PriorityAction = {
  title: string;
  detail: string;
  to: string;
  action: string;
  icon: "services" | "market" | "spark" | "upload" | "overview";
};

type ActivityItem = {
  id: string;
  title: string;
  detail: string;
  meta: string;
  sortAt: string;
  to: string;
  icon: "services" | "send";
};

function normalizePricePulse(raw: unknown): PricePulse | null {
  const row = asRecord(raw);
  const price = toNumberValue(row.price);
  if (price == null) return null;
  return {
    crop: toStringValue(row.crop),
    district: toStringValue(row.district),
    price,
    currency: toStringValue(row.currency) || "UGX",
    capturedAt: toStringValue(row.captured_at),
  };
}

function percentage(value: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((value / total) * 100);
}

function leadFitScore(lead: ProviderLead, serviceDistricts: Set<string>, focusCropSet: Set<string>) {
  let score = 0;
  if (lead.district && serviceDistricts.has(lead.district)) score += 35;
  if (lead.crop && focusCropSet.has(lead.crop.toLowerCase())) score += 25;
  if (lead.mediaUrls.length > 0) score += 15;
  if (lead.price != null) score += 10;
  const age = daysAgo(lead.createdAt);
  if (age != null) {
    if (age <= 2) score += 15;
    else if (age <= 7) score += 8;
  }
  return score;
}

function freshnessLabel(createdAt: string) {
  const age = daysAgo(createdAt);
  if (age == null) return "Recently posted";
  if (age <= 1) return "Today";
  if (age <= 3) return `${age}d ago`;
  if (age <= 7) return "This week";
  return "Older";
}

export default function ProviderDashboard() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [focusCrops, setFocusCrops] = useState<string[]>([]);
  const [myServices, setMyServices] = useState<ProviderServiceListing[]>([]);
  const [farmerLeads, setFarmerLeads] = useState<ProviderLead[]>([]);
  const [myOffers, setMyOffers] = useState<ProviderOffer[]>([]);
  const [pricePulse, setPricePulse] = useState<PricePulse[]>([]);

  useEffect(() => {
    if (!user?.phone) return;
    setLoading(true);
    setError(null);
    Promise.allSettled([
      api.profileDetails(),
      api.marketServices(`?phone=${encodeURIComponent(user.phone)}&limit=260`),
      api.marketListings("?status=open&role=seller&limit=360"),
      api.marketOffers(`?phone=${encodeURIComponent(user.phone)}&limit=260`),
      api.marketPrices("?limit=80"),
    ])
      .then(([profileRes, servicesRes, leadsRes, offersRes, pricesRes]) => {
        setFocusCrops(
          profileRes.status === "fulfilled"
            ? toStringList(profileRes.value.identity?.focus_crops ?? profileRes.value.identity?.crops ?? [])
            : []
        );
        setMyServices(
          servicesRes.status === "fulfilled"
            ? (servicesRes.value.items ?? []).map((item) => normalizeProviderService(item)).filter((item): item is ProviderServiceListing => item != null)
            : []
        );
        setFarmerLeads(
          leadsRes.status === "fulfilled"
            ? (leadsRes.value.items ?? []).map((item) => normalizeProviderLead(item)).filter((item): item is ProviderLead => item != null)
            : []
        );
        setMyOffers(
          offersRes.status === "fulfilled"
            ? (offersRes.value.items ?? []).map((item) => normalizeProviderOffer(item)).filter((item): item is ProviderOffer => item != null)
            : []
        );
        setPricePulse(
          pricesRes.status === "fulfilled"
            ? (pricesRes.value.items ?? []).map((item) => normalizePricePulse(item)).filter((item): item is PricePulse => item != null)
            : []
        );
      })
      .catch(() => setError("Unable to load provider dashboard."))
      .finally(() => setLoading(false));
  }, [user?.phone]);

  const serviceDistricts = useMemo(() => new Set(myServices.map((item) => item.district).filter(Boolean)), [myServices]);
  const focusCropSet = useMemo(() => new Set(focusCrops.map((item) => item.toLowerCase())), [focusCrops]);
  const contactedLeadIds = useMemo(() => new Set(myOffers.map((item) => item.listingId)), [myOffers]);

  const openServices = useMemo(() => myServices.filter((item) => item.status.toLowerCase() === "open").length, [myServices]);
  const pausedServices = useMemo(() => myServices.filter((item) => item.status.toLowerCase() === "paused").length, [myServices]);
  const mediaReadyServices = useMemo(() => myServices.filter((item) => item.mediaUrls.length > 0).length, [myServices]);
  const servicesMissingPrice = useMemo(() => myServices.filter((item) => item.price == null || item.price <= 0).length, [myServices]);
  const staleServices = useMemo(
    () => myServices.filter((item) => (daysAgo(item.updatedAt || item.createdAt) ?? 0) > 14).length,
    [myServices]
  );
  const matchedLeads = useMemo(
    () =>
      farmerLeads.filter((lead) => {
        if (lead.district && serviceDistricts.has(lead.district)) return true;
        if (lead.crop && focusCropSet.has(lead.crop.toLowerCase())) return true;
        return false;
      }).length,
    [farmerLeads, serviceDistricts, focusCropSet]
  );
  const contactRate = useMemo(() => percentage(contactedLeadIds.size, farmerLeads.length), [contactedLeadIds, farmerLeads.length]);
  const matchRate = useMemo(() => percentage(matchedLeads, farmerLeads.length), [matchedLeads, farmerLeads.length]);
  const avgQuote = useMemo(
    () => average(myOffers.map((item) => item.price).filter((value): value is number => value != null && value > 0)),
    [myOffers]
  );

  const districtRows = useMemo(() => {
    const map = new Map<string, { district: string; leads: number; matched: number; crops: Map<string, number> }>();
    for (const lead of farmerLeads) {
      const district = lead.district || "Unknown";
      const row = map.get(district) ?? { district, leads: 0, matched: 0, crops: new Map<string, number>() };
      row.leads += 1;
      if (lead.district && serviceDistricts.has(lead.district)) row.matched += 1;
      const crop = lead.crop || "Mixed";
      row.crops.set(crop, (row.crops.get(crop) ?? 0) + 1);
      map.set(district, row);
    }
    return [...map.values()]
      .map((row) => {
        const topCrop = [...row.crops.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? "Mixed";
        return {
          district: row.district,
          leads: row.leads,
          matched: row.matched,
          topCrop,
          fitRate: percentage(row.matched, row.leads),
        };
      })
      .sort((left, right) => right.leads - left.leads)
      .slice(0, 6);
  }, [farmerLeads, serviceDistricts]);

  const topLeadMatches = useMemo(() => {
    return [...farmerLeads]
      .map((lead) => ({ lead, score: leadFitScore(lead, serviceDistricts, focusCropSet) }))
      .sort((left, right) => right.score - left.score)
      .slice(0, 5);
  }, [farmerLeads, focusCropSet, serviceDistricts]);

  const recentActivities = useMemo(() => {
    const serviceActivity: ActivityItem[] = myServices.slice(0, 4).map((service) => ({
      id: `service-${service.id}`,
      title: service.serviceType || "Service updated",
      detail: `${[service.parish, service.district].filter(Boolean).join(", ") || "Location not set"} • ${service.status || "open"}`,
      meta: `Updated ${formatCompactDate(service.updatedAt || service.createdAt)}`,
      sortAt: service.updatedAt || service.createdAt,
      to: "/provider/services",
      icon: "services",
    }));
    const offerActivity: ActivityItem[] = myOffers.slice(0, 4).map((offer) => ({
      id: `offer-${offer.id}`,
      title: `Offer sent for listing #${offer.listingId}`,
      detail: offer.price != null ? formatMoney(offer.price, "UGX") : "Price pending",
      meta: `Sent ${formatCompactDate(offer.createdAt)}`,
      sortAt: offer.createdAt,
      to: "/provider/leads",
      icon: "send",
    }));
    return [...serviceActivity, ...offerActivity]
      .sort((left, right) => Date.parse(right.sortAt || "") - Date.parse(left.sortAt || ""))
      .slice(0, 6);
  }, [myOffers, myServices]);

  const bestPrices = useMemo(() => {
    if (pricePulse.length === 0) return [];
    const focus = focusCropSet.size > 0 ? pricePulse.filter((item) => focusCropSet.has(item.crop.toLowerCase())) : pricePulse;
    return focus.slice(0, 5);
  }, [focusCropSet, pricePulse]);

  const checklist = useMemo(
    () => [
      {
        label: "Service proof",
        detail: `${mediaReadyServices} of ${myServices.length || 0} services include evidence`,
        done: myServices.length > 0 && mediaReadyServices >= Math.max(1, Math.ceil(myServices.length / 2)),
      },
      {
        label: "District coverage",
        detail: `${serviceDistricts.size} districts currently covered`,
        done: serviceDistricts.size >= 3,
      },
      {
        label: "Lead follow-up",
        detail: `${contactedLeadIds.size} leads contacted (${contactRate}%)`,
        done: contactRate >= 35,
      },
      {
        label: "Pricing hygiene",
        detail: servicesMissingPrice === 0 ? "All services have pricing" : `${servicesMissingPrice} services still missing price`,
        done: servicesMissingPrice === 0,
      },
    ],
    [contactRate, contactedLeadIds.size, mediaReadyServices, myServices.length, serviceDistricts.size, servicesMissingPrice]
  );

  const serviceHealth = useMemo(
    () => [
      { label: "Open services", value: openServices, total: Math.max(myServices.length, 1), detail: "Currently available" },
      { label: "Paused services", value: pausedServices, total: Math.max(myServices.length, 1), detail: "Need review or reopening" },
      { label: "With media", value: mediaReadyServices, total: Math.max(myServices.length, 1), detail: "Evidence ready" },
      { label: "Missing price", value: servicesMissingPrice, total: Math.max(myServices.length, 1), detail: "Needs pricing" },
      { label: "Stale updates", value: staleServices, total: Math.max(myServices.length, 1), detail: "Older than 14 days" },
    ],
    [mediaReadyServices, myServices.length, openServices, pausedServices, servicesMissingPrice, staleServices]
  );

  const pipelineHealth = useMemo(
    () => [
      { label: "Lead fit", value: `${matchRate}%`, detail: `${matchedLeads} of ${farmerLeads.length} leads align` },
      { label: "Contact rate", value: `${contactRate}%`, detail: `${contactedLeadIds.size} leads reached` },
      { label: "Offers sent", value: `${myOffers.length}`, detail: avgQuote != null ? `Avg ${formatMoney(avgQuote, "UGX")}` : "No quote average yet" },
    ],
    [avgQuote, contactedLeadIds.size, contactRate, farmerLeads.length, matchRate, matchedLeads, myOffers.length]
  );

  const priorityActions = useMemo<PriorityAction[]>(() => {
    const items: PriorityAction[] = [];
    if (myServices.length === 0) {
      items.push({
        title: "Publish your first service",
        detail: "You need at least one active service before demand can route cleanly.",
        to: "/provider/services",
        action: "Add service",
        icon: "services",
      });
    }
    if (matchedLeads > contactedLeadIds.size) {
      items.push({
        title: "Respond to matched demand",
        detail: `${matchedLeads - contactedLeadIds.size} matched leads still have no offer from you.`,
        to: "/provider/leads",
        action: "Open leads",
        icon: "market",
      });
    }
    if (mediaReadyServices < openServices) {
      items.push({
        title: "Upload work evidence",
        detail: `${openServices - mediaReadyServices} open services still need photos or videos.`,
        to: "/provider/services",
        action: "Add media",
        icon: "upload",
      });
    }
    if (pausedServices > 0 || staleServices > 0) {
      items.push({
        title: "Clean up service catalog",
        detail: `${pausedServices} paused and ${staleServices} stale services need attention.`,
        to: "/provider/services",
        action: "Review services",
        icon: "overview",
      });
    }
    if (items.length === 0) {
      items.push({
        title: "Expand demand reach",
        detail: "Your catalog is in decent shape. Push visibility through targeted campaigns.",
        to: "/provider/marketing",
        action: "Open marketing",
        icon: "spark",
      });
    }
    return items.slice(0, 4);
  }, [contactedLeadIds.size, matchedLeads, mediaReadyServices, myServices.length, openServices, pausedServices, staleServices]);

  const focusTags = useMemo(() => {
    const tags = [...focusCrops.slice(0, 3), ...[...serviceDistricts].slice(0, 2)];
    return tags.filter(Boolean);
  }, [focusCrops, serviceDistricts]);

  const overviewSummary = useMemo(() => {
    if (myServices.length === 0) return "Start by publishing a service so buyers and farmers can route work to you.";
    if (matchedLeads > contactedLeadIds.size) return `${matchedLeads - contactedLeadIds.size} matched leads are waiting for a response from your side.`;
    if (servicesMissingPrice > 0) return `${servicesMissingPrice} services still need pricing to improve conversion and trust.`;
    return "Your service catalog is active. Keep follow-up speed high and add more evidence where possible.";
  }, [contactedLeadIds.size, matchedLeads, myServices.length, servicesMissingPrice]);

  if (loading) return <section className="farmer-page provider-page">Loading provider dashboard...</section>;

  return (
    <section className="farmer-page provider-page provider-overview-neo">
      <div className="provider-overview-hero">
        <div className="provider-overview-hero-main">
          <div className="section-title-with-icon">
            <span className="section-icon">
              <Icon name="overview" size={18} />
            </span>
            <div>
              <div className="label">Provider overview</div>
              <h1>Run services, demand, and growth from one dashboard.</h1>
              <p className="muted">{overviewSummary}</p>
            </div>
          </div>
          <div className="provider-header-actions">
            <NavLink to="/provider/services" className="btn small">
              Manage services
            </NavLink>
            <NavLink to="/provider/leads" className="btn ghost small">
              Review leads
            </NavLink>
            <NavLink to="/provider/marketing" className="btn ghost small">
              Open marketing
            </NavLink>
          </div>
          <div className="provider-overview-tags">
            {(focusTags.length ? focusTags : ["Provider portal", "Live demand"]).map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </div>
        </div>

        <aside className="provider-overview-hero-side">
          <div className="provider-panel-header">
            <div>
              <div className="label">Next actions</div>
              <h3>Today</h3>
            </div>
          </div>
          <div className="provider-priority-list">
            {priorityActions.map((item) => (
              <NavLink key={item.title} to={item.to} className="provider-priority-card">
                <span className="provider-priority-icon">
                  <Icon name={item.icon} size={18} />
                </span>
                <div>
                  <strong>{item.title}</strong>
                  <p>{item.detail}</p>
                  <span>{item.action}</span>
                </div>
              </NavLink>
            ))}
          </div>
        </aside>
      </div>

      {error ? <p className="status error">{error}</p> : null}

      <div className="provider-kpi-grid provider-kpi-grid-rich">
        <article className="provider-kpi-card">
          <div className="provider-kpi-label">Published services</div>
          <div className="provider-kpi-value">{myServices.length}</div>
          <div className="provider-kpi-meta">{openServices} open now</div>
        </article>
        <article className="provider-kpi-card">
          <div className="provider-kpi-label">Coverage districts</div>
          <div className="provider-kpi-value">{serviceDistricts.size}</div>
          <div className="provider-kpi-meta">Live service footprint</div>
        </article>
        <article className="provider-kpi-card">
          <div className="provider-kpi-label">Matched leads</div>
          <div className="provider-kpi-value">{matchedLeads}</div>
          <div className="provider-kpi-meta">{matchRate}% of open demand</div>
        </article>
        <article className="provider-kpi-card">
          <div className="provider-kpi-label">Offers sent</div>
          <div className="provider-kpi-value">{myOffers.length}</div>
          <div className="provider-kpi-meta">{contactRate}% contact rate</div>
        </article>
        <article className="provider-kpi-card">
          <div className="provider-kpi-label">Average quote</div>
          <div className="provider-kpi-value">{avgQuote != null ? formatMoney(avgQuote, "UGX") : "--"}</div>
          <div className="provider-kpi-meta">From submitted offers</div>
        </article>
        <article className="provider-kpi-card">
          <div className="provider-kpi-label">Catalog hygiene</div>
          <div className="provider-kpi-value">{servicesMissingPrice + staleServices}</div>
          <div className="provider-kpi-meta">Items needing cleanup</div>
        </article>
      </div>

      <div className="provider-dashboard-grid">
        <div className="provider-dashboard-main">
          <section className="farmer-card provider-panel">
            <div className="provider-panel-header">
              <div>
                <div className="label">Opportunity queue</div>
                <h3>Best-fit leads to act on now</h3>
              </div>
              <NavLink to="/provider/leads" className="btn ghost tiny">
                Open lead pipeline
              </NavLink>
            </div>
            {topLeadMatches.length === 0 ? (
              <p className="muted">No lead opportunities available yet.</p>
            ) : (
              <div className="provider-focus-list">
                {topLeadMatches.map(({ lead, score }) => (
                  <article key={lead.id} className="provider-focus-card">
                    <div className="provider-focus-head">
                      <div>
                        <strong>{lead.crop || "Open demand"}</strong>
                        <p>{[lead.parish, lead.district].filter(Boolean).join(", ") || "Location not set"}</p>
                      </div>
                      <span className="provider-score-pill">Score {score}</span>
                    </div>
                    <div className="provider-focus-meta">
                      <span>{lead.quantity != null ? `${lead.quantity} ${lead.unit || "units"}` : "Quantity open"}</span>
                      <span>{lead.price != null ? formatMoney(lead.price, lead.currency || "UGX") : "Negotiable"}</span>
                      <span>{freshnessLabel(lead.createdAt)}</span>
                    </div>
                    <div className="provider-chip-row">
                      {lead.mediaUrls.length > 0 ? <span className="provider-status-pill status-open">Evidence</span> : null}
                      {lead.district && serviceDistricts.has(lead.district) ? <span className="provider-status-pill status-open">District fit</span> : null}
                      {lead.crop && focusCropSet.has(lead.crop.toLowerCase()) ? <span className="provider-status-pill status-open">Crop fit</span> : null}
                    </div>
                    <div className="provider-focus-actions">
                      <NavLink className="btn ghost tiny" to={`/provider/leads?district=${encodeURIComponent(lead.district || "")}`}>
                        Open in leads
                      </NavLink>
                      <NavLink className="btn ghost tiny" to={`/marketplace/listings/${lead.id}`}>
                        Listing details
                      </NavLink>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="farmer-card provider-panel">
            <div className="provider-panel-header">
              <div>
                <div className="label">District opportunity board</div>
                <h3>Where demand is strongest</h3>
              </div>
            </div>
            {districtRows.length === 0 ? (
              <p className="muted">No district demand data yet.</p>
            ) : (
              <div className="provider-opportunity-grid">
                {districtRows.map((row) => (
                  <article key={row.district} className="provider-opportunity-card">
                    <div className="provider-opportunity-head">
                      <strong>{row.district}</strong>
                      <span>{row.leads} leads</span>
                    </div>
                    <div className="provider-progress-track">
                      <i style={{ width: `${Math.max(8, row.fitRate)}%` }} />
                    </div>
                    <div className="provider-opportunity-meta">
                      <span>{row.fitRate}% district fit</span>
                      <span>Top crop: {row.topCrop}</span>
                    </div>
                    <NavLink to={`/provider/leads?district=${encodeURIComponent(row.district)}`} className="provider-inline-link">
                      Review district leads
                    </NavLink>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="farmer-card provider-panel">
            <div className="provider-panel-header">
              <div>
                <div className="label">Recent operations</div>
                <h3>Latest service and offer activity</h3>
              </div>
            </div>
            {recentActivities.length === 0 ? (
              <p className="muted">No recent activity yet.</p>
            ) : (
              <div className="provider-activity-list">
                {recentActivities.map((item) => (
                  <NavLink key={item.id} to={item.to} className="provider-activity-item">
                    <span className="provider-activity-icon">
                      <Icon name={item.icon} size={16} />
                    </span>
                    <div>
                      <strong>{item.title}</strong>
                      <p>{item.detail}</p>
                      <span>{item.meta}</span>
                    </div>
                  </NavLink>
                ))}
              </div>
            )}
          </section>
        </div>

        <div className="provider-dashboard-side">
          <section className="farmer-card provider-panel">
            <div className="provider-panel-header">
              <div>
                <div className="label">Service health</div>
                <h3>Catalog quality and coverage</h3>
              </div>
              <NavLink to="/provider/services" className="btn ghost tiny">
                Open services
              </NavLink>
            </div>
            <div className="provider-health-list">
              {serviceHealth.map((item) => (
                <article key={item.label} className="provider-health-item">
                  <div className="provider-health-head">
                    <strong>{item.label}</strong>
                    <span>{item.value}</span>
                  </div>
                  <div className="provider-progress-track">
                    <i style={{ width: `${Math.max(6, percentage(item.value, item.total))}%` }} />
                  </div>
                  <p>{item.detail}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="farmer-card provider-panel">
            <div className="provider-panel-header">
              <div>
                <div className="label">Pipeline health</div>
                <h3>Demand response snapshot</h3>
              </div>
            </div>
            <div className="provider-mini-stat-grid">
              {pipelineHealth.map((item) => (
                <article key={item.label} className="provider-mini-stat">
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                  <p>{item.detail}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="farmer-card provider-panel">
            <div className="provider-panel-header">
              <div>
                <div className="label">Price watch</div>
                <h3>Recent market price signal</h3>
              </div>
            </div>
            {bestPrices.length === 0 ? (
              <p className="muted">No pricing signal available yet.</p>
            ) : (
              <div className="provider-price-list">
                {bestPrices.map((item, index) => (
                  <article key={`${item.crop}-${item.district}-${index}`} className="provider-price-row">
                    <div>
                      <strong>{item.crop}</strong>
                      <span>{[item.district, formatCompactDate(item.capturedAt)].filter(Boolean).join(" | ")}</span>
                    </div>
                    <strong>{formatMoney(item.price, item.currency)}</strong>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="farmer-card provider-panel">
            <div className="provider-panel-header">
              <div>
                <div className="label">Readiness</div>
                <h3>Execution checklist</h3>
              </div>
            </div>
            <div className="provider-checklist">
              {checklist.map((item) => (
                <article key={item.label} className={`provider-check-item ${item.done ? "done" : ""}`}>
                  <div>
                    <strong>{item.label}</strong>
                    <p>{item.detail}</p>
                  </div>
                  <span className={`provider-check-pill ${item.done ? "done" : "pending"}`}>{item.done ? "Done" : "Pending"}</span>
                </article>
              ))}
            </div>
          </section>
        </div>
      </div>
    </section>
  );
}
