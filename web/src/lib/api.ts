export type ApiError = {
  status: number;
  detail: string;
};

export type VisionIssue = {
  name: string;
  category: string;
  confidence: number;
  evidence: string;
  recommended_action: string;
};

export type VisionModelRun = {
  model: string;
  quality_score: number;
  overall_assessment: string;
  top_labels: string[];
  likely_issues: VisionIssue[];
};

export type VisionAnalysis = {
  overall_assessment: string;
  likely_issues: VisionIssue[];
  immediate_actions: string[];
  field_checks: string[];
  media_count: number;
  model: string;
  selected_model_reason?: string | null;
  crop_hint?: string | null;
  deep_analysis?: boolean;
  top_labels?: string[] | null;
  per_image_notes?: string[] | null;
  model_runs?: VisionModelRun[] | null;
  raw_output?: string | null;
};

export type AuthUserOut = {
  id: string;
  phone: string;
  role: string;
  status: string;
  verification_status: string;
  created_at: string;
};

export type AuthRegisterPayload = {
  phone: string;
  password: string;
  role: string;
  full_name: string;
  district: string;
  parish: string;
  crops?: string[];
  organization_name?: string | null;
  service_categories?: string[];
  focus_crops?: string[];
};

export type AuthPhoneAvailabilityOut = {
  phone: string;
  normalized_phone: string;
  available: boolean;
};

export type UgandaDistrictOut = {
  id: string;
  name: string;
  parish_count: number;
};

export type UgandaParishOut = {
  id: string;
  name: string;
  subcounty?: string | null;
  district: string;
  district_id: string;
};

export type OnboardingRoleOptionOut = {
  id: string;
  label: string;
  description: string;
  required_fields: string[];
};

export type ServiceCategoryOptionOut = {
  id: string;
  label: string;
};

export type OnboardingOptionsOut = {
  roles: OnboardingRoleOptionOut[];
  service_categories: ServiceCategoryOptionOut[];
  crops: string[];
  default_role: string;
};

export type ChatAudioTranscriptionResponse = {
  transcript: string;
  language?: string | null;
  confidence?: number | null;
  model: string;
};

export type BinaryApiResponse = {
  blob: Blob;
  contentType: string;
};

const BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";
const REQUEST_TIMEOUT_MS = Number(import.meta.env.VITE_API_TIMEOUT_MS || 10000);
const CHAT_REQUEST_TIMEOUT_MS = Number(import.meta.env.VITE_CHAT_TIMEOUT_MS || 90000);
const TOKEN_KEY = "agrik_token";
const ADMIN_TOKEN_KEY = "agrik_admin_token";
const DEVICE_KEY = "agrik_device_id";
type RequestOptions = RequestInit & { timeoutMs?: number };

