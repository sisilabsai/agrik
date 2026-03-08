import { useEffect, useMemo, useState } from "react";
import { Icon } from "../components/Visuals";
import { api } from "../lib/api";

type ProfileDetails = {
  settings: {
    preferred_language?: string | null;
    district?: string | null;
    parish?: string | null;
    sms_opt_in: boolean;
    voice_opt_in: boolean;
    weather_alerts: boolean;
    price_alerts: boolean;
  };
  farm: {
    crops: string[];
    planting_dates: unknown[];
    soil_profile: Record<string, unknown>;
    climate_exposure: Record<string, unknown>;
    yield_estimates: unknown[];
  };
};

type SettingsForm = {
  preferredLanguage: string;
  district: string;
  parish: string;
  smsOptIn: boolean;
  voiceOptIn: boolean;
  weatherAlerts: boolean;
  priceAlerts: boolean;
};

type FarmFinance = {
  currency: string;
  plannedInputCost: string;
  plannedLaborCost: string;
  plannedLogisticsCost: string;
  plannedOtherCost: string;
  loanPrincipal: string;
  loanInterestPct: string;
  expectedInstallment: string;
  currentCashOnHand: string;
  savingsTarget: string;
  notes: string;
};

type FarmInsurance = {
  enrolled: boolean;
  provider: string;
  productType: string;
  policyNumber: string;
  coverageAmount: string;
  premiumAmount: string;
  startDate: string;
  endDate: string;
  claimStatus: string;
  lastClaimAmount: string;
  lastClaimDate: string;
  triggerModel: string;
};

type FarmExpectations = {
  seasonLabel: string;
  targetYieldKg: string;
  expectedPricePerKg: string;
  projectedRevenue: string;
  targetHarvestDate: string;
  plantingWindowStart: string;
  plantingWindowEnd: string;
  confidencePct: string;
  buyerPlan: string;
};

type FarmRiskProfile = {
  droughtRisk: string;
  floodRisk: string;
  pestRisk: string;
  diseaseRisk: string;
  marketRisk: string;
  mitigationPlan: string;
  nextPreparednessDrillDate: string;
};

type FarmOperations = {
  leadFarmerName: string;
  leadFarmerPhone: string;
  extensionOfficerName: string;
  extensionOfficerPhone: string;
  irrigationType: string;
  storageCapacityKg: string;
  householdLaborCount: string;
  hiredLaborCount: string;
  mechanizationAccess: string;
  inputSupplier: string;
  nextActionDate: string;
  nextActionNote: string;
  agroecologyPractices: string[];
};

type FarmInsight = {
  id: string;
  title: string;
  detail: string;
  action: string;
  level: "critical" | "warning" | "good";
};

type FarmUnit = {
  id: string;
  name: string;
  district: string;
  parish: string;
  crops: string[];
  lastPlantingDate: string;
  soilType: string;
  farmSizeAcres: string;
  hasWaterAccess: boolean;
  notes: string;
  isPrimary: boolean;
  finance: FarmFinance;
  insurance: FarmInsurance;
  expectations: FarmExpectations;
  risk: FarmRiskProfile;
  operations: FarmOperations;
};

const defaultSettings: SettingsForm = {
  preferredLanguage: "",
  district: "",
  parish: "",
  smsOptIn: true,
  voiceOptIn: true,
  weatherAlerts: true,
  priceAlerts: true,
};

const CROP_OPTIONS = [
  "Maize",
  "Beans",
  "Cassava",
  "Rice",
  "Groundnuts",
  "Sorghum",
  "Millet",
  "Bananas",
  "Coffee",
  "Cotton",
  "Soybeans",
  "Sunflower",
  "Tomatoes",
  "Onions",
  "Cabbage",
];

const SOIL_TYPE_OPTIONS = ["Loamy", "Sandy", "Clay", "Silty", "Peaty", "Chalky", "Saline", "Black cotton", "Volcanic"];
const CURRENCY_OPTIONS = ["UGX", "USD", "KES", "TZS"];
const INSURANCE_PRODUCT_OPTIONS = ["Weather index", "Yield loss", "Input protection", "Livestock", "Other"];
const CLAIM_STATUS_OPTIONS = ["No claim", "Submitted", "Under review", "Approved", "Rejected", "Paid"];
const IRRIGATION_OPTIONS = ["Rain-fed", "Manual irrigation", "Drip irrigation", "Sprinkler", "Solar pump", "Gravity flow"];
const MECHANIZATION_OPTIONS = ["None", "Shared cooperative service", "Rented per season", "Owned"];
const RISK_LEVEL_OPTIONS = ["1", "2", "3", "4", "5"];
const AGROECOLOGY_PRACTICES = [
  "Mulching",
  "Intercropping",
  "Compost use",
  "Crop rotation",
  "Cover cropping",
  "Integrated pest management",
  "Minimum tillage",
  "Water harvesting",
];

function normalizeOption(value: string, options: string[]): string {
  const clean = value.trim();
  if (!clean) return "";
  const matched = options.find((option) => option.toLowerCase() === clean.toLowerCase());
  return matched ?? clean;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function toStringValue(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value == null) return "";
  return String(value).trim();
}

function toNumberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const cleaned = value.replace(/,/g, "").trim();
    if (!cleaned) return null;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toNumberInput(value: unknown): string {
  const parsed = toNumberValue(value);
  return parsed == null ? "" : String(parsed);
}

function toBooleanValue(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const lowered = value.trim().toLowerCase();
    if (["true", "1", "yes", "y", "on"].includes(lowered)) return true;
    if (["false", "0", "no", "n", "off"].includes(lowered)) return false;
  }
  return fallback;
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const clean = value.trim();
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(clean);
  }
  return result;
}

function normalizeCrops(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return uniqueStrings(value.map((item) => normalizeOption(toStringValue(item), CROP_OPTIONS)));
}

function normalizeAgroPractices(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return uniqueStrings(value.map((item) => normalizeOption(toStringValue(item), AGROECOLOGY_PRACTICES)));
}

