import math
from typing import Optional


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    # Earth radius in kilometers
    r = 6371.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lambda = math.radians(lon2 - lon1)

    a = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return r * c


def within_radius_km(
    lat: Optional[float],
    lon: Optional[float],
    target_lat: float,
    target_lon: float,
    radius_km: float,
) -> bool:
    if lat is None or lon is None:
        return False
    return haversine_km(lat, lon, target_lat, target_lon) <= radius_km
