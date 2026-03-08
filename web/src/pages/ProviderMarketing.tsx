import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Icon } from "../components/Visuals";
import { api } from "../lib/api";
import { useAuth } from "../state/auth";
import {
  asRecord,
  formatCompactDate,
  formatMoney,
  normalizeProviderLead,
  normalizeProviderOffer,
  normalizeProviderService,
  slugify,
  toNumberValue,
  toStringValue,
  uniqueValues,
  type ProviderLead,
  type ProviderOffer,
  type ProviderServiceListing,
} from "./providerUtils";

type CampaignStatus = "draft" | "active" | "paused" | "completed";

type Campaign = {
  id: string;
  name: string;
  serviceType: string;
  district: string;
  crop: string;
  channel: "sms" | "whatsapp" | "call";
  tone: "direct" | "trust" | "promotion";
  message: string;
  status: CampaignStatus;
  replies: number;
  conversions: number;
  createdAt: string;
};

type CampaignDraft = {
  name: string;
  serviceType: string;
  district: string;
  crop: string;
  channel: "sms" | "whatsapp" | "call";
  tone: "direct" | "trust" | "promotion";
};

type PricePoint = {
  crop: string;
  district: string;
  price: number;
  currency: string;
  capturedAt: string;
};

function emptyCampaignDraft(): CampaignDraft {
  return {
    name: "",
    serviceType: "",
    district: "",
    crop: "",
    channel: "whatsapp",
    tone: "trust",
  };
}

function campaignStorageKey(userId: string | undefined, phone: string | undefined): string {
  if (userId) return `agrik_provider_campaigns_${userId}`;
  return `agrik_provider_campaigns_${phone ?? "unknown"}`;
}

