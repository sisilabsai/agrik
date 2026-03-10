import os
from typing import List
from dotenv import load_dotenv

load_dotenv()


def _normalize_database_url(database_url: str) -> str:
    raw = (database_url or "").strip()
    if raw.startswith("postgresql://"):
        return raw.replace("postgresql://", "postgresql+psycopg://", 1)
    return raw


def get_database_url() -> str:
    # Prefer Postgres; fallback to local SQLite for quick dev if not set.
    return _normalize_database_url(os.getenv("DATABASE_URL", "sqlite:///./agrik.db"))


def get_africas_talking_config() -> dict:
    return {
        "username": os.getenv("AFRICASTALKING_USERNAME", os.getenv("Username", "")),
        "api_key": os.getenv("AFRICASTALKING_API_KEY", os.getenv("API_KEY", "")),
        "sender_id": os.getenv("AFRICASTALKING_SENDER_ID", ""),
        "base_url": os.getenv("AFRICASTALKING_BASE_URL", "https://api.africastalking.com"),
        "signature_secret": os.getenv("AFRICASTALKING_SIGNATURE_SECRET", ""),
    }


def get_twilio_config() -> dict:
    return {
        "account_sid": os.getenv("TWILIO_ACCOUNT_SID", ""),
        "auth_token": os.getenv("TWILIO_AUTH_TOKEN", ""),
        "from_number": os.getenv("TWILIO_FROM", ""),
        "messaging_service_sid": os.getenv("TWILIO_MESSAGING_SERVICE_SID", ""),
        "base_url": os.getenv("TWILIO_BASE_URL", "https://api.twilio.com"),
    }


def get_infobip_config() -> dict:
    return {
        "api_key": os.getenv("INFOBIP_API_KEY", ""),
        "base_url": os.getenv("INFOBIP_BASE_URL", os.getenv("BASE_URL", "https://api.infobip.com")),
        "voice_from": os.getenv("INFOBIP_VOICE_FROM", ""),
        "sms_from": os.getenv("INFOBIP_SMS_FROM", ""),
        "voice_language": os.getenv("INFOBIP_VOICE_LANG", "en"),
        "voice_name": os.getenv("INFOBIP_VOICE_NAME", "Joanna"),
        "voice_gender": os.getenv("INFOBIP_VOICE_GENDER", "female"),
        "calls_application_id": os.getenv("INFOBIP_CALLS_APP_ID", ""),
    }


def get_min_confidence_threshold() -> float:
    try:
        return float(os.getenv("MIN_CONFIDENCE_THRESHOLD", "0.55"))
    except ValueError:
        return 0.55


def get_market_admin_token() -> str:
    return os.getenv("MARKET_ADMIN_TOKEN", "")


def get_open_meteo_config() -> dict:
    return {
        "forecast_url": os.getenv("OPEN_METEO_BASE_URL", "https://api.open-meteo.com/v1/forecast"),
        "geocode_url": os.getenv("OPEN_METEO_GEOCODE_URL", "https://geocoding-api.open-meteo.com/v1/search"),
        "lookahead_days": int(os.getenv("WEATHER_ALERT_LOOKAHEAD_DAYS", "3")),
    }


