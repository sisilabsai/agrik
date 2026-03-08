import json
import re
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy.exc import IntegrityError

from app.db.models import AuthUser, AuthUserProfile
from app.db.session import SessionLocal
from app.services.admin_auth import seed_admin_user
from app.services.auth import register_user
from app.services.onboarding import get_onboarding_options, prepare_onboarding, upsert_registration_profile
from app.services.passwords import hash_password
from app.services.phone_numbers import normalize_ugandan_phone, phone_lookup_variants
from app.services.uganda_locations import list_districts, list_parishes

DEFAULT_USER_PASSWORD = "User@AGRIK2026"
EMAIL_DOMAIN = "agrik.app"
PHONE_LOCAL_BASE = 780000000
OUTPUT_PATH = Path("runtime/seeds/test_users_uganda.json")
ROLES = ["farmer", "buyer", "offtaker", "service_provider", "input_supplier"]

FIRST_NAMES = [
    "Wilson",
    "Amina",
    "Brian",
    "Naomi",
    "David",
    "Grace",
    "Irene",
    "Moses",
    "Ruth",
    "Kevin",
    "Sarah",
    "Peter",
    "Janet",
    "Daniel",
    "Mercy",
    "Collins",
    "Sandra",
    "Isaac",
    "Rebecca",
    "Patrick",
    "Martha",
    "Joseph",
    "Esther",
    "Denis",
    "Agnes",
]

MIDDLE_NAMES = [
    "Adoch",
    "Kato",
    "Nabirye",
    "Okello",
    "Ajok",
    "Mugisha",
    "Auma",
    "Bwire",
    "Nalongo",
    "Byaruhanga",
    "Nambusi",
    "Wekesa",
]

LAST_NAMES = [
    "Ecaat",
    "Ssekandi",
    "Tumusiime",
    "Namusoke",
    "Ocen",
    "Kagimu",
    "Nabwire",
    "Ssenfuma",
    "Atwine",
    "Okot",
    "Nankunda",
    "Kibirige",
    "Achan",
    "Byaruhanga",
    "Kiconco",
    "Nalubega",
]


def _slugify(value: str) -> str:
    cleaned = re.sub(r"[^a-z0-9]+", ".", value.strip().lower())
    return re.sub(r"\.+", ".", cleaned).strip(".")


def _unique_name(seed_index: int, role_index: int, used: set[str]) -> str:
    for attempt in range(512):
        first = FIRST_NAMES[(seed_index + role_index * 7 + attempt) % len(FIRST_NAMES)]
        middle = MIDDLE_NAMES[(seed_index * 3 + role_index * 5 + attempt) % len(MIDDLE_NAMES)]
        last = LAST_NAMES[(seed_index * 5 + role_index * 11 + attempt) % len(LAST_NAMES)]
        candidate = f"{first} {middle} {last}"
        if candidate not in used:
            used.add(candidate)
            return candidate
    fallback = f"AGRIK User {seed_index + 1}"
    used.add(fallback)
    return fallback


def _unique_email(local_base: str, used_locals: set[str]) -> str:
    base = _slugify(local_base)[:60] or "user"
    candidate = base
    suffix = 2
    while candidate in used_locals:
        candidate = f"{base[:56]}.{suffix}"
        suffix += 1
    used_locals.add(candidate)
    return f"{candidate}@{EMAIL_DOMAIN}"


def _profile_payload(role: str, district_name: str, crop_pool: list[str], service_pool: list[str], seed_index: int) -> dict:
    crop_a = crop_pool[seed_index % len(crop_pool)]
    crop_b = crop_pool[(seed_index + 7) % len(crop_pool)]
    crops = [crop_a] if crop_a == crop_b else [crop_a, crop_b]

    if role == "farmer":
        return {
            "crops": crops,
            "organization_name": None,
            "service_categories": [],
            "focus_crops": [],
        }

    organization_name = f"{district_name} AGRIK Cooperative"
    if role in {"service_provider", "input_supplier"}:
        service_a = service_pool[seed_index % len(service_pool)]
        service_b = service_pool[(seed_index + 3) % len(service_pool)]
        services = [service_a] if service_a == service_b else [service_a, service_b]
        return {
            "crops": [],
            "organization_name": organization_name,
            "service_categories": services,
            "focus_crops": [],
        }

    return {
        "crops": [],
        "organization_name": organization_name,
        "service_categories": [],
        "focus_crops": crops,
    }


