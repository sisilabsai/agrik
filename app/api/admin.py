from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.api.admin_deps import require_admin_user
from app.db.models import (
    AuthUser,
    AuthUserProfile,
    AdminActivity,
    ChatMessage,
    MarketUser,
    MarketListing,
    MarketLocation,
    MarketAlert,
    MarketOffer,
    PlatformService,
    MarketPrice,
)
from app.schemas.admin import (
    AdminUserOut,
    AdminUserUpdate,
    AdminUserActivityItem,
    AdminListingUpdate,
    AdminSummaryOut,
    AdminActivityOut,
    AdminActivityResponse,
    AdminServiceCreate,
    AdminServiceUpdate,
    AdminServiceOut,
    AdminServicesResponse,
    AdminAlertCreate,
    AdminAlertBulkCreate,
    AdminAlertUpdate,
    AdminAlertOut,
    AdminAlertsResponse,
    AdminSeedServicesRequest,
    AdminMetadataOut,
    AdminMetadataUser,
    AdminPriceUpdate,
)
from app.schemas.marketplace import (
    MarketListingOut,
    MarketListingsResponse,
    MarketPriceOut,
    MarketPricesResponse,
    MarketPriceCreate,
)
from app.services.marketplace import list_listings, list_prices, create_price, create_location, get_or_create_market_user
from app.services.admin_audit import record_admin_activity

router = APIRouter()


DEFAULT_PLATFORM_SERVICE_TYPES = [
    "AI Advisory (SMS)",
    "AI Voice Assistant",
    "Smartphone App Premium",
    "Advanced Advisory (Image Diagnosis)",
    "Extension Dashboard",
    "Weather Farming Alerts",
    "Geospatial Intelligence & Soil Insights",
    "Pest & Disease Alerts",
    "Market Price Intelligence",
    "Agroecology Coaching",
    "Digital Farm Memory",
    "Insurance Enablement",
    "Credit & Input Financing",
    "Digital Financial Identity",
    "Yield & Profit Forecasting",
]


def _serialize_location(location: MarketLocation | None):
    if not location:
        return None
    return {
        "id": location.id,
        "district": location.district,
        "parish": location.parish,
        "latitude": location.latitude,
        "longitude": location.longitude,
        "geometry_wkt": location.geometry_wkt,
    }


def _serialize_service(
    service: PlatformService,
) -> AdminServiceOut:
    return AdminServiceOut(
        id=service.id,
        service_type=service.service_type,
        description=service.description,
        price=service.price,
        currency=service.currency,
        status=service.status,
        created_at=service.created_at,
        updated_at=service.updated_at,
    )


def _serialize_alert(
    alert: MarketAlert, location: MarketLocation | None, target_phone: str | None
) -> AdminAlertOut:
    return AdminAlertOut(
        id=alert.id,
        user_id=alert.user_id,
        target_phone=target_phone,
        alert_type=alert.alert_type,
        crop=alert.crop,
        threshold=alert.threshold,
        channel=alert.channel,
        active=alert.active,
        min_interval_hours=alert.min_interval_hours,
        last_notified_at=alert.last_notified_at,
        created_at=alert.created_at,
        location=_serialize_location(location),
    )


def _as_string_list(value) -> list[str]:
    if isinstance(value, list):
        return [item for item in value if isinstance(item, str) and item.strip()]
    return []


def _summarize_admin_activity_details(details: dict) -> str | None:
    if not isinstance(details, dict):
        return None
    changes = details.get("changes")
    if isinstance(changes, dict):
        changed_fields = [key for key in changes.keys() if isinstance(key, str)]
        if changed_fields:
            return "Updated fields: " + ", ".join(changed_fields[:4])
    note = details.get("note")
    if isinstance(note, str) and note.strip():
        return note.strip()
    return None


