import re
from dataclasses import dataclass
from types import SimpleNamespace
from typing import Optional, Tuple, List

from app.db.session import SessionLocal
from app.services.marketplace import (
    create_listing,
    list_listings,
    create_offer,
    create_service,
    list_prices,
    create_alert,
)
from app.services.marketplace_validation import validate_price_alert_inputs, normalize_crop


@dataclass
class ParsedCommand:
    action: str
    crop: Optional[str] = None
    role: Optional[str] = None
    quantity: Optional[float] = None
    unit: Optional[str] = None
    price: Optional[float] = None
    currency: Optional[str] = None
    district: Optional[str] = None
    parish: Optional[str] = None
    listing_id: Optional[int] = None
    service_type: Optional[str] = None
    radius_km: Optional[float] = None
    alert_type: Optional[str] = None
    threshold: Optional[float] = None


def _tokens(message: str) -> List[str]:
    return re.findall(r"[A-Za-z0-9]+", message.strip())


def _parse_location(tokens: List[str]) -> Tuple[Optional[str], Optional[str]]:
    district = None
    parish = None
    upper = [t.upper() for t in tokens]
    if "DISTRICT" in upper:
        idx = upper.index("DISTRICT")
        if idx + 1 < len(tokens):
            district = tokens[idx + 1].title()
    if "PARISH" in upper:
        idx = upper.index("PARISH")
        if idx + 1 < len(tokens):
            parish = tokens[idx + 1].title()
    if not district and "IN" in upper:
        idx = upper.index("IN")
        if idx + 1 < len(tokens):
            district = tokens[idx + 1].title()
    return district, parish


def _parse_price(tokens: List[str]) -> Tuple[Optional[float], Optional[str]]:
    upper = [t.upper() for t in tokens]
    if "UGX" in upper:
        idx = upper.index("UGX")
        if idx + 1 < len(tokens) and re.match(r"^\d+(\.\d+)?$", tokens[idx + 1]):
            return float(tokens[idx + 1]), "UGX"
    for t in tokens:
        if t.upper().startswith("UGX"):
            m = re.match(r"UGX(\d+(?:\.\d+)?)", t.upper())
            if m:
                return float(m.group(1)), "UGX"
    return None, None


def _parse_quantity(tokens: List[str]) -> Tuple[Optional[float], Optional[str]]:
    for i, t in enumerate(tokens):
        m = re.match(r"^(\d+(?:\.\d+)?)([A-Za-z]+)$", t)
        if m:
            return float(m.group(1)), m.group(2).lower()
        if re.match(r"^\d+(?:\.\d+)?$", t):
            if i + 1 < len(tokens) and re.match(r"^[A-Za-z]+$", tokens[i + 1]):
                return float(t), tokens[i + 1].lower()
    return None, None


def _parse_radius(tokens: List[str]) -> Optional[float]:
    upper = [t.upper() for t in tokens]
    if "RADIUS" in upper:
        idx = upper.index("RADIUS")
        if idx + 1 < len(tokens) and re.match(r"^\d+(\.\d+)?$", tokens[idx + 1]):
            return float(tokens[idx + 1])
    for t in tokens:
        m = re.match(r"^(\d+(?:\.\d+)?)KM$", t.upper())
        if m:
            return float(m.group(1))
    return None


def _parse_threshold(tokens: List[str]) -> Optional[float]:
    for t in tokens:
        if re.match(r"^\d+(\.\d+)?$", t):
            return float(t)
    return None


def parse_command(message: str) -> Optional[ParsedCommand]:
    tokens = _tokens(message)
    if not tokens:
        return None
    upper = [t.upper() for t in tokens]
    verb = upper[0]

    district, parish = _parse_location(tokens)
    price, currency = _parse_price(tokens)
    quantity, unit = _parse_quantity(tokens)

    if verb in {"SELL", "BUY"}:
        crop = tokens[1].lower() if len(tokens) > 1 else None
        role = "seller" if verb == "SELL" else "buyer"
        return ParsedCommand(
            action="listing",
            crop=crop,
            role=role,
            quantity=quantity,
            unit=unit,
            price=price,
            currency=currency,
            district=district,
            parish=parish,
        )

    if verb in {"BUYERS", "SELLERS", "SEARCH", "FIND"}:
        crop = tokens[1].lower() if len(tokens) > 1 else None
        role = None
        if verb == "BUYERS":
            role = "buyer"
        if verb == "SELLERS":
            role = "seller"
        return ParsedCommand(
            action="search",
            crop=crop,
            role=role,
            district=district,
            parish=parish,
        )

    if verb == "OFFER":
        listing_id = int(tokens[1]) if len(tokens) > 1 and tokens[1].isdigit() else None
        return ParsedCommand(
            action="offer",
            listing_id=listing_id,
            price=price,
            quantity=quantity,
        )

    if verb == "SERVICE":
        service_type = tokens[1].lower() if len(tokens) > 1 else None
        radius_km = _parse_radius(tokens)
        return ParsedCommand(
            action="service",
            service_type=service_type,
            price=price,
            currency=currency,
            radius_km=radius_km,
            district=district,
            parish=parish,
        )

    if verb == "PRICE":
        crop = tokens[1].lower() if len(tokens) > 1 else None
        return ParsedCommand(
            action="price",
            crop=crop,
            district=district,
        )

    if verb == "ALERT":
        if len(tokens) > 1 and tokens[1].upper() == "PRICE":
            direction = None
            idx = 2
            if len(tokens) > idx and tokens[idx].upper() in {"ABOVE", "BELOW"}:
                direction = tokens[idx].lower()
                idx += 1
            crop = tokens[idx].lower() if len(tokens) > idx else None
            threshold = _parse_threshold(tokens[idx + 1:]) if len(tokens) > idx + 1 else None
            return ParsedCommand(
                action="alert",
                alert_type=f"price_{direction or 'above'}",
                crop=crop,
                threshold=threshold,
                district=district,
                parish=parish,
            )

        alert_type = tokens[1].lower() if len(tokens) > 1 else None
        threshold = _parse_threshold(tokens[2:]) if len(tokens) > 2 else None
        return ParsedCommand(
            action="alert",
            alert_type=alert_type,
            threshold=threshold,
            district=district,
            parish=parish,
        )

    return None


