import logging
import re
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

import httpx
from sqlalchemy.orm import Session

from app.core.config import get_chroma_config, get_market_intel_config
from app.db.models import MarketPrice

logger = logging.getLogger("agrik.market_intel")

CROP_KEYS = ("crop", "commodity", "product", "item", "name", "description")
PRICE_KEYS = (
    "price",
    "price_value",
    "avg_price",
    "average_price",
    "weighted_avg_price",
    "weighted_average",
    "value",
    "rate",
)
MARKET_KEYS = ("market", "market_name", "location", "marketLocation", "terminal")
DISTRICT_KEYS = ("district", "region", "county", "state", "area")
CURRENCY_KEYS = ("currency", "currency_code", "unit", "uom")
CAPTURED_KEYS = ("captured_at", "date", "reported_at", "timestamp", "report_date", "reportDate")


@dataclass
class PricePrediction:
    crop: str
    district: Optional[str]
    predicted_price: float
    currency: str
    direction: str
    confidence: float
    horizon_days: int
    points: int


def _select_value(item: Dict[str, Any], keys: tuple[str, ...]) -> Optional[Any]:
    for key in keys:
        if key in item and item[key] not in (None, ""):
            return item[key]
    return None


def _parse_price(value: Any, item: Optional[Dict[str, Any]] = None) -> Optional[float]:
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        numbers = re.findall(r"-?\d+(?:\.\d+)?", value.replace(",", ""))
        if not numbers:
            return None
        values = [float(n) for n in numbers]
        return sum(values) / len(values)

    if item:
        for low_key, high_key in (("price_min", "price_max"), ("min_price", "max_price"), ("low", "high")):
            low = item.get(low_key)
            high = item.get(high_key)
            if low is not None and high is not None:
                try:
                    return (float(low) + float(high)) / 2.0
                except (TypeError, ValueError):
                    continue
    return None


def _parse_datetime(value: Any) -> Optional[datetime]:
    if isinstance(value, datetime):
        return value
    if isinstance(value, (int, float)):
        try:
            return datetime.utcfromtimestamp(value)
        except (OverflowError, OSError, ValueError):
            return None
    if isinstance(value, str):
        cleaned = value.strip().replace("Z", "+00:00")
        try:
            return datetime.fromisoformat(cleaned).replace(tzinfo=None)
        except ValueError:
            pass
        for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%d/%m/%Y", "%m/%d/%Y"):
            try:
                return datetime.strptime(cleaned, fmt)
            except ValueError:
                continue
    return None


def _normalize_price_item(item: Dict[str, Any], fallback_source: str, default_currency: str) -> Optional[Dict[str, Any]]:
    crop = _select_value(item, CROP_KEYS)
    if crop:
        crop = str(crop).strip()
    price_raw = _select_value(item, PRICE_KEYS)
    price = _parse_price(price_raw, item)
    if not crop or price is None:
        return None

    market = _select_value(item, MARKET_KEYS)
    district = _select_value(item, DISTRICT_KEYS)
    currency = _select_value(item, CURRENCY_KEYS) or default_currency
    captured_at = _parse_datetime(_select_value(item, CAPTURED_KEYS))
    source = str(item.get("source") or item.get("provider") or fallback_source or "").strip() or None

    return {
        "crop": crop,
        "market": str(market).strip() if market else None,
        "district": str(district).strip() if district else None,
        "price": float(price),
        "currency": str(currency).strip() if currency else default_currency,
        "source": source,
        "captured_at": captured_at or datetime.utcnow(),
    }


def _extract_items(payload: Any) -> List[Dict[str, Any]]:
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    if isinstance(payload, dict):
        for key in ("items", "data", "results", "report", "records"):
            if isinstance(payload.get(key), list):
                return [item for item in payload[key] if isinstance(item, dict)]
        if all(isinstance(value, dict) for value in payload.values()):
            return [item for item in payload.values() if isinstance(item, dict)]
    return []


def fetch_json_price_feed() -> List[Dict[str, Any]]:
    cfg = get_market_intel_config()
    if not cfg["feed_url"]:
        return []

    headers: Dict[str, str] = {}
    token = cfg["feed_token"]
    if token:
        header = cfg["feed_auth_header"]
        scheme = (cfg["feed_auth_scheme"] or "Bearer").strip()
        if header.lower() == "authorization" and scheme.lower() == "bearer":
            headers[header] = f"Bearer {token}"
        else:
            headers[header] = token

    try:
        with httpx.Client(timeout=12.0) as client:
            response = client.get(cfg["feed_url"], headers=headers)
            response.raise_for_status()
            data = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        logger.warning("Price feed fetch failed: %s", exc)
        return []

    items = _extract_items(data)
    normalized = []
    for item in items:
        entry = _normalize_price_item(item, cfg["feed_source"], default_currency="UGX")
        if entry:
            normalized.append(entry)
    return normalized