@router.get("/summary", response_model=AdminSummaryOut)
def admin_summary(db: Session = Depends(get_db), admin=Depends(require_admin_user), request: Request = None) -> AdminSummaryOut:
    if request is not None:
        record_admin_activity(
            db,
            admin.id,
            "admin_view_summary",
            details={},
            ip_address=request.client.host if request.client else None,
        )
    users_total = db.query(AuthUser).count()
    users_verified = db.query(AuthUser).filter(AuthUser.verification_status == "verified").count()
    users_pending = db.query(AuthUser).filter(AuthUser.verification_status != "verified").count()
    return AdminSummaryOut(
        users_total=users_total,
        users_verified=users_verified,
        users_pending=users_pending,
        listings=db.query(MarketListing).count(),
        offers=db.query(MarketOffer).count(),
        services=db.query(PlatformService).count(),
        alerts=db.query(MarketAlert).count(),
        prices=db.query(MarketPrice).count(),
    )


@router.get("/users", response_model=list[AdminUserOut])
def list_users(
    role: str | None = None,
    status: str | None = None,
    verification_status: str | None = None,
    limit: int = 50,
    offset: int = 0,
    db: Session = Depends(get_db),
    admin=Depends(require_admin_user),
    request: Request = None,
) -> list[AdminUserOut]:
    query = db.query(AuthUser)
    if role:
        query = query.filter(AuthUser.role == role)
    if status:
        query = query.filter(AuthUser.status == status)
    if verification_status:
        query = query.filter(AuthUser.verification_status == verification_status)
    rows = query.order_by(AuthUser.created_at.desc()).limit(limit).offset(offset).all()
    if request is not None:
        record_admin_activity(
            db,
            admin.id,
            "admin_list_users",
            details={"count": len(rows)},
            ip_address=request.client.host if request.client else None,
        )
    if not rows:
        return []

    user_ids = [row.id for row in rows]
    user_id_set = set(user_ids)
    phones = [row.phone for row in rows if row.phone]

    profiles = db.query(AuthUserProfile).filter(AuthUserProfile.user_id.in_(user_ids)).all()
    profile_by_user = {profile.user_id: profile for profile in profiles}

    market_users = db.query(MarketUser).filter(MarketUser.phone.in_(phones)).all() if phones else []
    market_user_by_phone = {item.phone: item for item in market_users if item.phone}
    market_user_ids = [item.id for item in market_users]

    listing_counts: dict[str, int] = {}
    alert_counts: dict[str, int] = {}
    offer_counts: dict[str, int] = {}
    if market_user_ids:
        listing_counts = {
            user_id: int(count)
            for user_id, count in db.query(MarketListing.user_id, func.count(MarketListing.id))
            .filter(MarketListing.user_id.in_(market_user_ids))
            .group_by(MarketListing.user_id)
            .all()
        }
        alert_counts = {
            user_id: int(count)
            for user_id, count in db.query(MarketAlert.user_id, func.count(MarketAlert.id))
            .filter(MarketAlert.user_id.in_(market_user_ids))
            .group_by(MarketAlert.user_id)
            .all()
        }
        offer_counts = {
            user_id: int(count)
            for user_id, count in db.query(MarketOffer.user_id, func.count(MarketOffer.id))
            .filter(MarketOffer.user_id.in_(market_user_ids))
            .group_by(MarketOffer.user_id)
            .all()
        }

    chat_stats_by_user: dict[str, tuple[int, object | None]] = {}
    chat_rows = (
        db.query(ChatMessage.user_id, func.count(ChatMessage.id), func.max(ChatMessage.created_at))
        .filter(ChatMessage.user_id.in_(user_ids))
        .group_by(ChatMessage.user_id)
        .all()
    )
    for user_id, count, last_chat_at in chat_rows:
        chat_stats_by_user[user_id] = (int(count), last_chat_at)

    activity_limit = min(2400, max(320, len(user_ids) * 8))
    activity_rows = db.query(AdminActivity).order_by(AdminActivity.created_at.desc()).limit(activity_limit).all()
    recent_activity_by_user: dict[str, list[AdminUserActivityItem]] = {}
    for activity in activity_rows:
        details = activity.details if isinstance(activity.details, dict) else {}
        user_id = details.get("user_id")
        if not isinstance(user_id, str) or user_id not in user_id_set:
            continue
        bucket = recent_activity_by_user.setdefault(user_id, [])
        if len(bucket) >= 4:
            continue
        bucket.append(
            AdminUserActivityItem(
                action=activity.action,
                created_at=activity.created_at,
                detail_summary=_summarize_admin_activity_details(details),
            )
        )

    items: list[AdminUserOut] = []
    for row in rows:
        profile = profile_by_user.get(row.id)
        profile_data = profile.profile_data if profile and isinstance(profile.profile_data, dict) else {}
        email = profile_data.get("email")
        if not isinstance(email, str):
            email = None

        market_user = market_user_by_phone.get(row.phone)
        market_user_id = market_user.id if market_user else None
        chat_count, last_chat_at = chat_stats_by_user.get(row.id, (0, None))

        items.append(
            AdminUserOut(
                id=row.id,
                phone=row.phone,
                role=row.role,
                status=row.status,
                verification_status=row.verification_status,
                full_name=profile.full_name if profile else None,
                email=email,
                district=profile.district if profile else None,
                parish=profile.parish if profile else None,
                organization_name=profile.organization_name if profile else None,
                onboarding_stage=profile.onboarding_stage if profile else None,
                crops=_as_string_list(profile.crops if profile else []),
                service_categories=_as_string_list(profile.service_categories if profile else []),
                focus_crops=_as_string_list(profile.focus_crops if profile else []),
                market_listings=listing_counts.get(market_user_id, 0) if market_user_id else 0,
                market_alerts=alert_counts.get(market_user_id, 0) if market_user_id else 0,
                market_offers=offer_counts.get(market_user_id, 0) if market_user_id else 0,
                chat_messages=chat_count,
                last_chat_at=last_chat_at,
                recent_activity=recent_activity_by_user.get(row.id, []),
                created_at=row.created_at,
                updated_at=row.updated_at,
                last_login_at=row.last_login_at,
            )
        )

    return items


