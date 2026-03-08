from typing import Optional
from sqlalchemy.orm import Session

from app.db.models import Farmer, FarmerProfile


def get_or_create_farmer(db: Session, user_id: str, phone: str | None, preferred_language: Optional[str] = None) -> Farmer:
    farmer = db.query(Farmer).filter(Farmer.id == user_id).first()
    if farmer:
        updated = False
        if phone and farmer.phone != phone:
            farmer.phone = phone
            updated = True
        if preferred_language and farmer.preferred_language != preferred_language:
            farmer.preferred_language = preferred_language
            updated = True
        if updated:
            db.commit()
            db.refresh(farmer)
        return farmer

    farmer = Farmer(id=user_id, phone=phone or "unknown", preferred_language=preferred_language)
    db.add(farmer)
    db.commit()
    db.refresh(farmer)
    return farmer


def get_or_create_farmer_profile(db: Session, farmer_id: str) -> FarmerProfile:
    profile = db.query(FarmerProfile).filter(FarmerProfile.farmer_id == farmer_id).first()
    if profile:
        return profile
    profile = FarmerProfile(farmer_id=farmer_id)
    db.add(profile)
    db.commit()
    db.refresh(profile)
    return profile


def update_farmer_profile(
    db: Session,
    farmer_id: str,
    crops: Optional[list[str]] = None,
    planting_dates: Optional[list] = None,
    soil_profile: Optional[dict] = None,
    climate_exposure: Optional[dict] = None,
    yield_estimates: Optional[list] = None,
) -> FarmerProfile:
    profile = get_or_create_farmer_profile(db, farmer_id)
    if crops is not None:
        profile.crops = crops
    if planting_dates is not None:
        profile.planting_dates = planting_dates
    if soil_profile is not None:
        profile.soil_profile = soil_profile
    if climate_exposure is not None:
        profile.climate_exposure = climate_exposure
    if yield_estimates is not None:
        profile.yield_estimates = yield_estimates

    db.commit()
    db.refresh(profile)
    return profile
