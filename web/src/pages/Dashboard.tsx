import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "../state/auth";

type Listing = {
  id: number;
  crop: string;
  role: string;
  price?: number;
  unit?: string;
  quantity?: number;
  status: string;
  location?: { district?: string; parish?: string };
};

type Alert = {
  id: number;
  alert_type: string;
  crop?: string;
  threshold?: number;
  channel: string;
  active: boolean;
  location?: { district?: string };
};

type Price = {
  id: number;
  crop: string;
  price: number;
  district?: string;
  market?: string;
  currency?: string;
  source?: string;
  captured_at?: string;
};

type PricePrediction = {
  crop: string;
  district?: string | null;
  predicted_price: number;
  currency: string;
  direction: "up" | "down" | "flat";
  confidence: number;
  horizon_days: number;
  points: number;
};

type MarketInsight = {
  title?: string | null;
  summary: string;
  source?: string | null;
  score?: number | null;
};

type MarketIntel = {
  prices: Price[];
  predictions: PricePrediction[];
  insights: MarketInsight[];
  updated_at?: string | null;
  source?: string | null;
};

type Service = {
  id: number;
  service_type: string;
  price?: number;
  status: string;
  location?: { district?: string };
};

type Settings = {
  user_id: string;
  preferred_language?: string | null;
  district?: string | null;
  parish?: string | null;
  sms_opt_in: boolean;
  voice_opt_in: boolean;
  weather_alerts: boolean;
  price_alerts: boolean;
};

type Subscription = {
  id: number;
  plan: string;
  status: string;
  starts_at: string;
  ends_at?: string | null;
  provider?: string | null;
};

type ChatMessage = {
  id: number;
  role: "user" | "assistant";
  message: string;
  created_at: string;
};

type WeatherDay = {
  date: string;
  precipitation_mm?: number | null;
  temp_max_c?: number | null;
  temp_min_c?: number | null;
};

type WeatherSummary = {
  location_name?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  next_rain_date?: string | null;
  days: WeatherDay[];
  data_source: string;
};

type FarmProfileDraft = {
  cropsText: string;
  plantingDatesText: string;
  soilProfileText: string;
  climateExposureText: string;
  yieldEstimatesText: string;
};

