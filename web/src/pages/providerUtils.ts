export type ProviderServiceListing = {
  id: number;
  userId: string;
  serviceType: string;
  description: string;
  coverageRadiusKm: number | null;
  price: number | null;
  currency: string;
  status: string;
  district: string;
  parish: string;
  mediaUrls: string[];
  createdAt: string;
  updatedAt: string;
};

export type ProviderLead = {
  id: number;
  crop: string;
  quantity: number | null;
  unit: string;
  price: number | null;
  currency: string;
  role: string;
  grade: string;
  description: string;
  contactName: string;
  contactPhone: string;
  contactWhatsapp: string;
  district: string;
  parish: string;
  mediaUrls: string[];
  status: string;
  createdAt: string;
};

export type ProviderOffer = {
  id: number;
  listingId: number;
  price: number | null;
  quantity: number | null;
  status: string;
  createdAt: string;
};

export function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return {};
}

export function toStringValue(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value == null) return "";
  return String(value).trim();
}

export function toNumberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const cleaned = value.replace(/,/g, "").trim();
    if (!cleaned) return null;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function toMediaUrlList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const item of value) {
    const text = toStringValue(item);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    urls.push(text);
  }
  return urls;
}

export function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  const seen = new Set<string>();
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

export function normalizeProviderService(raw: unknown): ProviderServiceListing | null {
  const row = asRecord(raw);
  const location = asRecord(row.location);
  const id = toNumberValue(row.id);
  if (id == null) return null;
  return {
    id,
    userId: toStringValue(row.user_id),
    serviceType: toStringValue(row.service_type),
    description: toStringValue(row.description),
    coverageRadiusKm: toNumberValue(row.coverage_radius_km),
    price: toNumberValue(row.price),
    currency: toStringValue(row.currency) || "UGX",
    status: toStringValue(row.status) || "open",
    district: toStringValue(location.district),
    parish: toStringValue(location.parish),
    mediaUrls: toMediaUrlList(row.media_urls),
    createdAt: toStringValue(row.created_at),
    updatedAt: toStringValue(row.updated_at) || toStringValue(row.created_at),
  };
}

export function normalizeProviderLead(raw: unknown): ProviderLead | null {
  const row = asRecord(raw);
  const location = asRecord(row.location);
  const id = toNumberValue(row.id);
  if (id == null) return null;
  return {
    id,
    crop: toStringValue(row.crop),
    quantity: toNumberValue(row.quantity),
    unit: toStringValue(row.unit),
    price: toNumberValue(row.price),
    currency: toStringValue(row.currency) || "UGX",
    role: toStringValue(row.role),
    grade: toStringValue(row.grade),
    description: toStringValue(row.description),
    contactName: toStringValue(row.contact_name),
    contactPhone: toStringValue(row.contact_phone),
    contactWhatsapp: toStringValue(row.contact_whatsapp),
    district: toStringValue(location.district),
    parish: toStringValue(location.parish),
    mediaUrls: toMediaUrlList(row.media_urls),
    status: toStringValue(row.status) || "open",
    createdAt: toStringValue(row.created_at),
  };
}

export function normalizeProviderOffer(raw: unknown): ProviderOffer | null {
  const row = asRecord(raw);
  const id = toNumberValue(row.id);
  const listingId = toNumberValue(row.listing_id);
  if (id == null || listingId == null) return null;
  return {
    id,
    listingId,
    price: toNumberValue(row.price),
    quantity: toNumberValue(row.quantity),
    status: toStringValue(row.status) || "open",
    createdAt: toStringValue(row.created_at),
  };
}

export function formatMoney(value: number, currency: string): string {
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

export function formatCompactDate(value: string): string {
  if (!value) return "--";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "--";
  return parsed.toLocaleDateString();
}

export function daysAgo(value: string): number | null {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  const diffMs = Date.now() - parsed.getTime();
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
}

export function average(values: number[]): number | null {
  if (values.length === 0) return null;
  const total = values.reduce((sum, item) => sum + item, 0);
  return total / values.length;
}

export function uniqueValues(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const text = toStringValue(value);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}