@router.patch("/users/{user_id}", response_model=AdminUserOut)
def update_user(
    user_id: str,
    payload: AdminUserUpdate,
    db: Session = Depends(get_db),
    admin=Depends(require_admin_user),
    request: Request = None,
) -> AdminUserOut:
    user = db.query(AuthUser).filter(AuthUser.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if payload.role is not None:
        user.role = payload.role
    if payload.status is not None:
        user.status = payload.status
    if payload.verification_status is not None:
        user.verification_status = payload.verification_status

    db.commit()
    db.refresh(user)
    if request is not None:
        record_admin_activity(
            db,
            admin.id,
            "admin_update_user",
            details={"user_id": user_id, "changes": payload.model_dump(exclude_unset=True)},
            ip_address=request.client.host if request.client else None,
        )
    return AdminUserOut(
        id=user.id,
        phone=user.phone,
        role=user.role,
        status=user.status,
        verification_status=user.verification_status,
        created_at=user.created_at,
        updated_at=user.updated_at,
        last_login_at=user.last_login_at,
    )


@router.get("/listings", response_model=MarketListingsResponse)
def admin_listings(
    crop: str | None = None,
    role: str | None = None,
    district: str | None = None,
    status: str | None = None,
    user_id: str | None = None,
    limit: int = 20,
    db: Session = Depends(get_db),
    admin=Depends(require_admin_user),
    request: Request = None,
) -> MarketListingsResponse:
    rows = list_listings(db, crop, role, district, None, status, None, None, None, limit, user_id=user_id, phone=None)
    items = []
    for listing, location in rows:
        items.append(
            MarketListingOut(
                id=listing.id,
                user_id=listing.user_id,
                role=listing.role,
                crop=listing.crop,
                quantity=listing.quantity,
                unit=listing.unit,
                price=listing.price,
                currency=listing.currency,
                grade=listing.grade,
                description=listing.description,
                contact_name=listing.contact_name,
                contact_phone=listing.contact_phone,
                contact_whatsapp=listing.contact_whatsapp,
                media_urls=listing.media_urls or [],
                availability_start=listing.availability_start,
                availability_end=listing.availability_end,
                status=listing.status,
                created_at=listing.created_at,
                location=_serialize_location(location),
            )
        )
    if request is not None:
        record_admin_activity(
            db,
            admin.id,
            "admin_list_listings",
            details={"count": len(items)},
            ip_address=request.client.host if request.client else None,
        )
    return MarketListingsResponse(items=items)


@router.patch("/listings/{listing_id}", response_model=MarketListingOut)
def admin_update_listing(
    listing_id: int,
    payload: AdminListingUpdate,
    db: Session = Depends(get_db),
    admin=Depends(require_admin_user),
    request: Request = None,
) -> MarketListingOut:
    listing = db.query(MarketListing).filter(MarketListing.id == listing_id).first()
    if not listing:
        raise HTTPException(status_code=404, detail="Listing not found")

    if payload.status is not None:
        listing.status = payload.status
    if payload.price is not None:
        listing.price = payload.price
    if payload.quantity is not None:
        listing.quantity = payload.quantity
    if payload.unit is not None:
        listing.unit = payload.unit
    if payload.currency is not None:
        listing.currency = payload.currency
    if payload.grade is not None:
        listing.grade = payload.grade

    db.commit()
    db.refresh(listing)
    if request is not None:
        record_admin_activity(
            db,
            admin.id,
            "admin_update_listing",
            details={"listing_id": listing_id, "changes": payload.model_dump(exclude_unset=True)},
            ip_address=request.client.host if request.client else None,
        )

    location = None
    if listing.location_id:
        location = db.query(MarketLocation).filter(MarketLocation.id == listing.location_id).first()
    return MarketListingOut(
        id=listing.id,
        user_id=listing.user_id,
        role=listing.role,
        crop=listing.crop,
        quantity=listing.quantity,
        unit=listing.unit,
        price=listing.price,
        currency=listing.currency,
        grade=listing.grade,
        description=listing.description,
        contact_name=listing.contact_name,
        contact_phone=listing.contact_phone,
        contact_whatsapp=listing.contact_whatsapp,
        media_urls=listing.media_urls or [],
        availability_start=listing.availability_start,
        availability_end=listing.availability_end,
        status=listing.status,
        created_at=listing.created_at,
        location=_serialize_location(location),
    )


@router.get("/services", response_model=AdminServicesResponse)
def admin_services(
    service_type: str | None = None,
    status: str | None = None,
    limit: int = 30,
    offset: int = 0,
    db: Session = Depends(get_db),
    admin=Depends(require_admin_user),
    request: Request = None,
) -> AdminServicesResponse:
    query = db.query(PlatformService)
    if service_type:
        query = query.filter(PlatformService.service_type.ilike(f"%{service_type}%"))
    if status:
        query = query.filter(PlatformService.status == status)

    rows = query.order_by(PlatformService.created_at.desc()).limit(limit).offset(offset).all()
    items = [_serialize_service(service) for service in rows]
    if request is not None:
        record_admin_activity(
            db,
            admin.id,
            "admin_list_services",
            details={"count": len(items)},
            ip_address=request.client.host if request.client else None,
        )
    return AdminServicesResponse(items=items)


@router.post("/services", response_model=AdminServiceOut)
def admin_create_service(
    payload: AdminServiceCreate,
    db: Session = Depends(get_db),
    admin=Depends(require_admin_user),
    request: Request = None,
) -> AdminServiceOut:
    service = PlatformService(
        service_type=payload.service_type,
        description=payload.description,
        price=payload.price,
        currency=payload.currency or "UGX",
        status=payload.status or "open",
    )
    db.add(service)
    db.commit()
    db.refresh(service)
    if request is not None:
        record_admin_activity(
            db,
            admin.id,
            "admin_create_service",
            details={"service_id": service.id, "service_type": service.service_type},
            ip_address=request.client.host if request.client else None,
        )
    return _serialize_service(service)


@router.patch("/services/{service_id}", response_model=AdminServiceOut)
def admin_update_service(
    service_id: int,
    payload: AdminServiceUpdate,
    db: Session = Depends(get_db),
    admin=Depends(require_admin_user),
    request: Request = None,
) -> AdminServiceOut:
    service = db.query(PlatformService).filter(PlatformService.id == service_id).first()
    if not service:
        raise HTTPException(status_code=404, detail="Service not found")

    if payload.service_type is not None:
        service.service_type = payload.service_type
    if payload.description is not None:
        service.description = payload.description
    if payload.price is not None:
        service.price = payload.price
    if payload.currency is not None:
        service.currency = payload.currency
    if payload.status is not None:
        service.status = payload.status

    db.commit()
    db.refresh(service)

    if request is not None:
        record_admin_activity(
            db,
            admin.id,
            "admin_update_service",
            details={"service_id": service.id, "changes": payload.model_dump(exclude_unset=True)},
            ip_address=request.client.host if request.client else None,
        )
    return _serialize_service(service)


@router.delete("/services/{service_id}")
def admin_delete_service(
    service_id: int,
    db: Session = Depends(get_db),
    admin=Depends(require_admin_user),
    request: Request = None,
) -> dict:
    service = db.query(PlatformService).filter(PlatformService.id == service_id).first()
    if not service:
        raise HTTPException(status_code=404, detail="Service not found")
    db.delete(service)
    db.commit()
    if request is not None:
        record_admin_activity(
            db,
            admin.id,
            "admin_delete_service",
            details={"service_id": service_id},
            ip_address=request.client.host if request.client else None,
        )
    return {"status": "deleted"}


@router.post("/services/seed")
def admin_seed_services(
    payload: AdminSeedServicesRequest,
    db: Session = Depends(get_db),
    admin=Depends(require_admin_user),
    request: Request = None,
) -> dict:
    requested_types = [item.strip() for item in (payload.service_types or []) if item and item.strip()]
    seed_types = requested_types or DEFAULT_PLATFORM_SERVICE_TYPES

    existing = {row[0] for row in db.query(PlatformService.service_type).all() if row[0]}
    created = 0
    for service_type in seed_types:
        if service_type in existing:
            continue
        service = PlatformService(
            service_type=service_type,
            description=None,
            price=None,
            currency="UGX",
            status="open",
        )
        db.add(service)
        created += 1
    db.commit()

    if request is not None:
        record_admin_activity(
            db,
            admin.id,
            "admin_seed_services",
            details={"created": created},
            ip_address=request.client.host if request.client else None,
        )
    return {"created": created}


@router.get("/alerts", response_model=AdminAlertsResponse)
def admin_alerts(
    alert_type: str | None = None,
    crop: str | None = None,
    district: str | None = None,
    parish: str | None = None,
    phone: str | None = None,
    active_only: bool = False,
    limit: int = 50,
    offset: int = 0,
    db: Session = Depends(get_db),
    admin=Depends(require_admin_user),
    request: Request = None,
) -> AdminAlertsResponse:
    query = db.query(MarketAlert, MarketLocation, MarketUser).outerjoin(
        MarketLocation, MarketAlert.location_id == MarketLocation.id
    ).outerjoin(MarketUser, MarketAlert.user_id == MarketUser.id)
    if alert_type:
        query = query.filter(MarketAlert.alert_type == alert_type)
    if crop:
        query = query.filter(MarketAlert.crop.ilike(f"%{crop}%"))
    if district:
        query = query.filter(MarketLocation.district == district)
    if parish:
        query = query.filter(MarketLocation.parish == parish)
    if phone:
        query = query.filter(MarketUser.phone == phone)
    if active_only:
        query = query.filter(MarketAlert.active.is_(True))

    rows = query.order_by(MarketAlert.created_at.desc()).limit(limit).offset(offset).all()
    items = [
        _serialize_alert(alert, location, user.phone if user else None)
        for alert, location, user in rows
    ]
    if request is not None:
        record_admin_activity(
            db,
            admin.id,
            "admin_list_alerts",
            details={"count": len(items)},
            ip_address=request.client.host if request.client else None,
        )
    return AdminAlertsResponse(items=items)


@router.post("/alerts", response_model=AdminAlertOut)
def admin_create_alert(
    payload: AdminAlertCreate,
    db: Session = Depends(get_db),
    admin=Depends(require_admin_user),
    request: Request = None,
) -> AdminAlertOut:
    user = get_or_create_market_user(db, payload.phone, role="farmer")
    location = None
    if payload.location:
        location = create_location(
            db,
            user.id,
            payload.location.district,
            payload.location.parish,
            payload.location.latitude,
            payload.location.longitude,
            payload.location.geometry_wkt,
        )
    alert = MarketAlert(
        user_id=user.id,
        alert_type=payload.alert_type,
        crop=payload.crop,
        threshold=payload.threshold,
        channel=payload.channel or "sms",
        active=True if payload.active is None else payload.active,
        min_interval_hours=payload.min_interval_hours or 24,
        location_id=location.id if location else None,
    )
    db.add(alert)
    db.commit()
    db.refresh(alert)
    if request is not None:
        record_admin_activity(
            db,
            admin.id,
            "admin_create_alert",
            details={"alert_id": alert.id, "alert_type": alert.alert_type, "phone": payload.phone},
            ip_address=request.client.host if request.client else None,
        )
    return _serialize_alert(alert, location, user.phone)


@router.post("/alerts/bulk")
def admin_create_alert_bulk(
    payload: AdminAlertBulkCreate,
    db: Session = Depends(get_db),
    admin=Depends(require_admin_user),
    request: Request = None,
) -> dict:
    phones = [phone.strip() for phone in payload.phones if phone and phone.strip()]
    if not phones:
        raise HTTPException(status_code=400, detail="No target phones provided")

    created = 0
    for phone in phones:
        user = get_or_create_market_user(db, phone, role="farmer")
        location = None
        if payload.location:
            location = create_location(
                db,
                user.id,
                payload.location.district,
                payload.location.parish,
                payload.location.latitude,
                payload.location.longitude,
                payload.location.geometry_wkt,
            )
        alert = MarketAlert(
            user_id=user.id,
            alert_type=payload.alert_type,
            crop=payload.crop,
            threshold=payload.threshold,
            channel=payload.channel or "sms",
            active=True if payload.active is None else payload.active,
            min_interval_hours=payload.min_interval_hours or 24,
            location_id=location.id if location else None,
        )
        db.add(alert)
        created += 1

    db.commit()
    if request is not None:
        record_admin_activity(
            db,
            admin.id,
            "admin_create_alert_bulk",
            details={"created": created},
            ip_address=request.client.host if request.client else None,
        )
    return {"created": created}


@router.patch("/alerts/{alert_id}", response_model=AdminAlertOut)
def admin_update_alert(
    alert_id: int,
    payload: AdminAlertUpdate,
    db: Session = Depends(get_db),
    admin=Depends(require_admin_user),
    request: Request = None,
) -> AdminAlertOut:
    alert = db.query(MarketAlert).filter(MarketAlert.id == alert_id).first()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")

    if payload.alert_type is not None:
        alert.alert_type = payload.alert_type
    if payload.crop is not None:
        alert.crop = payload.crop
    if payload.threshold is not None:
        alert.threshold = payload.threshold
    if payload.channel is not None:
        alert.channel = payload.channel
    if payload.active is not None:
        alert.active = payload.active
    if payload.min_interval_hours is not None:
        alert.min_interval_hours = payload.min_interval_hours

    location = None
    if payload.location:
        location = create_location(
            db,
            alert.user_id,
            payload.location.district,
            payload.location.parish,
            payload.location.latitude,
            payload.location.longitude,
            payload.location.geometry_wkt,
        )
        alert.location_id = location.id

    db.commit()
    db.refresh(alert)
    if location is None and alert.location_id:
        location = db.query(MarketLocation).filter(MarketLocation.id == alert.location_id).first()
    target = db.query(MarketUser).filter(MarketUser.id == alert.user_id).first()

    if request is not None:
        record_admin_activity(
            db,
            admin.id,
            "admin_update_alert",
            details={"alert_id": alert.id, "changes": payload.model_dump(exclude_unset=True)},
            ip_address=request.client.host if request.client else None,
        )
    return _serialize_alert(alert, location, target.phone if target else None)


@router.delete("/alerts/{alert_id}")
def admin_delete_alert(
    alert_id: int,
    db: Session = Depends(get_db),
    admin=Depends(require_admin_user),
    request: Request = None,
) -> dict:
    alert = db.query(MarketAlert).filter(MarketAlert.id == alert_id).first()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    db.delete(alert)
    db.commit()
    if request is not None:
        record_admin_activity(
            db,
            admin.id,
            "admin_delete_alert",
            details={"alert_id": alert_id},
            ip_address=request.client.host if request.client else None,
        )
    return {"status": "deleted"}


@router.get("/metadata", response_model=AdminMetadataOut)
def admin_metadata(
    limit_users: int = 200,
    db: Session = Depends(get_db),
    admin=Depends(require_admin_user),
) -> AdminMetadataOut:
    crops = {
        row[0] for row in db.query(MarketListing.crop).distinct().all() if row[0]
    } | {
        row[0] for row in db.query(MarketPrice.crop).distinct().all() if row[0]
    } | {
        row[0] for row in db.query(MarketAlert.crop).distinct().all() if row[0]
    }
    districts = {row[0] for row in db.query(MarketLocation.district).distinct().all() if row[0]}
    parishes = {row[0] for row in db.query(MarketLocation.parish).distinct().all() if row[0]}
    service_types = {row[0] for row in db.query(PlatformService.service_type).distinct().all() if row[0]}
    alert_types = {row[0] for row in db.query(MarketAlert.alert_type).distinct().all() if row[0]}
    channels = {row[0] for row in db.query(MarketAlert.channel).distinct().all() if row[0]}
    markets = {row[0] for row in db.query(MarketPrice.market).distinct().all() if row[0]}
    currencies = {row[0] for row in db.query(MarketPrice.currency).distinct().all() if row[0]}
    price_sources = {row[0] for row in db.query(MarketPrice.source).distinct().all() if row[0]}

    if not service_types:
        service_types = set(DEFAULT_PLATFORM_SERVICE_TYPES)
    if not alert_types:
        alert_types = {"price", "weather", "general"}
    if not channels:
        channels = {"sms", "email", "push"}
    if not currencies:
        currencies = {"UGX"}
    if not price_sources:
        price_sources = {"manual"}

    users = db.query(AuthUser).order_by(AuthUser.created_at.desc()).limit(limit_users).all()
    user_items = [
        AdminMetadataUser(id=row.id, phone=row.phone, role=row.role) for row in users
    ]

    return AdminMetadataOut(
        crops=sorted(crops),
        districts=sorted(districts),
        parishes=sorted(parishes),
        markets=sorted(markets),
        currencies=sorted(currencies),
        price_sources=sorted(price_sources),
        service_types=sorted(service_types),
        alert_types=sorted(alert_types),
        channels=sorted(channels),
        users=user_items,
    )


@router.get("/prices", response_model=MarketPricesResponse)
def admin_prices(
    crop: str | None = None,
    district: str | None = None,
    market: str | None = None,
    limit: int = 20,
    db: Session = Depends(get_db),
    admin=Depends(require_admin_user),
    request: Request = None,
) -> MarketPricesResponse:
    prices = list_prices(db, crop, district, limit, market)
    items = [
        MarketPriceOut(
            id=p.id,
            crop=p.crop,
            market=p.market,
            district=p.district,
            price=p.price,
            currency=p.currency,
            source=p.source,
            captured_at=p.captured_at,
        )
        for p in prices
    ]
    if request is not None:
        record_admin_activity(
            db,
            admin.id,
            "admin_list_prices",
            details={"count": len(items)},
            ip_address=request.client.host if request.client else None,
        )
    return MarketPricesResponse(items=items)


@router.post("/prices", response_model=MarketPriceOut)
def admin_create_price(
    payload: MarketPriceCreate,
    db: Session = Depends(get_db),
    admin=Depends(require_admin_user),
    request: Request = None,
) -> MarketPriceOut:
    price = create_price(db, payload)
    if request is not None:
        record_admin_activity(
            db,
            admin.id,
            "admin_create_price",
            details={"crop": price.crop, "price_id": price.id, "district": price.district},
            ip_address=request.client.host if request.client else None,
        )
    return MarketPriceOut(
        id=price.id,
        crop=price.crop,
        market=price.market,
        district=price.district,
        price=price.price,
        currency=price.currency,
        source=price.source,
        captured_at=price.captured_at,
    )


@router.patch("/prices/{price_id}", response_model=MarketPriceOut)
def admin_update_price(
    price_id: int,
    payload: AdminPriceUpdate,
    db: Session = Depends(get_db),
    admin=Depends(require_admin_user),
    request: Request = None,
) -> MarketPriceOut:
    price = db.query(MarketPrice).filter(MarketPrice.id == price_id).first()
    if not price:
        raise HTTPException(status_code=404, detail="Price not found")

    if payload.crop is not None:
        price.crop = payload.crop
    if payload.market is not None:
        price.market = payload.market
    if payload.district is not None:
        price.district = payload.district
    if payload.price is not None:
        price.price = payload.price
    if payload.currency is not None:
        price.currency = payload.currency
    if payload.source is not None:
        price.source = payload.source
    if payload.captured_at is not None:
        price.captured_at = payload.captured_at

    db.commit()
    db.refresh(price)
    if request is not None:
        record_admin_activity(
            db,
            admin.id,
            "admin_update_price",
            details={"price_id": price.id, "changes": payload.model_dump(exclude_unset=True)},
            ip_address=request.client.host if request.client else None,
        )
    return MarketPriceOut(
        id=price.id,
        crop=price.crop,
        market=price.market,
        district=price.district,
        price=price.price,
        currency=price.currency,
        source=price.source,
        captured_at=price.captured_at,
    )


@router.get("/activity", response_model=AdminActivityResponse)
def admin_activity(
    action: str | None = None,
    limit: int = 50,
    offset: int = 0,
    db: Session = Depends(get_db),
    admin=Depends(require_admin_user),
) -> AdminActivityResponse:
    query = db.query(AdminActivity)
    if action:
        query = query.filter(AdminActivity.action == action)
    rows = query.order_by(AdminActivity.created_at.desc()).limit(limit).offset(offset).all()
    items = [
        AdminActivityOut(
            id=row.id,
            admin_id=row.admin_id,
            action=row.action,
            details=row.details or {},
            ip_address=row.ip_address,
            created_at=row.created_at,
        )
        for row in rows
    ]
    return AdminActivityResponse(items=items)