def fetch_mmn_prices() -> List[Dict[str, Any]]:
    cfg = get_market_intel_config()
    api_key = cfg["mmn_api_key"]
    slugs = cfg["mmn_report_slugs"]
    if not api_key or not slugs:
        return []

    base_url = cfg["mmn_base_url"].rstrip("/")
    query = cfg["mmn_query"].lstrip("?")
    default_currency = cfg["mmn_currency"] or "USD"

    items: List[Dict[str, Any]] = []
    try:
        with httpx.Client(timeout=15.0) as client:
            for slug in slugs:
                url = f"{base_url}/reports/{slug}"
                if query:
                    url = f"{url}?{query}"
                response = client.get(url, auth=(api_key, ""))
                response.raise_for_status()
                payload = response.json()
                report_items = _extract_items(payload)
                items.extend(report_items)
    except (httpx.HTTPError, ValueError) as exc:
        logger.warning("MMN fetch failed: %s", exc)
        return []

    normalized = []
    for item in items:
        entry = _normalize_price_item(item, f"MMN:{','.join(slugs)}", default_currency=default_currency)
        if entry:
            normalized.append(entry)
    return normalized


def refresh_market_prices(db: Session) -> int:
    cfg = get_market_intel_config()
    provider = (cfg["provider"] or "none").lower()
    if provider == "json":
        items = fetch_json_price_feed()
    elif provider == "mmn":
        items = fetch_mmn_prices()
    else:
        return 0

    if not items:
        return 0

    created = 0
    dedupe_window = timedelta(hours=6)
    for item in items:
        try:
            captured_at = item.get("captured_at") or datetime.utcnow()
            latest = (
                db.query(MarketPrice)
                .filter(
                    MarketPrice.crop == item["crop"],
                    MarketPrice.price == item["price"],
                    MarketPrice.district == item.get("district"),
                )
                .order_by(MarketPrice.captured_at.desc())
                .first()
            )
            if latest and latest.captured_at and abs(captured_at - latest.captured_at) <= dedupe_window:
                continue
            db.add(
                MarketPrice(
                    crop=item["crop"],
                    market=item.get("market"),
                    district=item.get("district"),
                    price=item["price"],
                    currency=item.get("currency") or "UGX",
                    source=item.get("source"),
                    captured_at=captured_at,
                )
            )
            created += 1
        except (KeyError, TypeError, ValueError):
            continue
    if created:
        db.commit()
    return created


def _direction(delta: float, baseline: float) -> str:
    if baseline <= 0:
        baseline = 1.0
    change = delta / baseline
    if change > 0.03:
        return "up"
    if change < -0.03:
        return "down"
    return "flat"


def predict_price_trends(
    db: Session,
    crop: Optional[str] = None,
    district: Optional[str] = None,
    limit: int = 6,
) -> List[PricePrediction]:
    cfg = get_market_intel_config()
    window = max(3, cfg["prediction_window"])
    min_points = max(2, cfg["prediction_min_points"])
    horizon_days = cfg["prediction_horizon_days"]

    crop_list: List[str]
    if crop:
        crop_list = [crop]
    else:
        query = db.query(MarketPrice.crop).distinct()
        if district:
            query = query.filter(MarketPrice.district == district)
        crop_list = [row[0] for row in query.limit(limit).all() if row[0]]

    predictions: List[PricePrediction] = []
    for crop_name in crop_list:
        price_query = db.query(MarketPrice).filter(MarketPrice.crop == crop_name)
        if district:
            price_query = price_query.filter(MarketPrice.district == district)
        rows = price_query.order_by(MarketPrice.captured_at.desc()).limit(window).all()
        if len(rows) < min_points:
            continue

        ordered = list(reversed(rows))
        prices = [row.price for row in ordered if row.price is not None]
        if len(prices) < min_points:
            continue
        delta = prices[-1] - prices[0]
        step = delta / max(1, len(prices) - 1)
        predicted = prices[-1] + step
        avg_price = sum(prices) / len(prices)
        direction = _direction(delta, avg_price)
        confidence = min(1.0, 0.25 + 0.1 * len(prices))
        currency = ordered[-1].currency or "UGX"

        predictions.append(
            PricePrediction(
                crop=crop_name,
                district=district or ordered[-1].district,
                predicted_price=round(predicted, 2),
                currency=currency,
                direction=direction,
                confidence=round(confidence, 2),
                horizon_days=horizon_days,
                points=len(prices),
            )
        )
    return predictions


def query_chroma_insights(query: str, limit: int = 3) -> List[Dict[str, Any]]:
    cfg = get_chroma_config()
    if not query or not cfg["collection"]:
        return []

    try:
        import chromadb
    except ImportError:
        logger.info("Chroma not installed; skipping insights.")
        return []

    try:
        client = chromadb.HttpClient(
            host=cfg["host"],
            port=cfg["port"],
            tenant=cfg["tenant"] or None,
            database=cfg["database"] or None,
        )
        collection = client.get_collection(cfg["collection"])
        results = collection.query(
            query_texts=[query],
            n_results=limit,
            include=["documents", "metadatas", "distances"],
        )
    except Exception as exc:
        logger.warning("Chroma query failed: %s", exc)
        return []

    documents = (results.get("documents") or [[]])[0]
    metadatas = (results.get("metadatas") or [[]])[0]
    distances = (results.get("distances") or [[]])[0]

    insights: List[Dict[str, Any]] = []
    for idx, doc in enumerate(documents):
        if not doc:
            continue
        meta = metadatas[idx] if idx < len(metadatas) else {}
        distance = distances[idx] if idx < len(distances) else None
        score = None
        if isinstance(distance, (int, float)):
            score = round(max(0.0, 1.0 - float(distance)), 3)
        insights.append(
            {
                "title": meta.get("title") if isinstance(meta, dict) else None,
                "summary": str(doc),
                "source": meta.get("source") if isinstance(meta, dict) else None,
                "score": score,
            }
        )
    return insights