export default function Dashboard() {
  const { user } = useAuth();
  const [listings, setListings] = useState<Listing[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [marketIntel, setMarketIntel] = useState<MarketIntel | null>(null);
  const [marketLoading, setMarketLoading] = useState(false);
  const [marketError, setMarketError] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<Settings | null>(null);
  const [farmDraft, setFarmDraft] = useState<FarmProfileDraft | null>(null);
  const [farmSaving, setFarmSaving] = useState(false);
  const [farmError, setFarmError] = useState<string | null>(null);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [subscriptionError, setSubscriptionError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [priceUpdatedAt, setPriceUpdatedAt] = useState<string | null>(null);
  const [weather, setWeather] = useState<WeatherSummary | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [weatherError, setWeatherError] = useState<string | null>(null);
  const [geoCoords, setGeoCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [geoStatus, setGeoStatus] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);

  const roleLabel = useMemo(() => {
    if (!user?.role) return "user";
    return user.role
      .split("_")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  }, [user]);

  const isProvider = user?.role === "service_provider" || user?.role === "input_supplier";
  const prices = marketIntel?.prices ?? [];
  const predictions = marketIntel?.predictions ?? [];
  const insights = marketIntel?.insights ?? [];
  const profileStatus = user?.verification_status ?? "unknown";

  const formatJson = (value: unknown, fallback: unknown) => {
    try {
      return JSON.stringify(value ?? fallback, null, 2);
    } catch {
      return JSON.stringify(fallback, null, 2);
    }
  };

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    const params = `?phone=${encodeURIComponent(user.phone)}`;
    const serviceQuery = isProvider ? params : "?limit=5";

    Promise.allSettled([
      api.marketListings(params),
      api.marketAlerts(params),
      api.marketServices(serviceQuery),
    ])
      .then(([listingRes, alertRes, serviceRes]) => {
        if (listingRes.status === "fulfilled") {
          setListings(listingRes.value.items as Listing[]);
        }
        if (alertRes.status === "fulfilled") {
          setAlerts(alertRes.value.items as Alert[]);
        }
        if (serviceRes.status === "fulfilled") {
          setServices(serviceRes.value.items as Service[]);
        }
      })
      .finally(() => setLoading(false));
  }, [user, isProvider]);

  useEffect(() => {
    if (!user) return;
    api.profileDetails()
      .then((res) => {
        const normalized = {
          ...res.settings,
          preferred_language: res.settings.preferred_language ?? "",
          district: res.settings.district ?? "",
          parish: res.settings.parish ?? "",
        } as Settings;
        setSettings(normalized);
        setSettingsDraft(normalized);
        setFarmDraft({
          cropsText: (res.farm.crops ?? []).join(", "),
          plantingDatesText: formatJson(res.farm.planting_dates ?? [], []),
          soilProfileText: formatJson(res.farm.soil_profile ?? {}, {}),
          climateExposureText: formatJson(res.farm.climate_exposure ?? {}, {}),
          yieldEstimatesText: formatJson(res.farm.yield_estimates ?? [], []),
        });
      })
      .catch(() => {
        setSettings(null);
        setSettingsDraft(null);
        setFarmDraft(null);
      });
  }, [user]);

  useEffect(() => {
    if (!user) return;
    api.subscription()
      .then((res) => setSubscription(res as Subscription))
      .catch((err) => {
        if (err?.status === 404) {
          setSubscription(null);
          return;
        }
        setSubscriptionError("Unable to load subscription.");
      });
  }, [user]);

  const loadMarketIntel = (refresh = false) => {
    if (!user) return;
    setMarketLoading(true);
    setMarketError(null);
    const params = new URLSearchParams();
    if (settings?.district) {
      params.set("district", settings.district);
    }
    if (refresh) {
      params.set("refresh", "true");
    }
    const query = params.toString() ? `?${params.toString()}` : "";
    api.marketIntel(query)
      .then((res) => {
        const intel = res as MarketIntel;
        setMarketIntel(intel);
        const updated = intel.updated_at ? new Date(intel.updated_at).toLocaleTimeString() : new Date().toLocaleTimeString();
        setPriceUpdatedAt(updated);
      })
      .catch(() => {
        setMarketError("Unable to load market intelligence.");
        setMarketIntel(null);
      })
      .finally(() => setMarketLoading(false));
  };

  useEffect(() => {
    if (!user) return;
    loadMarketIntel(true);
    const timer = setInterval(() => loadMarketIntel(false), 60000);
    return () => clearInterval(timer);
  }, [user, settings?.district]);

  useEffect(() => {
    if (!user) return;
    api.chatHistory(30)
      .then((res) => setChatMessages(res.items as ChatMessage[]))
      .catch(() => setChatMessages([]));
  }, [user]);

  useEffect(() => {
    if (!user) return;
    if (!geoCoords && !settings?.district && !settings?.parish) {
      setWeather(null);
      return;
    }
    setWeatherLoading(true);
    setWeatherError(null);
    const params = new URLSearchParams();
    if (geoCoords) {
      params.set("lat", geoCoords.lat.toString());
      params.set("lon", geoCoords.lon.toString());
    }
    const query = params.toString() ? `?${params.toString()}` : "";
    api.weatherSummary(query)
      .then((res) => setWeather(res as WeatherSummary))
      .catch(() => setWeatherError("Unable to load weather."))
      .finally(() => setWeatherLoading(false));
  }, [user, geoCoords, settings?.district, settings?.parish]);

  const handleSettingsChange = (field: keyof Settings, value: string | boolean) => {
    if (!settingsDraft) return;
    setSettingsDraft({ ...settingsDraft, [field]: value });
  };

  const handleSaveSettings = async () => {
    if (!settingsDraft) return;
    setSettingsSaving(true);
    try {
      const updated = (await api.updateSettings({
        preferred_language: settingsDraft.preferred_language,
        district: settingsDraft.district,
        parish: settingsDraft.parish,
        sms_opt_in: settingsDraft.sms_opt_in,
        voice_opt_in: settingsDraft.voice_opt_in,
        weather_alerts: settingsDraft.weather_alerts,
        price_alerts: settingsDraft.price_alerts,
      })) as Settings;
      setSettings(updated);
      setSettingsDraft({
        ...updated,
        preferred_language: updated.preferred_language ?? "",
        district: updated.district ?? "",
        parish: updated.parish ?? "",
      });
    } finally {
      setSettingsSaving(false);
    }
  };

  const handleFarmChange = (field: keyof FarmProfileDraft, value: string) => {
    if (!farmDraft) return;
    setFarmDraft({ ...farmDraft, [field]: value });
  };

  const handleSaveFarm = async () => {
    if (!farmDraft) return;
    setFarmSaving(true);
    setFarmError(null);
    try {
      const crops = farmDraft.cropsText
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);

      const parseJson = (text: string) => (text.trim() ? JSON.parse(text) : null);
      const plantingDates = parseJson(farmDraft.plantingDatesText) ?? [];
      const soilProfile = parseJson(farmDraft.soilProfileText) ?? {};
      const climateExposure = parseJson(farmDraft.climateExposureText) ?? {};
      const yieldEstimates = parseJson(farmDraft.yieldEstimatesText) ?? [];

      if (!Array.isArray(plantingDates)) {
        throw new Error("Planting dates must be a JSON array.");
      }
      if (Array.isArray(soilProfile) || typeof soilProfile !== "object") {
        throw new Error("Soil profile must be a JSON object.");
      }
      if (Array.isArray(climateExposure) || typeof climateExposure !== "object") {
        throw new Error("Climate exposure must be a JSON object.");
      }
      if (!Array.isArray(yieldEstimates)) {
        throw new Error("Yield estimates must be a JSON array.");
      }

      const res = (await api.updateProfileDetails({
        farm: {
          crops,
          planting_dates: plantingDates,
          soil_profile: soilProfile as Record<string, unknown>,
          climate_exposure: climateExposure as Record<string, unknown>,
          yield_estimates: yieldEstimates,
        },
      })) as {
        farm: {
          crops?: string[];
          planting_dates?: unknown[];
          soil_profile?: Record<string, unknown>;
          climate_exposure?: Record<string, unknown>;
          yield_estimates?: unknown[];
        };
      };

      setFarmDraft({
        cropsText: (res.farm.crops ?? []).join(", "),
        plantingDatesText: formatJson(res.farm.planting_dates ?? [], []),
        soilProfileText: formatJson(res.farm.soil_profile ?? {}, {}),
        climateExposureText: formatJson(res.farm.climate_exposure ?? {}, {}),
        yieldEstimatesText: formatJson(res.farm.yield_estimates ?? [], []),
      });
    } catch (err) {
      setFarmError(err instanceof Error ? err.message : "Unable to save profile.");
    } finally {
      setFarmSaving(false);
    }
  };

  const handleUseLocation = () => {
    if (!navigator.geolocation) {
      setGeoStatus("Geolocation is not supported on this device.");
      return;
    }
    setGeoStatus("Locating...");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeoCoords({ lat: pos.coords.latitude, lon: pos.coords.longitude });
        setGeoStatus("Location updated.");
      },
      () => {
        setGeoStatus("Unable to access location.");
      }
    );
  };

  const handleStartTrial = async () => {
    setSubscriptionError(null);
    try {
      const res = (await api.startSubscription({ plan: "basic", status: "trial" })) as Subscription;
      setSubscription(res);
    } catch {
      setSubscriptionError("Unable to start trial.");
    }
  };

  const handleChatSend = async () => {
    const message = chatInput.trim();
    if (!message) return;
    const tempId = Date.now();
    const now = new Date().toISOString();
    const locationHint = [settingsDraft?.parish, settingsDraft?.district].filter(Boolean).join(", ");
    const localeHint = settingsDraft?.preferred_language || undefined;
    setChatMessages((prev) => [...prev, { id: tempId, role: "user", message, created_at: now }]);
    setChatInput("");
    setChatSending(true);
    try {
      const response = await api.chatAsk({
        message,
        locale_hint: localeHint,
        location_hint: locationHint || undefined,
      });
      setChatMessages((prev) => [
        ...prev,
        { id: tempId + 1, role: "assistant", message: response.reply, created_at: new Date().toISOString() },
      ]);
    } catch {
      setChatMessages((prev) => [
        ...prev,
        { id: tempId + 1, role: "assistant", message: "GRIK is unavailable. Try again in a moment.", created_at: new Date().toISOString() },
      ]);
    } finally {
      setChatSending(false);
    }
  };

  if (!user) return null;

  return (
    <div className="dashboard-modern">
      <section className="panel hero-panel">
        <div className="label">AGRIK Core</div>
        <h2>{user.phone}</h2>
        <div className="pill-row">
          <span className="pill">{roleLabel}</span>
          <span className="pill">AI Advisory</span>
          <span className="pill">Weather + Soil</span>
        </div>
        <p className="muted">Your intelligence feed, alerts, and actions in one place.</p>
        <div className="stat-row">
          <div>
            <div className="stat-value">{alerts.length}</div>
            <div className="stat-label">Core alerts</div>
          </div>
          <div>
            <div className="stat-value">{prices.length}</div>
            <div className="stat-label">Prices tracked</div>
          </div>
          <div>
            <div className="stat-value">{listings.length}</div>
            <div className="stat-label">Listings</div>
          </div>
        </div>
      </section>

      <div className="dashboard-grid">
        <div className="dashboard-main">
          <section className="panel">
            <div className="panel-header">
              <div>
                <div className="label">Market intelligence</div>
                <h3>Realtime prices</h3>
              </div>
              <div className="panel-actions">
                <div className="panel-meta">Updated {priceUpdatedAt ?? "--"}</div>
                <button className="btn ghost small" onClick={() => loadMarketIntel(true)} disabled={marketLoading}>
                  {marketLoading ? "Refreshing..." : "Refresh feed"}
                </button>
              </div>
            </div>
            {marketError && <p className="status error">{marketError}</p>}
            {prices.length === 0 ? (
              <p>No prices published yet.</p>
            ) : (
              <ul className="list price-list">
                {prices.map((price) => (
                  <li key={price.id}>
                    <span>{price.crop} {price.district ?? price.market ?? ""}</span>
                    <strong>{price.currency ?? "UGX"}{price.price}</strong>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel">
            <div className="panel-header">
              <div>
                <div className="label">Price forecasts</div>
                <h3>AI-driven predictions</h3>
              </div>
            </div>
            {predictions.length === 0 ? (
              <p>No prediction signals yet. Connect a price feed or add listings.</p>
            ) : (
              <ul className="list prediction-list">
                {predictions.map((pred) => (
                  <li key={`${pred.crop}-${pred.district ?? "all"}`}>
                    <div className="prediction-item">
                      <div>
                        <div className="tile-title">{pred.crop}</div>
                        <div className="tile-meta">
                          {pred.district ? `${pred.district} • ` : ""}Next {pred.horizon_days} days · {pred.points} data points
                        </div>
                      </div>
                      <div className="prediction-metric">
                        <span className={`trend ${pred.direction}`}>{pred.direction}</span>
                        <strong>{pred.currency}{pred.predicted_price}</strong>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel">
            <div className="panel-header">
              <div>
                <div className="label">GRIK AI</div>
                <h3>Ask for guidance</h3>
              </div>
            </div>
            <div className="chip-row">
              {settings?.district && <span className="chip">Location: {settings.district}</span>}
              {weather?.next_rain_date && (
                <span className="chip">
                  Next rain: {new Date(weather.next_rain_date).toLocaleDateString()}
                </span>
              )}
              {predictions[0] && (
                <span className="chip">
                  Top trend: {predictions[0].crop} {predictions[0].direction}
                </span>
              )}
            </div>
            <div className="chat-messages">
              {chatMessages.length === 0 ? (
                <div className="muted">Ask about crop issues, pests, or recommended practices.</div>
              ) : (
                chatMessages.map((msg) => (
                  <div key={msg.id} className={`chat-bubble ${msg.role}`}>
                    <p>{msg.message}</p>
                  </div>
                ))
              )}
            </div>
            <div className="chat-input">
              <textarea
                placeholder="Ask GRIK about pests, fertilizer, or climate risk..."
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                rows={3}
              />
              <button className="btn" onClick={handleChatSend} disabled={chatSending}>
                {chatSending ? "Sending..." : "Send"}
              </button>
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">
              <div>
                <div className="label">Chroma feed</div>
                <h3>Market insights</h3>
              </div>
            </div>
            {insights.length === 0 ? (
              <p>No Chroma insights yet. Connect a collection to enrich market signals.</p>
            ) : (
              <ul className="list insight-list">
                {insights.map((insight, idx) => (
                  <li key={`${insight.title ?? "insight"}-${idx}`}>
                    <div className="tile-title">{insight.title ?? "Market signal"}</div>
                    <div className="tile-meta">
                      {insight.source ? `Source: ${insight.source}` : "Source: Chroma"} {insight.score ? `• ${insight.score}` : ""}
                    </div>
                    <p className="muted">{insight.summary}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel">
            <div className="panel-header">
              <div>
                <div className="label">Marketplace (add-on)</div>
                <h3>Listings</h3>
              </div>
              {loading && <div className="panel-meta">Loading...</div>}
            </div>
            {listings.length === 0 ? (
              <p>No listings yet. Create one via SMS: SELL MAIZE 200kg UGX1200 Lira.</p>
            ) : (
              <div className="grid">
                {listings.map((listing) => (
                  <div key={listing.id} className="tile">
                    <div className="tile-title">{listing.crop}</div>
                    <div className="tile-meta">{listing.role.toUpperCase()}</div>
                    <div className="tile-meta">
                      {listing.quantity ? `${listing.quantity} ${listing.unit ?? ""}` : ""}
                    </div>
                    <div className="tile-meta">
                      {listing.price ? `UGX${listing.price}` : ""}
                    </div>
                    <div className="tile-meta">{listing.location?.district ?? ""}</div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <div className="dashboard-side">
          <section className="panel">
            <div className="panel-header">
              <div>
                <div className="label">Weather</div>
                <h3>Local forecast</h3>
              </div>
              <div className="panel-actions">
                <button className="btn ghost small" onClick={handleUseLocation} disabled={geoStatus === "Locating..."}>
                  {geoStatus === "Locating..." ? "Locating..." : "Use my location"}
                </button>
              </div>
            </div>
            {geoStatus && <p className="status">{geoStatus}</p>}
            {weatherError && <p className="status error">{weatherError}</p>}
            {weatherLoading ? (
              <p>Loading forecast...</p>
            ) : weather ? (
              <div className="weather-summary">
                <div className="weather-location">{weather.location_name ?? "Your area"}</div>
                {weather.next_rain_date ? (
                  <div className="weather-highlight">
                    Next rain: {new Date(weather.next_rain_date).toLocaleDateString()}
                  </div>
                ) : (
                  <div className="muted">No heavy rain detected in the next few days.</div>
                )}
                <div className="weather-grid">
                  {weather.days.slice(0, 3).map((day) => (
                    <div key={day.date} className="weather-card">
                      <div className="weather-date">{new Date(day.date).toLocaleDateString()}</div>
                      <div className="weather-temp">
                        {day.temp_max_c != null ? Math.round(day.temp_max_c) : "--"}°
                        <span className="muted">
                          {" "}
                          / {day.temp_min_c != null ? Math.round(day.temp_min_c) : "--"}°
                        </span>
                      </div>
                      <div className="weather-meta">
                        {day.precipitation_mm != null ? `${day.precipitation_mm.toFixed(1)} mm` : "--"}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="weather-source muted">Source: {weather.data_source}</div>
              </div>
            ) : (
              <p>Add your district or use current location to see weather.</p>
            )}
          </section>

          <section className="panel">
            <div className="panel-header">
              <div>
                <div className="label">Subscription</div>
                <h3>Plan and access</h3>
              </div>
            </div>
            {subscription ? (
              <div className="subscription-card">
                <div className="subscription-plan">{subscription.plan}</div>
                <div className="subscription-status">{subscription.status}</div>
                <div className="muted">Ends {subscription.ends_at ? new Date(subscription.ends_at).toLocaleDateString() : "--"}</div>
              </div>
            ) : (
              <div className="subscription-card">
                <p>No active subscription.</p>
                <button className="btn" onClick={handleStartTrial}>Start free trial</button>
                {subscriptionError && <p className="status error">{subscriptionError}</p>}
              </div>
            )}
          </section>

          <section className="panel">
            <div className="panel-header">
              <div>
                <div className="label">Alerts</div>
                <h3>Core alerts</h3>
              </div>
            </div>
            {alerts.length === 0 ? (
              <p>No alerts yet. Create one: ALERT price MAIZE Lira 1200.</p>
            ) : (
              <ul className="list">
                {alerts.map((alert) => (
                  <li key={alert.id}>
                    {alert.alert_type.toUpperCase()} {alert.crop ? `- ${alert.crop}` : ""} {alert.threshold ?? ""} {alert.location?.district ?? ""}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel">
            <div className="panel-header">
              <div>
                <div className="label">Profile</div>
                <h3>Farm + identity</h3>
              </div>
            </div>
            {farmDraft ? (
              <div className="settings-grid">
                <div className="profile-meta">
                  <div className="profile-meta-row">
                    <span className="muted">Phone</span>
                    <strong>{user.phone}</strong>
                  </div>
                  <div className="profile-meta-row">
                    <span className="muted">Role</span>
                    <strong>{roleLabel}</strong>
                  </div>
                  <div className="profile-meta-row">
                    <span className="muted">Verification</span>
                    <strong>{profileStatus}</strong>
                  </div>
                </div>
                <label className="field">
                  Crops grown (comma separated)
                  <input
                    value={farmDraft.cropsText}
                    onChange={(e) => handleFarmChange("cropsText", e.target.value)}
                    placeholder="Maize, Cassava, Beans"
                  />
                </label>
                <label className="field">
                  Planting dates (JSON array)
                  <textarea
                    value={farmDraft.plantingDatesText}
                    onChange={(e) => handleFarmChange("plantingDatesText", e.target.value)}
                    rows={3}
                  />
                </label>
                <label className="field">
                  Soil profile (JSON object)
                  <textarea
                    value={farmDraft.soilProfileText}
                    onChange={(e) => handleFarmChange("soilProfileText", e.target.value)}
                    rows={3}
                  />
                </label>
                <label className="field">
                  Climate exposure (JSON object)
                  <textarea
                    value={farmDraft.climateExposureText}
                    onChange={(e) => handleFarmChange("climateExposureText", e.target.value)}
                    rows={3}
                  />
                </label>
                <label className="field">
                  Yield estimates (JSON array)
                  <textarea
                    value={farmDraft.yieldEstimatesText}
                    onChange={(e) => handleFarmChange("yieldEstimatesText", e.target.value)}
                    rows={3}
                  />
                </label>
                <button className="btn" onClick={handleSaveFarm} disabled={farmSaving}>
                  {farmSaving ? "Saving..." : "Save profile"}
                </button>
                {farmError && <p className="status error">{farmError}</p>}
              </div>
            ) : (
              <p>Profile unavailable.</p>
            )}
          </section>

          <section className="panel">
            <div className="panel-header">
              <div>
                <div className="label">Settings</div>
                <h3>Profile + channels</h3>
              </div>
            </div>
            {settingsDraft ? (
              <div className="settings-grid">
                <label className="field">
                  Preferred language
                  <input
                    value={settingsDraft.preferred_language ?? ""}
                    onChange={(e) => handleSettingsChange("preferred_language", e.target.value)}
                    placeholder="en"
                  />
                </label>
                <label className="field">
                  District
                  <input
                    value={settingsDraft.district ?? ""}
                    onChange={(e) => handleSettingsChange("district", e.target.value)}
                    placeholder="Lira"
                  />
                </label>
                <label className="field">
                  Parish
                  <input
                    value={settingsDraft.parish ?? ""}
                    onChange={(e) => handleSettingsChange("parish", e.target.value)}
                    placeholder="Oyam"
                  />
                </label>

                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={settingsDraft.sms_opt_in}
                    onChange={(e) => handleSettingsChange("sms_opt_in", e.target.checked)}
                  />
                  <span>SMS alerts</span>
                </label>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={settingsDraft.voice_opt_in}
                    onChange={(e) => handleSettingsChange("voice_opt_in", e.target.checked)}
                  />
                  <span>Voice alerts</span>
                </label>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={settingsDraft.weather_alerts}
                    onChange={(e) => handleSettingsChange("weather_alerts", e.target.checked)}
                  />
                  <span>Weather alerts</span>
                </label>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={settingsDraft.price_alerts}
                    onChange={(e) => handleSettingsChange("price_alerts", e.target.checked)}
                  />
                  <span>Price alerts</span>
                </label>

                <button className="btn" onClick={handleSaveSettings} disabled={settingsSaving}>
                  {settingsSaving ? "Saving..." : "Save settings"}
                </button>
              </div>
            ) : (
              <p>Settings unavailable.</p>
            )}
          </section>

          <section className="panel">
            <div className="panel-header">
              <div>
                <div className="label">Services (add-on)</div>
                <h3>{isProvider ? "My Services" : "Available services"}</h3>
              </div>
            </div>
            {services.length === 0 ? (
              <p>No services available yet.</p>
            ) : (
              <ul className="list">
                {services.map((service) => (
                  <li key={service.id}>
                    {service.service_type} {service.location?.district ?? ""} {service.price ? `UGX${service.price}` : ""}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