def get_market_intel_config() -> dict:
    def _to_int(value: str, default: int) -> int:
        try:
            return int(value)
        except ValueError:
            return default

    return {
        "provider": os.getenv("PRICE_FEED_PROVIDER", "none"),
        "feed_url": os.getenv("PRICE_FEED_URL", ""),
        "feed_token": os.getenv("PRICE_FEED_TOKEN", ""),
        "feed_auth_header": os.getenv("PRICE_FEED_AUTH_HEADER", "Authorization"),
        "feed_auth_scheme": os.getenv("PRICE_FEED_AUTH_SCHEME", "Bearer"),
        "feed_source": os.getenv("PRICE_FEED_SOURCE", "external"),
        "prediction_window": _to_int(os.getenv("PRICE_PREDICTION_WINDOW", "6"), 6),
        "prediction_min_points": _to_int(os.getenv("PRICE_PREDICTION_MIN_POINTS", "3"), 3),
        "prediction_horizon_days": _to_int(os.getenv("PRICE_PREDICTION_HORIZON_DAYS", "7"), 7),
        "mmn_base_url": os.getenv("MMN_BASE_URL", "https://marsapi.ams.usda.gov/services/v1.2"),
        "mmn_api_key": os.getenv("MMN_API_KEY", ""),
        "mmn_report_slugs": [slug.strip() for slug in os.getenv("MMN_REPORT_SLUGS", "").split(",") if slug.strip()],
        "mmn_query": os.getenv("MMN_REPORT_QUERY", ""),
        "mmn_currency": os.getenv("MMN_DEFAULT_CURRENCY", "USD"),
    }


def get_chroma_config() -> dict:
    try:
        port = int(os.getenv("CHROMA_PORT", "8000"))
    except ValueError:
        port = 8000
    return {
        "host": os.getenv("CHROMA_HOST", "localhost"),
        "port": port,
        "collection": os.getenv("CHROMA_COLLECTION", ""),
        "tenant": os.getenv("CHROMA_TENANT", ""),
        "database": os.getenv("CHROMA_DATABASE", ""),
    }


def get_default_sms_provider() -> str:
    return os.getenv("DEFAULT_SMS_PROVIDER", "africas_talking")


def get_media_storage_config() -> dict:
    def _to_int(value: str, default: int) -> int:
        try:
            return int(value)
        except ValueError:
            return default

    return {
        "market_media_dir": os.getenv("MARKET_MEDIA_DIR", "runtime/market_media"),
        "market_media_max_files": _to_int(os.getenv("MARKET_MEDIA_MAX_FILES", "8"), 8),
        "market_media_max_file_mb": _to_int(os.getenv("MARKET_MEDIA_MAX_FILE_MB", "8"), 8),
    }


def get_price_alert_lookback_hours() -> int:
    try:
        return int(os.getenv("PRICE_ALERT_LOOKBACK_HOURS", "72"))
    except ValueError:
        return 72


def get_auth_config() -> dict:
    def _to_int(value: str, default: int) -> int:
        try:
            return int(value)
        except ValueError:
            return default

    def _to_bool(value: str, default: bool) -> bool:
        if value is None or value == "":
            return default
        return value.strip().lower() in {"1", "true", "yes", "y", "on"}

    return {
        "secret": os.getenv("AUTH_SECRET", "change-me"),
        "token_ttl_minutes": _to_int(os.getenv("AUTH_TOKEN_TTL_MINUTES", "720"), 720),
        "otp_ttl_minutes": _to_int(os.getenv("AUTH_OTP_TTL_MINUTES", "10"), 10),
        "otp_length": _to_int(os.getenv("AUTH_OTP_LENGTH", "6"), 6),
        "otp_resend_cooldown_seconds": _to_int(os.getenv("AUTH_OTP_RESEND_COOLDOWN_SECONDS", "60"), 60),
        "otp_max_attempts": _to_int(os.getenv("AUTH_OTP_MAX_ATTEMPTS", "5"), 5),
        "require_otp": _to_bool(os.getenv("AUTH_REQUIRE_OTP", "false"), False),
        "allow_phone_only_login": _to_bool(os.getenv("AUTH_ALLOW_PHONE_ONLY_LOGIN", "true"), True),
        "password_min_length": _to_int(os.getenv("AUTH_PASSWORD_MIN_LENGTH", "6"), 6),
        "session_idle_days": _to_int(os.getenv("AUTH_SESSION_IDLE_DAYS", "3"), 3),
        "activity_touch_seconds": _to_int(os.getenv("AUTH_ACTIVITY_TOUCH_SECONDS", "300"), 300),
        "dev_bypass_otp": _to_bool(os.getenv("AUTH_DEV_BYPASS_OTP", "false"), False),
    }