function normalizePricePoint(raw: unknown): PricePoint | null {
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

function buildCampaignMessage(draft: CampaignDraft): string {
  const servicePart = draft.serviceType || "service support";
  const locationPart = draft.district ? ` in ${draft.district}` : "";
  const cropPart = draft.crop ? ` for ${draft.crop}` : "";
  if (draft.tone === "promotion") {
    return `AGRIK update: Limited slots for ${servicePart}${cropPart}${locationPart}. Book today for priority scheduling and trusted delivery.`;
  }
  if (draft.tone === "direct") {
    return `We are open for ${servicePart}${cropPart}${locationPart}. Reply now to secure timeline and pricing.`;
  }
  return `Trusted provider alert: ${servicePart}${cropPart}${locationPart}. Verified operations, clear pricing, and responsive support available now.`;
}

export default function ProviderMarketing() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [draft, setDraft] = useState<CampaignDraft>(emptyCampaignDraft());
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);

  const [myServices, setMyServices] = useState<ProviderServiceListing[]>([]);
  const [farmerLeads, setFarmerLeads] = useState<ProviderLead[]>([]);
  const [myOffers, setMyOffers] = useState<ProviderOffer[]>([]);
  const [prices, setPrices] = useState<PricePoint[]>([]);

  const storageKey = campaignStorageKey(user?.id, user?.phone);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) {
        setCampaigns([]);
        return;
      }
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        setCampaigns([]);
        return;
      }
      const rows: Campaign[] = [];
      for (const item of parsed) {
        const row = asRecord(item);
        const id = toStringValue(row.id);
        if (!id) continue;
        rows.push({
          id,
          name: toStringValue(row.name) || "Untitled campaign",
          serviceType: toStringValue(row.serviceType),
          district: toStringValue(row.district),
          crop: toStringValue(row.crop),
          channel: (toStringValue(row.channel) as Campaign["channel"]) || "whatsapp",
          tone: (toStringValue(row.tone) as Campaign["tone"]) || "trust",
          message: toStringValue(row.message),
          status: (toStringValue(row.status) as CampaignStatus) || "draft",
          replies: Math.max(0, Math.round(toNumberValue(row.replies) ?? 0)),
          conversions: Math.max(0, Math.round(toNumberValue(row.conversions) ?? 0)),
          createdAt: toStringValue(row.createdAt) || new Date().toISOString(),
        });
      }
      setCampaigns(rows);
    } catch {
      setCampaigns([]);
    }
  }, [storageKey]);

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(campaigns));
  }, [campaigns, storageKey]);

  useEffect(() => {
    if (!user?.phone) return;
    setLoading(true);
    setError(null);
    Promise.allSettled([
      api.marketServices(`?phone=${encodeURIComponent(user.phone)}&limit=280`),
      api.marketListings("?status=open&role=seller&limit=360"),
      api.marketOffers(`?phone=${encodeURIComponent(user.phone)}&limit=280`),
      api.marketPrices("?limit=120"),
    ])
      .then(([servicesRes, leadsRes, offersRes, pricesRes]) => {
        if (servicesRes.status === "fulfilled") {
          const services = (servicesRes.value.items ?? []).map((item) => normalizeProviderService(item)).filter((item): item is ProviderServiceListing => item != null);
          setMyServices(services);
          setDraft((prev) => ({
            ...prev,
            serviceType: prev.serviceType || services[0]?.serviceType || "",
          }));
        } else {
          setMyServices([]);
        }
        if (leadsRes.status === "fulfilled") {
          setFarmerLeads((leadsRes.value.items ?? []).map((item) => normalizeProviderLead(item)).filter((item): item is ProviderLead => item != null));
        } else {
          setFarmerLeads([]);
        }
        if (offersRes.status === "fulfilled") {
          setMyOffers((offersRes.value.items ?? []).map((item) => normalizeProviderOffer(item)).filter((item): item is ProviderOffer => item != null));
        } else {
          setMyOffers([]);
        }
        if (pricesRes.status === "fulfilled") {
          setPrices((pricesRes.value.items ?? []).map((item) => normalizePricePoint(item)).filter((item): item is PricePoint => item != null));
        } else {
          setPrices([]);
        }
      })
      .catch(() => setError("Unable to load marketing workspace."))
      .finally(() => setLoading(false));
  }, [user?.phone]);

  const serviceTypeOptions = useMemo(() => uniqueValues(myServices.map((item) => item.serviceType).filter(Boolean)), [myServices]);
  const districtOptions = useMemo(() => uniqueValues(farmerLeads.map((item) => item.district).filter(Boolean)), [farmerLeads]);
  const cropOptions = useMemo(() => uniqueValues(farmerLeads.map((item) => item.crop).filter(Boolean)), [farmerLeads]);

  const activeCampaigns = useMemo(() => campaigns.filter((item) => item.status === "active"), [campaigns]);
  const inactiveCampaigns = useMemo(() => campaigns.filter((item) => item.status !== "active").length, [campaigns]);
  const totalReplies = useMemo(() => campaigns.reduce((sum, item) => sum + item.replies, 0), [campaigns]);
  const totalConversions = useMemo(() => campaigns.reduce((sum, item) => sum + item.conversions, 0), [campaigns]);
  const campaignConversionRate = useMemo(() => (totalReplies > 0 ? Math.round((totalConversions / totalReplies) * 100) : 0), [totalConversions, totalReplies]);
  const contactedRate = useMemo(() => {
    if (farmerLeads.length === 0) return 0;
    const contacted = new Set(myOffers.map((item) => item.listingId)).size;
    return Math.round((contacted / farmerLeads.length) * 100);
  }, [farmerLeads.length, myOffers]);

  const estimatedAudience = useMemo(() => {
    if (activeCampaigns.length === 0) return 0;
    let total = 0;
    for (const campaign of activeCampaigns) {
      total += farmerLeads.filter((lead) => {
        const districtMatch = campaign.district ? lead.district === campaign.district : true;
        const cropMatch = campaign.crop ? lead.crop === campaign.crop : true;
        return districtMatch && cropMatch;
      }).length;
    }
    return total;
  }, [activeCampaigns, farmerLeads]);

  const topDistrictDemand = useMemo(() => {
    const map = new Map<string, number>();
    for (const lead of farmerLeads) {
      const district = lead.district || "Unknown";
      map.set(district, (map.get(district) ?? 0) + 1);
    }
    return [...map.entries()].sort((left, right) => right[1] - left[1]).slice(0, 6);
  }, [farmerLeads]);

  const campaignPriceSignals = useMemo(() => {
    const crop = draft.crop.trim();
    const district = draft.district.trim();
    const filtered = prices.filter((item) => (crop ? item.crop === crop : true)).filter((item) => (district ? item.district === district : true));
    return filtered.slice(0, 4);
  }, [draft.crop, draft.district, prices]);

  const suggestedLink = useMemo(() => {
    const params = new URLSearchParams();
    if (draft.serviceType) params.set("serviceType", draft.serviceType);
    if (draft.district) params.set("district", draft.district);
    if (draft.crop) params.set("crop", draft.crop);
    const query = params.toString();
    return query ? `/marketplace?${query}` : "/marketplace";
  }, [draft.crop, draft.district, draft.serviceType]);

  const draftMessage = useMemo(() => buildCampaignMessage(draft), [draft]);
  const campaignTemplates = useMemo(
    () => [
      {
        label: "Trust build",
        detail: "Use when you need credibility and proof-led outreach.",
        apply: () =>
          setDraft((prev) => ({
            ...prev,
            tone: "trust",
            channel: "whatsapp",
            name: prev.name || "Trust campaign",
          })),
      },
      {
        label: "Quick response",
        detail: "Use for active demand you want to answer immediately.",
        apply: () =>
          setDraft((prev) => ({
            ...prev,
            tone: "direct",
            channel: "sms",
            name: prev.name || "Quick response push",
          })),
      },
      {
        label: "Promo burst",
        detail: "Use to push visibility for available capacity.",
        apply: () =>
          setDraft((prev) => ({
            ...prev,
            tone: "promotion",
            channel: "whatsapp",
            name: prev.name || "Promo burst",
          })),
      },
    ],
    []
  );

  const onDraftChange = <K extends keyof CampaignDraft>(field: K, value: CampaignDraft[K]) => {
    setDraft((prev) => ({ ...prev, [field]: value }));
  };

  const copyText = async (text: string, successMessage: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setMessage(successMessage);
      setError(null);
    } catch {
      setError("Unable to copy to clipboard.");
    }
  };

  const createCampaign = (event: FormEvent) => {
    event.preventDefault();
    const name = draft.name.trim() || `${draft.serviceType || "Service"} push`;
    if (!name) {
      setError("Campaign name is required.");
      return;
    }
    const campaign: Campaign = {
      id: `cmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      serviceType: draft.serviceType.trim(),
      district: draft.district.trim(),
      crop: draft.crop.trim(),
      channel: draft.channel,
      tone: draft.tone,
      message: draftMessage,
      status: "draft",
      replies: 0,
      conversions: 0,
      createdAt: new Date().toISOString(),
    };
    setCampaigns((prev) => [campaign, ...prev]);
    setMessage("Campaign created.");
    setError(null);
    setDraft((prev) => ({ ...prev, name: "" }));
  };

  const updateCampaign = (campaignId: string, patch: Partial<Campaign>) => {
    setCampaigns((prev) => prev.map((item) => (item.id === campaignId ? { ...item, ...patch } : item)));
  };

  const removeCampaign = (campaignId: string) => {
    setCampaigns((prev) => prev.filter((item) => item.id !== campaignId));
  };

  if (loading) return <section className="farmer-page provider-page">Loading provider marketing...</section>;

  return (
    <section className="farmer-page provider-page provider-workspace-neo provider-marketing-neo">
      <section className="provider-workspace-hero">
        <div className="provider-workspace-hero-main">
          <div className="section-title-with-icon">
            <span className="section-icon">
              <Icon name="spark" size={18} />
            </span>
            <div>
              <div className="label">Marketing studio</div>
              <h1>Plan campaigns without losing operational context.</h1>
              <p className="muted">Build targeted outreach from live demand, price signal, and your current service footprint.</p>
            </div>
          </div>
          <div className="provider-header-actions">
            <Link className="btn ghost small" to="/provider/services">
              Service catalog
            </Link>
            <Link className="btn small" to="/provider/leads">
              Lead pipeline
            </Link>
          </div>
          <div className="provider-overview-tags">
            <span>{activeCampaigns.length} active</span>
            <span>{estimatedAudience} estimated reach</span>
            <span>{campaignConversionRate}% conversion</span>
          </div>
        </div>
        <aside className="provider-workspace-sidecard">
          <div className="provider-panel-header">
            <div>
              <div className="label">Campaign presets</div>
              <h3>Quick starts</h3>
            </div>
          </div>
          <div className="provider-template-list">
            {campaignTemplates.map((template) => (
              <button key={template.label} type="button" className="provider-template-card" onClick={template.apply}>
                <strong>{template.label}</strong>
                <p>{template.detail}</p>
              </button>
            ))}
          </div>
        </aside>
      </section>

      {(message || error) && <p className={`status ${error ? "error" : ""}`}>{error ?? message}</p>}

      <div className="provider-kpi-grid">
        <article className="provider-kpi-card">
          <div className="provider-kpi-label">Active campaigns</div>
          <div className="provider-kpi-value">{activeCampaigns.length}</div>
          <div className="provider-kpi-meta">{campaigns.length} total campaigns</div>
        </article>
        <article className="provider-kpi-card">
          <div className="provider-kpi-label">Estimated audience</div>
          <div className="provider-kpi-value">{estimatedAudience}</div>
          <div className="provider-kpi-meta">From active campaign filters</div>
        </article>
        <article className="provider-kpi-card">
          <div className="provider-kpi-label">Campaign conversion</div>
          <div className="provider-kpi-value">{campaignConversionRate}%</div>
          <div className="provider-kpi-meta">
            {totalConversions} conversions / {totalReplies} replies
          </div>
        </article>
        <article className="provider-kpi-card">
          <div className="provider-kpi-label">Lead contact rate</div>
          <div className="provider-kpi-value">{contactedRate}%</div>
          <div className="provider-kpi-meta">Offers sent to lead pool</div>
        </article>
        <article className="provider-kpi-card">
          <div className="provider-kpi-label">Inactive campaigns</div>
          <div className="provider-kpi-value">{inactiveCampaigns}</div>
          <div className="provider-kpi-meta">Draft, paused, or completed</div>
        </article>
      </div>

      <div className="provider-two-col">
        <section className="farmer-card provider-panel">
          <div className="provider-panel-header">
            <div>
              <div className="label">Campaign builder</div>
              <h3>Generate channel-ready outreach</h3>
            </div>
          </div>
          <form className="provider-form-grid" onSubmit={createCampaign}>
            <label className="field">
              Campaign name
              <input value={draft.name} onChange={(event) => onDraftChange("name", event.target.value)} placeholder="March transport push" />
            </label>
            <label className="field">
              Service type
              <select value={draft.serviceType} onChange={(event) => onDraftChange("serviceType", event.target.value)}>
                <option value="">Select service</option>
                {serviceTypeOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              District focus
              <select value={draft.district} onChange={(event) => onDraftChange("district", event.target.value)}>
                <option value="">All districts</option>
                {districtOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Crop focus
              <select value={draft.crop} onChange={(event) => onDraftChange("crop", event.target.value)}>
                <option value="">All crops</option>
                {cropOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Channel
              <select value={draft.channel} onChange={(event) => onDraftChange("channel", event.target.value as CampaignDraft["channel"])}>
                <option value="whatsapp">WhatsApp</option>
                <option value="sms">SMS</option>
                <option value="call">Call outreach</option>
              </select>
            </label>
            <label className="field">
              Tone
              <select value={draft.tone} onChange={(event) => onDraftChange("tone", event.target.value as CampaignDraft["tone"])}>
                <option value="trust">Trust-first</option>
                <option value="direct">Direct CTA</option>
                <option value="promotion">Promo burst</option>
              </select>
            </label>
            <label className="field provider-form-span">
              Message preview
              <textarea rows={3} value={draftMessage} readOnly />
            </label>
            <div className="provider-form-actions">
              <button type="submit" className="btn">
                Save campaign
              </button>
              <button type="button" className="btn ghost" onClick={() => copyText(draftMessage, "Campaign message copied.")}>
                Copy message
              </button>
            </div>
          </form>
          <div className="provider-submeta-row">
            <span>{draft.serviceType || "No service selected"}</span>
            <span>{draft.district || "All districts"} • {draft.crop || "All crops"}</span>
          </div>
        </section>

        <section className="farmer-card provider-panel">
          <div className="provider-panel-header">
            <div>
              <div className="label">Share kit</div>
              <h3>Reusable promo assets</h3>
            </div>
          </div>
          <div className="provider-marketing-assets">
            <article className="provider-asset-item">
              <strong>Public listing link</strong>
              <code>{suggestedLink}</code>
              <button type="button" className="btn ghost tiny" onClick={() => copyText(suggestedLink, "Public link copied.")}>
                Copy link
              </button>
            </article>
            <article className="provider-asset-item">
              <strong>Campaign hashtag</strong>
              <code>#{slugify(`${draft.serviceType || "service"}-${draft.district || "uganda"}`)}</code>
            </article>
            <article className="provider-asset-item">
              <strong>Price signals</strong>
              {campaignPriceSignals.length === 0 ? (
                <p className="muted">No matching market prices found yet.</p>
              ) : (
                <div className="provider-price-list">
                  {campaignPriceSignals.map((item, index) => (
                    <div key={`${item.crop}-${item.district}-${index}`} className="provider-price-row">
                      <div>
                        <strong>{item.crop}</strong>
                        <span>{[item.district, formatCompactDate(item.capturedAt)].filter(Boolean).join(" | ")}</span>
                      </div>
                      <strong>{formatMoney(item.price, item.currency)}</strong>
                    </div>
                  ))}
                </div>
              )}
            </article>
          </div>
        </section>
      </div>

      <section className="farmer-card provider-panel">
        <div className="provider-panel-header">
          <div>
            <div className="label">Campaign board</div>
            <h3>Track execution and response</h3>
          </div>
        </div>
        <div className="provider-submeta-row">
          <span>{campaigns.length} total campaigns</span>
          <span>{activeCampaigns.length} active now</span>
        </div>
        {campaigns.length === 0 ? (
          <p className="muted">No campaigns yet. Build your first campaign above.</p>
        ) : (
          <div className="provider-campaign-list">
            {campaigns.map((campaign) => (
              <article key={campaign.id} className="provider-campaign-item">
                <div className="provider-campaign-main">
                  <div className="provider-campaign-top">
                    <strong>{campaign.name}</strong>
                    <span className={`provider-status-pill status-${campaign.status}`}>{campaign.status}</span>
                  </div>
                  <div className="provider-service-meta">
                    <span>{campaign.serviceType || "Service not set"}</span>
                    <span>{campaign.crop || "All crops"}</span>
                    <span>{campaign.district || "All districts"}</span>
                    <span>{campaign.channel}</span>
                    <span>Created {formatCompactDate(campaign.createdAt)}</span>
                  </div>
                  <p>{campaign.message}</p>
                </div>
                <div className="provider-campaign-actions">
                  <label className="field">
                    Status
                    <select value={campaign.status} onChange={(event) => updateCampaign(campaign.id, { status: event.target.value as CampaignStatus })}>
                      <option value="draft">draft</option>
                      <option value="active">active</option>
                      <option value="paused">paused</option>
                      <option value="completed">completed</option>
                    </select>
                  </label>
                  <label className="field">
                    Replies
                    <input
                      type="number"
                      min="0"
                      value={campaign.replies}
                      onChange={(event) => updateCampaign(campaign.id, { replies: Math.max(0, Number(event.target.value) || 0) })}
                    />
                  </label>
                  <label className="field">
                    Conversions
                    <input
                      type="number"
                      min="0"
                      value={campaign.conversions}
                      onChange={(event) => updateCampaign(campaign.id, { conversions: Math.max(0, Number(event.target.value) || 0) })}
                    />
                  </label>
                  <button type="button" className="btn ghost tiny" onClick={() => copyText(campaign.message, "Campaign message copied.")}>
                    Copy
                  </button>
                  <button type="button" className="btn ghost tiny danger" onClick={() => removeCampaign(campaign.id)}>
                    Remove
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="farmer-card provider-panel">
        <div className="provider-panel-header">
          <div>
            <div className="label">Demand heat</div>
            <h3>Top districts by lead volume</h3>
          </div>
        </div>
        {topDistrictDemand.length === 0 ? (
          <p className="muted">No district demand signal available.</p>
        ) : (
          <div className="provider-rank-list">
            {topDistrictDemand.map(([district, count]) => {
              const max = topDistrictDemand[0]?.[1] ?? 1;
              const width = Math.max(8, Math.round((count / max) * 100));
              return (
                <article key={district} className="provider-rank-item">
                  <div className="provider-rank-main">
                    <strong>{district}</strong>
                    <span>{count} leads</span>
                  </div>
                  <div className="provider-rank-progress">
                    <i style={{ width: `${width}%` }} />
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </section>
  );
}
