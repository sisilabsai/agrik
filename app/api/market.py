from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from sqlalchemy.orm import Session
from app.db.session import SessionLocal
from app.api.deps import get_current_user, get_optional_current_user
from app.schemas.marketplace import (
    MarketListingCreate,
    MarketListingOut,
    MarketOfferCreate,
    MarketOfferOut,
    MarketOffersResponse,
    MarketServiceCreate,
    MarketServiceUpdate,
    MarketServiceOut,
    MarketAlertCreate,
    MarketAlertOut,
    MarketPriceCreate,
    MarketPriceOut,
    MarketListingsResponse,
    MarketServicesResponse,
    MarketPricesResponse,
    MarketAlertsResponse,
)
from app.schemas.market_intel import MarketIntelResponse, MarketPricePrediction, MarketInsight
from app.services.marketplace import (
    create_listing,
    list_listings,
    get_listing_details,
    create_offer,
    list_offers,
    create_service,
    list_services,
    create_alert,
    list_alerts,
    list_prices,
    create_price,
)
from app.services.market_intel import refresh_market_prices, predict_price_trends, query_chroma_insights
from app.services.media_storage import save_market_media_files
from app.core.config import get_market_admin_token
from app.db.models import MarketLocation, MarketListing, MarketOffer, MarketService, MarketAlert, MarketUser
from app.services.marketplace_validation import validate_price_alert_inputs, normalize_crop

router = APIRouter()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


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


def _clean_media_urls(values: list[str] | None) -> list[str]:
    if not values:
        return []
    cleaned: list[str] = []
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


def _get_market_user_for_auth(db: Session, auth_user) -> MarketUser:
    phone = (getattr(auth_user, "phone", None) or "").strip()
    if not phone:
        raise HTTPException(status_code=403, detail="Authenticated user has no phone")
    market_user = db.query(MarketUser).filter(MarketUser.phone == phone).first()
    if not market_user:
        raise HTTPException(status_code=404, detail="No marketplace profile found for user")
    return market_user


def _serialize_listing(
    listing: MarketListing,
    location: MarketLocation | None,
    owner: MarketUser | None = None,
    reveal_contact: bool = True,
) -> MarketListingOut:
    owner_phone = owner.phone if owner else None
    contact_phone = listing.contact_phone or owner_phone
    contact_whatsapp = listing.contact_whatsapp or contact_phone
    contact_name = listing.contact_name
    if not reveal_contact:
        contact_name = None
        contact_phone = None
        contact_whatsapp = None
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
        contact_name=contact_name,
        contact_phone=contact_phone,
        contact_whatsapp=contact_whatsapp,
        contact_unlocked=reveal_contact,
        media_urls=listing.media_urls or [],
        availability_start=listing.availability_start,
        availability_end=listing.availability_end,
        status=listing.status,
        created_at=listing.created_at,
        location=_serialize_location(location),
    )


@router.post("/media/upload")
async def upload_market_media(
    request: Request,
    files: list[UploadFile] = File(...),
    user=Depends(get_current_user),
):
    _ = user
    try:
        items = await save_market_media_files(files, str(request.base_url))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unable to store uploaded media: {exc}")
    return {"items": items}


@router.post("/listings", response_model=MarketListingOut)
def create_market_listing(payload: MarketListingCreate, db: Session = Depends(get_db)):
    listing = create_listing(db, payload)
    location = None
    if listing.location_id:
        location = db.query(MarketLocation).filter(MarketLocation.id == listing.location_id).first()
    owner = db.query(MarketUser).filter(MarketUser.id == listing.user_id).first()
    return _serialize_listing(listing, location, owner)


@router.get("/listings", response_model=MarketListingsResponse)
def get_market_listings(
    crop: str | None = None,
    role: str | None = None,
    district: str | None = None,
    parish: str | None = None,
    status: str | None = None,
    lat: float | None = None,
    lon: float | None = None,
    radius_km: float | None = None,
    user_id: str | None = None,
    phone: str | None = None,
    q: str | None = None,
    min_price: float | None = None,
    max_price: float | None = None,
    media_only: bool = False,
    sort: str = "newest",
    limit: int = 20,
    db: Session = Depends(get_db),
    auth_user=Depends(get_optional_current_user),
):
    rows = list_listings(
        db,
        crop,
        role,
        district,
        parish,
        status,
        lat,
        lon,
        radius_km,
        limit,
        user_id,
        phone,
        q=q,
        min_price=min_price,
        max_price=max_price,
        media_only=media_only,
        sort=sort,
    )
    user_ids = {listing.user_id for listing, _ in rows if listing.user_id}
    owners = {}
    if user_ids:
        owner_rows = db.query(MarketUser).filter(MarketUser.id.in_(user_ids)).all()
        owners = {owner.id: owner for owner in owner_rows}

    items = []
    reveal_contact = auth_user is not None
    for listing, location in rows:
        items.append(_serialize_listing(listing, location, owners.get(listing.user_id), reveal_contact=reveal_contact))
    return MarketListingsResponse(items=items)