function makeFarmId() {
  return `farm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function toNumericOrNull(value: string): number | null {
  return toNumberValue(value);
}

function toIntegerOrNull(value: string): number | null {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function createFarmFinance(partial?: Partial<FarmFinance>): FarmFinance {
  return {
    currency: partial?.currency || "UGX",
    plannedInputCost: partial?.plannedInputCost ?? "",
    plannedLaborCost: partial?.plannedLaborCost ?? "",
    plannedLogisticsCost: partial?.plannedLogisticsCost ?? "",
    plannedOtherCost: partial?.plannedOtherCost ?? "",
    loanPrincipal: partial?.loanPrincipal ?? "",
    loanInterestPct: partial?.loanInterestPct ?? "",
    expectedInstallment: partial?.expectedInstallment ?? "",
    currentCashOnHand: partial?.currentCashOnHand ?? "",
    savingsTarget: partial?.savingsTarget ?? "",
    notes: partial?.notes ?? "",
  };
}

function createFarmInsurance(partial?: Partial<FarmInsurance>): FarmInsurance {
  return {
    enrolled: partial?.enrolled ?? false,
    provider: partial?.provider ?? "",
    productType: partial?.productType ?? "",
    policyNumber: partial?.policyNumber ?? "",
    coverageAmount: partial?.coverageAmount ?? "",
    premiumAmount: partial?.premiumAmount ?? "",
    startDate: partial?.startDate ?? "",
    endDate: partial?.endDate ?? "",
    claimStatus: partial?.claimStatus ?? "No claim",
    lastClaimAmount: partial?.lastClaimAmount ?? "",
    lastClaimDate: partial?.lastClaimDate ?? "",
    triggerModel: partial?.triggerModel ?? "",
  };
}

function createFarmExpectations(partial?: Partial<FarmExpectations>): FarmExpectations {
  return {
    seasonLabel: partial?.seasonLabel ?? "",
    targetYieldKg: partial?.targetYieldKg ?? "",
    expectedPricePerKg: partial?.expectedPricePerKg ?? "",
    projectedRevenue: partial?.projectedRevenue ?? "",
    targetHarvestDate: partial?.targetHarvestDate ?? "",
    plantingWindowStart: partial?.plantingWindowStart ?? "",
    plantingWindowEnd: partial?.plantingWindowEnd ?? "",
    confidencePct: partial?.confidencePct ?? "",
    buyerPlan: partial?.buyerPlan ?? "",
  };
}

function createFarmRiskProfile(partial?: Partial<FarmRiskProfile>): FarmRiskProfile {
  return {
    droughtRisk: partial?.droughtRisk ?? "",
    floodRisk: partial?.floodRisk ?? "",
    pestRisk: partial?.pestRisk ?? "",
    diseaseRisk: partial?.diseaseRisk ?? "",
    marketRisk: partial?.marketRisk ?? "",
    mitigationPlan: partial?.mitigationPlan ?? "",
    nextPreparednessDrillDate: partial?.nextPreparednessDrillDate ?? "",
  };
}

function createFarmOperations(partial?: Partial<FarmOperations>): FarmOperations {
  return {
    leadFarmerName: partial?.leadFarmerName ?? "",
    leadFarmerPhone: partial?.leadFarmerPhone ?? "",
    extensionOfficerName: partial?.extensionOfficerName ?? "",
    extensionOfficerPhone: partial?.extensionOfficerPhone ?? "",
    irrigationType: partial?.irrigationType ?? "",
    storageCapacityKg: partial?.storageCapacityKg ?? "",
    householdLaborCount: partial?.householdLaborCount ?? "",
    hiredLaborCount: partial?.hiredLaborCount ?? "",
    mechanizationAccess: partial?.mechanizationAccess ?? "",
    inputSupplier: partial?.inputSupplier ?? "",
    nextActionDate: partial?.nextActionDate ?? "",
    nextActionNote: partial?.nextActionNote ?? "",
    agroecologyPractices: partial?.agroecologyPractices ?? [],
  };
}

function createFarmUnit(partial?: Partial<FarmUnit>): FarmUnit {
  return {
    id: partial?.id ?? makeFarmId(),
    name: partial?.name ?? "",
    district: partial?.district ?? "",
    parish: partial?.parish ?? "",
    crops: partial?.crops ?? [],
    lastPlantingDate: partial?.lastPlantingDate ?? "",
    soilType: partial?.soilType ?? "",
    farmSizeAcres: partial?.farmSizeAcres ?? "",
    hasWaterAccess: partial?.hasWaterAccess ?? false,
    notes: partial?.notes ?? "",
    isPrimary: partial?.isPrimary ?? false,
    finance: createFarmFinance(partial?.finance),
    insurance: createFarmInsurance(partial?.insurance),
    expectations: createFarmExpectations(partial?.expectations),
    risk: createFarmRiskProfile(partial?.risk),
    operations: createFarmOperations(partial?.operations),
  };
}

function inferProjectedRevenue(farm: FarmUnit): number {
  const explicit = toNumberValue(farm.expectations.projectedRevenue);
  if (explicit != null) return explicit;
  const yieldKg = toNumberValue(farm.expectations.targetYieldKg);
  const pricePerKg = toNumberValue(farm.expectations.expectedPricePerKg);
  if (yieldKg == null || pricePerKg == null) return 0;
  return yieldKg * pricePerKg;
}

function getPlannedCost(farm: FarmUnit): number {
  const parts = [
    toNumberValue(farm.finance.plannedInputCost) ?? 0,
    toNumberValue(farm.finance.plannedLaborCost) ?? 0,
    toNumberValue(farm.finance.plannedLogisticsCost) ?? 0,
    toNumberValue(farm.finance.plannedOtherCost) ?? 0,
    toNumberValue(farm.finance.expectedInstallment) ?? 0,
  ];
  return parts.reduce((sum, part) => sum + part, 0);
}

function average(values: Array<number | null>): number | null {
  const valid = values.filter((item): item is number => item != null && Number.isFinite(item));
  if (valid.length === 0) return null;
  return valid.reduce((sum, item) => sum + item, 0) / valid.length;
}

function farmRiskAverage(farm: FarmUnit): number | null {
  return average([
    toNumberValue(farm.risk.droughtRisk),
    toNumberValue(farm.risk.floodRisk),
    toNumberValue(farm.risk.pestRisk),
    toNumberValue(farm.risk.diseaseRisk),
    toNumberValue(farm.risk.marketRisk),
  ]);
}

function formatMoney(value: number, currency: string): string {
  if (!Number.isFinite(value)) return "--";
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

function formatDecimal(value: number | null, fallback = "--"): string {
  if (value == null || !Number.isFinite(value)) return fallback;
  return value.toFixed(1);
}

function toInputDate(value: unknown): string {
  const text = toStringValue(value);
  if (!text) return "";
  return text.slice(0, 10);
}

export default function FarmerFarm() {
  const [settings, setSettings] = useState<SettingsForm>(defaultSettings);
  const [farms, setFarms] = useState<FarmUnit[]>([]);
  const [activeFarmId, setActiveFarmId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activeFarm = useMemo(
    () => farms.find((farm) => farm.id === activeFarmId) ?? farms[0] ?? null,
    [activeFarmId, farms]
  );

  const cropOptions = useMemo(() => {
    const all = farms.flatMap((farm) => farm.crops);
    return uniqueStrings([...CROP_OPTIONS, ...all]);
  }, [farms]);

  const soilTypeOptions = useMemo(() => {
    const value = activeFarm?.soilType.trim() ?? "";
    if (!value) return SOIL_TYPE_OPTIONS;
    const exists = SOIL_TYPE_OPTIONS.some((option) => option.toLowerCase() === value.toLowerCase());
    return exists ? SOIL_TYPE_OPTIONS : [...SOIL_TYPE_OPTIONS, value];
  }, [activeFarm?.soilType]);

  const totalAreaAcres = useMemo(() => farms.reduce((sum, farm) => sum + (toNumberValue(farm.farmSizeAcres) ?? 0), 0), [farms]);
  const uniqueCropCount = useMemo(() => uniqueStrings(farms.flatMap((farm) => farm.crops)).length, [farms]);
  const farmsWithWaterAccess = useMemo(() => farms.filter((farm) => farm.hasWaterAccess).length, [farms]);
  const insuredFarms = useMemo(() => farms.filter((farm) => farm.insurance.enrolled).length, [farms]);
  const totalProjectedRevenue = useMemo(() => farms.reduce((sum, farm) => sum + inferProjectedRevenue(farm), 0), [farms]);
  const totalPlannedCost = useMemo(() => farms.reduce((sum, farm) => sum + getPlannedCost(farm), 0), [farms]);
  const totalCoverage = useMemo(
    () => farms.reduce((sum, farm) => sum + (toNumberValue(farm.insurance.coverageAmount) ?? 0), 0),
    [farms]
  );
  const portfolioMargin = totalProjectedRevenue - totalPlannedCost;
  const portfolioRiskScore = useMemo(() => average(farms.map((farm) => farmRiskAverage(farm))), [farms]);
  const currencySet = useMemo(() => {
    const values = farms
      .map((farm) => normalizeOption(farm.finance.currency || "UGX", CURRENCY_OPTIONS) || "UGX")
      .filter(Boolean);
    return Array.from(new Set(values));
  }, [farms]);
  const primaryCurrency = currencySet[0] || "UGX";
  const mixedCurrency = currencySet.length > 1;

  const activeFarmRiskScore = activeFarm ? farmRiskAverage(activeFarm) : null;
  const activePlannedCost = activeFarm ? getPlannedCost(activeFarm) : 0;
  const activeProjectedRevenue = activeFarm ? inferProjectedRevenue(activeFarm) : 0;
  const activeExpectedMargin = activeProjectedRevenue - activePlannedCost;
  const activeYield = activeFarm ? toNumberValue(activeFarm.expectations.targetYieldKg) : null;
  const activePrice = activeFarm ? toNumberValue(activeFarm.expectations.expectedPricePerKg) : null;
  const activeCashOnHand = activeFarm ? toNumberValue(activeFarm.finance.currentCashOnHand) ?? 0 : 0;
  const activeCoverageAmount = activeFarm ? toNumberValue(activeFarm.insurance.coverageAmount) ?? 0 : 0;
  const breakEvenPrice = activeFarm && activeYield && activeYield > 0 ? activePlannedCost / activeYield : null;
  const breakEvenYield = activeFarm && activePrice && activePrice > 0 ? activePlannedCost / activePrice : null;
  const activeCashRunway = activePlannedCost > 0 ? activeCashOnHand / activePlannedCost : null;
  const activeCoverageRatio = activeProjectedRevenue > 0 ? activeCoverageAmount / activeProjectedRevenue : null;
  const portfolioReadinessScore = [farms.length > 0, uniqueCropCount > 0, insuredFarms > 0, totalProjectedRevenue > 0, totalPlannedCost > 0]
    .filter(Boolean)
    .length;
  const activeFarmReadinessItems = useMemo(
    () => [
      {
        label: "Identity",
        ready: Boolean(activeFarm?.name.trim() && activeFarm?.district.trim()),
        detail: activeFarm?.name.trim() && activeFarm?.district.trim() ? "Farm identity is clear" : "Add name and district",
      },
      {
        label: "Production",
        ready: Boolean((activeFarm?.crops.length ?? 0) > 0 && activeFarm?.farmSizeAcres.trim()),
        detail: (activeFarm?.crops.length ?? 0) > 0 && activeFarm?.farmSizeAcres.trim() ? "Crop and area tracked" : "Add crops and size",
      },
      {
        label: "Expectations",
        ready: Boolean(activeFarm?.expectations.targetYieldKg.trim() && activeFarm?.expectations.expectedPricePerKg.trim()),
        detail:
          activeFarm?.expectations.targetYieldKg.trim() && activeFarm?.expectations.expectedPricePerKg.trim()
            ? "Yield and price targets set"
            : "Add yield and price targets",
      },
      {
        label: "Finance",
        ready: Boolean(activeFarm?.finance.plannedInputCost.trim() || activeFarm?.finance.currentCashOnHand.trim()),
        detail:
          activeFarm?.finance.plannedInputCost.trim() || activeFarm?.finance.currentCashOnHand.trim()
            ? "Liquidity or budget tracked"
            : "Add costs or cash position",
      },
      {
        label: "Execution",
        ready: Boolean(activeFarm?.operations.nextActionDate || activeFarm?.operations.nextActionNote.trim()),
        detail:
          activeFarm?.operations.nextActionDate || activeFarm?.operations.nextActionNote.trim()
            ? "Next action is planned"
            : "Add next action",
      },
    ],
    [activeFarm]
  );
  const activeFarmReadinessScore = activeFarmReadinessItems.filter((item) => item.ready).length;

  const activeFarmInsights = useMemo<FarmInsight[]>(() => {
    if (!activeFarm) return [];

    const insights: FarmInsight[] = [];

    if (activePlannedCost > 0) {
      if ((activeCashRunway ?? 0) < 0.3) {
        insights.push({
          id: "cash-runway-critical",
          title: "Liquidity gap is high",
          detail: "Current cash covers less than 30% of planned season costs.",
          action: "Secure input credit or reduce non-essential spending before planting.",
          level: "critical",
        });
      } else if ((activeCashRunway ?? 0) < 0.6) {
        insights.push({
          id: "cash-runway-warning",
          title: "Liquidity is moderate",
          detail: "Current cash covers under 60% of planned season costs.",
          action: "Schedule staged purchases and confirm short-term financing options.",
          level: "warning",
        });
      } else {
        insights.push({
          id: "cash-runway-good",
          title: "Liquidity is healthy",
          detail: "Available cash can support most planned season activities.",
          action: "Keep a reserve buffer for weather and price shocks.",
          level: "good",
        });
      }
    }

    if (!activeFarm.insurance.enrolled && (activeFarmRiskScore ?? 0) >= 3) {
      insights.push({
        id: "insurance-critical",
        title: "Insurance coverage missing",
        detail: "Risk score is elevated while insurance enrollment is still off.",
        action: "Prioritize weather-index or yield-loss cover before the next high-risk period.",
        level: "critical",
      });
    } else if (activeFarm.insurance.enrolled && activeProjectedRevenue > 0 && (activeCoverageRatio ?? 0) < 0.5) {
      insights.push({
        id: "insurance-warning",
        title: "Coverage may be too low",
        detail: "Current insurance coverage is under 50% of expected revenue.",
        action: "Review policy limits and consider increasing coverage for this season.",
        level: "warning",
      });
    }

    if ((activeFarmRiskScore ?? 0) >= 3.5 && !activeFarm.risk.mitigationPlan.trim()) {
      insights.push({
        id: "mitigation-critical",
        title: "Mitigation plan missing",
        detail: "Risk score is high but there is no documented mitigation response.",
        action: "Add actions for drought, pests, and market shocks with responsible owners.",
        level: "critical",
      });
    }

    if (!activeFarm.expectations.buyerPlan.trim()) {
      insights.push({
        id: "buyer-plan-warning",
        title: "Market channel not defined",
        detail: "No buyer channel or offtake plan is recorded for this season.",
        action: "Set your buyer route now to reduce post-harvest price pressure.",
        level: "warning",
      });
    }

    if (!activeFarm.operations.nextActionDate) {
      insights.push({
        id: "next-action-warning",
        title: "No scheduled next action",
        detail: "The operations block has no upcoming execution date.",
        action: "Add next task date and owner to keep field work on track.",
        level: "warning",
      });
    }

    if (activeFarm.operations.agroecologyPractices.length === 0) {
      insights.push({
        id: "agroecology-warning",
        title: "Climate-smart practice not tracked",
        detail: "No agroecology practices are selected for this farm.",
        action: "Start with mulching, rotation, or IPM to build resilience and soil health.",
        level: "warning",
      });
    }

    if (insights.length === 0) {
      insights.push({
        id: "profile-good",
        title: "Profile is well prepared",
        detail: "Core planning, risk, and operations fields are populated.",
        action: "Keep updating metrics as the season progresses.",
        level: "good",
      });
    }

    return insights;
  }, [
    activeCashRunway,
    activeCoverageRatio,
    activeFarm,
    activeFarmRiskScore,
    activePlannedCost,
    activeProjectedRevenue,
  ]);

  useEffect(() => {
    setLoading(true);
    api
      .profileDetails()
      .then((res) => {
        const profile = res as ProfileDetails;
        const soilProfile = asRecord(profile.farm.soil_profile);
        const climateExposure = asRecord(profile.farm.climate_exposure);
        const rawFarmUnits = Array.isArray(soilProfile.farm_units) ? soilProfile.farm_units : [];

        const plantingByFarm = new Map<string, string>();
        let firstPlantingDate = "";
        for (const item of profile.farm.planting_dates ?? []) {
          const row = asRecord(item);
          const date = toInputDate(row.date);
          if (!date) continue;
          if (!firstPlantingDate) firstPlantingDate = date;
          const farmId = toStringValue(row.farm_id);
          if (farmId && !plantingByFarm.has(farmId)) {
            plantingByFarm.set(farmId, date);
          }
        }

        const yieldEstimateByFarm = new Map<string, Record<string, unknown>>();
        let firstYieldEstimate = {} as Record<string, unknown>;
        for (const item of profile.farm.yield_estimates ?? []) {
          const row = asRecord(item);
          const farmId = toStringValue(row.farm_id);
          if (farmId && !yieldEstimateByFarm.has(farmId)) {
            yieldEstimateByFarm.set(farmId, row);
          }
          if (Object.keys(firstYieldEstimate).length === 0) {
            firstYieldEstimate = row;
          }
        }

        const riskByFarm = new Map<string, Record<string, unknown>>();
        const riskRows = Array.isArray(climateExposure.risk_by_farm) ? climateExposure.risk_by_farm : [];
        for (const rowItem of riskRows) {
          const row = asRecord(rowItem);
          const farmId = toStringValue(row.farm_id);
          if (farmId && !riskByFarm.has(farmId)) {
            riskByFarm.set(farmId, row);
          }
        }

        const legacyFinance = asRecord(soilProfile.finance_profile || soilProfile.financial_plan);
        const legacyInsurance = asRecord(soilProfile.insurance_profile);
        const legacyExpectations = asRecord(soilProfile.season_expectations);
        const legacyRisk = asRecord(climateExposure.risk_profile);
        const legacyOperations = asRecord(soilProfile.operations_profile);

        const parsedUnits = rawFarmUnits
          .map((raw, index) => {
            const data = asRecord(raw);
            const id = toStringValue(data.id) || `farm-${index + 1}`;
            const expectationsSource = asRecord(data.expectations);
            const financeSource = asRecord(data.finance);
            const insuranceSource = asRecord(data.insurance);
            const riskSource = asRecord(data.risk_profile || data.risk);
            const operationsSource = asRecord(data.operations);
            const estimateSource = yieldEstimateByFarm.get(id) ?? {};
            const climateRiskSource = riskByFarm.get(id) ?? {};

            return createFarmUnit({
              id,
              name: toStringValue(data.name) || `Farm ${index + 1}`,
              district: toStringValue(data.district),
              parish: toStringValue(data.parish),
              crops: normalizeCrops(data.crops),
              lastPlantingDate: toInputDate(data.last_planting_date) || plantingByFarm.get(id) || (index === 0 ? firstPlantingDate : ""),
              soilType: normalizeOption(toStringValue(data.soil_type), SOIL_TYPE_OPTIONS),
              farmSizeAcres: toNumberInput(data.farm_size_acres),
              hasWaterAccess: toBooleanValue(data.has_water_access),
              notes: toStringValue(data.notes),
              isPrimary: toBooleanValue(data.is_primary),
              finance: createFarmFinance({
                currency: normalizeOption(toStringValue(financeSource.currency), CURRENCY_OPTIONS) || "UGX",
                plannedInputCost: toNumberInput(financeSource.planned_input_cost),
                plannedLaborCost: toNumberInput(financeSource.planned_labor_cost),
                plannedLogisticsCost: toNumberInput(financeSource.planned_logistics_cost),
                plannedOtherCost: toNumberInput(financeSource.planned_other_cost),
                loanPrincipal: toNumberInput(financeSource.loan_principal),
                loanInterestPct: toNumberInput(financeSource.loan_interest_pct),
                expectedInstallment: toNumberInput(financeSource.expected_installment),
                currentCashOnHand: toNumberInput(financeSource.current_cash_on_hand),
                savingsTarget: toNumberInput(financeSource.savings_target),
                notes: toStringValue(financeSource.notes),
              }),
              insurance: createFarmInsurance({
                enrolled: toBooleanValue(insuranceSource.enrolled),
                provider: toStringValue(insuranceSource.provider),
                productType: toStringValue(insuranceSource.product_type),
                policyNumber: toStringValue(insuranceSource.policy_number),
                coverageAmount: toNumberInput(insuranceSource.coverage_amount),
                premiumAmount: toNumberInput(insuranceSource.premium_amount),
                startDate: toInputDate(insuranceSource.start_date),
                endDate: toInputDate(insuranceSource.end_date),
                claimStatus: toStringValue(insuranceSource.claim_status) || "No claim",
                lastClaimAmount: toNumberInput(insuranceSource.last_claim_amount),
                lastClaimDate: toInputDate(insuranceSource.last_claim_date),
                triggerModel: toStringValue(insuranceSource.trigger_model),
              }),
              expectations: createFarmExpectations({
                seasonLabel:
                  toStringValue(expectationsSource.season_label) || toStringValue(estimateSource.season_label),
                targetYieldKg:
                  toNumberInput(expectationsSource.target_yield_kg) || toNumberInput(estimateSource.target_yield_kg),
                expectedPricePerKg:
                  toNumberInput(expectationsSource.expected_price_per_kg) || toNumberInput(estimateSource.expected_price_per_kg),
                projectedRevenue:
                  toNumberInput(expectationsSource.projected_revenue) || toNumberInput(estimateSource.projected_revenue),
                targetHarvestDate:
                  toInputDate(expectationsSource.target_harvest_date) || toInputDate(estimateSource.target_harvest_date),
                plantingWindowStart: toInputDate(expectationsSource.planting_window_start),
                plantingWindowEnd: toInputDate(expectationsSource.planting_window_end),
                confidencePct:
                  toNumberInput(expectationsSource.confidence_pct) || toNumberInput(estimateSource.confidence_pct),
                buyerPlan: toStringValue(expectationsSource.buyer_plan),
              }),
              risk: createFarmRiskProfile({
                droughtRisk: toStringValue(riskSource.drought_risk) || toStringValue(climateRiskSource.drought_risk),
                floodRisk: toStringValue(riskSource.flood_risk) || toStringValue(climateRiskSource.flood_risk),
                pestRisk: toStringValue(riskSource.pest_risk) || toStringValue(climateRiskSource.pest_risk),
                diseaseRisk: toStringValue(riskSource.disease_risk) || toStringValue(climateRiskSource.disease_risk),
                marketRisk: toStringValue(riskSource.market_risk) || toStringValue(climateRiskSource.market_risk),
                mitigationPlan: toStringValue(riskSource.mitigation_plan),
                nextPreparednessDrillDate: toInputDate(riskSource.next_preparedness_drill_date),
              }),
              operations: createFarmOperations({
                leadFarmerName: toStringValue(operationsSource.lead_farmer_name),
                leadFarmerPhone: toStringValue(operationsSource.lead_farmer_phone),
                extensionOfficerName: toStringValue(operationsSource.extension_officer_name),
                extensionOfficerPhone: toStringValue(operationsSource.extension_officer_phone),
                irrigationType: toStringValue(operationsSource.irrigation_type),
                storageCapacityKg: toNumberInput(operationsSource.storage_capacity_kg),
                householdLaborCount: toNumberInput(operationsSource.household_labor_count),
                hiredLaborCount: toNumberInput(operationsSource.hired_labor_count),
                mechanizationAccess: toStringValue(operationsSource.mechanization_access),
                inputSupplier: toStringValue(operationsSource.input_supplier),
                nextActionDate: toInputDate(operationsSource.next_action_date),
                nextActionNote: toStringValue(operationsSource.next_action_note),
                agroecologyPractices: normalizeAgroPractices(operationsSource.agroecology_practices),
              }),
            });
          })
          .filter((farm) => Boolean(farm.id));

        const legacyFarm = createFarmUnit({
          id: "farm-1",
          name: toStringValue(soilProfile.farm_name) || "Main farm",
          district: profile.settings.district ?? "",
          parish: profile.settings.parish ?? "",
          crops: normalizeCrops(profile.farm.crops),
          lastPlantingDate: firstPlantingDate,
          soilType: normalizeOption(toStringValue(soilProfile.soil_type), SOIL_TYPE_OPTIONS),
          farmSizeAcres: toNumberInput(soilProfile.farm_size_acres),
          hasWaterAccess: toBooleanValue(climateExposure.has_water_access),
          notes: toStringValue(soilProfile.notes),
          isPrimary: true,
          finance: createFarmFinance({
            currency: normalizeOption(toStringValue(legacyFinance.currency), CURRENCY_OPTIONS) || "UGX",
            plannedInputCost: toNumberInput(legacyFinance.planned_input_cost),
            plannedLaborCost: toNumberInput(legacyFinance.planned_labor_cost),
            plannedLogisticsCost: toNumberInput(legacyFinance.planned_logistics_cost),
            plannedOtherCost: toNumberInput(legacyFinance.planned_other_cost),
            loanPrincipal: toNumberInput(legacyFinance.loan_principal),
            loanInterestPct: toNumberInput(legacyFinance.loan_interest_pct),
            expectedInstallment: toNumberInput(legacyFinance.expected_installment),
            currentCashOnHand: toNumberInput(legacyFinance.current_cash_on_hand),
            savingsTarget: toNumberInput(legacyFinance.savings_target),
            notes: toStringValue(legacyFinance.notes),
          }),
          insurance: createFarmInsurance({
            enrolled: toBooleanValue(legacyInsurance.enrolled),
            provider: toStringValue(legacyInsurance.provider),
            productType: toStringValue(legacyInsurance.product_type),
            policyNumber: toStringValue(legacyInsurance.policy_number),
            coverageAmount: toNumberInput(legacyInsurance.coverage_amount),
            premiumAmount: toNumberInput(legacyInsurance.premium_amount),
            startDate: toInputDate(legacyInsurance.start_date),
            endDate: toInputDate(legacyInsurance.end_date),
            claimStatus: toStringValue(legacyInsurance.claim_status) || "No claim",
            lastClaimAmount: toNumberInput(legacyInsurance.last_claim_amount),
            lastClaimDate: toInputDate(legacyInsurance.last_claim_date),
            triggerModel: toStringValue(legacyInsurance.trigger_model),
          }),
          expectations: createFarmExpectations({
            seasonLabel: toStringValue(legacyExpectations.season_label) || toStringValue(firstYieldEstimate.season_label),
            targetYieldKg: toNumberInput(legacyExpectations.target_yield_kg) || toNumberInput(firstYieldEstimate.target_yield_kg),
            expectedPricePerKg:
              toNumberInput(legacyExpectations.expected_price_per_kg) || toNumberInput(firstYieldEstimate.expected_price_per_kg),
            projectedRevenue: toNumberInput(legacyExpectations.projected_revenue) || toNumberInput(firstYieldEstimate.projected_revenue),
            targetHarvestDate: toInputDate(legacyExpectations.target_harvest_date) || toInputDate(firstYieldEstimate.target_harvest_date),
            plantingWindowStart: toInputDate(legacyExpectations.planting_window_start),
            plantingWindowEnd: toInputDate(legacyExpectations.planting_window_end),
            confidencePct: toNumberInput(legacyExpectations.confidence_pct) || toNumberInput(firstYieldEstimate.confidence_pct),
            buyerPlan: toStringValue(legacyExpectations.buyer_plan),
          }),
          risk: createFarmRiskProfile({
            droughtRisk: toStringValue(legacyRisk.drought_risk),
            floodRisk: toStringValue(legacyRisk.flood_risk),
            pestRisk: toStringValue(legacyRisk.pest_risk),
            diseaseRisk: toStringValue(legacyRisk.disease_risk),
            marketRisk: toStringValue(legacyRisk.market_risk),
            mitigationPlan: toStringValue(legacyRisk.mitigation_plan),
            nextPreparednessDrillDate: toInputDate(legacyRisk.next_preparedness_drill_date),
          }),
          operations: createFarmOperations({
            leadFarmerName: toStringValue(legacyOperations.lead_farmer_name),
            leadFarmerPhone: toStringValue(legacyOperations.lead_farmer_phone),
            extensionOfficerName: toStringValue(legacyOperations.extension_officer_name),
            extensionOfficerPhone: toStringValue(legacyOperations.extension_officer_phone),
            irrigationType: toStringValue(legacyOperations.irrigation_type),
            storageCapacityKg: toNumberInput(legacyOperations.storage_capacity_kg),
            householdLaborCount: toNumberInput(legacyOperations.household_labor_count),
            hiredLaborCount: toNumberInput(legacyOperations.hired_labor_count),
            mechanizationAccess: toStringValue(legacyOperations.mechanization_access),
            inputSupplier: toStringValue(legacyOperations.input_supplier),
            nextActionDate: toInputDate(legacyOperations.next_action_date),
            nextActionNote: toStringValue(legacyOperations.next_action_note),
            agroecologyPractices: normalizeAgroPractices(legacyOperations.agroecology_practices),
          }),
        });

        const normalizedUnits = parsedUnits.length > 0 ? parsedUnits : [legacyFarm];
        const usedIds = new Set<string>();
        const deduped = normalizedUnits.map((farm, index) => {
          let candidate = farm.id || `farm-${index + 1}`;
          while (usedIds.has(candidate)) {
            candidate = `${candidate}-${index + 1}`;
          }
          usedIds.add(candidate);
          return { ...farm, id: candidate };
        });

        const preferredPrimaryId = toStringValue(soilProfile.primary_farm_id);
        const foundPrimary =
          deduped.find((farm) => farm.id === preferredPrimaryId) ??
          deduped.find((farm) => farm.isPrimary) ??
          deduped[0];
        const primaryId = foundPrimary?.id ?? deduped[0]?.id ?? "";
        const finalFarms = deduped.map((farm) => ({ ...farm, isPrimary: farm.id === primaryId }));

        setSettings({
          preferredLanguage: profile.settings.preferred_language ?? "",
          district: profile.settings.district ?? "",
          parish: profile.settings.parish ?? "",
          smsOptIn: profile.settings.sms_opt_in,
          voiceOptIn: profile.settings.voice_opt_in,
          weatherAlerts: profile.settings.weather_alerts,
          priceAlerts: profile.settings.price_alerts,
        });
        setFarms(finalFarms);
        setActiveFarmId(primaryId || finalFarms[0]?.id || "");
      })
      .catch(() => setError("Unable to load farm portfolio."))
      .finally(() => setLoading(false));
  }, []);

  const onSettingsChange = <K extends keyof SettingsForm>(field: K, value: SettingsForm[K]) => {
    setSettings((prev) => ({ ...prev, [field]: value }));
  };

  const onActiveFarmChange = <K extends keyof FarmUnit>(field: K, value: FarmUnit[K]) => {
    if (!activeFarmId) return;
    setFarms((prev) => prev.map((farm) => (farm.id === activeFarmId ? { ...farm, [field]: value } : farm)));
  };

  const onFinanceChange = <K extends keyof FarmFinance>(field: K, value: FarmFinance[K]) => {
    if (!activeFarmId) return;
    setFarms((prev) =>
      prev.map((farm) =>
        farm.id === activeFarmId
          ? {
              ...farm,
              finance: { ...farm.finance, [field]: value },
            }
          : farm
      )
    );
  };

  const onInsuranceChange = <K extends keyof FarmInsurance>(field: K, value: FarmInsurance[K]) => {
    if (!activeFarmId) return;
    setFarms((prev) =>
      prev.map((farm) =>
        farm.id === activeFarmId
          ? {
              ...farm,
              insurance: { ...farm.insurance, [field]: value },
            }
          : farm
      )
    );
  };

  const onExpectationsChange = <K extends keyof FarmExpectations>(field: K, value: FarmExpectations[K]) => {
    if (!activeFarmId) return;
    setFarms((prev) =>
      prev.map((farm) =>
        farm.id === activeFarmId
          ? {
              ...farm,
              expectations: { ...farm.expectations, [field]: value },
            }
          : farm
      )
    );
  };

  const onRiskChange = <K extends keyof FarmRiskProfile>(field: K, value: FarmRiskProfile[K]) => {
    if (!activeFarmId) return;
    setFarms((prev) =>
      prev.map((farm) =>
        farm.id === activeFarmId
          ? {
              ...farm,
              risk: { ...farm.risk, [field]: value },
            }
          : farm
      )
    );
  };

  const onOperationsChange = <K extends keyof FarmOperations>(field: K, value: FarmOperations[K]) => {
    if (!activeFarmId) return;
    setFarms((prev) =>
      prev.map((farm) =>
        farm.id === activeFarmId
          ? {
              ...farm,
              operations: { ...farm.operations, [field]: value },
            }
          : farm
      )
    );
  };

  const addFarm = () => {
    const newFarm = createFarmUnit({
      name: `Farm ${farms.length + 1}`,
      district: activeFarm?.district || settings.district,
      parish: activeFarm?.parish || settings.parish,
      finance: createFarmFinance({ currency: activeFarm?.finance.currency || "UGX" }),
      operations: createFarmOperations({
        agroecologyPractices: activeFarm?.operations.agroecologyPractices ?? [],
      }),
    });
    setFarms((prev) => [...prev, newFarm]);
    setActiveFarmId(newFarm.id);
    setMessage("New farm added. Fill in details and save.");
    setError(null);
  };

  const removeFarm = (farmId: string) => {
    if (farms.length <= 1) {
      setError("At least one farm profile is required.");
      return;
    }

    const target = farms.find((farm) => farm.id === farmId);
    const remaining = farms.filter((farm) => farm.id !== farmId);
    if (target?.isPrimary && remaining.length > 0) {
      remaining[0] = { ...remaining[0], isPrimary: true };
    }
    if (!remaining.some((farm) => farm.isPrimary) && remaining.length > 0) {
      remaining[0] = { ...remaining[0], isPrimary: true };
    }

    setFarms(remaining);
    if (activeFarmId === farmId) {
      setActiveFarmId(remaining[0]?.id ?? "");
    }
    setMessage("Farm removed.");
    setError(null);
  };

  const markPrimaryFarm = (farmId: string) => {
    setFarms((prev) => prev.map((farm) => ({ ...farm, isPrimary: farm.id === farmId })));
    setMessage("Primary farm updated.");
    setError(null);
  };

  const handleSave = async () => {
    if (farms.length === 0) {
      setError("Add at least one farm before saving.");
      return;
    }

    setSaving(true);
    setMessage(null);
    setError(null);

    try {
      const normalizedFarms = farms.map((farm, index) =>
        createFarmUnit({
          ...farm,
          name: farm.name.trim() || `Farm ${index + 1}`,
          district: farm.district.trim(),
          parish: farm.parish.trim(),
          crops: uniqueStrings(farm.crops.map((item) => normalizeOption(item, CROP_OPTIONS))),
          lastPlantingDate: farm.lastPlantingDate.trim(),
          soilType: normalizeOption(farm.soilType, SOIL_TYPE_OPTIONS),
          farmSizeAcres: farm.farmSizeAcres.trim(),
          notes: farm.notes.trim(),
          finance: createFarmFinance({
            currency: normalizeOption(farm.finance.currency, CURRENCY_OPTIONS) || "UGX",
            plannedInputCost: farm.finance.plannedInputCost.trim(),
            plannedLaborCost: farm.finance.plannedLaborCost.trim(),
            plannedLogisticsCost: farm.finance.plannedLogisticsCost.trim(),
            plannedOtherCost: farm.finance.plannedOtherCost.trim(),
            loanPrincipal: farm.finance.loanPrincipal.trim(),
            loanInterestPct: farm.finance.loanInterestPct.trim(),
            expectedInstallment: farm.finance.expectedInstallment.trim(),
            currentCashOnHand: farm.finance.currentCashOnHand.trim(),
            savingsTarget: farm.finance.savingsTarget.trim(),
            notes: farm.finance.notes.trim(),
          }),
          insurance: createFarmInsurance({
            enrolled: farm.insurance.enrolled,
            provider: farm.insurance.provider.trim(),
            productType: farm.insurance.productType.trim(),
            policyNumber: farm.insurance.policyNumber.trim(),
            coverageAmount: farm.insurance.coverageAmount.trim(),
            premiumAmount: farm.insurance.premiumAmount.trim(),
            startDate: farm.insurance.startDate.trim(),
            endDate: farm.insurance.endDate.trim(),
            claimStatus: farm.insurance.claimStatus.trim() || "No claim",
            lastClaimAmount: farm.insurance.lastClaimAmount.trim(),
            lastClaimDate: farm.insurance.lastClaimDate.trim(),
            triggerModel: farm.insurance.triggerModel.trim(),
          }),
          expectations: createFarmExpectations({
            seasonLabel: farm.expectations.seasonLabel.trim(),
            targetYieldKg: farm.expectations.targetYieldKg.trim(),
            expectedPricePerKg: farm.expectations.expectedPricePerKg.trim(),
            projectedRevenue: farm.expectations.projectedRevenue.trim(),
            targetHarvestDate: farm.expectations.targetHarvestDate.trim(),
            plantingWindowStart: farm.expectations.plantingWindowStart.trim(),
            plantingWindowEnd: farm.expectations.plantingWindowEnd.trim(),
            confidencePct: farm.expectations.confidencePct.trim(),
            buyerPlan: farm.expectations.buyerPlan.trim(),
          }),
          risk: createFarmRiskProfile({
            droughtRisk: farm.risk.droughtRisk.trim(),
            floodRisk: farm.risk.floodRisk.trim(),
            pestRisk: farm.risk.pestRisk.trim(),
            diseaseRisk: farm.risk.diseaseRisk.trim(),
            marketRisk: farm.risk.marketRisk.trim(),
            mitigationPlan: farm.risk.mitigationPlan.trim(),
            nextPreparednessDrillDate: farm.risk.nextPreparednessDrillDate.trim(),
          }),
          operations: createFarmOperations({
            leadFarmerName: farm.operations.leadFarmerName.trim(),
            leadFarmerPhone: farm.operations.leadFarmerPhone.trim(),
            extensionOfficerName: farm.operations.extensionOfficerName.trim(),
            extensionOfficerPhone: farm.operations.extensionOfficerPhone.trim(),
            irrigationType: farm.operations.irrigationType.trim(),
            storageCapacityKg: farm.operations.storageCapacityKg.trim(),
            householdLaborCount: farm.operations.householdLaborCount.trim(),
            hiredLaborCount: farm.operations.hiredLaborCount.trim(),
            mechanizationAccess: farm.operations.mechanizationAccess.trim(),
            inputSupplier: farm.operations.inputSupplier.trim(),
            nextActionDate: farm.operations.nextActionDate.trim(),
            nextActionNote: farm.operations.nextActionNote.trim(),
            agroecologyPractices: normalizeAgroPractices(farm.operations.agroecologyPractices),
          }),
        })
      );

      const primaryFarm = normalizedFarms.find((farm) => farm.isPrimary) ?? normalizedFarms[0];
      const finalFarms = normalizedFarms.map((farm) => ({ ...farm, isPrimary: farm.id === primaryFarm.id }));
      const uniqueCrops = uniqueStrings(finalFarms.flatMap((farm) => farm.crops));
      const totalSize = finalFarms.reduce((sum, farm) => sum + (toNumberValue(farm.farmSizeAcres) ?? 0), 0);
      const totalRevenue = finalFarms.reduce((sum, farm) => sum + inferProjectedRevenue(farm), 0);
      const totalCost = finalFarms.reduce((sum, farm) => sum + getPlannedCost(farm), 0);
      const coverageTotal = finalFarms.reduce((sum, farm) => sum + (toNumberValue(farm.insurance.coverageAmount) ?? 0), 0);
      const insuredCount = finalFarms.filter((farm) => farm.insurance.enrolled).length;

      await api.updateProfileDetails({
        settings: {
          preferred_language: settings.preferredLanguage || null,
          district: primaryFarm.district || settings.district || null,
          parish: primaryFarm.parish || settings.parish || null,
          sms_opt_in: settings.smsOptIn,
          voice_opt_in: settings.voiceOptIn,
          weather_alerts: settings.weatherAlerts,
          price_alerts: settings.priceAlerts,
        },
        farm: {
          crops: uniqueCrops,
          planting_dates: finalFarms
            .filter((farm) => Boolean(farm.lastPlantingDate))
            .map((farm) => ({
              farm_id: farm.id,
              farm_name: farm.name,
              date: farm.lastPlantingDate,
            })),
          soil_profile: {
            soil_type: primaryFarm.soilType || null,
            farm_size_acres: primaryFarm.farmSizeAcres ? toNumericOrNull(primaryFarm.farmSizeAcres) : null,
            notes: primaryFarm.notes || null,
            primary_farm_id: primaryFarm.id,
            farm_units: finalFarms.map((farm) => ({
              id: farm.id,
              name: farm.name,
              district: farm.district || null,
              parish: farm.parish || null,
              crops: farm.crops,
              last_planting_date: farm.lastPlantingDate || null,
              soil_type: farm.soilType || null,
              farm_size_acres: farm.farmSizeAcres ? toNumericOrNull(farm.farmSizeAcres) : null,
              has_water_access: farm.hasWaterAccess,
              notes: farm.notes || null,
              is_primary: farm.isPrimary,
              finance: {
                currency: farm.finance.currency || "UGX",
                planned_input_cost: toNumericOrNull(farm.finance.plannedInputCost),
                planned_labor_cost: toNumericOrNull(farm.finance.plannedLaborCost),
                planned_logistics_cost: toNumericOrNull(farm.finance.plannedLogisticsCost),
                planned_other_cost: toNumericOrNull(farm.finance.plannedOtherCost),
                loan_principal: toNumericOrNull(farm.finance.loanPrincipal),
                loan_interest_pct: toNumericOrNull(farm.finance.loanInterestPct),
                expected_installment: toNumericOrNull(farm.finance.expectedInstallment),
                current_cash_on_hand: toNumericOrNull(farm.finance.currentCashOnHand),
                savings_target: toNumericOrNull(farm.finance.savingsTarget),
                notes: farm.finance.notes || null,
              },
              insurance: {
                enrolled: farm.insurance.enrolled,
                provider: farm.insurance.provider || null,
                product_type: farm.insurance.productType || null,
                policy_number: farm.insurance.policyNumber || null,
                coverage_amount: toNumericOrNull(farm.insurance.coverageAmount),
                premium_amount: toNumericOrNull(farm.insurance.premiumAmount),
                start_date: farm.insurance.startDate || null,
                end_date: farm.insurance.endDate || null,
                claim_status: farm.insurance.claimStatus || null,
                last_claim_amount: toNumericOrNull(farm.insurance.lastClaimAmount),
                last_claim_date: farm.insurance.lastClaimDate || null,
                trigger_model: farm.insurance.triggerModel || null,
              },
              expectations: {
                season_label: farm.expectations.seasonLabel || null,
                target_yield_kg: toNumericOrNull(farm.expectations.targetYieldKg),
                expected_price_per_kg: toNumericOrNull(farm.expectations.expectedPricePerKg),
                projected_revenue: toNumericOrNull(farm.expectations.projectedRevenue) ?? inferProjectedRevenue(farm),
                target_harvest_date: farm.expectations.targetHarvestDate || null,
                planting_window_start: farm.expectations.plantingWindowStart || null,
                planting_window_end: farm.expectations.plantingWindowEnd || null,
                confidence_pct: toNumericOrNull(farm.expectations.confidencePct),
                buyer_plan: farm.expectations.buyerPlan || null,
              },
              risk_profile: {
                drought_risk: toIntegerOrNull(farm.risk.droughtRisk),
                flood_risk: toIntegerOrNull(farm.risk.floodRisk),
                pest_risk: toIntegerOrNull(farm.risk.pestRisk),
                disease_risk: toIntegerOrNull(farm.risk.diseaseRisk),
                market_risk: toIntegerOrNull(farm.risk.marketRisk),
                mitigation_plan: farm.risk.mitigationPlan || null,
                next_preparedness_drill_date: farm.risk.nextPreparednessDrillDate || null,
              },
              operations: {
                lead_farmer_name: farm.operations.leadFarmerName || null,
                lead_farmer_phone: farm.operations.leadFarmerPhone || null,
                extension_officer_name: farm.operations.extensionOfficerName || null,
                extension_officer_phone: farm.operations.extensionOfficerPhone || null,
                irrigation_type: farm.operations.irrigationType || null,
                storage_capacity_kg: toNumericOrNull(farm.operations.storageCapacityKg),
                household_labor_count: toIntegerOrNull(farm.operations.householdLaborCount),
                hired_labor_count: toIntegerOrNull(farm.operations.hiredLaborCount),
                mechanization_access: farm.operations.mechanizationAccess || null,
                input_supplier: farm.operations.inputSupplier || null,
                next_action_date: farm.operations.nextActionDate || null,
                next_action_note: farm.operations.nextActionNote || null,
                agroecology_practices: farm.operations.agroecologyPractices,
              },
            })),
            finance_profile: {
              currency: primaryFarm.finance.currency || "UGX",
              expected_revenue_total: totalRevenue,
              planned_cost_total: totalCost,
              expected_margin_total: totalRevenue - totalCost,
            },
            insurance_profile: {
              insured_farm_count: insuredCount,
              total_coverage_amount: coverageTotal,
            },
            portfolio_totals: {
              farm_count: finalFarms.length,
              crop_count: uniqueCrops.length,
              total_size_acres: totalSize,
              total_expected_revenue: totalRevenue,
              total_planned_cost: totalCost,
            },
          },
          climate_exposure: {
            has_water_access: primaryFarm.hasWaterAccess,
            farms_with_water_access: finalFarms.filter((farm) => farm.hasWaterAccess).map((farm) => farm.id),
            risk_by_farm: finalFarms.map((farm) => ({
              farm_id: farm.id,
              drought_risk: toIntegerOrNull(farm.risk.droughtRisk),
              flood_risk: toIntegerOrNull(farm.risk.floodRisk),
              pest_risk: toIntegerOrNull(farm.risk.pestRisk),
              disease_risk: toIntegerOrNull(farm.risk.diseaseRisk),
              market_risk: toIntegerOrNull(farm.risk.marketRisk),
            })),
          },
          yield_estimates: finalFarms
            .map((farm) => {
              const projected = inferProjectedRevenue(farm);
              const targetYield = toNumericOrNull(farm.expectations.targetYieldKg);
              const targetPrice = toNumericOrNull(farm.expectations.expectedPricePerKg);
              if (targetYield == null && targetPrice == null && projected <= 0) {
                return null;
              }
              return {
                farm_id: farm.id,
                farm_name: farm.name,
                season_label: farm.expectations.seasonLabel || null,
                target_yield_kg: targetYield,
                expected_price_per_kg: targetPrice,
                projected_revenue: projected,
                target_harvest_date: farm.expectations.targetHarvestDate || null,
                confidence_pct: toNumericOrNull(farm.expectations.confidencePct),
              };
            })
            .filter((row) => row != null),
        },
      });

      setFarms(finalFarms);
      setActiveFarmId(primaryFarm.id);
      setSettings((prev) => ({
        ...prev,
        district: primaryFarm.district,
        parish: primaryFarm.parish,
      }));
      setMessage("Farm management profile updated successfully.");
    } catch {
      setError("Unable to save farm portfolio.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <section className="farmer-page">Loading farm portfolio...</section>;

  return (
    <section className="farmer-page">
      <div className="farmer-page-header farmer-command-header">
        <div className="section-title-with-icon">
          <span className="section-icon">
            <Icon name="farm" size={18} />
          </span>
          <div>
            <div className="label">Farm profile</div>
            <h1>Farm management command center</h1>
            <p className="muted">
              Manage production, finance, insurance, risk, and seasonal expectations in one place.
            </p>
          </div>
        </div>
        <div className="farmer-command-actions">
          <a className="btn ghost small" href="#farm-intelligence">
            Jump to insights
          </a>
          <button className="btn small" type="button" onClick={handleSave} disabled={saving}>
            <Icon name="send" size={14} />
            {saving ? "Saving..." : "Save all updates"}
          </button>
        </div>
      </div>

      {(message || error) && <p className={`status ${error ? "error" : ""}`}>{error ?? message}</p>}

      <section className="farmer-card farmer-command-hero">
        <div className="farmer-command-hero-copy">
          <div className="label">Portfolio posture</div>
          <h3>{activeFarm ? `${activeFarm.name || "Active farm"} is the current planning focus` : "Start by selecting a farm"}</h3>
          <p className="muted">
            Portfolio readiness is {portfolioReadinessScore}/5. Use the farm switcher below, then update production, finance, risk, and execution in sequence.
          </p>
          <div className="farmer-chip-row">
            <span className="chip">Farms: {farms.length}</span>
            <span className="chip">Risk avg: {portfolioRiskScore != null ? `${portfolioRiskScore.toFixed(1)} / 5` : "--"}</span>
            <span className="chip">Coverage: {totalCoverage > 0 ? formatMoney(totalCoverage, primaryCurrency) : "--"}</span>
          </div>
        </div>
        <div className="farmer-command-hero-side">
          <article className="farmer-command-mini-card">
            <span className="label">Portfolio margin</span>
            <strong>{portfolioMargin !== 0 ? formatMoney(portfolioMargin, primaryCurrency) : "--"}</strong>
            <span className="muted">Expected revenue minus planned cost</span>
          </article>
          <article className="farmer-command-mini-card">
            <span className="label">Active readiness</span>
            <strong>{activeFarm ? `${activeFarmReadinessScore}/5` : "--"}</strong>
            <span className="muted">Core planning checks complete</span>
          </article>
        </div>
      </section>

      <section className="farmer-card">
        <div className="farmer-card-header">
          <div className="section-title-with-icon">
            <span className="section-icon">
              <Icon name="overview" size={18} />
            </span>
            <div>
              <div className="label">Portfolio</div>
              <h3>Registered farms and totals</h3>
            </div>
          </div>
          <button className="btn ghost small" type="button" onClick={addFarm}>
            <Icon name="plus" size={14} /> Add farm
          </button>
        </div>

        <div className="farmer-filter-chip-row farm-section-nav">
          <a className="btn ghost tiny" href="#farm-identity">
            Identity
          </a>
          <a className="btn ghost tiny" href="#farm-expectations">
            Expectations
          </a>
          <a className="btn ghost tiny" href="#farm-finance">
            Finance
          </a>
          <a className="btn ghost tiny" href="#farm-insurance">
            Insurance
          </a>
          <a className="btn ghost tiny" href="#farm-risk-operations">
            Risk and ops
          </a>
          <a className="btn ghost tiny" href="#farm-intelligence">
            Intelligence
          </a>
          <a className="btn ghost tiny" href="#farm-settings">
            Settings
          </a>
        </div>

        <div className="farm-summary-grid">
          <div className="farm-summary-card">
            <div className="label">Farms</div>
            <div className="farm-summary-value">{farms.length}</div>
          </div>
          <div className="farm-summary-card">
            <div className="label">Unique crops</div>
            <div className="farm-summary-value">{uniqueCropCount}</div>
          </div>
          <div className="farm-summary-card">
            <div className="label">Water access farms</div>
            <div className="farm-summary-value">{farmsWithWaterAccess}</div>
          </div>
          <div className="farm-summary-card">
            <div className="label">Insured farms</div>
            <div className="farm-summary-value">{insuredFarms}</div>
          </div>
          <div className="farm-summary-card">
            <div className="label">Total acres</div>
            <div className="farm-summary-value">{totalAreaAcres > 0 ? totalAreaAcres.toFixed(1) : "--"}</div>
          </div>
          <div className="farm-summary-card">
            <div className="label">Expected revenue</div>
            <div className="farm-summary-value">
              {totalProjectedRevenue > 0 ? formatMoney(totalProjectedRevenue, primaryCurrency) : "--"}
            </div>
          </div>
          <div className="farm-summary-card">
            <div className="label">Planned cost</div>
            <div className="farm-summary-value">{totalPlannedCost > 0 ? formatMoney(totalPlannedCost, primaryCurrency) : "--"}</div>
          </div>
          <div className="farm-summary-card">
            <div className="label">Expected margin</div>
            <div className="farm-summary-value">{portfolioMargin !== 0 ? formatMoney(portfolioMargin, primaryCurrency) : "--"}</div>
          </div>
        </div>

        <div className="farmer-inline-meta">
          Insurance coverage tracked: {totalCoverage > 0 ? formatMoney(totalCoverage, primaryCurrency) : "--"}.
          {mixedCurrency ? " Portfolio has mixed currencies; totals are shown in native units by default." : ""}
        </div>
        <div className="farm-portfolio-grid">
          {farms.map((farm) => (
            <article key={farm.id} className={`farm-portfolio-item ${farm.id === activeFarmId ? "active" : ""}`}>
              <button className="farm-portfolio-select" type="button" onClick={() => setActiveFarmId(farm.id)}>
                <div className="farm-portfolio-title-row">
                  <strong>{farm.name || "Unnamed farm"}</strong>
                  {farm.isPrimary ? <span className="pill">primary</span> : null}
                </div>
                <div className="farm-portfolio-meta">
                  {[farm.parish, farm.district].filter(Boolean).join(", ") || "Location not set"}
                </div>
                <div className="farm-portfolio-meta">{farm.crops.length} crop{farm.crops.length === 1 ? "" : "s"}</div>
                <div className="farm-portfolio-meta">
                  Risk: {formatDecimal(farmRiskAverage(farm))}/5 | Revenue:{" "}
                  {inferProjectedRevenue(farm) > 0 ? formatMoney(inferProjectedRevenue(farm), farm.finance.currency || "UGX") : "--"}
                </div>
              </button>
              <div className="farm-portfolio-actions">
                <button
                  className="btn ghost tiny grik-icon-btn"
                  type="button"
                  onClick={() => markPrimaryFarm(farm.id)}
                  title="Set as primary farm"
                  aria-label="Set as primary farm"
                >
                  <Icon name="shield" size={13} />
                </button>
                <button
                  className="btn ghost tiny grik-icon-btn"
                  type="button"
                  onClick={() => removeFarm(farm.id)}
                  disabled={farms.length <= 1}
                  title="Remove farm"
                  aria-label="Remove farm"
                >
                  <Icon name="trash" size={13} />
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>

      {activeFarm ? (
        <>
          <section className="farmer-card" id="farm-identity">
            <div className="farmer-card-header">
              <div className="section-title-with-icon">
                <span className="section-icon">
                  <Icon name="farm" size={18} />
                </span>
                <div>
                  <div className="label">Active farm</div>
                  <h3>{activeFarm.name || "Farm details"}</h3>
                </div>
              </div>
              {activeFarm.isPrimary ? <span className="pill">Primary planning farm</span> : null}
            </div>

            <div className="farmer-dashboard-grid">
              <div className="farm-kpi-grid">
                <article className="farm-kpi-card">
                  <div className="label">Readiness</div>
                  <strong>{activeFarmReadinessScore}/5</strong>
                </article>
                <article className="farm-kpi-card">
                  <div className="label">Crop mix</div>
                  <strong>{activeFarm.crops.length || "--"}</strong>
                </article>
                <article className="farm-kpi-card">
                  <div className="label">Water access</div>
                  <strong>{activeFarm.hasWaterAccess ? "Available" : "Not tracked"}</strong>
                </article>
                <article className="farm-kpi-card">
                  <div className="label">Last planting</div>
                  <strong>{activeFarm.lastPlantingDate || "--"}</strong>
                </article>
              </div>

              <div className="farmer-side-summary">
                {activeFarmReadinessItems.map((item) => (
                  <div key={item.label} className="farmer-side-summary-item">
                    <span>{item.label}</span>
                    <strong>{item.ready ? "Ready" : "Pending"}</strong>
                  </div>
                ))}
              </div>
            </div>

            <div className="farmer-form-grid">
              <label className="field">
                Farm name
                <input value={activeFarm.name} onChange={(event) => onActiveFarmChange("name", event.target.value)} placeholder="Main farm" />
              </label>
              <label className="field">
                District
                <input value={activeFarm.district} onChange={(event) => onActiveFarmChange("district", event.target.value)} placeholder="Lira" />
              </label>
              <label className="field">
                Parish
                <input value={activeFarm.parish} onChange={(event) => onActiveFarmChange("parish", event.target.value)} placeholder="Aromo" />
              </label>
              <label className="field farmer-form-span">
                Crops grown
                <select
                  multiple
                  value={activeFarm.crops}
                  onChange={(event) =>
                    onActiveFarmChange(
                      "crops",
                      Array.from(event.target.selectedOptions, (option) => option.value)
                    )
                  }
                >
                  {cropOptions.map((crop) => (
                    <option key={crop} value={crop}>
                      {crop}
                    </option>
                  ))}
                </select>
                <span className="field-note">Use Ctrl/Cmd-click to select multiple crops.</span>
              </label>
              <label className="field">
                Last planting date
                <input
                  type="date"
                  value={activeFarm.lastPlantingDate}
                  onChange={(event) => onActiveFarmChange("lastPlantingDate", event.target.value)}
                />
              </label>
              <label className="field">
                Soil type
                <select value={activeFarm.soilType} onChange={(event) => onActiveFarmChange("soilType", event.target.value)}>
                  <option value="">Select soil type</option>
                  {soilTypeOptions.map((soilType) => (
                    <option key={soilType} value={soilType}>
                      {soilType}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Farm size (acres)
                <input
                  type="number"
                  value={activeFarm.farmSizeAcres}
                  onChange={(event) => onActiveFarmChange("farmSizeAcres", event.target.value)}
                  placeholder="2.5"
                />
              </label>
              <label className="field farmer-form-span">
                Farm notes
                <textarea
                  value={activeFarm.notes}
                  onChange={(event) => onActiveFarmChange("notes", event.target.value)}
                  rows={3}
                  placeholder="Main constraints, land issues, labor bottlenecks, or critical context."
                />
              </label>
            </div>

            <label className="toggle">
              <input
                type="checkbox"
                checked={activeFarm.hasWaterAccess}
                onChange={(event) => onActiveFarmChange("hasWaterAccess", event.target.checked)}
              />
              <span>Water access available on this farm</span>
            </label>
          </section>

          <section className="farmer-card" id="farm-expectations">
            <div className="farmer-card-header">
              <div className="section-title-with-icon">
                <span className="section-icon">
                  <Icon name="activity" size={18} />
                </span>
                <div>
                  <div className="label">Season expectations</div>
                  <h3>Yield, market, and outcome targets</h3>
                </div>
              </div>
            </div>

            <div className="farmer-form-grid">
              <label className="field">
                Season label
                <input
                  value={activeFarm.expectations.seasonLabel}
                  onChange={(event) => onExpectationsChange("seasonLabel", event.target.value)}
                  placeholder="2026 Season A"
                />
              </label>
              <label className="field">
                Planting window start
                <input
                  type="date"
                  value={activeFarm.expectations.plantingWindowStart}
                  onChange={(event) => onExpectationsChange("plantingWindowStart", event.target.value)}
                />
              </label>
              <label className="field">
                Planting window end
                <input
                  type="date"
                  value={activeFarm.expectations.plantingWindowEnd}
                  onChange={(event) => onExpectationsChange("plantingWindowEnd", event.target.value)}
                />
              </label>
              <label className="field">
                Target harvest date
                <input
                  type="date"
                  value={activeFarm.expectations.targetHarvestDate}
                  onChange={(event) => onExpectationsChange("targetHarvestDate", event.target.value)}
                />
              </label>
              <label className="field">
                Target yield (kg)
                <input
                  type="number"
                  value={activeFarm.expectations.targetYieldKg}
                  onChange={(event) => onExpectationsChange("targetYieldKg", event.target.value)}
                  placeholder="3600"
                />
              </label>
              <label className="field">
                Expected price per kg
                <input
                  type="number"
                  value={activeFarm.expectations.expectedPricePerKg}
                  onChange={(event) => onExpectationsChange("expectedPricePerKg", event.target.value)}
                  placeholder="1200"
                />
              </label>
              <label className="field">
                Revenue target (optional override)
                <input
                  type="number"
                  value={activeFarm.expectations.projectedRevenue}
                  onChange={(event) => onExpectationsChange("projectedRevenue", event.target.value)}
                  placeholder="4200000"
                />
              </label>
              <label className="field">
                Confidence (%)
                <input
                  type="number"
                  value={activeFarm.expectations.confidencePct}
                  onChange={(event) => onExpectationsChange("confidencePct", event.target.value)}
                  placeholder="65"
                />
              </label>
              <label className="field farmer-form-span">
                Buyer plan / market channel
                <textarea
                  rows={2}
                  value={activeFarm.expectations.buyerPlan}
                  onChange={(event) => onExpectationsChange("buyerPlan", event.target.value)}
                  placeholder="Cooperative bulk sale, direct market, contract buyer..."
                />
              </label>
            </div>

            <div className="farm-kpi-grid">
              <article className="farm-kpi-card">
                <div className="label">Projected revenue</div>
                <strong>{activeProjectedRevenue > 0 ? formatMoney(activeProjectedRevenue, activeFarm.finance.currency || "UGX") : "--"}</strong>
              </article>
              <article className="farm-kpi-card">
                <div className="label">Planned season cost</div>
                <strong>{activePlannedCost > 0 ? formatMoney(activePlannedCost, activeFarm.finance.currency || "UGX") : "--"}</strong>
              </article>
              <article className="farm-kpi-card">
                <div className="label">Expected margin</div>
                <strong>{activeExpectedMargin !== 0 ? formatMoney(activeExpectedMargin, activeFarm.finance.currency || "UGX") : "--"}</strong>
              </article>
              <article className="farm-kpi-card">
                <div className="label">Break-even price/kg</div>
                <strong>{breakEvenPrice != null ? formatMoney(breakEvenPrice, activeFarm.finance.currency || "UGX") : "--"}</strong>
              </article>
              <article className="farm-kpi-card">
                <div className="label">Break-even yield (kg)</div>
                <strong>{breakEvenYield != null ? breakEvenYield.toFixed(0) : "--"}</strong>
              </article>
              <article className="farm-kpi-card">
                <div className="label">Risk score</div>
                <strong>{activeFarmRiskScore != null ? `${activeFarmRiskScore.toFixed(1)} / 5` : "--"}</strong>
              </article>
            </div>
          </section>

          <section className="farmer-card" id="farm-finance">
            <div className="farmer-card-header">
              <div className="section-title-with-icon">
                <span className="section-icon">
                  <Icon name="finance" size={18} />
                </span>
                <div>
                  <div className="label">Finance management</div>
                  <h3>Budget, liquidity, and credit</h3>
                </div>
              </div>
            </div>

            <div className="farmer-form-grid">
              <label className="field">
                Currency
                <select value={activeFarm.finance.currency} onChange={(event) => onFinanceChange("currency", event.target.value)}>
                  {CURRENCY_OPTIONS.map((currency) => (
                    <option key={currency} value={currency}>
                      {currency}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Planned input cost
                <input
                  type="number"
                  value={activeFarm.finance.plannedInputCost}
                  onChange={(event) => onFinanceChange("plannedInputCost", event.target.value)}
                  placeholder="Seeds, fertilizer, pesticides"
                />
              </label>
              <label className="field">
                Planned labor cost
                <input
                  type="number"
                  value={activeFarm.finance.plannedLaborCost}
                  onChange={(event) => onFinanceChange("plannedLaborCost", event.target.value)}
                  placeholder="Hiring and supervision"
                />
              </label>
              <label className="field">
                Planned logistics cost
                <input
                  type="number"
                  value={activeFarm.finance.plannedLogisticsCost}
                  onChange={(event) => onFinanceChange("plannedLogisticsCost", event.target.value)}
                  placeholder="Transport and post-harvest handling"
                />
              </label>
              <label className="field">
                Planned other cost
                <input
                  type="number"
                  value={activeFarm.finance.plannedOtherCost}
                  onChange={(event) => onFinanceChange("plannedOtherCost", event.target.value)}
                  placeholder="Rent, tools, fees"
                />
              </label>
              <label className="field">
                Loan principal
                <input
                  type="number"
                  value={activeFarm.finance.loanPrincipal}
                  onChange={(event) => onFinanceChange("loanPrincipal", event.target.value)}
                  placeholder="Current credit amount"
                />
              </label>
              <label className="field">
                Loan interest (%)
                <input
                  type="number"
                  value={activeFarm.finance.loanInterestPct}
                  onChange={(event) => onFinanceChange("loanInterestPct", event.target.value)}
                  placeholder="18"
                />
              </label>
              <label className="field">
                Expected installment
                <input
                  type="number"
                  value={activeFarm.finance.expectedInstallment}
                  onChange={(event) => onFinanceChange("expectedInstallment", event.target.value)}
                  placeholder="Per cycle repayment"
                />
              </label>
              <label className="field">
                Cash on hand
                <input
                  type="number"
                  value={activeFarm.finance.currentCashOnHand}
                  onChange={(event) => onFinanceChange("currentCashOnHand", event.target.value)}
                  placeholder="Available liquidity"
                />
              </label>
              <label className="field">
                Savings target
                <input
                  type="number"
                  value={activeFarm.finance.savingsTarget}
                  onChange={(event) => onFinanceChange("savingsTarget", event.target.value)}
                  placeholder="Season savings goal"
                />
              </label>
              <label className="field farmer-form-span">
                Finance notes
                <textarea
                  rows={2}
                  value={activeFarm.finance.notes}
                  onChange={(event) => onFinanceChange("notes", event.target.value)}
                  placeholder="Loan conditions, repayment risks, supplier credit terms..."
                />
              </label>
            </div>
          </section>

          <section className="farmer-card" id="farm-insurance">
            <div className="farmer-card-header">
              <div className="section-title-with-icon">
                <span className="section-icon">
                  <Icon name="shield" size={18} />
                </span>
                <div>
                  <div className="label">Insurance</div>
                  <h3>Protection and claim readiness</h3>
                </div>
              </div>
            </div>

            <label className="toggle">
              <input
                type="checkbox"
                checked={activeFarm.insurance.enrolled}
                onChange={(event) => onInsuranceChange("enrolled", event.target.checked)}
              />
              <span>Farm enrolled in insurance</span>
            </label>

            <div className="farmer-form-grid">
              <label className="field">
                Insurance provider
                <input
                  value={activeFarm.insurance.provider}
                  onChange={(event) => onInsuranceChange("provider", event.target.value)}
                  placeholder="Name of insurer or cooperative"
                />
              </label>
              <label className="field">
                Product type
                <select value={activeFarm.insurance.productType} onChange={(event) => onInsuranceChange("productType", event.target.value)}>
                  <option value="">Select product</option>
                  {INSURANCE_PRODUCT_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Policy number
                <input
                  value={activeFarm.insurance.policyNumber}
                  onChange={(event) => onInsuranceChange("policyNumber", event.target.value)}
                  placeholder="Policy reference"
                />
              </label>
              <label className="field">
                Coverage amount
                <input
                  type="number"
                  value={activeFarm.insurance.coverageAmount}
                  onChange={(event) => onInsuranceChange("coverageAmount", event.target.value)}
                  placeholder="Coverage value"
                />
              </label>
              <label className="field">
                Premium amount
                <input
                  type="number"
                  value={activeFarm.insurance.premiumAmount}
                  onChange={(event) => onInsuranceChange("premiumAmount", event.target.value)}
                  placeholder="Premium paid"
                />
              </label>
              <label className="field">
                Policy start date
                <input type="date" value={activeFarm.insurance.startDate} onChange={(event) => onInsuranceChange("startDate", event.target.value)} />
              </label>
              <label className="field">
                Policy end date
                <input type="date" value={activeFarm.insurance.endDate} onChange={(event) => onInsuranceChange("endDate", event.target.value)} />
              </label>
              <label className="field">
                Claim status
                <select value={activeFarm.insurance.claimStatus} onChange={(event) => onInsuranceChange("claimStatus", event.target.value)}>
                  {CLAIM_STATUS_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Last claim amount
                <input
                  type="number"
                  value={activeFarm.insurance.lastClaimAmount}
                  onChange={(event) => onInsuranceChange("lastClaimAmount", event.target.value)}
                  placeholder="0"
                />
              </label>
              <label className="field">
                Last claim date
                <input
                  type="date"
                  value={activeFarm.insurance.lastClaimDate}
                  onChange={(event) => onInsuranceChange("lastClaimDate", event.target.value)}
                />
              </label>
              <label className="field farmer-form-span">
                Trigger model / conditions
                <textarea
                  rows={2}
                  value={activeFarm.insurance.triggerModel}
                  onChange={(event) => onInsuranceChange("triggerModel", event.target.value)}
                  placeholder="Rainfall threshold, loss threshold, NDVI trigger, etc."
                />
              </label>
            </div>
          </section>

          <section className="farmer-card" id="farm-risk-operations">
            <div className="farmer-card-header">
              <div className="section-title-with-icon">
                <span className="section-icon">
                  <Icon name="climate" size={18} />
                </span>
                <div>
                  <div className="label">Risk and operations</div>
                  <h3>Preparedness, staffing, and execution</h3>
                </div>
              </div>
            </div>

            <div className="farmer-form-grid">
              <label className="field">
                Drought risk (1-5)
                <select value={activeFarm.risk.droughtRisk} onChange={(event) => onRiskChange("droughtRisk", event.target.value)}>
                  <option value="">Select</option>
                  {RISK_LEVEL_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Flood risk (1-5)
                <select value={activeFarm.risk.floodRisk} onChange={(event) => onRiskChange("floodRisk", event.target.value)}>
                  <option value="">Select</option>
                  {RISK_LEVEL_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Pest risk (1-5)
                <select value={activeFarm.risk.pestRisk} onChange={(event) => onRiskChange("pestRisk", event.target.value)}>
                  <option value="">Select</option>
                  {RISK_LEVEL_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Disease risk (1-5)
                <select value={activeFarm.risk.diseaseRisk} onChange={(event) => onRiskChange("diseaseRisk", event.target.value)}>
                  <option value="">Select</option>
                  {RISK_LEVEL_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Market risk (1-5)
                <select value={activeFarm.risk.marketRisk} onChange={(event) => onRiskChange("marketRisk", event.target.value)}>
                  <option value="">Select</option>
                  {RISK_LEVEL_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Next preparedness drill
                <input
                  type="date"
                  value={activeFarm.risk.nextPreparednessDrillDate}
                  onChange={(event) => onRiskChange("nextPreparednessDrillDate", event.target.value)}
                />
              </label>
              <label className="field farmer-form-span">
                Mitigation plan
                <textarea
                  rows={2}
                  value={activeFarm.risk.mitigationPlan}
                  onChange={(event) => onRiskChange("mitigationPlan", event.target.value)}
                  placeholder="Contingency actions for drought, pests, flood, and market shocks."
                />
              </label>
            </div>

            <div className="farmer-form-grid">
              <label className="field">
                Lead farmer
                <input
                  value={activeFarm.operations.leadFarmerName}
                  onChange={(event) => onOperationsChange("leadFarmerName", event.target.value)}
                  placeholder="Farm lead name"
                />
              </label>
              <label className="field">
                Lead farmer phone
                <input
                  value={activeFarm.operations.leadFarmerPhone}
                  onChange={(event) => onOperationsChange("leadFarmerPhone", event.target.value)}
                  placeholder="+256..."
                />
              </label>
              <label className="field">
                Extension officer
                <input
                  value={activeFarm.operations.extensionOfficerName}
                  onChange={(event) => onOperationsChange("extensionOfficerName", event.target.value)}
                  placeholder="Officer or agent"
                />
              </label>
              <label className="field">
                Extension officer phone
                <input
                  value={activeFarm.operations.extensionOfficerPhone}
                  onChange={(event) => onOperationsChange("extensionOfficerPhone", event.target.value)}
                  placeholder="+256..."
                />
              </label>
              <label className="field">
                Irrigation type
                <select value={activeFarm.operations.irrigationType} onChange={(event) => onOperationsChange("irrigationType", event.target.value)}>
                  <option value="">Select irrigation</option>
                  {IRRIGATION_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Storage capacity (kg)
                <input
                  type="number"
                  value={activeFarm.operations.storageCapacityKg}
                  onChange={(event) => onOperationsChange("storageCapacityKg", event.target.value)}
                  placeholder="1200"
                />
              </label>
              <label className="field">
                Household labor count
                <input
                  type="number"
                  value={activeFarm.operations.householdLaborCount}
                  onChange={(event) => onOperationsChange("householdLaborCount", event.target.value)}
                  placeholder="3"
                />
              </label>
              <label className="field">
                Hired labor count
                <input
                  type="number"
                  value={activeFarm.operations.hiredLaborCount}
                  onChange={(event) => onOperationsChange("hiredLaborCount", event.target.value)}
                  placeholder="6"
                />
              </label>
              <label className="field">
                Mechanization access
                <select value={activeFarm.operations.mechanizationAccess} onChange={(event) => onOperationsChange("mechanizationAccess", event.target.value)}>
                  <option value="">Select</option>
                  {MECHANIZATION_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Input supplier
                <input
                  value={activeFarm.operations.inputSupplier}
                  onChange={(event) => onOperationsChange("inputSupplier", event.target.value)}
                  placeholder="Supplier, agro-dealer, cooperative"
                />
              </label>
              <label className="field">
                Next action date
                <input
                  type="date"
                  value={activeFarm.operations.nextActionDate}
                  onChange={(event) => onOperationsChange("nextActionDate", event.target.value)}
                />
              </label>
              <label className="field farmer-form-span">
                Next action note
                <textarea
                  rows={2}
                  value={activeFarm.operations.nextActionNote}
                  onChange={(event) => onOperationsChange("nextActionNote", event.target.value)}
                  placeholder="What must be done next and by whom?"
                />
              </label>
              <label className="field farmer-form-span">
                Agroecology practices in use
                <select
                  multiple
                  value={activeFarm.operations.agroecologyPractices}
                  onChange={(event) =>
                    onOperationsChange(
                      "agroecologyPractices",
                      Array.from(event.target.selectedOptions, (option) => option.value)
                    )
                  }
                >
                  {AGROECOLOGY_PRACTICES.map((practice) => (
                    <option key={practice} value={practice}>
                      {practice}
                    </option>
                  ))}
                </select>
                <span className="field-note">Track climate-smart and regenerative practices per farm.</span>
              </label>
            </div>
          </section>

          <section className="farmer-card" id="farm-intelligence">
            <div className="farmer-card-header">
              <div className="section-title-with-icon">
                <span className="section-icon">
                  <Icon name="spark" size={18} />
                </span>
                <div>
                  <div className="label">Farm intelligence</div>
                  <h3>Priority actions from your live profile</h3>
                </div>
              </div>
            </div>

            <div className="farm-insight-grid">
              {activeFarmInsights.map((insight) => (
                <article key={insight.id} className={`farm-insight-card ${insight.level}`}>
                  <div className="farm-insight-heading">
                    <strong>{insight.title}</strong>
                    <span className={`farm-insight-badge ${insight.level}`}>{insight.level}</span>
                  </div>
                  <p>{insight.detail}</p>
                  <div className="farm-insight-action">{insight.action}</div>
                </article>
              ))}
            </div>

            <div className="farm-insight-meta">
              Cash runway:{" "}
              {activeCashRunway != null ? `${Math.max(activeCashRunway, 0).toFixed(2)}x season cost` : "--"} | Coverage ratio:{" "}
              {activeCoverageRatio != null ? `${(Math.max(activeCoverageRatio, 0) * 100).toFixed(0)}% of expected revenue` : "--"} | Risk
              score: {activeFarmRiskScore != null ? `${activeFarmRiskScore.toFixed(1)} / 5` : "--"}
            </div>
          </section>
        </>
      ) : null}

      <section className="farmer-card" id="farm-settings">
        <div className="farmer-card-header">
          <div className="section-title-with-icon">
            <span className="section-icon">
              <Icon name="services" size={18} />
            </span>
            <div>
              <div className="label">Farmer settings</div>
              <h3>Channels and alert preferences</h3>
            </div>
          </div>
        </div>

        <div className="farmer-form-grid">
          <label className="field">
            Preferred language
            <input
              value={settings.preferredLanguage}
              onChange={(event) => onSettingsChange("preferredLanguage", event.target.value)}
              placeholder="English / Luganda / Runyankole"
            />
          </label>
          <label className="field">
            Default district (synced from primary farm)
            <input value={settings.district} onChange={(event) => onSettingsChange("district", event.target.value)} placeholder="Lira" />
          </label>
          <label className="field">
            Default parish (synced from primary farm)
            <input value={settings.parish} onChange={(event) => onSettingsChange("parish", event.target.value)} placeholder="Aromo" />
          </label>
        </div>

        <div className="farmer-toggle-grid">
          <label className="toggle">
            <input type="checkbox" checked={settings.smsOptIn} onChange={(event) => onSettingsChange("smsOptIn", event.target.checked)} />
            <span>SMS updates</span>
          </label>
          <label className="toggle">
            <input type="checkbox" checked={settings.voiceOptIn} onChange={(event) => onSettingsChange("voiceOptIn", event.target.checked)} />
            <span>Voice updates</span>
          </label>
          <label className="toggle">
            <input type="checkbox" checked={settings.weatherAlerts} onChange={(event) => onSettingsChange("weatherAlerts", event.target.checked)} />
            <span>Weather alerts</span>
          </label>
          <label className="toggle">
            <input type="checkbox" checked={settings.priceAlerts} onChange={(event) => onSettingsChange("priceAlerts", event.target.checked)} />
            <span>Price alerts</span>
          </label>
        </div>

        <button className="btn" type="button" onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : "Save farm management profile"}
        </button>
      </section>

      <section className="farmer-card">
        <div className="farmer-card-header">
          <div className="section-title-with-icon">
            <span className="section-icon">
              <Icon name="spark" size={18} />
            </span>
            <div>
              <div className="label">Decision support</div>
              <h3>What this profile unlocks in GRIK</h3>
            </div>
          </div>
        </div>
        <ul className="grik-stack-list">
          <li>Farm-level yield and profitability projections tied to your actual cost structure</li>
          <li>Insurance readiness tracking, policy context, and future claim support</li>
          <li>Risk-based advisory prompts based on drought, flood, pest, and market pressure scores</li>
          <li>Climate-smart operations follow-up through next action dates and practices</li>
          <li>Data foundation for financing discussions with cooperatives, lenders, and insurers</li>
        </ul>
      </section>
    </section>
  );
}
