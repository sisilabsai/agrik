from typing import Optional
from sqlalchemy.orm import Session
from app.db.models import AuthUserSettings


def get_or_create_settings(db: Session, user_id: str) -> AuthUserSettings:
    settings = db.query(AuthUserSettings).filter(AuthUserSettings.user_id == user_id).first()
    if settings:
        return settings

    settings = AuthUserSettings(user_id=user_id)
    db.add(settings)
    db.commit()
    db.refresh(settings)
    return settings


def update_settings(
    db: Session,
    user_id: str,
    preferred_language: Optional[str] = None,
    district: Optional[str] = None,
    parish: Optional[str] = None,
    sms_opt_in: Optional[bool] = None,
    voice_opt_in: Optional[bool] = None,
    weather_alerts: Optional[bool] = None,
    price_alerts: Optional[bool] = None,
) -> AuthUserSettings:
    settings = get_or_create_settings(db, user_id)
    if preferred_language is not None:
        settings.preferred_language = preferred_language
    if district is not None:
        settings.district = district
    if parish is not None:
        settings.parish = parish
    if sms_opt_in is not None:
        settings.sms_opt_in = sms_opt_in
    if voice_opt_in is not None:
        settings.voice_opt_in = voice_opt_in
    if weather_alerts is not None:
        settings.weather_alerts = weather_alerts
    if price_alerts is not None:
        settings.price_alerts = price_alerts

    db.commit()
    db.refresh(settings)
    return settings