export function setToken(token: string | null) {
  if (!token) {
    localStorage.removeItem(TOKEN_KEY);
    return;
  }
  localStorage.setItem(TOKEN_KEY, token);
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setAdminToken(token: string | null) {
  if (!token) {
    localStorage.removeItem(ADMIN_TOKEN_KEY);
    return;
  }
  localStorage.setItem(ADMIN_TOKEN_KEY, token);
}

export function getAdminToken(): string | null {
  return localStorage.getItem(ADMIN_TOKEN_KEY);
}

function createDeviceId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `dev-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

export function getDeviceId(): string {
  const existing = localStorage.getItem(DEVICE_KEY);
  if (existing) {
    return existing;
  }
  const created = createDeviceId();
  localStorage.setItem(DEVICE_KEY, created);
  return created;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  return requestWithToken(path, options, getToken());
}

async function requestWithToken<T>(path: string, options: RequestOptions, token: string | null): Promise<T> {
  const { timeoutMs = REQUEST_TIMEOUT_MS, ...fetchOptions } = options;
  const headers = new Headers(fetchOptions.headers || {});
  headers.set("Content-Type", "application/json");
  headers.set("X-Device-ID", getDeviceId());
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const controller = new AbortController();
  const timeoutHandle = window.setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      ...fetchOptions,
      headers,
      signal: controller.signal,
    });
  } catch (err) {
    const detail =
      err instanceof DOMException && err.name === "AbortError"
        ? `Request timeout after ${timeoutMs}ms`
        : "Network error while contacting API";
    throw { status: 0, detail } as ApiError;
  } finally {
    window.clearTimeout(timeoutHandle);
  }

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const data = await response.json();
      detail = data.detail || detail;
    } catch {
      // ignore
    }
    throw { status: response.status, detail } as ApiError;
  }

  return (await response.json()) as T;
}

async function requestMultipartWithToken<T>(
  path: string,
  payload: FormData,
  timeoutMs: number,
  token: string | null
): Promise<T> {
  const headers = new Headers();
  headers.set("X-Device-ID", getDeviceId());
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const controller = new AbortController();
  const timeoutHandle = window.setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers,
      body: payload,
      signal: controller.signal,
    });
  } catch (err) {
    const detail =
      err instanceof DOMException && err.name === "AbortError"
        ? `Request timeout after ${timeoutMs}ms`
        : "Network error while contacting API";
    throw { status: 0, detail } as ApiError;
  } finally {
    window.clearTimeout(timeoutHandle);
  }

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const data = await response.json();
      detail = data.detail || detail;
    } catch {
      // ignore
    }
    throw { status: response.status, detail } as ApiError;
  }

  return (await response.json()) as T;
}

async function requestBinaryWithToken(
  path: string,
  options: RequestOptions,
  token: string | null
): Promise<BinaryApiResponse> {
  const { timeoutMs = REQUEST_TIMEOUT_MS, ...fetchOptions } = options;
  const headers = new Headers(fetchOptions.headers || {});
  headers.set("Content-Type", "application/json");
  headers.set("X-Device-ID", getDeviceId());
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const controller = new AbortController();
  const timeoutHandle = window.setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      ...fetchOptions,
      headers,
      signal: controller.signal,
    });
  } catch (err) {
    const detail =
      err instanceof DOMException && err.name === "AbortError"
        ? `Request timeout after ${timeoutMs}ms`
        : "Network error while contacting API";
    throw { status: 0, detail } as ApiError;
  } finally {
    window.clearTimeout(timeoutHandle);
  }

  if (!response.ok) {
    let detail = response.statusText;
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      try {
        const data = (await response.json()) as { detail?: string };
        detail = data.detail || detail;
      } catch {
        // ignore
      }
    } else {
      try {
        const text = await response.text();
        if (text.trim()) detail = text.trim();
      } catch {
        // ignore
      }
    }
    throw { status: response.status, detail } as ApiError;
  }

  const blob = await response.blob();
  return {
    blob,
    contentType: response.headers.get("content-type") || blob.type || "application/octet-stream",
  };
}

async function adminRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  return requestWithToken(path, options, getAdminToken());
}

export const api = {
  health: () => request<{ status: string }>("/health"),
  authRegister: (payload: AuthRegisterPayload) =>
    request<{ status: string; token?: string; user?: AuthUserOut }>("/auth/register", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  authPhoneAvailability: (phone: string) =>
    request<AuthPhoneAvailabilityOut>(`/auth/phone-availability?phone=${encodeURIComponent(phone)}`),
  authLogin: (payload: { phone: string; password?: string | null }) =>
    request<{ status: string; token?: string; user?: AuthUserOut }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({
        ...payload,
        device_id: getDeviceId(),
      }),
    }),
  authVerify: (payload: { phone: string; code: string }) =>
    request<{ token: string; user: AuthUserOut }>(
      "/auth/verify-otp",
      {
      method: "POST",
      body: JSON.stringify({
        ...payload,
        device_id: getDeviceId(),
      }),
      }
    ),
  authMe: () => request<AuthUserOut>("/auth/me"),
  referenceDistricts: () =>
    request<{ country: string; total: number; items: UgandaDistrictOut[] }>("/reference/uganda/districts"),
  referenceParishes: (district?: string) => {
    const query = district?.trim() ? `?district=${encodeURIComponent(district)}` : "";
    return request<{ country: string; district?: string | null; total: number; items: UgandaParishOut[] }>(
      `/reference/uganda/parishes${query}`
    );
  },
  referenceUgandaLiveMap: () =>
    request<{
      country: string;
      generated_at: string;
      users_total: number;
      active_districts: number;
      districts_total: number;
      coordinate_coverage_pct: number;
      roles: {
        total: number;
        farmers: number;
        buyers: number;
        offtakers: number;
        service_providers: number;
        input_suppliers: number;
        admins: number;
      };
      markers: {
        district_id?: string | null;
        district: string;
        latitude: number;
        longitude: number;
        users_total: number;
        farmers: number;
        buyers: number;
        offtakers: number;
        service_providers: number;
        input_suppliers: number;
        listings: number;
        offers: number;
        services: number;
        alerts: number;
        dominant_role: string;
        readiness: number;
        last_updated_at?: string | null;
      }[];
    }>("/reference/uganda/live-map"),
  onboardingOptions: () => request<OnboardingOptionsOut>("/reference/onboarding/options"),
  adminLogin: (payload: { email: string; password: string }) =>
    request<{
      status: string;
      token?: string;
      admin?: {
        id: string;
        email: string;
        status: string;
        verification_status: string;
        created_at: string;
      };
    }>("/admin/login", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  adminVerify: (payload: { email: string; code: string }) =>
    request<{ token: string; admin: { id: string; email: string; status: string; verification_status: string; created_at: string } }>(
      "/admin/verify-otp",
      {
        method: "POST",
        body: JSON.stringify(payload),
      }
    ),
  adminMe: () =>
    adminRequest<{ id: string; email: string; status: string; verification_status: string; created_at: string }>("/admin/me"),
  marketSummary: () => request<{ listings: number; offers: number; services: number; alerts: number }>("/market/summary"),
  marketListings: (query = "") => request<{ items: unknown[] }>(`/market/listings${query}`),
  marketListingById: (listingId: number) => request<unknown>(`/market/listings/${listingId}`),
  marketCreateListing: (payload: {
    phone: string;
    role: "seller" | "buyer";
    crop: string;
    quantity?: number;
    unit?: string;
    price?: number;
    currency?: string;
    grade?: string;
    description?: string;
    contact_name?: string;
    contact_phone?: string;
    contact_whatsapp?: string;
    media_urls?: string[];
    availability_start?: string;
    availability_end?: string;
    status?: string;
    location?: {
      district?: string;
      parish?: string;
      latitude?: number;
      longitude?: number;
      geometry_wkt?: string;
    };
  }) =>
    request("/market/listings", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  marketCreateOffer: (payload: {
    phone: string;
    listing_id: number;
    price?: number;
    quantity?: number;
  }) =>
    request("/market/offers", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  marketOffers: (query = "") => request<{ items: unknown[] }>(`/market/offers${query}`),
  marketUploadMedia: (payload: { files: File[] }) => {
    const formData = new FormData();
    for (const file of payload.files) {
      formData.append("files", file, file.name);
    }
    return requestMultipartWithToken<{
      items: { filename: string; url: string; content_type: string; size_bytes: number }[];
    }>("/market/media/upload", formData, CHAT_REQUEST_TIMEOUT_MS, getToken());
  },
  marketServices: (query = "") => request<{ items: unknown[] }>(`/market/services${query}`),
  marketCreateService: (payload: {
    phone: string;
    service_type: string;
    description?: string;
    media_urls?: string[];
    coverage_radius_km?: number;
    price?: number;
    currency?: string;
    status?: string;
    location?: {
      district?: string;
      parish?: string;
      latitude?: number;
      longitude?: number;
      geometry_wkt?: string;
    };
  }) =>
    request("/market/services", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  marketUpdateService: (
    serviceId: number,
    payload: {
      service_type?: string | null;
      description?: string | null;
      media_urls?: string[] | null;
      coverage_radius_km?: number | null;
      price?: number | null;
      currency?: string | null;
      status?: string | null;
      location?:
        | {
            district?: string | null;
            parish?: string | null;
            latitude?: number | null;
            longitude?: number | null;
            geometry_wkt?: string | null;
          }
        | null;
    }
  ) =>
    request(`/market/services/${serviceId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  marketDeleteService: (serviceId: number) =>
    request(`/market/services/${serviceId}`, {
      method: "DELETE",
    }),
  marketPrices: (query = "") => request<{ items: unknown[] }>(`/market/prices${query}`),
  marketIntel: (query = "") =>
    request<{
      prices: unknown[];
      predictions: unknown[];
      insights: unknown[];
      updated_at?: string | null;
      source?: string | null;
    }>(`/market/intel${query}`),
  marketAlerts: (query = "") => request<{ items: unknown[] }>(`/market/alerts${query}`),
  userSettings: () =>
    request<{
      user_id: string;
      preferred_language?: string | null;
      district?: string | null;
      parish?: string | null;
      sms_opt_in: boolean;
      voice_opt_in: boolean;
      weather_alerts: boolean;
      price_alerts: boolean;
      updated_at?: string | null;
    }>("/profile/settings"),
  updateSettings: (payload: {
    preferred_language?: string | null;
    district?: string | null;
    parish?: string | null;
    sms_opt_in?: boolean;
    voice_opt_in?: boolean;
    weather_alerts?: boolean;
    price_alerts?: boolean;
  }) =>
    request("/profile/settings", {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  profileDetails: () =>
    request<{
      user: { id: string; phone: string; role: string; status: string; verification_status: string; created_at: string };
      settings: {
        user_id: string;
        preferred_language?: string | null;
        district?: string | null;
        parish?: string | null;
        sms_opt_in: boolean;
        voice_opt_in: boolean;
        weather_alerts: boolean;
        price_alerts: boolean;
        updated_at?: string | null;
      };
      farm: {
        farmer_id: string;
        crops: string[];
        planting_dates: unknown[];
        soil_profile: Record<string, unknown>;
        climate_exposure: Record<string, unknown>;
        yield_estimates: unknown[];
        updated_at?: string | null;
      };
      identity?: {
        user_id: string;
        full_name: string;
        district: string;
        parish: string;
        crops: string[];
        organization_name?: string | null;
        service_categories: string[];
        focus_crops: string[];
        onboarding_stage: string;
        updated_at?: string | null;
      } | null;
    }>("/profile/details"),
  updateProfileDetails: (payload: {
    settings?: {
      preferred_language?: string | null;
      district?: string | null;
      parish?: string | null;
      sms_opt_in?: boolean;
      voice_opt_in?: boolean;
      weather_alerts?: boolean;
      price_alerts?: boolean;
    };
    farm?: {
      crops?: string[];
      planting_dates?: unknown[];
      soil_profile?: Record<string, unknown>;
      climate_exposure?: Record<string, unknown>;
      yield_estimates?: unknown[];
    };
  }) =>
    request("/profile/details", {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  subscription: () =>
    request<{
      id: number;
      plan: string;
      status: string;
      starts_at: string;
      ends_at?: string | null;
      provider?: string | null;
      external_ref?: string | null;
    }>("/profile/subscription"),
  subscriptionHistory: (limit = 50) =>
    request<
      {
        id: number;
        plan: string;
        status: string;
        starts_at: string;
        ends_at?: string | null;
        provider?: string | null;
        external_ref?: string | null;
      }[]
    >(`/profile/subscriptions?limit=${limit}`),
  startSubscription: (payload: {
    plan: string;
    status?: string;
    ends_at?: string | null;
    provider?: string | null;
    external_ref?: string | null;
  }) =>
    request("/profile/subscription", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  platformServices: (query = "") =>
    request<
      {
        id: number;
        service_type: string;
        description?: string | null;
        price?: number | null;
        currency?: string | null;
        status: string;
        created_at: string;
        updated_at?: string | null;
      }[]
    >(`/profile/platform-services${query}`),
  chatHistory: (limit = 30) => request<{ items: { id: number; role: string; message: string; created_at: string }[] }>(`/chat/history?limit=${limit}`),
  chatAsk: (payload: { message: string; locale_hint?: string; location_hint?: string }) =>
    request<{
      reply: string;
      language: string;
      sources?: string[];
      citations?: { source_id?: string | null; title?: string | null; page?: string | null; file?: string | null; url?: string | null }[];
      source_confidence?: number;
      citation_text?: string;
      follow_ups?: string[];
      media_analysis?: VisionAnalysis;
    }>(
      "/chat/ask",
      {
        method: "POST",
        body: JSON.stringify(payload),
        timeoutMs: CHAT_REQUEST_TIMEOUT_MS,
      }
    ),
  chatAskMultimodal: (payload: {
    message: string;
    locale_hint?: string;
    location_hint?: string;
    crop_hint?: string;
    model_preference?: string;
    deep_analysis?: boolean;
    files: File[];
  }) => {
    const formData = new FormData();
    formData.append("message", payload.message);
    if (payload.locale_hint) {
      formData.append("locale_hint", payload.locale_hint);
    }
    if (payload.location_hint) {
      formData.append("location_hint", payload.location_hint);
    }
    if (payload.crop_hint) {
      formData.append("crop_hint", payload.crop_hint);
    }
    if (payload.model_preference) {
      formData.append("model_preference", payload.model_preference);
    }
    formData.append("deep_analysis", payload.deep_analysis ? "true" : "false");
    for (const file of payload.files) {
      formData.append("files", file, file.name);
    }

    return requestMultipartWithToken<{
      reply: string;
      language: string;
      sources?: string[];
      citations?: { source_id?: string | null; title?: string | null; page?: string | null; file?: string | null; url?: string | null }[];
      source_confidence?: number;
      citation_text?: string;
      follow_ups?: string[];
      media_analysis?: VisionAnalysis;
    }>("/chat/ask-multimodal", formData, CHAT_REQUEST_TIMEOUT_MS, getToken());
  },
  chatTranscribeAudio: (payload: { file: File; locale_hint?: string }) => {
    const formData = new FormData();
    formData.append("audio", payload.file, payload.file.name || "audio-upload");
    if (payload.locale_hint) {
      formData.append("locale_hint", payload.locale_hint);
    }
    return requestMultipartWithToken<ChatAudioTranscriptionResponse>(
      "/chat/transcribe-audio",
      formData,
      CHAT_REQUEST_TIMEOUT_MS,
      getToken()
    );
  },
  chatSynthesizeAudio: (payload: { text: string; locale_hint?: string; voice_hint?: string }) =>
    requestBinaryWithToken(
      "/chat/synthesize-audio",
      {
        method: "POST",
        body: JSON.stringify(payload),
        timeoutMs: CHAT_REQUEST_TIMEOUT_MS,
      },
      getToken()
    ),
  visionOptions: () =>
    request<{
      models: { id: string; label: string; tip: string }[];
      crops: string[];
    }>("/chat/vision/options"),
  weatherSummary: (query = "") =>
    request<{
      location_name?: string | null;
      latitude?: number | null;
      longitude?: number | null;
      next_rain_date?: string | null;
      days: { date: string; precipitation_mm?: number | null; temp_max_c?: number | null; temp_min_c?: number | null }[];
      data_source: string;
    }>(`/weather/summary${query}`),
  adminSummary: () =>
    adminRequest<{
      users_total: number;
      users_verified: number;
      users_pending: number;
      listings: number;
      offers: number;
      services: number;
      alerts: number;
      prices: number;
    }>("/admin/summary"),
  adminUsers: (query = "") =>
    adminRequest<
      {
        id: string;
        phone: string;
        role: string;
        status: string;
        verification_status: string;
        full_name?: string | null;
        email?: string | null;
        district?: string | null;
        parish?: string | null;
        organization_name?: string | null;
        onboarding_stage?: string | null;
        crops?: string[];
        service_categories?: string[];
        focus_crops?: string[];
        market_listings?: number;
        market_alerts?: number;
        market_offers?: number;
        chat_messages?: number;
        last_chat_at?: string | null;
        recent_activity?: { action: string; created_at: string; detail_summary?: string | null }[];
        created_at: string;
        updated_at?: string | null;
        last_login_at?: string | null;
      }[]
    >(`/admin/users${query}`),
  adminUpdateUser: (userId: string, payload: { role?: string; status?: string; verification_status?: string }) =>
    adminRequest(`/admin/users/${userId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  adminListings: (query = "") => adminRequest<{ items: unknown[] }>(`/admin/listings${query}`),
  adminUpdateListing: (
    listingId: number,
    payload: { status?: string; price?: number | null; quantity?: number | null; unit?: string | null; currency?: string | null; grade?: string | null }
  ) =>
    adminRequest(`/admin/listings/${listingId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  adminAlerts: (query = "") => adminRequest<{ items: unknown[] }>(`/admin/alerts${query}`),
  adminCreateAlert: (payload: {
    phone: string;
    alert_type: string;
    crop?: string | null;
    threshold?: number | null;
    channel?: string | null;
    active?: boolean | null;
    min_interval_hours?: number | null;
    location?: { district?: string | null; parish?: string | null };
  }) =>
    adminRequest(`/admin/alerts`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  adminCreateAlertBulk: (payload: {
    phones: string[];
    alert_type: string;
    crop?: string | null;
    threshold?: number | null;
    channel?: string | null;
    active?: boolean | null;
    min_interval_hours?: number | null;
    location?: { district?: string | null; parish?: string | null };
  }) =>
    adminRequest(`/admin/alerts/bulk`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  adminUpdateAlert: (
    alertId: number,
    payload: {
      alert_type?: string | null;
      crop?: string | null;
      threshold?: number | null;
      channel?: string | null;
      active?: boolean | null;
      min_interval_hours?: number | null;
      location?: { district?: string | null; parish?: string | null };
    }
  ) =>
    adminRequest(`/admin/alerts/${alertId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  adminDeleteAlert: (alertId: number) =>
    adminRequest(`/admin/alerts/${alertId}`, {
      method: "DELETE",
    }),
  adminPrices: (query = "") => adminRequest<{ items: unknown[] }>(`/admin/prices${query}`),
  adminCreatePrice: (payload: {
    crop: string;
    market?: string | null;
    district?: string | null;
    price: number;
    currency?: string | null;
    source?: string | null;
    captured_at?: string | null;
  }) =>
    adminRequest("/admin/prices", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  adminUpdatePrice: (
    priceId: number,
    payload: {
      crop?: string | null;
      market?: string | null;
      district?: string | null;
      price?: number | null;
      currency?: string | null;
      source?: string | null;
      captured_at?: string | null;
    }
  ) =>
    adminRequest(`/admin/prices/${priceId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  adminServices: (query = "") => adminRequest<{ items: unknown[] }>(`/admin/services${query}`),
  adminCreateService: (payload: {
    service_type: string;
    description?: string | null;
    price?: number | null;
    currency?: string | null;
    status?: string | null;
  }) =>
    adminRequest(`/admin/services`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  adminUpdateService: (
    serviceId: number,
    payload: {
      service_type?: string | null;
      description?: string | null;
      price?: number | null;
      currency?: string | null;
      status?: string | null;
    }
  ) =>
    adminRequest(`/admin/services/${serviceId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  adminDeleteService: (serviceId: number) =>
    adminRequest(`/admin/services/${serviceId}`, {
      method: "DELETE",
    }),
  adminSeedServices: (payload: { service_types?: string[] | null }) =>
    adminRequest<{ created: number }>(`/admin/services/seed`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  adminMetadata: () =>
    adminRequest<{
      crops: string[];
      districts: string[];
      parishes: string[];
      markets: string[];
      currencies: string[];
      price_sources: string[];
      service_types: string[];
      alert_types: string[];
      channels: string[];
      users: { id: string; phone: string; role: string }[];
    }>("/admin/metadata"),
  adminActivity: (query = "") =>
    adminRequest<{ items: { id: number; admin_id: string; action: string; details: Record<string, unknown>; ip_address?: string | null; created_at: string }[] }>(
      `/admin/activity${query}`
    ),
};
