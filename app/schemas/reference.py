from pydantic import BaseModel, Field


class UgandaDistrictOut(BaseModel):
    id: str
    name: str
    parish_count: int


class UgandaDistrictListOut(BaseModel):
    country: str
    total: int
    items: list[UgandaDistrictOut]


class UgandaParishOut(BaseModel):
    id: str
    name: str
    subcounty: str | None = None
    district: str
    district_id: str


class UgandaParishListOut(BaseModel):
    country: str
    district: str | None = None
    total: int
    items: list[UgandaParishOut]


class ServiceCategoryOptionOut(BaseModel):
    id: str
    label: str


class OnboardingRoleOptionOut(BaseModel):
    id: str
    label: str
    description: str
    required_fields: list[str] = Field(default_factory=list)


class OnboardingOptionsOut(BaseModel):
    roles: list[OnboardingRoleOptionOut]
    service_categories: list[ServiceCategoryOptionOut]
    crops: list[str]
    default_role: str


class UgandaLiveMapRoleTotalsOut(BaseModel):
    total: int
    farmers: int
    buyers: int
    offtakers: int
    service_providers: int
    input_suppliers: int
    admins: int


class UgandaLiveMapDistrictOut(BaseModel):
    district_id: str | None = None
    district: str
    latitude: float
    longitude: float
    users_total: int
    farmers: int
    buyers: int
    offtakers: int
    service_providers: int
    input_suppliers: int
    listings: int
    offers: int
    services: int
    alerts: int
    dominant_role: str
    readiness: int
    last_updated_at: str | None = None


class UgandaLiveMapOut(BaseModel):
    country: str
    generated_at: str
    users_total: int
    active_districts: int
    districts_total: int
    coordinate_coverage_pct: float
    roles: UgandaLiveMapRoleTotalsOut
    markers: list[UgandaLiveMapDistrictOut]
