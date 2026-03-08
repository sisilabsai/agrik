from pydantic import BaseModel, ConfigDict

class HealthResponse(BaseModel):
    status: str


class AdviceSource(BaseModel):
    title: str | None = None
    source_id: str | None = None
    page: str | None = None
    file: str | None = None
    url: str | None = None


class VisionIssueOut(BaseModel):
    name: str
    category: str
    confidence: float
    evidence: str
    recommended_action: str


class VisionModelRunOut(BaseModel):
    model: str
    quality_score: float
    overall_assessment: str
    top_labels: list[str]
    likely_issues: list[VisionIssueOut]


class VisionAnalysisOut(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    overall_assessment: str
    likely_issues: list[VisionIssueOut]
    immediate_actions: list[str]
    field_checks: list[str]
    media_count: int
    model: str
    selected_model_reason: str | None = None
    crop_hint: str | None = None
    deep_analysis: bool = False
    top_labels: list[str] | None = None
    per_image_notes: list[str] | None = None
    model_runs: list[VisionModelRunOut] | None = None
    raw_output: str | None = None


class AdviceResponse(BaseModel):
    reply: str
    language: str
    sources: list[str] | None = None
    citations: list[AdviceSource] | None = None
    source_confidence: float | None = None
    citation_text: str | None = None
    follow_ups: list[str] | None = None
    media_analysis: VisionAnalysisOut | None = None
