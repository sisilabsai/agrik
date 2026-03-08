from dataclasses import dataclass
from typing import Optional

from sqlalchemy.orm import Session

from app.db.models import AuthUserProfile, AuthUserSettings, Farmer, FarmerProfile
from app.services.marketplace_validation import ALLOWED_CROPS, normalize_crop
from app.services.uganda_locations import resolve_district_and_parish


ROLE_LABELS = {
    "farmer": "Farmer",
    "buyer": "Buyer",
    "offtaker": "Offtaker",
    "service_provider": "Service provider",
    "input_supplier": "Input supplier",
}

ROLE_DESCRIPTIONS = {
    "farmer": "Sell produce, receive advisory, and manage farm operations.",
    "buyer": "Source produce and publish demand in the marketplace.",
    "offtaker": "Run structured procurement and contract sourcing.",
    "service_provider": "Offer field services such as transport and mechanization.",
    "input_supplier": "Provide seeds, inputs, and related agri products.",
}

SERVICE_CATEGORY_OPTIONS = [
    {"id": "mechanization", "label": "Mechanization"},
    {"id": "transport", "label": "Transport"},
    {"id": "spraying", "label": "Spraying"},
    {"id": "storage", "label": "Storage"},
    {"id": "aggregation", "label": "Aggregation"},
    {"id": "drying", "label": "Drying"},
    {"id": "extension", "label": "Extension advisory"},
    {"id": "finance", "label": "Financial services"},
    {"id": "logistics", "label": "Logistics"},
]

SERVICE_CATEGORY_ALIASES = {
    "mechanization": "mechanization",
    "tractor": "mechanization",
    "transport": "transport",
    "spraying": "spraying",
    "storage": "storage",
    "aggregation": "aggregation",
    "drying": "drying",
    "extension": "extension",
    "advisory": "extension",
    "finance": "finance",
    "financial services": "finance",
    "logistics": "logistics",
}

ROLE_REQUIRED_FIELDS = {
    "farmer": ["full_name", "phone", "district", "parish", "crops"],
    "service_provider": ["full_name", "phone", "district", "parish", "organization_name", "service_categories"],
    "input_supplier": ["full_name", "phone", "district", "parish", "organization_name", "service_categories"],
    "buyer": ["full_name", "phone", "district", "parish", "organization_name", "focus_crops"],
    "offtaker": ["full_name", "phone", "district", "parish", "organization_name", "focus_crops"],
}


@dataclass
class PreparedOnboarding:
    full_name: str
    district: str
    parish: str
    crops: list[str]
    organization_name: Optional[str]
    service_categories: list[str]
    focus_crops: list[str]


def _normalize_text(value: str | None) -> str:
    return " ".join((value or "").strip().split())


def _require_text(value: str | None, field_name: str) -> str:
    cleaned = _normalize_text(value)
    if not cleaned:
        raise ValueError(f"{field_name} is required")
    return cleaned


def _dedupe_preserve_order(values: list[str]) -> list[str]:
    seen: set[str] = set()
    deduped: list[str] = []
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        deduped.append(value)
    return deduped


def _normalize_crop_list(values: list[str] | None, field_name: str, required: bool) -> list[str]:
    raw_values = values or []
    normalized: list[str] = []
    for raw in raw_values:
        candidate = normalize_crop(raw)
        if candidate is None:
            allowed = ", ".join(sorted(ALLOWED_CROPS))
            raise ValueError(f"{field_name} includes unsupported crop '{raw}'. Allowed: {allowed}")
        normalized.append(candidate)
    normalized = _dedupe_preserve_order(normalized)
    if required and not normalized:
        raise ValueError(f"{field_name} is required")
    return normalized


