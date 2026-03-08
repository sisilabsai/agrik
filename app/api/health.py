from fastapi import APIRouter
from sqlalchemy import text
from app.schemas.models import HealthResponse
from app.db.session import SessionLocal

router = APIRouter()

@router.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(status="ok")


@router.get("/health/ready", response_model=HealthResponse)
def readiness() -> HealthResponse:
    # Basic readiness: database connectivity
    db = SessionLocal()
    try:
        db.execute(text("SELECT 1"))
        return HealthResponse(status="ok")
    finally:
        db.close()
