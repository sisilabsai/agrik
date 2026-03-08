from datetime import datetime
from pydantic import BaseModel

from app.schemas.auth import AuthUserOut
from app.schemas.profile import UserSettingsOut, UserSettingsUpdate


class FarmProfileOut(BaseModel):
    farmer_id: str
    crops: list[str]
    planting_dates: list
    soil_profile: dict
    climate_exposure: dict
    yield_estimates: list
    updated_at: datetime | None = None


class FarmProfileUpdate(BaseModel):
    crops: list[str] | None = None
    planting_dates: list | None = None
    soil_profile: dict | None = None
    climate_exposure: dict | None = None
    yield_estimates: list | None = None


class IdentityProfileOut(BaseModel):
    user_id: str
    full_name: str
    district: str
    parish: str
    crops: list[str]
    organization_name: str | None = None
    service_categories: list[str]
    focus_crops: list[str]
    onboarding_stage: str
    updated_at: datetime | None = None


class UserProfileOut(BaseModel):
    user: AuthUserOut
    settings: UserSettingsOut
    farm: FarmProfileOut
    identity: IdentityProfileOut | None = None


class UserProfileUpdate(BaseModel):
    settings: UserSettingsUpdate | None = None
    farm: FarmProfileUpdate | None = None
