from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_db, get_current_user
from app.schemas.profile import UserSettingsOut, UserSettingsUpdate, SubscriptionOut, SubscriptionCreate, PlatformServiceOut
from app.schemas.user_profile import UserProfileOut, UserProfileUpdate, FarmProfileOut, IdentityProfileOut
from app.schemas.auth import AuthUserOut
from app.db.models import PlatformService, AuthUserProfile
from app.services.user_settings import get_or_create_settings, update_settings
from app.services.user_profile import get_or_create_farmer, get_or_create_farmer_profile, update_farmer_profile
from app.services.subscriptions import get_latest_subscription, create_subscription, list_subscriptions

router = APIRouter()


def _serialize_user(user) -> AuthUserOut:
    return AuthUserOut(
        id=user.id,
        phone=user.phone,
        role=user.role,
        status=user.status,
        verification_status=user.verification_status,
        created_at=user.created_at,
    )


def _serialize_settings(settings) -> UserSettingsOut:
    return UserSettingsOut(
        user_id=settings.user_id,
        preferred_language=settings.preferred_language,
        district=settings.district,
        parish=settings.parish,
        sms_opt_in=settings.sms_opt_in,
        voice_opt_in=settings.voice_opt_in,
        weather_alerts=settings.weather_alerts,
        price_alerts=settings.price_alerts,
        updated_at=settings.updated_at,
    )


def _serialize_farm(profile) -> FarmProfileOut:
    return FarmProfileOut(
        farmer_id=profile.farmer_id,
        crops=profile.crops or [],
        planting_dates=profile.planting_dates or [],
        soil_profile=profile.soil_profile or {},
        climate_exposure=profile.climate_exposure or {},
        yield_estimates=profile.yield_estimates or [],
        updated_at=profile.updated_at,
    )


def _serialize_identity(profile: AuthUserProfile | None) -> IdentityProfileOut | None:
    if not profile:
        return None
    return IdentityProfileOut(
        user_id=profile.user_id,
        full_name=profile.full_name,
        district=profile.district,
        parish=profile.parish,
        crops=profile.crops or [],
        organization_name=profile.organization_name,
        service_categories=profile.service_categories or [],
        focus_crops=profile.focus_crops or [],
        onboarding_stage=profile.onboarding_stage,
        updated_at=profile.updated_at,
    )


@router.get("/settings", response_model=UserSettingsOut)
def read_settings(db: Session = Depends(get_db), user=Depends(get_current_user)) -> UserSettingsOut:
    settings = get_or_create_settings(db, user.id)
    return _serialize_settings(settings)


@router.put("/settings", response_model=UserSettingsOut)
def write_settings(
    payload: UserSettingsUpdate,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
) -> UserSettingsOut:
    settings = update_settings(
        db,
        user.id,
        preferred_language=payload.preferred_language,
        district=payload.district,
        parish=payload.parish,
        sms_opt_in=payload.sms_opt_in,
        voice_opt_in=payload.voice_opt_in,
        weather_alerts=payload.weather_alerts,
        price_alerts=payload.price_alerts,
    )
    return _serialize_settings(settings)


@router.get("/details", response_model=UserProfileOut)
def read_profile(db: Session = Depends(get_db), user=Depends(get_current_user)) -> UserProfileOut:
    settings = get_or_create_settings(db, user.id)
    farmer = get_or_create_farmer(db, user.id, user.phone, settings.preferred_language)
    farm_profile = get_or_create_farmer_profile(db, farmer.id)
    identity_profile = db.query(AuthUserProfile).filter(AuthUserProfile.user_id == user.id).first()
    return UserProfileOut(
        user=_serialize_user(user),
        settings=_serialize_settings(settings),
        farm=_serialize_farm(farm_profile),
        identity=_serialize_identity(identity_profile),
    )


@router.put("/details", response_model=UserProfileOut)
def update_profile(
    payload: UserProfileUpdate,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
) -> UserProfileOut:
    settings = get_or_create_settings(db, user.id)
    if payload.settings:
        settings_data = payload.settings.model_dump(exclude_unset=True)
        if settings_data:
            settings = update_settings(db, user.id, **settings_data)

    farmer = get_or_create_farmer(db, user.id, user.phone, settings.preferred_language)
    farm_profile = get_or_create_farmer_profile(db, farmer.id)
    if payload.farm:
        farm_data = payload.farm.model_dump(exclude_unset=True)
        if farm_data:
            farm_profile = update_farmer_profile(db, farmer.id, **farm_data)

    identity_profile = db.query(AuthUserProfile).filter(AuthUserProfile.user_id == user.id).first()
    identity_changed = False
    if identity_profile:
        if payload.settings:
            if payload.settings.district is not None:
                identity_profile.district = payload.settings.district
                identity_changed = True
            if payload.settings.parish is not None:
                identity_profile.parish = payload.settings.parish
                identity_changed = True
        if payload.farm and payload.farm.crops is not None:
            identity_profile.crops = payload.farm.crops
            identity_changed = True

    if identity_changed:
        db.commit()
        db.refresh(identity_profile)

    return UserProfileOut(
        user=_serialize_user(user),
        settings=_serialize_settings(settings),
        farm=_serialize_farm(farm_profile),
        identity=_serialize_identity(identity_profile),
    )


@router.get("/subscription", response_model=SubscriptionOut)
def read_subscription(db: Session = Depends(get_db), user=Depends(get_current_user)) -> SubscriptionOut:
    subscription = get_latest_subscription(db, user.id)
    if not subscription:
        raise HTTPException(status_code=404, detail="No subscription found")
    return SubscriptionOut(
        id=subscription.id,
        plan=subscription.plan,
        status=subscription.status,
        starts_at=subscription.starts_at,
        ends_at=subscription.ends_at,
        provider=subscription.provider,
        external_ref=subscription.external_ref,
    )


@router.post("/subscription", response_model=SubscriptionOut)
def create_subscription_endpoint(
    payload: SubscriptionCreate,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
) -> SubscriptionOut:
    subscription = create_subscription(
        db,
        user.id,
        plan=payload.plan,
        status=payload.status,
        ends_at=payload.ends_at,
        provider=payload.provider,
        external_ref=payload.external_ref,
    )
    return SubscriptionOut(
        id=subscription.id,
        plan=subscription.plan,
        status=subscription.status,
        starts_at=subscription.starts_at,
        ends_at=subscription.ends_at,
        provider=subscription.provider,
        external_ref=subscription.external_ref,
    )


@router.get("/subscriptions", response_model=list[SubscriptionOut])
def read_subscriptions(
    limit: int = 50,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
) -> list[SubscriptionOut]:
    rows = list_subscriptions(db, user.id, limit=limit)
    return [
        SubscriptionOut(
            id=item.id,
            plan=item.plan,
            status=item.status,
            starts_at=item.starts_at,
            ends_at=item.ends_at,
            provider=item.provider,
            external_ref=item.external_ref,
        )
        for item in rows
    ]


@router.get("/platform-services", response_model=list[PlatformServiceOut])
def read_platform_services(
    status: str | None = "open",
    limit: int = 100,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
) -> list[PlatformServiceOut]:
    query = db.query(PlatformService)
    if status:
        query = query.filter(PlatformService.status == status)
    rows = query.order_by(PlatformService.created_at.desc()).limit(limit).all()
    return [
        PlatformServiceOut(
            id=item.id,
            service_type=item.service_type,
            description=item.description,
            price=item.price,
            currency=item.currency,
            status=item.status,
            created_at=item.created_at,
            updated_at=item.updated_at,
        )
        for item in rows
    ]
