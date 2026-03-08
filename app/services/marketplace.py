import uuid
from datetime import datetime
from typing import Optional, List, Iterable
import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.db.models import (
    MarketUser,
    MarketLocation,
    MarketListing,
    MarketOffer,
    MarketService,
    MarketAlert,
    MarketPrice,
)
from app.services.geo import within_radius_km


def _now() -> datetime:
    return datetime.utcnow()


def _clean_media_urls(values: Optional[Iterable[str]]) -> List[str]:
    if not values:
        return []
    cleaned: List[str] = []
    seen = set()
    for raw in values:
        text = str(raw or "").strip()
        if not text:
            continue
        key = text.lower()
        if key in seen:
            continue
        seen.add(key)
        cleaned.append(text)
    return cleaned


def get_or_create_market_user(db: Session, phone: str, role: str, preferred_language: Optional[str] = None) -> MarketUser:
    user = db.query(MarketUser).filter(MarketUser.phone == phone).first()
    if user:
        if role and user.role != role:
            user.role = role
        if preferred_language and not user.preferred_language:
            user.preferred_language = preferred_language
        db.commit()
        return user

    user = MarketUser(
        id=uuid.uuid4().hex,
        phone=phone,
        role=role,
        preferred_language=preferred_language,
        verification_status="unverified",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _resolve_market_user_id(db: Session, user_id: Optional[str], phone: Optional[str]) -> Optional[str]:
    if user_id:
        return user_id
    if phone:
        user = db.query(MarketUser).filter(MarketUser.phone == phone).first()
        if user:
            return user.id
    return None


def create_location(
    db: Session,
    user_id: str,
    district: Optional[str],
    parish: Optional[str],
    latitude: Optional[float],
    longitude: Optional[float],
    geometry_wkt: Optional[str],
) -> MarketLocation:
    location = MarketLocation(
        user_id=user_id,
        district=district,
        parish=parish,
        latitude=latitude,
        longitude=longitude,
        geometry_wkt=geometry_wkt,
    )
    db.add(location)
    db.commit()
    db.refresh(location)
    return location


def create_listing(db: Session, payload) -> MarketListing:
    user = get_or_create_market_user(db, payload.phone, payload.role)
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
    listing = MarketListing(
        user_id=user.id,
        role=payload.role,
        crop=payload.crop,
        quantity=payload.quantity,
        unit=payload.unit,
        price=payload.price,
        currency=payload.currency or "UGX",
        grade=payload.grade,
        description=(getattr(payload, "description", None) or None),
        contact_name=(getattr(payload, "contact_name", None) or None),
        contact_phone=(getattr(payload, "contact_phone", None) or user.phone),
        contact_whatsapp=(getattr(payload, "contact_whatsapp", None) or getattr(payload, "contact_phone", None) or user.phone),
        media_urls=_clean_media_urls(getattr(payload, "media_urls", None)),
        availability_start=payload.availability_start,
        availability_end=payload.availability_end,
        status=payload.status or "open",
        location_id=location.id if location else None,
    )
    db.add(listing)
    db.commit()
    db.refresh(listing)
    return listing


def list_listings(
    db: Session,
    crop: Optional[str],
    role: Optional[str],
    district: Optional[str],
    parish: Optional[str],
    status: Optional[str],
    lat: Optional[float],
    lon: Optional[float],
    radius_km: Optional[float],
    limit: int,
    user_id: Optional[str] = None,
    phone: Optional[str] = None,
    q: Optional[str] = None,
    min_price: Optional[float] = None,
    max_price: Optional[float] = None,
    media_only: bool = False,
    sort: Optional[str] = None,
) -> List[tuple[MarketListing, Optional[MarketLocation]]]:
    query = db.query(MarketListing, MarketLocation).outerjoin(
        MarketLocation, MarketListing.location_id == MarketLocation.id
    )
    resolved_user_id = _resolve_market_user_id(db, user_id, phone)
    if resolved_user_id:
        query = query.filter(MarketListing.user_id == resolved_user_id)
    if crop:
        query = query.filter(MarketListing.crop.ilike(f"%{crop}%"))
    if role:
        query = query.filter(MarketListing.role == role)
    if status:
        query = query.filter(MarketListing.status == status)
    if district:
        query = query.filter(MarketLocation.district == district)
    if parish:
        query = query.filter(MarketLocation.parish == parish)
    if min_price is not None:
        query = query.filter(MarketListing.price >= min_price)
    if max_price is not None:
        query = query.filter(MarketListing.price <= max_price)
    if q:
        text = q.strip()
        if text:
            pattern = f"%{text}%"
            query = query.filter(
                sa.or_(
                    MarketListing.crop.ilike(pattern),
                    MarketListing.grade.ilike(pattern),
                    MarketListing.description.ilike(pattern),
                    MarketLocation.district.ilike(pattern),
                    MarketLocation.parish.ilike(pattern),
                )
            )

    sort_key = (sort or "newest").strip().lower()
    if sort_key == "price_asc":
        query = query.order_by(MarketListing.price.is_(None), MarketListing.price.asc(), MarketListing.created_at.desc())
    elif sort_key == "price_desc":
        query = query.order_by(MarketListing.price.is_(None), MarketListing.price.desc(), MarketListing.created_at.desc())
    elif sort_key == "quantity_desc":
        query = query.order_by(MarketListing.quantity.is_(None), MarketListing.quantity.desc(), MarketListing.created_at.desc())
    else:
        query = query.order_by(MarketListing.created_at.desc())

    fetch_limit = max(limit, min(500, limit * 5 if (media_only or (lat is not None and lon is not None and radius_km is not None)) else limit))
    rows = query.limit(fetch_limit).all()

    if not media_only and (lat is None or lon is None or radius_km is None):
        return rows[:limit]

    filtered: List[tuple[MarketListing, Optional[MarketLocation]]] = []
    for listing, location in rows:
        if media_only and not _clean_media_urls(getattr(listing, "media_urls", None)):
            continue
        if lat is not None and lon is not None and radius_km is not None:
            if not location or not within_radius_km(location.latitude, location.longitude, lat, lon, radius_km):
                continue
        filtered.append((listing, location))
        if len(filtered) >= limit:
            break
    return filtered


def get_listing_details(
    db: Session,
    listing_id: int,
) -> Optional[tuple[MarketListing, Optional[MarketLocation], Optional[MarketUser]]]:
    return (
        db.query(MarketListing, MarketLocation, MarketUser)
        .outerjoin(MarketLocation, MarketListing.location_id == MarketLocation.id)
        .outerjoin(MarketUser, MarketListing.user_id == MarketUser.id)
        .filter(MarketListing.id == listing_id)
        .first()
    )


def create_offer(db: Session, payload) -> MarketOffer:
    user = get_or_create_market_user(db, payload.phone, role="buyer")
    offer = MarketOffer(
        listing_id=payload.listing_id,
        user_id=user.id,
        price=payload.price,
        quantity=payload.quantity,
        status="open",
        created_at=_now(),
    )
    db.add(offer)
    db.commit()
    db.refresh(offer)
    return offer


def create_service(db: Session, payload) -> MarketService:
    user = get_or_create_market_user(db, payload.phone, role="service_provider")
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
    service = MarketService(
        user_id=user.id,
        service_type=payload.service_type,
        description=payload.description,
        media_urls=_clean_media_urls(getattr(payload, "media_urls", None)),
        coverage_radius_km=payload.coverage_radius_km,
        price=payload.price,
        currency=payload.currency or "UGX",
        status=payload.status or "open",
        location_id=location.id if location else None,
    )
    db.add(service)
    db.commit()
    db.refresh(service)
    return service


def list_services(
    db: Session,
    service_type: Optional[str],
    district: Optional[str],
    parish: Optional[str],
    lat: Optional[float],
    lon: Optional[float],
    radius_km: Optional[float],
    limit: int,
    user_id: Optional[str] = None,
    phone: Optional[str] = None,
) -> List[tuple[MarketService, Optional[MarketLocation]]]:
    query = db.query(MarketService, MarketLocation).outerjoin(
        MarketLocation, MarketService.location_id == MarketLocation.id
    )
    resolved_user_id = _resolve_market_user_id(db, user_id, phone)
    if resolved_user_id:
        query = query.filter(MarketService.user_id == resolved_user_id)
    if service_type:
        query = query.filter(MarketService.service_type == service_type)
    if district:
        query = query.filter(MarketLocation.district == district)
    if parish:
        query = query.filter(MarketLocation.parish == parish)

    query = query.order_by(MarketService.created_at.desc()).limit(limit)
    rows = query.all()

    if lat is None or lon is None or radius_km is None:
        return rows

    filtered: List[tuple[MarketService, Optional[MarketLocation]]] = []
    for service, location in rows:
        if location and within_radius_km(location.latitude, location.longitude, lat, lon, radius_km):
            filtered.append((service, location))
    return filtered


def create_alert(db: Session, payload) -> MarketAlert:
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
        created_at=_now(),
    )
    db.add(alert)
    db.commit()
    db.refresh(alert)
    return alert