def _seed_admin(db) -> str:
    admin = seed_admin_user(db)
    if not admin:
        return "No admin seeded. Set ADMIN_SEED_EMAIL and ADMIN_SEED_PASSWORD in .env."
    return f"Seeded admin: {admin.email}"


def _find_user_by_phone(db, phone: str) -> AuthUser | None:
    normalized = normalize_ugandan_phone(phone)
    variants = phone_lookup_variants(normalized)
    return db.query(AuthUser).filter(AuthUser.phone.in_(variants)).first()


def main() -> None:
    db = SessionLocal()
    used_names: set[str] = set()
    used_email_locals: set[str] = set()
    created = 0
    updated = 0
    records: list[dict] = []

    try:
        admin_message = _seed_admin(db)

        onboarding = get_onboarding_options()
        crop_pool = onboarding["crops"]
        service_pool = [item["id"] for item in onboarding["service_categories"]]
        districts = list_districts()

        for district_index, district in enumerate(districts):
            _, parishes = list_parishes(district.id)
            if not parishes:
                continue

            for role_index, role in enumerate(ROLES):
                seed_index = district_index * len(ROLES) + role_index
                parish = parishes[role_index % len(parishes)]
                phone = f"+256{PHONE_LOCAL_BASE + seed_index:09d}"
                full_name = _unique_name(seed_index, role_index, used_names)
                email = _unique_email(f"{full_name}.{district.name}.{role}.{seed_index + 1}", used_email_locals)
                profile = _profile_payload(role, district.name, crop_pool, service_pool, seed_index)

                user = _find_user_by_phone(db, phone)
                if not user:
                    try:
                        user = register_user(
                            db,
                            phone=phone,
                            password=DEFAULT_USER_PASSWORD,
                            role=role,
                            full_name=full_name,
                            district=district.id,
                            parish=parish["id"],
                            crops=profile["crops"],
                            organization_name=profile["organization_name"],
                            service_categories=profile["service_categories"],
                            focus_crops=profile["focus_crops"],
                        )
                        created += 1
                    except IntegrityError:
                        db.rollback()
                        user = _find_user_by_phone(db, phone)
                        if not user:
                            raise
                        updated += 1
                else:
                    prepared = prepare_onboarding(
                        role=role,
                        full_name=full_name,
                        district=district.id,
                        parish=parish["id"],
                        crops=profile["crops"],
                        organization_name=profile["organization_name"],
                        service_categories=profile["service_categories"],
                        focus_crops=profile["focus_crops"],
                    )
                    user.role = role
                    if not user.password_hash:
                        user.password_hash = hash_password(DEFAULT_USER_PASSWORD)
                    upsert_registration_profile(
                        db=db,
                        user_id=user.id,
                        phone=phone,
                        role=role,
                        prepared=prepared,
                    )
                    updated += 1

                user.status = "active"
                user.verification_status = "verified"
                db.commit()
                db.refresh(user)

                auth_profile = db.query(AuthUserProfile).filter(AuthUserProfile.user_id == user.id).first()
                if auth_profile:
                    profile_data = dict(auth_profile.profile_data or {})
                    profile_data.update(
                        {
                            "role": role,
                            "email": email,
                            "seed_source": "uganda_test_users_v1",
                        }
                    )
                    auth_profile.profile_data = profile_data
                    db.commit()

                records.append(
                    {
                        "user_id": user.id,
                        "full_name": full_name,
                        "email": email,
                        "phone": phone,
                        "password": DEFAULT_USER_PASSWORD,
                        "role": role,
                        "district_id": district.id,
                        "district": district.name,
                        "parish_id": parish["id"],
                        "parish": parish["name"],
                        "organization_name": profile["organization_name"],
                        "crops": profile["crops"],
                        "service_categories": profile["service_categories"],
                        "focus_crops": profile["focus_crops"],
                    }
                )

        OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "domain": EMAIL_DOMAIN,
            "default_user_password": DEFAULT_USER_PASSWORD,
            "district_count": len(districts),
            "roles_per_district": len(ROLES),
            "target_user_count": len(districts) * len(ROLES),
            "created": created,
            "updated": updated,
            "admin_seed_message": admin_message,
            "users": records,
        }
        OUTPUT_PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")

        print(admin_message)
        print(f"Seeded users: created={created}, updated={updated}, total={len(records)}")
        print(f"Exported: {OUTPUT_PATH}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