def get_admin_auth_config() -> dict:
    def _to_int(value: str, default: int) -> int:
        try:
            return int(value)
        except ValueError:
            return default

    def _to_bool(value: str, default: bool) -> bool:
        if value is None or value == "":
            return default
        return value.strip().lower() in {"1", "true", "yes", "y", "on"}

    return {
        "seed_email": os.getenv("ADMIN_SEED_EMAIL", ""),
        "seed_password": os.getenv("ADMIN_SEED_PASSWORD", ""),
        "seed_update_password": _to_bool(os.getenv("ADMIN_SEED_UPDATE_PASSWORD", "false"), False),
        "secret": os.getenv("ADMIN_AUTH_SECRET", os.getenv("AUTH_SECRET", "change-me")),
        "token_ttl_minutes": _to_int(os.getenv("ADMIN_TOKEN_TTL_MINUTES", "720"), 720),
        "require_otp": _to_bool(os.getenv("ADMIN_REQUIRE_OTP", "false"), False),
        "otp_ttl_minutes": _to_int(os.getenv("ADMIN_OTP_TTL_MINUTES", "10"), 10),
        "otp_length": _to_int(os.getenv("ADMIN_OTP_LENGTH", "6"), 6),
        "otp_resend_cooldown_seconds": _to_int(os.getenv("ADMIN_OTP_RESEND_COOLDOWN_SECONDS", "60"), 60),
        "otp_max_attempts": _to_int(os.getenv("ADMIN_OTP_MAX_ATTEMPTS", "5"), 5),
        "password_hash_iters": _to_int(os.getenv("ADMIN_PASSWORD_HASH_ITERS", "200000"), 200000),
    }


def get_smtp_config() -> dict:
    def _to_int(value: str, default: int) -> int:
        try:
            return int(value)
        except ValueError:
            return default

    def _to_bool(value: str, default: bool) -> bool:
        if value is None or value == "":
            return default
        return value.strip().lower() in {"1", "true", "yes", "y", "on"}

    return {
        "host": os.getenv("SMTP_HOST", ""),
        "port": _to_int(os.getenv("SMTP_PORT", "587"), 587),
        "username": os.getenv("SMTP_USERNAME", ""),
        "password": os.getenv("SMTP_PASSWORD", ""),
        "from_address": os.getenv("SMTP_FROM", ""),
        "use_tls": _to_bool(os.getenv("SMTP_USE_TLS", "true"), True),
        "use_ssl": _to_bool(os.getenv("SMTP_USE_SSL", "false"), False),
    }


def get_cors_origins() -> List[str]:
    raw = os.getenv("CORS_ALLOWED_ORIGINS")
    if not raw:
        raw = "http://localhost:5173,http://127.0.0.1:5173"
    origins = [origin.strip() for origin in raw.split(",") if origin.strip()]
    return origins or ["http://localhost:5173"]


