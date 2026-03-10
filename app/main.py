import time
import logging
from pathlib import Path
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from prometheus_client import generate_latest, CONTENT_TYPE_LATEST
from app.core.logging import configure_logging
from app.core.config import get_ai_provider_config, get_cors_origins, get_media_storage_config
from app.core.metrics import REQUEST_COUNT, REQUEST_LATENCY, QUEUE_BACKLOG
from app.db.session import SessionLocal
from app.db.models import OutboundMessage
from app.api.health import router as health_router
from app.api.sms import router as sms_router
from app.api.voice import router as voice_router
from app.api.market import router as market_router
from app.api.auth import router as auth_router
from app.api.profile import router as profile_router
from app.api.chat import router as chat_router
from app.api.weather import router as weather_router
from app.api.reference import router as reference_router
from app.api.admin import router as admin_router
from app.api.admin_auth import router as admin_auth_router
from app.db.session import DATABASE_URL, engine
from app.db.models import Base
from app.services.admin_auth import seed_admin_user

app = FastAPI(title="AGRIK API", version="0.1.0")
logger = logging.getLogger("agrik.main")

configure_logging()

media_cfg = get_media_storage_config()
market_media_dir = Path(media_cfg["market_media_dir"])
if not market_media_dir.is_absolute():
    market_media_dir = Path.cwd() / market_media_dir
market_media_dir.mkdir(parents=True, exist_ok=True)
app.mount("/media/market", StaticFiles(directory=str(market_media_dir)), name="market-media")

cors_origins = get_cors_origins()
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
def startup() -> None:
    db_url = (DATABASE_URL or "").strip().lower()
    if db_url.startswith("sqlite"):
        # Keep local SQLite bootstrap convenient for quick dev.
        try:
            Base.metadata.create_all(bind=engine)
        except Exception as exc:
            logger.exception("Database schema initialization failed during startup: %s", exc)
            return
    else:
        logger.info("Skipping SQLAlchemy auto-create for non-SQLite DB; expected schema via Alembic migrations.")

    # Seed initial admin (if configured via env).
    db = SessionLocal()
    try:
        seed_admin_user(db)
    except Exception as exc:
        logger.exception("Admin seeding failed during startup: %s", exc)
    finally:
        db.close()

    audio_cfg = get_ai_provider_config()
    if bool(audio_cfg.get("audio_prewarm_enabled")):
        try:
            from app.services.audio import prewarm_audio_runtime

            warmed = prewarm_audio_runtime(audio_cfg)
            logger.info("Audio runtime prewarmed backend=%s", warmed)
        except Exception as exc:
            logger.warning("Audio runtime prewarm failed: %s", exc)

@app.get("/")
def root() -> dict:
    return {"name": "AGRIK", "status": "ok"}

@app.middleware("http")
async def metrics_middleware(request: Request, call_next):
    start = time.time()
    response = await call_next(request)
    duration = time.time() - start
    path = request.url.path
    REQUEST_COUNT.labels(method=request.method, path=path, status=str(response.status_code)).inc()
    REQUEST_LATENCY.labels(method=request.method, path=path).observe(duration)
    return response

@app.get("/metrics")
def metrics():
    from fastapi.responses import Response
    # update backlog gauge at scrape time
    db = SessionLocal()
    try:
        count = db.query(OutboundMessage).filter(OutboundMessage.status == "pending").count()
        QUEUE_BACKLOG.set(count)
    finally:
        db.close()
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)

app.include_router(health_router, tags=["health"])
app.include_router(sms_router, prefix="/sms", tags=["sms"])
app.include_router(voice_router, prefix="/voice", tags=["voice"])
app.include_router(market_router, prefix="/market", tags=["market"])
app.include_router(auth_router, prefix="/auth", tags=["auth"])
app.include_router(reference_router, prefix="/reference", tags=["reference"])
app.include_router(profile_router, prefix="/profile", tags=["profile"])
app.include_router(chat_router, prefix="/chat", tags=["chat"])
app.include_router(weather_router, prefix="/weather", tags=["weather"])
app.include_router(admin_auth_router, prefix="/admin", tags=["admin-auth"])
app.include_router(admin_router, prefix="/admin", tags=["admin"])