def _format_listing(listing, location) -> str:
    loc = location.district if location and location.district else ""
    qty = f" {listing.quantity:g}{listing.unit}" if listing.quantity and listing.unit else ""
    price = f" UGX{listing.price:g}" if listing.price else ""
    role = "SELL" if listing.role == "seller" else "BUY"
    return f"#{listing.id} {role} {listing.crop}{qty}{price} {loc}".strip()


def handle_marketplace_sms(phone: str, message: str) -> Optional[str]:
    parsed = parse_command(message)
    if not parsed:
        return None

    db = SessionLocal()
    try:
        if parsed.action == "listing":
            if not parsed.crop or not parsed.role:
                return "Usage: SELL <crop> <qty><unit> <price> <district>"
            location = None
            if parsed.district or parsed.parish:
                location = SimpleNamespace(
                    district=parsed.district,
                    parish=parsed.parish,
                    latitude=None,
                    longitude=None,
                    geometry_wkt=None,
                )
            listing_payload = SimpleNamespace(
                phone=phone,
                role=parsed.role,
                crop=parsed.crop,
                quantity=parsed.quantity,
                unit=parsed.unit,
                price=parsed.price,
                currency=parsed.currency,
                grade=None,
                availability_start=None,
                availability_end=None,
                status="open",
                location=location,
            )
            listing = create_listing(db, listing_payload)
            return f"Listing created: #{listing.id} {parsed.role.upper()} {parsed.crop}. Reply OFFER {listing.id} UGX<price>."

        if parsed.action == "search":
            rows = list_listings(
                db,
                crop=parsed.crop,
                role=parsed.role,
                district=parsed.district,
                parish=parsed.parish,
                status="open",
                lat=None,
                lon=None,
                radius_km=None,
                limit=3,
            )
            if not rows:
                return "No listings found. Try another crop or district."
            lines = [_format_listing(listing, location) for listing, location in rows]
            return "Results: " + " | ".join(lines)

        if parsed.action == "offer":
            if not parsed.listing_id:
                return "Usage: OFFER <listing_id> UGX<price>"
            offer_payload = SimpleNamespace(
                phone=phone,
                listing_id=parsed.listing_id,
                price=parsed.price,
                quantity=parsed.quantity,
            )
            offer = create_offer(db, offer_payload)
            return f"Offer sent for listing #{offer.listing_id}."

        if parsed.action == "service":
            if not parsed.service_type:
                return "Usage: SERVICE <type> <price> <district>"
            location = None
            if parsed.district or parsed.parish:
                location = SimpleNamespace(
                    district=parsed.district,
                    parish=parsed.parish,
                    latitude=None,
                    longitude=None,
                    geometry_wkt=None,
                )
            service_payload = SimpleNamespace(
                phone=phone,
                service_type=parsed.service_type,
                description=None,
                coverage_radius_km=parsed.radius_km,
                price=parsed.price,
                currency=parsed.currency,
                status="open",
                location=location,
            )
            service = create_service(db, service_payload)
            return f"Service listed: #{service.id} {parsed.service_type}."

        if parsed.action == "price":
            if not parsed.crop:
                return "Usage: PRICE <crop> <district>"
            prices = list_prices(db, parsed.crop, parsed.district, limit=2)
            if not prices:
                return "No prices found for that crop yet."
            lines = []
            for p in prices:
                loc = p.district or p.market or ""
                lines.append(f"{p.crop} {loc}: UGX{p.price:g}")
            return "Prices: " + " | ".join(lines)

        if parsed.action == "alert":
            if not parsed.alert_type:
                return "Usage: ALERT <rain|dry|heat> <district> <threshold>"
            if parsed.alert_type.startswith("price_"):
                if not parsed.crop or parsed.threshold is None:
                    return "Usage: ALERT PRICE <above|below> <crop> <threshold> <district>"
                error = validate_price_alert_inputs(parsed.crop, parsed.district, parsed.threshold)
                if error:
                    return f"Invalid price alert: {error}."
                parsed.crop = normalize_crop(parsed.crop)
            alert_payload = SimpleNamespace(
                phone=phone,
                alert_type=parsed.alert_type,
                crop=parsed.crop,
                threshold=parsed.threshold,
                channel="sms",
                active=True,
                min_interval_hours=24,
                location=SimpleNamespace(
                    district=parsed.district,
                    parish=parsed.parish,
                    latitude=None,
                    longitude=None,
                    geometry_wkt=None,
                ) if (parsed.district or parsed.parish) else None,
            )
            create_alert(db, alert_payload)
            label = parsed.alert_type.replace("price_", "price ").upper()
            return f"Alert created: {label} for {parsed.district or 'your area'}."

    finally:
        db.close()

    return None