@router.get("/listings/{listing_id}", response_model=MarketListingOut)
def get_market_listing_by_id(
    listing_id: int,
    db: Session = Depends(get_db),
    auth_user=Depends(get_optional_current_user),
):
    row = get_listing_details(db, listing_id)
    if not row:
        raise HTTPException(status_code=404, detail="Listing not found")
    listing, location, owner = row
    return _serialize_listing(listing, location, owner, reveal_contact=auth_user is not None)


@router.post("/offers", response_model=MarketOfferOut)
def create_market_offer(payload: MarketOfferCreate, db: Session = Depends(get_db)):
    offer = create_offer(db, payload)
    return MarketOfferOut(
        id=offer.id,
        listing_id=offer.listing_id,
        user_id=offer.user_id,
        price=offer.price,
        quantity=offer.quantity,
        status=offer.status,
        created_at=offer.created_at,
    )


@router.get("/offers", response_model=MarketOffersResponse)
def get_market_offers(
    listing_id: int | None = None,
    user_id: str | None = None,
    phone: str | None = None,
    status: str | None = None,
    limit: int = 50,
    db: Session = Depends(get_db),
):
    rows = list_offers(
        db,
        listing_id=listing_id,
        user_id=user_id,
        phone=phone,
        status=status,
        limit=limit,
    )
    items = [
        MarketOfferOut(
            id=offer.id,
            listing_id=offer.listing_id,
            user_id=offer.user_id,
            price=offer.price,
            quantity=offer.quantity,
            status=offer.status,
            created_at=offer.created_at,
        )
        for offer in rows
    ]
    return MarketOffersResponse(items=items)


@router.post("/services", response_model=MarketServiceOut)
def create_market_service(payload: MarketServiceCreate, db: Session = Depends(get_db)):
    service = create_service(db, payload)
    location = None
    if service.location_id:
        location = db.query(MarketLocation).filter(MarketLocation.id == service.location_id).first()
    return MarketServiceOut(
        id=service.id,
        user_id=service.user_id,
        service_type=service.service_type,
        description=service.description,
        media_urls=service.media_urls or [],
        coverage_radius_km=service.coverage_radius_km,
        price=service.price,
        currency=service.currency,
        status=service.status,
        created_at=service.created_at,
        updated_at=service.updated_at,
        location=_serialize_location(location),
    )


@router.get("/services", response_model=MarketServicesResponse)
def get_market_services(
    service_type: str | None = None,
    district: str | None = None,
    parish: str | None = None,
    lat: float | None = None,
    lon: float | None = None,
    radius_km: float | None = None,
    user_id: str | None = None,
    phone: str | None = None,
    limit: int = 20,
    db: Session = Depends(get_db),
):
    rows = list_services(db, service_type, district, parish, lat, lon, radius_km, limit, user_id, phone)
    items = []
    for service, location in rows:
        items.append(
            MarketServiceOut(
                id=service.id,
                user_id=service.user_id,
                service_type=service.service_type,
                description=service.description,
                media_urls=service.media_urls or [],
                coverage_radius_km=service.coverage_radius_km,
                price=service.price,
                currency=service.currency,
                status=service.status,
                created_at=service.created_at,
                updated_at=service.updated_at,
                location=_serialize_location(location),
            )
        )
    return MarketServicesResponse(items=items)


@router.patch("/services/{service_id}", response_model=MarketServiceOut)
def update_market_service(
    service_id: int,
    payload: MarketServiceUpdate,
    db: Session = Depends(get_db),
    auth_user=Depends(get_current_user),
):
    market_user = _get_market_user_for_auth(db, auth_user)
    service = db.query(MarketService).filter(MarketService.id == service_id).first()
    if not service or service.user_id != market_user.id:
        raise HTTPException(status_code=404, detail="Service not found")

    updates = payload.model_dump(exclude_unset=True)
    if "service_type" in updates:
        service_type = (updates.get("service_type") or "").strip()
        if not service_type:
            raise HTTPException(status_code=400, detail="Service type is required")
        service.service_type = service_type
    if "description" in updates:
        description = updates.get("description")
        service.description = str(description).strip() if description else None
    if "media_urls" in updates:
        service.media_urls = _clean_media_urls(updates.get("media_urls"))
    if "coverage_radius_km" in updates:
        service.coverage_radius_km = updates.get("coverage_radius_km")
    if "price" in updates:
        service.price = updates.get("price")
    if "currency" in updates:
        currency = updates.get("currency")
        service.currency = (str(currency).strip() if currency else "UGX")
    if "status" in updates:
        status = (updates.get("status") or "").strip().lower()
        service.status = status or "open"
    if "location" in updates:
        if payload.location is None:
            service.location_id = None
        else:
            location_updates = payload.location.model_dump(exclude_unset=True)
            if service.location_id:
                location = db.query(MarketLocation).filter(MarketLocation.id == service.location_id).first()
            else:
                location = None
            if not location:
                location = MarketLocation(user_id=market_user.id)
                db.add(location)
                db.flush()
                service.location_id = location.id

            for field in ("district", "parish", "latitude", "longitude", "geometry_wkt"):
                if field in location_updates:
                    setattr(location, field, location_updates.get(field))

    db.commit()
    db.refresh(service)
    location = None
    if service.location_id:
        location = db.query(MarketLocation).filter(MarketLocation.id == service.location_id).first()
    return MarketServiceOut(
        id=service.id,
        user_id=service.user_id,
        service_type=service.service_type,
        description=service.description,
        media_urls=service.media_urls or [],
        coverage_radius_km=service.coverage_radius_km,
        price=service.price,
        currency=service.currency,
        status=service.status,
        created_at=service.created_at,
        updated_at=service.updated_at,
        location=_serialize_location(location),
    )