def _normalize_service_categories(values: list[str] | None, required: bool) -> list[str]:
    raw_values = values or []
    normalized: list[str] = []
    for raw in raw_values:
        key = _normalize_text(raw).lower()
        mapped = SERVICE_CATEGORY_ALIASES.get(key)
        if not mapped:
            allowed = ", ".join(item["id"] for item in SERVICE_CATEGORY_OPTIONS)
            raise ValueError(f"service_categories includes unsupported value '{raw}'. Allowed: {allowed}")
        normalized.append(mapped)
    normalized = _dedupe_preserve_order(normalized)
    if required and not normalized:
        raise ValueError("service_categories is required")
    return normalized


def prepare_onboarding(
    role: str,
    full_name: str,
    district: str,
    parish: str,
    crops: list[str] | None,
    organization_name: str | None,
    service_categories: list[str] | None,
    focus_crops: list[str] | None,
) -> PreparedOnboarding:
    cleaned_name = _require_text(full_name, "full_name")
    resolved_district, resolved_parish = resolve_district_and_parish(district, parish)

    if role == "farmer":
        return PreparedOnboarding(
            full_name=cleaned_name,
            district=resolved_district,
            parish=resolved_parish,
            crops=_normalize_crop_list(crops, "crops", required=True),
            organization_name=None,
            service_categories=[],
            focus_crops=[],
        )

    if role in {"service_provider", "input_supplier"}:
        return PreparedOnboarding(
            full_name=cleaned_name,
            district=resolved_district,
            parish=resolved_parish,
            crops=[],
            organization_name=_require_text(organization_name, "organization_name"),
            service_categories=_normalize_service_categories(service_categories, required=True),
            focus_crops=[],
        )

    if role in {"buyer", "offtaker"}:
        return PreparedOnboarding(
            full_name=cleaned_name,
            district=resolved_district,
            parish=resolved_parish,
            crops=[],
            organization_name=_require_text(organization_name, "organization_name"),
            service_categories=[],
            focus_crops=_normalize_crop_list(focus_crops, "focus_crops", required=True),
        )

    raise ValueError("unsupported role for onboarding")


def get_onboarding_options() -> dict:
    return {
        "roles": [
            {
                "id": role_id,
                "label": ROLE_LABELS.get(role_id, role_id),
                "description": ROLE_DESCRIPTIONS.get(role_id, ""),
                "required_fields": ROLE_REQUIRED_FIELDS.get(role_id, []),
            }
            for role_id in ROLE_REQUIRED_FIELDS.keys()
        ],
        "service_categories": SERVICE_CATEGORY_OPTIONS,
        "crops": sorted(ALLOWED_CROPS),
        "default_role": "farmer",
    }


def upsert_registration_profile(
    db: Session,
    user_id: str,
    phone: str,
    role: str,
    prepared: PreparedOnboarding,
) -> None:
    auth_profile = db.query(AuthUserProfile).filter(AuthUserProfile.user_id == user_id).first()
    if not auth_profile:
        auth_profile = AuthUserProfile(user_id=user_id)
        db.add(auth_profile)

    auth_profile.full_name = prepared.full_name
    auth_profile.district = prepared.district
    auth_profile.parish = prepared.parish
    auth_profile.crops = prepared.crops
    auth_profile.organization_name = prepared.organization_name
    auth_profile.service_categories = prepared.service_categories
    auth_profile.focus_crops = prepared.focus_crops
    auth_profile.onboarding_stage = "completed"
    auth_profile.profile_data = {"role": role}

    settings = db.query(AuthUserSettings).filter(AuthUserSettings.user_id == user_id).first()
    if not settings:
        settings = AuthUserSettings(user_id=user_id)
        db.add(settings)
    settings.district = prepared.district
    settings.parish = prepared.parish

    if role != "farmer":
        return

    farmer = db.query(Farmer).filter(Farmer.id == user_id).first()
    if not farmer:
        farmer = Farmer(id=user_id, phone=phone)
        db.add(farmer)
    else:
        farmer.phone = phone

    farm_profile = db.query(FarmerProfile).filter(FarmerProfile.farmer_id == user_id).first()
    if not farm_profile:
        farm_profile = FarmerProfile(farmer_id=user_id)
        db.add(farm_profile)
    farm_profile.crops = prepared.crops