def list_alerts(
    db: Session,
    user_id: Optional[str] = None,
    phone: Optional[str] = None,
    active_only: bool = False,
) -> List[tuple[MarketAlert, Optional[MarketLocation]]]:
    query = db.query(MarketAlert, MarketLocation).outerjoin(
        MarketLocation, MarketAlert.location_id == MarketLocation.id
    )
    resolved_user_id = _resolve_market_user_id(db, user_id, phone)
    if resolved_user_id:
        query = query.filter(MarketAlert.user_id == resolved_user_id)
    if active_only:
        query = query.filter(MarketAlert.active.is_(True))
    return query.order_by(MarketAlert.created_at.desc()).all()


def list_prices(
    db: Session,
    crop: Optional[str],
    district: Optional[str],
    limit: int,
    market: Optional[str] = None,
) -> List[MarketPrice]:
    query = db.query(MarketPrice)
    if crop:
        query = query.filter(MarketPrice.crop.ilike(f"%{crop}%"))
    if district:
        query = query.filter(MarketPrice.district == district)
    if market:
        query = query.filter(MarketPrice.market.ilike(f"%{market}%"))
    return query.order_by(MarketPrice.captured_at.desc()).limit(limit).all()


def list_offers(
    db: Session,
    listing_id: Optional[int] = None,
    user_id: Optional[str] = None,
    phone: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 50,
) -> List[MarketOffer]:
    query = db.query(MarketOffer)
    if listing_id is not None:
        query = query.filter(MarketOffer.listing_id == listing_id)
    resolved_user_id = _resolve_market_user_id(db, user_id, phone)
    if resolved_user_id:
        query = query.filter(MarketOffer.user_id == resolved_user_id)
    if status:
        query = query.filter(MarketOffer.status == status)
    return query.order_by(MarketOffer.created_at.desc()).limit(limit).all()


def create_price(db: Session, payload) -> MarketPrice:
    price = MarketPrice(
        crop=payload.crop,
        market=payload.market,
        district=payload.district,
        price=payload.price,
        currency=payload.currency or "UGX",
        source=payload.source,
        captured_at=payload.captured_at or _now(),
    )
    db.add(price)
    db.commit()
    db.refresh(price)
    return price
