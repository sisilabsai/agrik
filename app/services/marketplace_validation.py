from typing import Optional

ALLOWED_CROPS = {
    "maize",
    "beans",
    "cassava",
    "groundnut",
    "banana",
    "coffee",
    "sorghum",
    "millet",
    "rice",
    "sweet potato",
}

CROP_SYNONYMS = {
    "corn": "maize",
    "maize": "maize",
    "bean": "beans",
    "beans": "beans",
    "cassava": "cassava",
    "kasava": "cassava",
    "manioc": "cassava",
    "yuca": "cassava",
    "groundnut": "groundnut",
    "groundnuts": "groundnut",
    "peanut": "groundnut",
    "peanuts": "groundnut",
    "banana": "banana",
    "matooke": "banana",
    "plantain": "banana",
    "coffee": "coffee",
    "sorghum": "sorghum",
    "millet": "millet",
    "rice": "rice",
    "sweet potato": "sweet potato",
    "sweetpotato": "sweet potato",
    "sweet-potato": "sweet potato",
}


def normalize_crop(crop: Optional[str]) -> Optional[str]:
    if not crop:
        return None
    cleaned = crop.strip().lower().replace("_", " ").replace("-", " ")
    cleaned = " ".join(cleaned.split())
    if cleaned in ALLOWED_CROPS:
        return cleaned
    return CROP_SYNONYMS.get(cleaned)


def validate_price_alert_inputs(
    crop: Optional[str],
    district: Optional[str],
    threshold: Optional[float],
) -> Optional[str]:
    if not crop:
        return "crop is required for price alerts"
    if normalize_crop(crop) is None:
        allowed = ", ".join(sorted(ALLOWED_CROPS))
        return f"crop must be one of: {allowed}"
    if not district or not district.strip():
        return "district is required for price alerts"
    if threshold is None:
        return "threshold is required for price alerts"
    return None
