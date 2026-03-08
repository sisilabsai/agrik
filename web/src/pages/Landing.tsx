import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Link } from "react-router-dom";
import { HeroFarmGraphic, Icon } from "../components/Visuals";
import { api } from "../lib/api";
import { asRecord, toNumberValue, toStringValue } from "../lib/marketplace";

type MarketSummary = {
  listings: number;
  offers: number;
  services: number;
  alerts: number;
};

type LandingOpsKpi = {
  label: string;
  value: number;
  unit: "%" | "count";
  delta: number;
  betterWhen: "higher" | "lower";
};

type LandingOpsZone = {
  name: string;
  readiness: number;
  alerts: number;
  updateMin: number;
};

type LandingOpsData = {
  labels: string[];
  listingActivity: number[];
  offerMomentum: number[];
  alertPressure: number[];
  priceSeries: number[];
  kpis: LandingOpsKpi[];
  zones: LandingOpsZone[];
};

type ListingLite = {
  id: number;
  createdAt: string;
  district: string;
  parish: string;
  crop: string;
  role: string;
};

type OfferLite = {
  id: number;
  listingId: number;
  createdAt: string;
};

type ServiceLite = {
  id: number;
  createdAt: string;
  district: string;
  parish: string;
};

type AlertLite = {
  id: number;
  createdAt: string;
  district: string;
  parish: string;
  alertType: string;
  active: boolean;
};

type PriceLite = {
  id: number;
  capturedAt: string;
  district: string;
  crop: string;
  price: number;
};

type UgandaLiveMapRoles = {
  total: number;
  farmers: number;
  buyers: number;
  offtakers: number;
  serviceProviders: number;
  inputSuppliers: number;
  admins: number;
};

type UgandaLiveMapMarker = {
  districtId: string;
  district: string;
  latitude: number;
  longitude: number;
  usersTotal: number;
  farmers: number;
  buyers: number;
  offtakers: number;
  serviceProviders: number;
  inputSuppliers: number;
  listings: number;
  offers: number;
  services: number;
  alerts: number;
  dominantRole: string;
  readiness: number;
  lastUpdatedAt: string;
};

type UgandaLiveMapData = {
  country: string;
  generatedAt: string;
  usersTotal: number;
  activeDistricts: number;
  districtsTotal: number;
  coordinateCoveragePct: number;
  roles: UgandaLiveMapRoles;
  markers: UgandaLiveMapMarker[];
};

type ChartPoint = {
  x: number;
  y: number;
};

const OPS_CHART_WIDTH = 620;
const OPS_CHART_HEIGHT = 250;
const OPS_CHART_PADDING_X = 22;
const OPS_CHART_PADDING_Y = 20;
const PRICE_CHART_WIDTH = 310;
const PRICE_CHART_HEIGHT = 130;
const PRICE_CHART_PADDING_X = 18;
const PRICE_CHART_PADDING_Y = 16;
const TOTAL_UGANDA_DISTRICTS = 135;
const UGANDA_CENTER: [number, number] = [1.3733, 32.2903];
const UGANDA_ZOOM = 6.5;

const LIVE_MAP_ROLE_COLORS: Record<string, string> = {
  farmer: "#68e09b",
  buyer: "#63b9ff",
  offtaker: "#f9b161",
  service_provider: "#b598ff",
  input_supplier: "#ff8ca8",
  other: "#d9dee9",
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function parseTimeMs(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toDayKey(ms: number): string {
  const date = new Date(ms);
  return date.toISOString().slice(0, 10);
}

function buildDayWindow(days: number): { keys: string[]; labels: string[] } {
  const keys: string[] = [];
  const labels: string[] = [];
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const day = new Date(now);
    day.setDate(now.getDate() - offset);
    keys.push(day.toISOString().slice(0, 10));
    labels.push(
      day.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      })
    );
  }
  return { keys, labels };
}