@router.delete("/services/{service_id}")
def delete_market_service(
    service_id: int,
    db: Session = Depends(get_db),
    auth_user=Depends(get_current_user),
) -> dict:
    market_user = _get_market_user_for_auth(db, auth_user)
    service = db.query(MarketService).filter(MarketService.id == service_id).first()
    if not service or service.user_id != market_user.id:
        raise HTTPException(status_code=404, detail="Service not found")

    db.delete(service)
    db.commit()
    return {"status": "deleted", "service_id": service_id}


@router.post("/alerts", response_model=MarketAlertOut)
def create_market_alert(payload: MarketAlertCreate, db: Session = Depends(get_db)):
    alert_type = (payload.alert_type or "").lower()
    if alert_type.startswith("price"):
        district = payload.location.district if payload.location else None
        error = validate_price_alert_inputs(payload.crop, district, payload.threshold)
        if error:
            raise HTTPException(status_code=400, detail=error)
        payload.crop = normalize_crop(payload.crop)
    alert = create_alert(db, payload)
    location = None
    if alert.location_id:
        location = db.query(MarketLocation).filter(MarketLocation.id == alert.location_id).first()
    return MarketAlertOut(
        id=alert.id,
        user_id=alert.user_id,
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


@router.get("/alerts", response_model=MarketAlertsResponse)
def get_market_alerts(
    user_id: str | None = None,
    phone: str | None = None,
    active_only: bool = False,
    db: Session = Depends(get_db),
):
    rows = list_alerts(db, user_id=user_id, phone=phone, active_only=active_only)
    items = []
    for alert, location in rows:
        items.append(
            MarketAlertOut(
                id=alert.id,
                user_id=alert.user_id,
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
        )
    return MarketAlertsResponse(items=items)


@router.get("/summary")
def get_market_summary(db: Session = Depends(get_db)) -> dict:
    return {
        "listings": db.query(MarketListing).count(),
        "offers": db.query(MarketOffer).count(),
        "services": db.query(MarketService).count(),
        "alerts": db.query(MarketAlert).count(),
    }


@router.get("/prices", response_model=MarketPricesResponse)
def get_market_prices(
    crop: str | None = None,
    district: str | None = None,
    limit: int = 20,
    db: Session = Depends(get_db),
):
    prices = list_prices(db, crop, district, limit)
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
    return MarketPricesResponse(items=items)


@router.post("/prices", response_model=MarketPriceOut)
def create_market_price(
    payload: MarketPriceCreate,
    request: Request,
    db: Session = Depends(get_db),
):
    token = get_market_admin_token()
    if token:
        provided = request.headers.get("X-Admin-Token", "")
        if provided != token:
            raise HTTPException(status_code=403, detail="Invalid admin token")
    price = create_price(db, payload)
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


@router.get("/intel", response_model=MarketIntelResponse)
def get_market_intel(
    crop: str | None = None,
    district: str | None = None,
    limit: int = 8,
    refresh: bool = False,
    db: Session = Depends(get_db),
) -> MarketIntelResponse:
    if refresh:
        refresh_market_prices(db)

    prices = list_prices(db, crop, district, limit)
    price_items = [
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

    predictions_raw = predict_price_trends(db, crop=crop, district=district, limit=limit)
    predictions = [
        MarketPricePrediction(
            crop=pred.crop,
            district=pred.district,
            predicted_price=pred.predicted_price,
            currency=pred.currency,
            direction=pred.direction,
            confidence=pred.confidence,
            horizon_days=pred.horizon_days,
            points=pred.points,
        )
        for pred in predictions_raw
    ]

    query_parts = ["market price forecast"]
    if crop:
        query_parts.append(crop)
    if district:
        query_parts.append(district)
    query_text = " ".join(query_parts).strip()
    insights_raw = query_chroma_insights(query_text, limit=3)
    insights = [MarketInsight(**insight) for insight in insights_raw]

    updated_at = price_items[0].captured_at if price_items else None
    return MarketIntelResponse(
        prices=price_items,
        predictions=predictions,
        insights=insights,
        updated_at=updated_at,
        source="local+feed",
    )
