export type MarketLocation = {
  district: string;
  parish: string;
};

export type MarketListingRecord = {
  id: number;
  userId: string;
  role: string;
  crop: string;
  quantity: number | null;
  unit: string;
  price: number | null;
  currency: string;
  grade: string;
  description: string;
  contactName: string;
  contactPhone: string;
  contactWhatsapp: string;
  contactUnlocked: boolean;
  status: string;
  mediaUrls: string[];
  createdAt: string;
  location: MarketLocation;
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

export function toBooleanValue(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return ["1", "true", "yes", "y", "on"].includes(normalized);
  }
  return false;
}

export function toMediaUrls(value: unknown): string[] {
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

export function normalizeListing(raw: unknown): MarketListingRecord | null {
  const row = asRecord(raw);
  const id = toNumberValue(row.id);
  if (id == null) return null;
  const location = asRecord(row.location);
  return {
    id,
    userId: toStringValue(row.user_id),
    role: toStringValue(row.role) || "seller",
    crop: toStringValue(row.crop),
    quantity: toNumberValue(row.quantity),
    unit: toStringValue(row.unit),
    price: toNumberValue(row.price),
    currency: toStringValue(row.currency) || "UGX",
    grade: toStringValue(row.grade),
    description: toStringValue(row.description),
    contactName: toStringValue(row.contact_name),
    contactPhone: toStringValue(row.contact_phone),
    contactWhatsapp: toStringValue(row.contact_whatsapp),
    contactUnlocked:
      toBooleanValue(row.contact_unlocked) ||
      !!(toStringValue(row.contact_phone) || toStringValue(row.contact_whatsapp) || toStringValue(row.contact_name)),
    status: toStringValue(row.status) || "open",
    mediaUrls: toMediaUrls(row.media_urls),
    createdAt: toStringValue(row.created_at),
    location: {
      district: toStringValue(location.district),
      parish: toStringValue(location.parish),
    },
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

export function formatDate(value: string): string {
  if (!value) return "--";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "--";
  return parsed.toLocaleDateString();
}

export function compactText(value: string, max = 120): string {
  const text = (value || "").trim();
  if (!text) return "";
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}...`;
}

export function listingLocationLabel(listing: MarketListingRecord): string {
  return [listing.location.parish, listing.location.district].filter(Boolean).join(", ") || "Location --";
}

export function listingContactName(listing: MarketListingRecord): string {
  if (listing.contactName) return listing.contactName;
  return listing.role === "buyer" ? "Buyer contact" : "Seller contact";
}

function sanitizePhone(phone: string): string {
  return toStringValue(phone);
}

function sanitizeDigits(phone: string): string {
  const raw = sanitizePhone(phone).replace(/\s+/g, "");
  if (!raw) return "";
  if (raw.startsWith("+")) return `+${raw.slice(1).replace(/[^\d]/g, "")}`;
  return raw.replace(/[^\d]/g, "");
}

export function buildTelHref(phone: string): string | null {
  const value = sanitizePhone(phone);
  if (!value) return null;
  return `tel:${value}`;
}

export function buildSmsHref(phone: string, body: string): string | null {
  const value = sanitizePhone(phone);
  if (!value) return null;
  const text = encodeURIComponent(body || "");
  return `sms:${value}${text ? `?body=${text}` : ""}`;
}

export function buildWhatsappHref(phone: string, message: string): string | null {
  const digits = sanitizeDigits(phone).replace(/^\+/, "");
  if (!digits) return null;
  const text = encodeURIComponent(message || "");
  return `https://wa.me/${digits}${text ? `?text=${text}` : ""}`;
}