function countByDay<T>(rows: T[], keys: string[], getTimestamp: (row: T) => string): number[] {
  const counts = new Map<string, number>(keys.map((key) => [key, 0]));
  for (const row of rows) {
    const timestamp = getTimestamp(row);
    const ms = parseTimeMs(timestamp);
    if (ms == null) continue;
    const key = toDayKey(ms);
    if (!counts.has(key)) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return keys.map((key) => counts.get(key) ?? 0);
}

function normalizeSeries(values: number[]): number[] {
  const peak = Math.max(1, ...values);
  return values.map((value) => Math.round((value / peak) * 100));
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat().format(Math.round(value));
}

function toChartPoints(
  values: number[],
  minValue: number,
  maxValue: number,
  width: number,
  height: number,
  paddingX: number,
  paddingY: number
): ChartPoint[] {
  if (values.length === 0) return [];
  const usableWidth = width - paddingX * 2;
  const usableHeight = height - paddingY * 2;
  const valueRange = Math.max(1, maxValue - minValue);
  return values.map((value, index) => {
    const x = paddingX + (index / Math.max(1, values.length - 1)) * usableWidth;
    const ratio = clamp((value - minValue) / valueRange, 0, 1);
    const y = height - paddingY - ratio * usableHeight;
    return { x, y };
  });
}

function toLinePath(points: ChartPoint[]): string {
  if (points.length === 0) return "";
  return points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ");
}

function toAreaPath(points: ChartPoint[], baselineY: number): string {
  if (points.length === 0) return "";
  const line = toLinePath(points);
  const first = points[0];
  const last = points[points.length - 1];
  return `${line} L ${last.x.toFixed(2)} ${baselineY.toFixed(2)} L ${first.x.toFixed(2)} ${baselineY.toFixed(2)} Z`;
}

function kpiTone(kpi: LandingOpsKpi): "good" | "risk" | "flat" {
  if (Math.abs(kpi.delta) < 0.1) return "flat";
  const improving = kpi.betterWhen === "higher" ? kpi.delta > 0 : kpi.delta < 0;
  return improving ? "good" : "risk";
}

function formatKpiValue(kpi: LandingOpsKpi): string {
  if (kpi.unit === "%") return `${Math.round(kpi.value)}%`;
  return formatInteger(kpi.value);
}

function formatKpiDelta(kpi: LandingOpsKpi): string {
  if (Math.abs(kpi.delta) < 0.1) return kpi.unit === "%" ? "0.0 pts" : "0";
  const sign = kpi.delta > 0 ? "+" : "-";
  if (kpi.unit === "%") {
    return `${sign}${Math.abs(kpi.delta).toFixed(1)} pts`;
  }
  return `${sign}${formatInteger(Math.abs(kpi.delta))}`;
}

function normalizeListingLite(raw: unknown): ListingLite | null {
  const row = asRecord(raw);
  const id = toNumberValue(row.id);
  if (id == null) return null;
  const location = asRecord(row.location);
  return {
    id: Math.trunc(id),
    createdAt: toStringValue(row.created_at),
    district: toStringValue(location.district),
    parish: toStringValue(location.parish),
    crop: toStringValue(row.crop),
    role: toStringValue(row.role),
  };
}

function normalizeOfferLite(raw: unknown): OfferLite | null {
  const row = asRecord(raw);
  const id = toNumberValue(row.id);
  const listingId = toNumberValue(row.listing_id);
  if (id == null || listingId == null) return null;
  return {
    id: Math.trunc(id),
    listingId: Math.trunc(listingId),
    createdAt: toStringValue(row.created_at),
  };
}

function normalizeServiceLite(raw: unknown): ServiceLite | null {
  const row = asRecord(raw);
  const id = toNumberValue(row.id);
  if (id == null) return null;
  const location = asRecord(row.location);
  return {
    id: Math.trunc(id),
    createdAt: toStringValue(row.created_at),
    district: toStringValue(location.district),
    parish: toStringValue(location.parish),
  };
}

function normalizeAlertLite(raw: unknown): AlertLite | null {
  const row = asRecord(raw);
  const id = toNumberValue(row.id);
  if (id == null) return null;
  const location = asRecord(row.location);
  return {
    id: Math.trunc(id),
    createdAt: toStringValue(row.created_at),
    district: toStringValue(location.district),
    parish: toStringValue(location.parish),
    alertType: toStringValue(row.alert_type),
    active: row.active !== false,
  };
}

function normalizePriceLite(raw: unknown): PriceLite | null {
  const row = asRecord(raw);
  const id = toNumberValue(row.id);
  const price = toNumberValue(row.price);
  if (id == null || price == null) return null;
  return {
    id: Math.trunc(id),
    capturedAt: toStringValue(row.captured_at),
    district: toStringValue(row.district),
    crop: toStringValue(row.crop),
    price,
  };
}

function normalizeLiveMapMarker(raw: unknown): UgandaLiveMapMarker | null {
  const row = asRecord(raw);
  const district = toStringValue(row.district);
  const latitude = toNumberValue(row.latitude);
  const longitude = toNumberValue(row.longitude);
  if (!district || latitude == null || longitude == null) return null;
  return {
    districtId: toStringValue(row.district_id),
    district,
    latitude,
    longitude,
    usersTotal: Math.max(0, Math.round(toNumberValue(row.users_total) ?? 0)),
    farmers: Math.max(0, Math.round(toNumberValue(row.farmers) ?? 0)),
    buyers: Math.max(0, Math.round(toNumberValue(row.buyers) ?? 0)),
    offtakers: Math.max(0, Math.round(toNumberValue(row.offtakers) ?? 0)),
    serviceProviders: Math.max(0, Math.round(toNumberValue(row.service_providers) ?? 0)),
    inputSuppliers: Math.max(0, Math.round(toNumberValue(row.input_suppliers) ?? 0)),
    listings: Math.max(0, Math.round(toNumberValue(row.listings) ?? 0)),
    offers: Math.max(0, Math.round(toNumberValue(row.offers) ?? 0)),
    services: Math.max(0, Math.round(toNumberValue(row.services) ?? 0)),
    alerts: Math.max(0, Math.round(toNumberValue(row.alerts) ?? 0)),
    dominantRole: toStringValue(row.dominant_role) || "other",
    readiness: Math.max(0, Math.round(toNumberValue(row.readiness) ?? 0)),
    lastUpdatedAt: toStringValue(row.last_updated_at),
  };
}

function normalizeLiveMap(raw: unknown): UgandaLiveMapData | null {
  const row = asRecord(raw);
  const rolesRaw = asRecord(row.roles);
  const markersRaw = Array.isArray(row.markers) ? row.markers : [];
  const markers = markersRaw
    .map((item) => normalizeLiveMapMarker(item))
    .filter((item): item is UgandaLiveMapMarker => item != null);
  return {
    country: toStringValue(row.country) || "Uganda",
    generatedAt: toStringValue(row.generated_at),
    usersTotal: Math.max(0, Math.round(toNumberValue(row.users_total) ?? 0)),
    activeDistricts: Math.max(0, Math.round(toNumberValue(row.active_districts) ?? 0)),
    districtsTotal: Math.max(0, Math.round(toNumberValue(row.districts_total) ?? 0)),
    coordinateCoveragePct: Math.max(0, toNumberValue(row.coordinate_coverage_pct) ?? 0),
    roles: {
      total: Math.max(0, Math.round(toNumberValue(rolesRaw.total) ?? 0)),
      farmers: Math.max(0, Math.round(toNumberValue(rolesRaw.farmers) ?? 0)),
      buyers: Math.max(0, Math.round(toNumberValue(rolesRaw.buyers) ?? 0)),
      offtakers: Math.max(0, Math.round(toNumberValue(rolesRaw.offtakers) ?? 0)),
      serviceProviders: Math.max(0, Math.round(toNumberValue(rolesRaw.service_providers) ?? 0)),
      inputSuppliers: Math.max(0, Math.round(toNumberValue(rolesRaw.input_suppliers) ?? 0)),
      admins: Math.max(0, Math.round(toNumberValue(rolesRaw.admins) ?? 0)),
    },
    markers,
  };
}

function roleColor(role: string): string {
  const normalized = role.trim().toLowerCase();
  return LIVE_MAP_ROLE_COLORS[normalized] ?? LIVE_MAP_ROLE_COLORS.other;
}

function buildOpsData(
  summary: MarketSummary | null,
  listings: ListingLite[],
  offers: OfferLite[],
  services: ServiceLite[],
  alerts: AlertLite[],
  prices: PriceLite[]
): LandingOpsData {
  const { keys, labels } = buildDayWindow(12);
  const listingCounts = countByDay(listings, keys, (item) => item.createdAt);
  const offerCounts = countByDay(offers, keys, (item) => item.createdAt);
  const alertCounts = countByDay(alerts, keys, (item) => item.createdAt);
  const listingActivity = normalizeSeries(listingCounts);
  const offerMomentum = normalizeSeries(offerCounts);
  const alertPressure = normalizeSeries(alertCounts);

  const splitIndex = Math.floor(keys.length / 2);
  const previousKeys = new Set(keys.slice(0, splitIndex));
  const currentKeys = new Set(keys.slice(splitIndex));

  const previousListings = sum(listingCounts.slice(0, splitIndex));
  const currentListings = sum(listingCounts.slice(splitIndex));
  const previousOffers = sum(offerCounts.slice(0, splitIndex));
  const currentOffers = sum(offerCounts.slice(splitIndex));
  const previousAlerts = sum(alertCounts.slice(0, splitIndex));
  const currentAlerts = sum(alertCounts.slice(splitIndex));

  const currentOfferRate = currentListings > 0 ? (currentOffers / currentListings) * 100 : 0;
  const previousOfferRate = previousListings > 0 ? (previousOffers / previousListings) * 100 : 0;

  const listingDistrictById = new Map<number, string>();
  for (const listing of listings) {
    if (listing.district) {
      listingDistrictById.set(listing.id, listing.district);
    }
  }

  const allDistricts = new Set<string>();
  const previousDistricts = new Set<string>();
  const currentDistricts = new Set<string>();

  function trackDistrict(district: string, timestamp: string) {
    const normalizedDistrict = district.trim();
    if (!normalizedDistrict) return;
    allDistricts.add(normalizedDistrict);
    const ms = parseTimeMs(timestamp);
    if (ms == null) return;
    const dayKey = toDayKey(ms);
    if (currentKeys.has(dayKey)) currentDistricts.add(normalizedDistrict);
    if (previousKeys.has(dayKey)) previousDistricts.add(normalizedDistrict);
  }

  listings.forEach((item) => trackDistrict(item.district, item.createdAt));
  services.forEach((item) => trackDistrict(item.district, item.createdAt));
  alerts.forEach((item) => trackDistrict(item.district, item.createdAt));
  offers.forEach((item) => {
    const district = listingDistrictById.get(item.listingId) ?? "";
    trackDistrict(district, item.createdAt);
  });

  const coveragePct = (allDistricts.size / TOTAL_UGANDA_DISTRICTS) * 100;
  const previousCoveragePct = (previousDistricts.size / TOTAL_UGANDA_DISTRICTS) * 100;
  const currentCoveragePct = (currentDistricts.size / TOTAL_UGANDA_DISTRICTS) * 100;

  type DistrictStats = {
    district: string;
    listings: number;
    offers: number;
    services: number;
    alerts: number;
    latestAt: number;
  };

  const districtStats = new Map<string, DistrictStats>();

  function ensureDistrictStats(district: string): DistrictStats | null {
    const value = district.trim();
    if (!value) return null;
    const existing = districtStats.get(value);
    if (existing) return existing;
    const created: DistrictStats = {
      district: value,
      listings: 0,
      offers: 0,
      services: 0,
      alerts: 0,
      latestAt: 0,
    };
    districtStats.set(value, created);
    return created;
  }

  function touchLatest(stats: DistrictStats, timestamp: string) {
    const ms = parseTimeMs(timestamp);
    if (ms == null) return;
    stats.latestAt = Math.max(stats.latestAt, ms);
  }

  listings.forEach((item) => {
    const stats = ensureDistrictStats(item.district);
    if (!stats) return;
    stats.listings += 1;
    touchLatest(stats, item.createdAt);
  });

  services.forEach((item) => {
    const stats = ensureDistrictStats(item.district);
    if (!stats) return;
    stats.services += 1;
    touchLatest(stats, item.createdAt);
  });

  alerts.forEach((item) => {
    const stats = ensureDistrictStats(item.district);
    if (!stats) return;
    stats.alerts += 1;
    touchLatest(stats, item.createdAt);
  });

  offers.forEach((item) => {
    const district = listingDistrictById.get(item.listingId);
    if (!district) return;
    const stats = ensureDistrictStats(district);
    if (!stats) return;
    stats.offers += 1;
    touchLatest(stats, item.createdAt);
  });

  const nowMs = Date.now();
  const zones = [...districtStats.values()]
    .sort((left, right) => {
      const leftActivity = left.listings + left.offers + left.services + left.alerts;
      const rightActivity = right.listings + right.offers + right.services + right.alerts;
      if (rightActivity !== leftActivity) return rightActivity - leftActivity;
      return left.alerts - right.alerts;
    })
    .slice(0, 4)
    .map((stats) => {
      const readiness = clamp(
        Math.round(38 + stats.listings * 12 + stats.offers * 10 + stats.services * 9 - stats.alerts * 6),
        18,
        98
      );
      const updateMin = stats.latestAt > 0 ? Math.max(1, Math.round((nowMs - stats.latestAt) / 60000)) : 0;
      return {
        name: stats.district,
        readiness,
        alerts: stats.alerts,
        updateMin,
      };
    });

  if (zones.length === 0) {
    const fallbackDistricts = Array.from(new Set(prices.map((item) => item.district).filter((value) => value.trim().length > 0))).slice(0, 4);
    fallbackDistricts.forEach((district) => {
      zones.push({
        name: district,
        readiness: 60,
        alerts: 0,
        updateMin: 0,
      });
    });
  }

  const priceSeries = [...prices]
    .sort((left, right) => (parseTimeMs(left.capturedAt) ?? 0) - (parseTimeMs(right.capturedAt) ?? 0))
    .slice(-12)
    .map((item) => item.price);

  const totalListings = summary?.listings ?? listings.length;
  const totalAlerts = summary?.alerts ?? alerts.length;

  const kpis: LandingOpsKpi[] = [
    {
      label: "Open listings",
      value: totalListings,
      unit: "count",
      delta: currentListings - previousListings,
      betterWhen: "higher",
    },
    {
      label: "Offer response",
      value: currentOfferRate,
      unit: "%",
      delta: currentOfferRate - previousOfferRate,
      betterWhen: "higher",
    },
    {
      label: "Active alerts",
      value: totalAlerts,
      unit: "count",
      delta: currentAlerts - previousAlerts,
      betterWhen: "lower",
    },
    {
      label: "District coverage",
      value: coveragePct,
      unit: "%",
      delta: currentCoveragePct - previousCoveragePct,
      betterWhen: "higher",
    },
  ];

  return {
    labels,
    listingActivity,
    offerMomentum,
    alertPressure,
    priceSeries,
    kpis,
    zones,
  };
}

export default function Landing() {
  const [summary, setSummary] = useState<MarketSummary | null>(null);
  const [listings, setListings] = useState<ListingLite[]>([]);
  const [offers, setOffers] = useState<OfferLite[]>([]);
  const [services, setServices] = useState<ServiceLite[]>([]);
  const [alerts, setAlerts] = useState<AlertLite[]>([]);
  const [prices, setPrices] = useState<PriceLite[]>([]);
  const [liveMap, setLiveMap] = useState<UgandaLiveMapData | null>(null);

  const mapCanvasRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerLayerRef = useRef<L.LayerGroup | null>(null);
  const hasFittedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    Promise.allSettled([
      api.marketSummary(),
      api.marketListings("?status=open&limit=900"),
      api.marketOffers("?status=open&limit=900"),
      api.marketServices("?status=open&limit=700"),
      api.marketAlerts("?active_only=true"),
      api.marketPrices("?limit=300"),
      api.referenceUgandaLiveMap(),
    ])
      .then((results) => {
        if (cancelled) return;
        const [summaryRes, listingsRes, offersRes, servicesRes, alertsRes, pricesRes, liveMapRes] = results;

        if (summaryRes.status === "fulfilled") {
          setSummary(summaryRes.value);
        } else {
          setSummary(null);
        }

        if (listingsRes.status === "fulfilled") {
          const rows = (listingsRes.value.items ?? [])
            .map((item) => normalizeListingLite(item))
            .filter((item): item is ListingLite => item != null);
          setListings(rows);
        } else {
          setListings([]);
        }

        if (offersRes.status === "fulfilled") {
          const rows = (offersRes.value.items ?? [])
            .map((item) => normalizeOfferLite(item))
            .filter((item): item is OfferLite => item != null);
          setOffers(rows);
        } else {
          setOffers([]);
        }

        if (servicesRes.status === "fulfilled") {
          const rows = (servicesRes.value.items ?? [])
            .map((item) => normalizeServiceLite(item))
            .filter((item): item is ServiceLite => item != null);
          setServices(rows);
        } else {
          setServices([]);
        }

        if (alertsRes.status === "fulfilled") {
          const rows = (alertsRes.value.items ?? [])
            .map((item) => normalizeAlertLite(item))
            .filter((item): item is AlertLite => item != null)
            .filter((item) => item.active);
          setAlerts(rows);
        } else {
          setAlerts([]);
        }

        if (pricesRes.status === "fulfilled") {
          const rows = (pricesRes.value.items ?? [])
            .map((item) => normalizePriceLite(item))
            .filter((item): item is PriceLite => item != null);
          setPrices(rows);
        } else {
          setPrices([]);
        }

        if (liveMapRes.status === "fulfilled") {
          const data = normalizeLiveMap(liveMapRes.value);
          setLiveMap(data);
        } else {
          setLiveMap(null);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setSummary(null);
        setListings([]);
        setOffers([]);
        setServices([]);
        setAlerts([]);
        setPrices([]);
        setLiveMap(null);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!mapCanvasRef.current || mapRef.current) return;
    const map = L.map(mapCanvasRef.current, {
      zoomControl: false,
      scrollWheelZoom: false,
      dragging: true,
      attributionControl: false,
    }).setView(UGANDA_CENTER, UGANDA_ZOOM);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
      minZoom: 6,
      maxZoom: 9,
    }).addTo(map);

    L.control.zoom({ position: "bottomright" }).addTo(map);
    L.control.attribution({ position: "bottomleft", prefix: false })
      .addAttribution("&copy; OpenStreetMap")
      .addTo(map);

    const markerLayer = L.layerGroup().addTo(map);
    mapRef.current = map;
    markerLayerRef.current = markerLayer;

    return () => {
      map.remove();
      mapRef.current = null;
      markerLayerRef.current = null;
      hasFittedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!mapRef.current || !markerLayerRef.current) return;
    const layer = markerLayerRef.current;
    layer.clearLayers();

    const markers = (liveMap?.markers ?? []).filter(
      (item) => Number.isFinite(item.latitude) && Number.isFinite(item.longitude)
    );

    markers.forEach((item) => {
      const color = roleColor(item.dominantRole);
      const circle = L.circleMarker([item.latitude, item.longitude], {
        radius: clamp(7 + item.usersTotal * 0.45, 7, 22),
        fillColor: color,
        color: "rgba(255,255,255,0.86)",
        weight: 1.5,
        opacity: 1,
        fillOpacity: 0.88,
      });
      const popup = `
        <div class="map-popup">
          <strong>${item.district}</strong><br/>
          Users: ${formatInteger(item.usersTotal)}<br/>
          Farmers: ${formatInteger(item.farmers)}<br/>
          Other users: ${formatInteger(item.usersTotal - item.farmers)}<br/>
          Listings: ${formatInteger(item.listings)} | Offers: ${formatInteger(item.offers)}<br/>
          Services: ${formatInteger(item.services)} | Alerts: ${formatInteger(item.alerts)}<br/>
          Readiness: ${item.readiness}%
        </div>
      `;
      circle.bindPopup(popup);
      layer.addLayer(circle);
    });

    if (!hasFittedRef.current && markers.length > 0) {
      const bounds = L.latLngBounds(markers.map((item) => [item.latitude, item.longitude] as [number, number]));
      mapRef.current.fitBounds(bounds.pad(0.12), { maxZoom: 8.2 });
      hasFittedRef.current = true;
    }

    if (markers.length === 0 && mapRef.current) {
      mapRef.current.setView(UGANDA_CENTER, UGANDA_ZOOM);
    }
  }, [liveMap]);

  const resolvedSummary = useMemo(
    () =>
      summary ?? {
        listings: listings.length,
        offers: offers.length,
        services: services.length,
        alerts: alerts.length,
      },
    [summary, listings.length, offers.length, services.length, alerts.length]
  );

  const hasPulseData =
    resolvedSummary.listings + resolvedSummary.offers + resolvedSummary.services + resolvedSummary.alerts > 0;

  const opsData = useMemo(
    () => buildOpsData(summary, listings, offers, services, alerts, prices),
    [summary, listings, offers, services, alerts, prices]
  );

  const pulseTotal = useMemo(
    () => resolvedSummary.listings + resolvedSummary.offers + resolvedSummary.services + resolvedSummary.alerts,
    [resolvedSummary]
  );

  const priceSeriesForChart = useMemo(
    () => (opsData.priceSeries.length > 0 ? opsData.priceSeries : [0, 0]),
    [opsData.priceSeries]
  );
  const hasPriceData = opsData.priceSeries.length > 0;
  const priceMax = useMemo(() => Math.max(...priceSeriesForChart, 1200), [priceSeriesForChart]);
  const priceMin = useMemo(() => Math.min(...priceSeriesForChart, 700), [priceSeriesForChart]);

  const listingPoints = useMemo(
    () =>
      toChartPoints(
        opsData.listingActivity,
        0,
        100,
        OPS_CHART_WIDTH,
        OPS_CHART_HEIGHT,
        OPS_CHART_PADDING_X,
        OPS_CHART_PADDING_Y
      ),
    [opsData.listingActivity]
  );
  const offerPoints = useMemo(
    () =>
      toChartPoints(
        opsData.offerMomentum,
        0,
        100,
        OPS_CHART_WIDTH,
        OPS_CHART_HEIGHT,
        OPS_CHART_PADDING_X,
        OPS_CHART_PADDING_Y
      ),
    [opsData.offerMomentum]
  );
  const alertPoints = useMemo(
    () =>
      toChartPoints(
        opsData.alertPressure,
        0,
        100,
        OPS_CHART_WIDTH,
        OPS_CHART_HEIGHT,
        OPS_CHART_PADDING_X,
        OPS_CHART_PADDING_Y
      ),
    [opsData.alertPressure]
  );
  const pricePoints = useMemo(
    () =>
      toChartPoints(
        priceSeriesForChart,
        priceMin,
        priceMax,
        PRICE_CHART_WIDTH,
        PRICE_CHART_HEIGHT,
        PRICE_CHART_PADDING_X,
        PRICE_CHART_PADDING_Y
      ),
    [priceMax, priceMin, priceSeriesForChart]
  );

  const listingLinePath = useMemo(() => toLinePath(listingPoints), [listingPoints]);
  const alertLinePath = useMemo(() => toLinePath(alertPoints), [alertPoints]);
  const offerAreaPath = useMemo(
    () => toAreaPath(offerPoints, OPS_CHART_HEIGHT - OPS_CHART_PADDING_Y),
    [offerPoints]
  );
  const priceLinePath = useMemo(() => toLinePath(pricePoints), [pricePoints]);

  const latestPrice = hasPriceData ? opsData.priceSeries[opsData.priceSeries.length - 1] : null;
  const priceDelta = hasPriceData && opsData.priceSeries.length > 1 ? latestPrice! - opsData.priceSeries[0] : null;
  const liveMapMarkers = liveMap?.markers ?? [];
  const hasLiveMapData = liveMap != null;
  const liveMapRoles = liveMap?.roles ?? {
    total: 0,
    farmers: 0,
    buyers: 0,
    offtakers: 0,
    serviceProviders: 0,
    inputSuppliers: 0,
    admins: 0,
  };
  const liveMapCoverage = useMemo(() => {
    if (!liveMap) return 0;
    if (liveMap.districtsTotal <= 0) return 0;
    return Math.round((liveMap.activeDistricts / liveMap.districtsTotal) * 100);
  }, [liveMap]);
  const otherUsersCount = Math.max(0, liveMapRoles.total - liveMapRoles.farmers);
  const formattedMapUpdatedAt = useMemo(() => {
    if (!liveMap?.generatedAt) return "--";
    const parsed = new Date(liveMap.generatedAt);
    if (Number.isNaN(parsed.getTime())) return "--";
    return parsed.toLocaleString();
  }, [liveMap?.generatedAt]);

  return (
    <div className="landing landing-neo">
      <section className="landing-neo-hero">
        <div className="landing-neo-copy">
          <p className="eyebrow">Digital Extension Intelligence For The Farmers</p>
          <h1>AGRIK is field intelligence built For The Farmers.</h1>
          <p className="landing-neo-lead">
            Clear advisory, risk alerts, and finance-ready records across SMS, voice, and mobile.
          </p>
          <div className="landing-neo-cta">
            <Link className="btn" to="/auth">
              Start with advisory
            </Link>
            <Link className="btn ghost" to="/auth">
              Explore channels
            </Link>
            <Link className="btn ghost" to="/marketplace">
              View marketplace
            </Link>
          </div>

          <div className="landing-neo-trust-grid">
            <article className="landing-neo-trust-card">
              <span className="landing-neo-trust-icon">
                <Icon name="sms" size={18} />
              </span>
              <div>
                <strong>Any phone access</strong>
                <p>Works on basic phones with low data.</p>
              </div>
            </article>
            <article className="landing-neo-trust-card">
              <span className="landing-neo-trust-icon">
                <Icon name="climate" size={18} />
              </span>
              <div>
                <strong>Hyperlocal intelligence</strong>
                <p>Local weather and risk signals in every recommendation.</p>
              </div>
            </article>
            <article className="landing-neo-trust-card">
              <span className="landing-neo-trust-icon">
                <Icon name="finance" size={18} />
              </span>
              <div>
                <strong>Finance-ready records</strong>
                <p>Farm records that support insurance and credit.</p>
              </div>
            </article>
          </div>
        </div>

        <div className="landing-neo-visual">
          <div className="landing-neo-hero-art-wrap">
            <HeroFarmGraphic className="landing-neo-hero-art" />
            <div className="landing-neo-art-badges">
              <span>
                <Icon name="ai" size={14} /> AI advisory
              </span>
              <span>
                <Icon name="shield" size={14} /> Verified trust
              </span>
              <span>
                <Icon name="weather" size={14} /> Risk signals
              </span>
            </div>
          </div>

          <article className="landing-neo-float landing-neo-float-live">
            <div className="label">Live pulse</div>
            <strong>{hasPulseData ? pulseTotal : "--"}</strong>
            <span>Total market and alert events</span>
          </article>

          <article className="landing-neo-float landing-neo-float-channels">
            <div className="label">Delivery stack</div>
            <div className="landing-neo-channel-pills">
              <span>
                <Icon name="sms" size={13} /> SMS
              </span>
              <span>
                <Icon name="voice" size={13} /> Voice
              </span>
              <span>
                <Icon name="app" size={13} /> App
              </span>
              <span>
                <Icon name="dash" size={13} /> Dashboard
              </span>
            </div>
          </article>
        </div>
      </section>

      <section className="landing-neo-band">
        <article>
          <div className="label">Primary focus</div>
          <h3>Advisory first</h3>
          <p>Practical agronomy guidance before everything else.</p>
        </article>
        <article>
          <div className="label">Risk layer</div>
          <h3>Climate and pest signals</h3>
          <p>Early warnings reduce avoidable yield losses.</p>
        </article>
        <article>
          <div className="label">Trust layer</div>
          <h3>Insurance and credit readiness</h3>
          <p>Structured records build trust with lenders and insurers.</p>
        </article>
      </section>

      <section className="landing-neo-ops">
        <div className="landing-neo-ops-head">
          <p className="eyebrow">Live command center</p>
          <h2>Real marketplace and risk activity</h2>
          <p>These signals come directly from listings, offers, alerts, and market prices in the live API.</p>
        </div>

        <div className="landing-neo-ops-layout">
          <article className="landing-neo-ops-main">
            <div className="landing-neo-ops-kpi-grid">
              {opsData.kpis.map((kpi) => (
                <div key={kpi.label} className="landing-neo-ops-kpi">
                  <div className="landing-neo-ops-kpi-top">
                    <span>{kpi.label}</span>
                    <strong>{formatKpiValue(kpi)}</strong>
                  </div>
                  <div className={`landing-neo-ops-kpi-change tone-${kpiTone(kpi)}`}>{formatKpiDelta(kpi)}</div>
                </div>
              ))}
            </div>

            <div className="landing-neo-ops-chart-shell">
              <svg
                viewBox={`0 0 ${OPS_CHART_WIDTH} ${OPS_CHART_HEIGHT}`}
                className="landing-neo-ops-chart"
                role="img"
                aria-label="Live listing, offer, and alert trends"
              >
                <defs>
                  <linearGradient id="landing-offer-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="rgba(75, 172, 255, 0.38)" />
                    <stop offset="100%" stopColor="rgba(75, 172, 255, 0.02)" />
                  </linearGradient>
                </defs>

                <rect x="0" y="0" width={OPS_CHART_WIDTH} height={OPS_CHART_HEIGHT} rx="14" fill="rgba(7, 39, 24, 0.95)" />

                {[0, 1, 2, 3, 4].map((step) => {
                  const y = OPS_CHART_PADDING_Y + ((OPS_CHART_HEIGHT - OPS_CHART_PADDING_Y * 2) / 4) * step;
                  return (
                    <path
                      key={step}
                      d={`M ${OPS_CHART_PADDING_X} ${y} L ${OPS_CHART_WIDTH - OPS_CHART_PADDING_X} ${y}`}
                      stroke="rgba(235,245,238,0.12)"
                      strokeWidth="1"
                    />
                  );
                })}

                <path d={offerAreaPath} fill="url(#landing-offer-fill)" />
                <path d={listingLinePath} fill="none" stroke="#81f9bf" strokeWidth="3" strokeLinecap="round" />
                <path d={alertLinePath} fill="none" stroke="#f5ce92" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="7 6" />

                {listingPoints.map((point, index) => (
                  <circle key={`listing-${index}`} cx={point.x} cy={point.y} r="2.5" fill="#81f9bf" />
                ))}
              </svg>

              <div className="landing-neo-ops-legend">
                <span>
                  <i className="swatch advisory" /> Listing activity
                </span>
                <span>
                  <i className="swatch rainfall" /> Offer momentum
                </span>
                <span>
                  <i className="swatch risk" /> Alert pressure
                </span>
              </div>

              <div className="landing-neo-ops-labels">
                {opsData.labels.map((label) => (
                  <span key={label}>{label}</span>
                ))}
              </div>
            </div>
          </article>

          <aside className="landing-neo-ops-side">
            <article className="landing-neo-ops-side-card">
              <h3>District readiness</h3>
              <div className="landing-neo-zone-list">
                {opsData.zones.length === 0 ? (
                  <div className="landing-neo-zone-row">
                    <div className="landing-neo-zone-meta">
                      <strong>No district feed yet</strong>
                      <span>Seed market activity to populate district readiness.</span>
                    </div>
                  </div>
                ) : (
                  opsData.zones.map((zone) => (
                    <div key={zone.name} className="landing-neo-zone-row">
                      <div className="landing-neo-zone-meta">
                        <strong>{zone.name}</strong>
                        <span>
                          {zone.readiness}% readiness | {zone.alerts} alerts | updated{" "}
                          {zone.updateMin > 0 ? `${zone.updateMin}m ago` : "recently"}
                        </span>
                      </div>
                      <div className="landing-neo-zone-track">
                        <div className="landing-neo-zone-fill" style={{ width: `${zone.readiness}%` }} />
                      </div>
                    </div>
                  ))
                )}
              </div>
            </article>

            <article className="landing-neo-ops-side-card">
              <h3>Market price trend</h3>
              <svg
                viewBox={`0 0 ${PRICE_CHART_WIDTH} ${PRICE_CHART_HEIGHT}`}
                className="landing-neo-price-chart"
                role="img"
                aria-label="Live market price trend"
              >
                <rect x="0" y="0" width={PRICE_CHART_WIDTH} height={PRICE_CHART_HEIGHT} rx="12" fill="rgba(10, 45, 28, 0.94)" />
                <path d={priceLinePath} fill="none" stroke="#8bf9c6" strokeWidth="3" strokeLinecap="round" />
                {pricePoints.map((point, index) => (
                  <circle
                    key={`price-${index}`}
                    cx={point.x}
                    cy={point.y}
                    r={index === pricePoints.length - 1 ? 3.4 : 2.1}
                    fill="#e8fff3"
                  />
                ))}
              </svg>
              <div className="landing-neo-price-meta">
                <div>
                  <span>Latest</span>
                  <strong>{latestPrice != null ? `${formatInteger(latestPrice)} UGX/kg` : "--"}</strong>
                </div>
                <div>
                  <span>Trend</span>
                  <strong className={priceDelta == null ? "" : priceDelta >= 0 ? "up" : "down"}>
                    {priceDelta == null ? "--" : `${priceDelta >= 0 ? "+" : ""}${formatInteger(priceDelta)} UGX`}
                  </strong>
                </div>
              </div>
            </article>
          </aside>
        </div>
      </section>

      <section className="landing-neo-map">
        <div className="landing-neo-map-head">
          <p className="eyebrow">Realtime Uganda map</p>
          <h2>Live farmer and ecosystem footprint</h2>
          <p>
            District markers refresh from real user and marketplace records. Marker size reflects users; color reflects dominant role.
          </p>
        </div>

        <div className="landing-neo-map-layout">
          <article className="landing-neo-map-shell">
            <div ref={mapCanvasRef} className="landing-neo-map-canvas" aria-label="Uganda live user map" />
            <div className="landing-neo-map-note">
              Updated: <strong>{formattedMapUpdatedAt}</strong>
            </div>
          </article>

          <aside className="landing-neo-map-side">
            {!hasLiveMapData && (
              <p className="landing-neo-map-empty">
                Live map data is unavailable. Ensure the API is running with <code>/reference/uganda/live-map</code>.
              </p>
            )}
            <div className="landing-neo-map-kpis">
              <article>
                <span>Total users</span>
                <strong>{formatInteger(liveMapRoles.total)}</strong>
              </article>
              <article>
                <span>Farmers</span>
                <strong>{formatInteger(liveMapRoles.farmers)}</strong>
              </article>
              <article>
                <span>Other users</span>
                <strong>{formatInteger(otherUsersCount)}</strong>
              </article>
              <article>
                <span>District coverage</span>
                <strong>{liveMapCoverage}%</strong>
              </article>
            </div>

            <div className="landing-neo-map-legend">
              <h3>Role marker legend</h3>
              <div className="landing-neo-role-row">
                <i style={{ backgroundColor: LIVE_MAP_ROLE_COLORS.farmer }} />
                <span>Farmers</span>
                <strong>{formatInteger(liveMapRoles.farmers)}</strong>
              </div>
              <div className="landing-neo-role-row">
                <i style={{ backgroundColor: LIVE_MAP_ROLE_COLORS.buyer }} />
                <span>Buyers</span>
                <strong>{formatInteger(liveMapRoles.buyers)}</strong>
              </div>
              <div className="landing-neo-role-row">
                <i style={{ backgroundColor: LIVE_MAP_ROLE_COLORS.offtaker }} />
                <span>Offtakers</span>
                <strong>{formatInteger(liveMapRoles.offtakers)}</strong>
              </div>
              <div className="landing-neo-role-row">
                <i style={{ backgroundColor: LIVE_MAP_ROLE_COLORS.service_provider }} />
                <span>Service providers</span>
                <strong>{formatInteger(liveMapRoles.serviceProviders)}</strong>
              </div>
              <div className="landing-neo-role-row">
                <i style={{ backgroundColor: LIVE_MAP_ROLE_COLORS.input_supplier }} />
                <span>Input suppliers</span>
                <strong>{formatInteger(liveMapRoles.inputSuppliers)}</strong>
              </div>
            </div>

            <div className="landing-neo-map-meta">
              <span>Mapped districts: {formatInteger(liveMapMarkers.length)}</span>
              <span>Active districts: {formatInteger(liveMap?.activeDistricts ?? 0)}</span>
              <span>Coordinate coverage: {Math.round(liveMap?.coordinateCoveragePct ?? 0)}%</span>
            </div>
          </aside>
        </div>
      </section>

      <section className="landing-neo-final">
        <div className="section-title-with-icon">
          <span className="section-icon">
            <Icon name="spark" size={18} />
          </span>
          <div>
            <h2>Ready to launch advisory and risk intelligence?</h2>
            <p>Start with clear guidance and tools built For The Farmers.</p>
          </div>
        </div>
        <div className="landing-neo-final-actions">
          <Link className="btn" to="/auth">
            Create my account
          </Link>
          <Link className="btn ghost" to="/auth">
            Request partner demo
          </Link>
        </div>
      </section>
    </div>
  );
}