def get_ai_provider_config() -> dict:
    def _to_float(value: str, default: float) -> float:
        try:
            return float(value)
        except ValueError:
            return default

    def _to_int(value: str, default: int) -> int:
        try:
            return int(value)
        except ValueError:
            return default

    def _to_bool(value: str, default: bool) -> bool:
        if value is None or value == "":
            return default
        return value.strip().lower() in {"1", "true", "yes", "y", "on"}

    return {
        "provider": os.getenv("AI_PROVIDER", "none").strip().lower(),
        "advisory_provider": os.getenv("GRIK_CHAT_PROVIDER", os.getenv("AI_PROVIDER", "none")).strip().lower(),
        "hf_token": os.getenv("HUGGINGFACE_API_TOKEN", "").strip(),
        "hf_model": os.getenv("HF_MODEL", "").strip(),
        "hf_fallback_model": os.getenv("HF_FALLBACK_MODEL", "").strip(),
        "hf_alt_models": [token.strip() for token in os.getenv("HF_ALT_MODELS", "").split(",") if token.strip()],
        "gemini_api_key": os.getenv("GEMINI_API_KEY", "").strip(),
        "gemini_base_url": os.getenv("GEMINI_BASE_URL", "https://generativelanguage.googleapis.com/v1beta").strip(),
        "gemini_model": os.getenv("GEMINI_MODEL", "gemini-flash-latest").strip(),
        "gemini_fallback_model": os.getenv("GEMINI_FALLBACK_MODEL", "").strip(),
        "gemini_alt_models": [token.strip() for token in os.getenv("GEMINI_ALT_MODELS", "").split(",") if token.strip()],
        "gemini_timeout": _to_float(os.getenv("GEMINI_TIMEOUT", "30"), 30.0),
        "gemini_temperature": _to_float(os.getenv("GEMINI_TEMPERATURE", "0.2"), 0.2),
        "gemini_max_output_tokens": _to_int(os.getenv("GEMINI_MAX_OUTPUT_TOKENS", "900"), 900),
        "gemini_requests_per_minute": _to_int(os.getenv("GEMINI_REQUESTS_PER_MINUTE", "12"), 12),
        "tts_backend": os.getenv("TTS_BACKEND", "edge-tts").strip().lower(),
        "hf_audio_inference_base_url": os.getenv(
            "HF_AUDIO_INFERENCE_BASE_URL",
            os.getenv("HF_VISION_INFERENCE_BASE_URL", "https://router.huggingface.co/hf-inference/models"),
        ).strip(),
        "hf_audio_timeout": _to_float(os.getenv("HF_AUDIO_TIMEOUT", "60"), 60.0),
        "hf_audio_max_file_mb": _to_int(os.getenv("HF_AUDIO_MAX_FILE_MB", "12"), 12),
        "audio_prewarm_enabled": _to_bool(os.getenv("AUDIO_PREWARM_ENABLED", "false"), False),
        "stt_backend": os.getenv("STT_BACKEND", "openai-whisper").strip().lower(),
        "hf_stt_model": os.getenv("HF_STT_MODEL", "openai/whisper-large-v3-turbo").strip(),
        "hf_stt_alt_models": [
            token.strip() for token in os.getenv("HF_STT_ALT_MODELS", "").split(",") if token.strip()
        ],
        "stt_fallback_backend": os.getenv("STT_FALLBACK_BACKEND", "faster-whisper").strip().lower(),
        "openai_whisper_model": os.getenv("OPENAI_WHISPER_MODEL", "small").strip(),
        "openai_whisper_model_path": os.getenv("OPENAI_WHISPER_MODEL_PATH", "").strip(),
        "openai_whisper_model_dir": os.getenv("OPENAI_WHISPER_MODEL_DIR", "runtime/models/openai-whisper").strip(),
        "openai_whisper_device": os.getenv("OPENAI_WHISPER_DEVICE", "cpu").strip().lower(),
        "faster_whisper_model_size": os.getenv("FASTER_WHISPER_MODEL_SIZE", "small").strip(),
        "faster_whisper_model_path": os.getenv("FASTER_WHISPER_MODEL_PATH", "").strip(),
        "faster_whisper_model_dir": os.getenv("FASTER_WHISPER_MODEL_DIR", "runtime/models/faster-whisper").strip(),
        "faster_whisper_device": os.getenv("FASTER_WHISPER_DEVICE", "cpu").strip().lower(),
        "faster_whisper_compute_type": os.getenv("FASTER_WHISPER_COMPUTE_TYPE", "int8").strip().lower(),
        "faster_whisper_cpu_threads": _to_int(os.getenv("FASTER_WHISPER_CPU_THREADS", "4"), 4),
        "faster_whisper_num_workers": _to_int(os.getenv("FASTER_WHISPER_NUM_WORKERS", "1"), 1),
        "faster_whisper_beam_size": _to_int(os.getenv("FASTER_WHISPER_BEAM_SIZE", "1"), 1),
        "faster_whisper_vad_filter": _to_bool(os.getenv("FASTER_WHISPER_VAD_FILTER", "true"), True),
        "tts_voice_profile_default": os.getenv("TTS_VOICE_PROFILE_DEFAULT", "auto").strip().lower(),
        "hf_tts_model": os.getenv("HF_TTS_MODEL", "facebook/mms-tts-eng").strip(),
        "hf_tts_max_chars": _to_int(os.getenv("HF_TTS_MAX_CHARS", "800"), 800),
        "hf_tts_voice_preset": os.getenv("HF_TTS_VOICE_PRESET", "").strip(),
        "hf_tts_voice_preset_uganda": os.getenv("HF_TTS_VOICE_PRESET_UGANDA", "").strip(),
        "hf_tts_voice_preset_east_africa": os.getenv("HF_TTS_VOICE_PRESET_EAST_AFRICA", "").strip(),
        "hf_tts_voice_preset_neutral": os.getenv("HF_TTS_VOICE_PRESET_NEUTRAL", "").strip(),
        "coqui_tts_model_id": os.getenv("COQUI_TTS_MODEL_ID", "intronhealth/afro-tts").strip(),
        "coqui_tts_model_dir": os.getenv("COQUI_TTS_MODEL_DIR", "runtime/models/intronhealth/afro-tts").strip(),
        "coqui_tts_config_path": os.getenv(
            "COQUI_TTS_CONFIG_PATH",
            "runtime/models/intronhealth/afro-tts/config.json",
        ).strip(),
        "coqui_tts_checkpoint_dir": os.getenv(
            "COQUI_TTS_CHECKPOINT_DIR",
            "runtime/models/intronhealth/afro-tts",
        ).strip(),
        "coqui_tts_speaker_wav": os.getenv("COQUI_TTS_SPEAKER_WAV", "").strip(),
        "coqui_tts_speaker_wav_uganda": os.getenv("COQUI_TTS_SPEAKER_WAV_UGANDA", "").strip(),
        "coqui_tts_speaker_wav_east_africa": os.getenv("COQUI_TTS_SPEAKER_WAV_EAST_AFRICA", "").strip(),
        "coqui_tts_speaker_wav_neutral": os.getenv("COQUI_TTS_SPEAKER_WAV_NEUTRAL", "").strip(),
        "coqui_tts_use_cuda": _to_bool(os.getenv("COQUI_TTS_USE_CUDA", "true"), True),
        "coqui_tts_default_language": os.getenv("COQUI_TTS_DEFAULT_LANGUAGE", "en").strip(),
        "coqui_tts_gpt_cond_len": _to_int(os.getenv("COQUI_TTS_GPT_COND_LEN", "3"), 3),
        "piper_binary_path": os.getenv("PIPER_BINARY_PATH", "piper").strip(),
        "piper_model_path": os.getenv("PIPER_MODEL_PATH", "").strip(),
        "piper_model_path_uganda": os.getenv("PIPER_MODEL_PATH_UGANDA", "").strip(),
        "piper_model_path_east_africa": os.getenv("PIPER_MODEL_PATH_EAST_AFRICA", "").strip(),
        "piper_model_path_neutral": os.getenv("PIPER_MODEL_PATH_NEUTRAL", "").strip(),
        "piper_model_config_path": os.getenv("PIPER_MODEL_CONFIG_PATH", "").strip(),
        "piper_model_config_path_uganda": os.getenv("PIPER_MODEL_CONFIG_PATH_UGANDA", "").strip(),
        "piper_model_config_path_east_africa": os.getenv("PIPER_MODEL_CONFIG_PATH_EAST_AFRICA", "").strip(),
        "piper_model_config_path_neutral": os.getenv("PIPER_MODEL_CONFIG_PATH_NEUTRAL", "").strip(),
        "piper_speaker_id": os.getenv("PIPER_SPEAKER_ID", "").strip(),
        "piper_speaker_id_uganda": os.getenv("PIPER_SPEAKER_ID_UGANDA", "").strip(),
        "piper_speaker_id_east_africa": os.getenv("PIPER_SPEAKER_ID_EAST_AFRICA", "").strip(),
        "piper_speaker_id_neutral": os.getenv("PIPER_SPEAKER_ID_NEUTRAL", "").strip(),
        "piper_tts_max_chars": _to_int(os.getenv("PIPER_TTS_MAX_CHARS", "800"), 800),
        "piper_length_scale": _to_float(os.getenv("PIPER_LENGTH_SCALE", "1.0"), 1.0),
        "piper_noise_scale": _to_float(os.getenv("PIPER_NOISE_SCALE", "0.667"), 0.667),
        "piper_noise_w": _to_float(os.getenv("PIPER_NOISE_W", "0.8"), 0.8),
        "edge_tts_voice_default": os.getenv("EDGE_TTS_VOICE_DEFAULT", "en-NG-EzinneNeural").strip(),
        "edge_tts_voice_en": os.getenv("EDGE_TTS_VOICE_EN", "en-NG-EzinneNeural").strip(),
        "edge_tts_voice_sw": os.getenv("EDGE_TTS_VOICE_SW", "sw-KE-RafikiNeural").strip(),
        "edge_tts_voice_lg": os.getenv("EDGE_TTS_VOICE_LG", "en-NG-EzinneNeural").strip(),
        "edge_tts_voice_nyn": os.getenv("EDGE_TTS_VOICE_NYN", "en-NG-EzinneNeural").strip(),
        "edge_tts_voice_ach": os.getenv("EDGE_TTS_VOICE_ACH", "en-NG-EzinneNeural").strip(),
        "edge_tts_voice_teo": os.getenv("EDGE_TTS_VOICE_TEO", "en-NG-EzinneNeural").strip(),
        "edge_tts_voice_uganda": os.getenv("EDGE_TTS_VOICE_UGANDA", "").strip(),
        "edge_tts_voice_east_africa": os.getenv("EDGE_TTS_VOICE_EAST_AFRICA", "").strip(),
        "edge_tts_voice_neutral": os.getenv("EDGE_TTS_VOICE_NEUTRAL", "").strip(),
        "edge_tts_rate": os.getenv("EDGE_TTS_RATE", "+0%").strip(),
        "edge_tts_pitch": os.getenv("EDGE_TTS_PITCH", "+0Hz").strip(),
        "elevenlabs_api_key": os.getenv("ELEVENLABS_API_KEY", "").strip(),
        "elevenlabs_base_url": os.getenv("ELEVENLABS_BASE_URL", "https://api.elevenlabs.io").strip(),
        "elevenlabs_voice_id": os.getenv("ELEVENLABS_VOICE_ID", "JBFqnCBsd6RMkjVDRZzb").strip(),
        "elevenlabs_voice_id_uganda": os.getenv("ELEVENLABS_VOICE_ID_UGANDA", "").strip(),
        "elevenlabs_voice_id_east_africa": os.getenv("ELEVENLABS_VOICE_ID_EAST_AFRICA", "").strip(),
        "elevenlabs_voice_id_neutral": os.getenv("ELEVENLABS_VOICE_ID_NEUTRAL", "").strip(),
        "elevenlabs_model_id": os.getenv("ELEVENLABS_MODEL_ID", "eleven_multilingual_v2").strip(),
        "elevenlabs_output_format": os.getenv("ELEVENLABS_OUTPUT_FORMAT", "mp3_44100_128").strip(),
        "elevenlabs_tts_max_chars": _to_int(os.getenv("ELEVENLABS_TTS_MAX_CHARS", "2000"), 2000),
        "elevenlabs_stability": _to_float(os.getenv("ELEVENLABS_STABILITY", "0.5"), 0.5),
        "elevenlabs_similarity_boost": _to_float(os.getenv("ELEVENLABS_SIMILARITY_BOOST", "0.75"), 0.75),
        "elevenlabs_style": _to_float(os.getenv("ELEVENLABS_STYLE", "0.0"), 0.0),
        "elevenlabs_speaker_boost": _to_bool(os.getenv("ELEVENLABS_SPEAKER_BOOST", "true"), True),
        "hf_vision_model": os.getenv("HF_VISION_MODEL", "").strip(),
        "hf_vision_alt_models": [token.strip() for token in os.getenv("HF_VISION_ALT_MODELS", "").split(",") if token.strip()],
        "hf_vision_mode": os.getenv("HF_VISION_MODE", "classification").strip().lower(),
        "hf_vision_inference_base_url": os.getenv(
            "HF_VISION_INFERENCE_BASE_URL", "https://router.huggingface.co/hf-inference/models"
        ).strip(),
        "hf_vision_max_images": _to_int(os.getenv("HF_VISION_MAX_IMAGES", "6"), 6),
        "hf_vision_max_file_mb": _to_int(os.getenv("HF_VISION_MAX_FILE_MB", "6"), 6),
        "hf_vision_compare_max_models": _to_int(os.getenv("HF_VISION_COMPARE_MAX_MODELS", "3"), 3),
        "hf_vision_crop_model_map": os.getenv("HF_VISION_CROP_MODEL_MAP", "").strip(),
        "hf_vision_temperature": _to_float(os.getenv("HF_VISION_TEMPERATURE", "0.1"), 0.1),
        "hf_vision_max_tokens": _to_int(os.getenv("HF_VISION_MAX_TOKENS", "900"), 900),
        "hf_base_url": os.getenv("HF_BASE_URL", "https://router.huggingface.co/v1").strip(),
        "hf_timeout": _to_float(os.getenv("HF_TIMEOUT", "30"), 30.0),
        "hf_verify_ssl": _to_bool(os.getenv("HF_VERIFY_SSL", "true"), True),
        "hf_temperature": _to_float(os.getenv("HF_TEMPERATURE", "0.2"), 0.2),
        "hf_max_tokens": _to_int(os.getenv("HF_MAX_TOKENS", "900"), 900),
        "hf_translation_enabled": _to_bool(os.getenv("HF_TRANSLATION_ENABLED", "true"), True),
        "hf_translation_model": os.getenv("HF_TRANSLATION_MODEL", "CohereLabs/command-a-translate-08-2025").strip(),
        "hf_translation_max_tokens": _to_int(os.getenv("HF_TRANSLATION_MAX_TOKENS", "900"), 900),
        "hf_translation_targets": [
            token.strip().lower() for token in os.getenv("HF_TRANSLATION_TARGETS", "sw,lg").split(",") if token.strip()
        ],
    }


def get_external_knowledge_config() -> dict:
    def _to_int(value: str, default: int) -> int:
        try:
            return int(value)
        except ValueError:
            return default

    def _to_bool(value: str, default: bool) -> bool:
        if value is None or value == "":
            return default
        return value.strip().lower() in {"1", "true", "yes", "y", "on"}

    return {
        "enabled": _to_bool(os.getenv("EXTERNAL_KNOWLEDGE_ENABLED", "true"), True),
        "provider": os.getenv("EXTERNAL_KNOWLEDGE_PROVIDER", "wikimedia").strip().lower(),
        "max_items": _to_int(os.getenv("EXTERNAL_KNOWLEDGE_MAX_ITEMS", "1"), 1),
        "timeout_seconds": _to_int(os.getenv("EXTERNAL_KNOWLEDGE_TIMEOUT_SECONDS", "8"), 8),
        "languages": [token.strip().lower() for token in os.getenv("EXTERNAL_KNOWLEDGE_LANGS", "en,sw,lg").split(",") if token.strip()],
        "wikimedia_user_agent": os.getenv(
            "WIKIMEDIA_USER_AGENT",
            "AGRIK/0.1 (https://agrik.local; support@agrik.local)",
        ).strip(),
    }
