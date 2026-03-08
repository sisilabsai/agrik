# AGRIK

Phase 1 foundation for SMS/Voice-first agricultural intelligence.

## Status (What We Have Built)
- FastAPI service with health and root endpoints
- SMS inbound endpoints (generic, Twilio, Africa's Talking)
- Voice inbound endpoint (generic JSON)
- Infobip voice integration (TTS outbound + Calls API webhooks)
- Farmer memory persistence (SQLAlchemy + Postgres/SQLite)
- Language detection stub + grounded retrieval pipeline
- Retrieval quality upgrades (field-weighted scoring, crop-match boost, tuned stopwords)
- Outbound SMS via Africa's Talking with retries and logging
- Twilio outbound SMS + signature validation
- Outbound SMS send metrics + alerting/dashboard panels
- Delivery report callback endpoints and storage (Africa's Talking + Twilio)
- Alembic migrations (initial schema + delivery reports)
- Uganda manuals (English + Luganda + Runyankole)
- Structured manuals JSON + pest/disease cards JSON (language-aware)
- Language-aware manual selection by detected language
- Language-specific JSON corpora support + optional language-specific stub
- Validation and retrieval CLI scripts
- GRIK web copilot context engine (farmer profile + chat memory + weather + market signals)
- Hugging Face Router integration (OpenAI-compatible chat completions)
- Structured JSON logging + Prometheus metrics endpoint
- Background retry worker for outbound SMS

## Next Build (Planned)
- Provider hardening:
  - Webhook input validation and idempotency
  - Rate limiting and abuse protection
- Operational readiness (iterative):
  - Tune alert thresholds based on live traffic

## Features (Phase 1)
- SMS and Voice inbound APIs
- Farmer memory persistence (SQLAlchemy + Postgres or SQLite)
- Language detection stub (keyword + locale hint)
- Grounded agronomy retrieval stub (local JSON corpus)
- SMS provider scaffolding (Twilio + Africa's Talking)
- Health + root endpoints
- Marketplace listings + search (API-first, SMS/voice integration planned)

## Quick start
1. Create venv and install deps:
   - `pip install -r requirements.txt`
2. Set `DATABASE_URL` (Postgres recommended):
   - Example: `postgresql+psycopg://user:pass@localhost:5432/agrik`
   - Optional: set `DB_CONNECT_TIMEOUT=5` to avoid long hangs when DB is unreachable
3. Run API:
   - `uvicorn app.main:app --reload`

## Web frontend (Step 2)
1. Install web deps:
   - `cd web`
   - `npm install`
2. Configure API base URL:
   - copy `web/.env.example` to `web/.env` and set `VITE_API_BASE_URL`
   - optional: `VITE_API_TIMEOUT_MS=10000` to prevent stuck loading when API is unavailable
   - optional: `VITE_CHAT_TIMEOUT_MS=90000` for longer GRIK inference requests
3. Run web dev server:
   - `npm run dev`

## GRIK AI provider setup
- Configure in `.env`:
  - `AI_PROVIDER=huggingface`
  - `HUGGINGFACE_API_TOKEN=<token>`
  - `HF_MODEL=openai/gpt-oss-120b`
  - Audio (STT/TTS):
    - `TTS_BACKEND=edge-tts` (recommended fast path on Python 3.12+)
    - Optional: `TTS_BACKEND=elevenlabs` (hosted TTS; no local model downloads)
    - Optional: `TTS_BACKEND=piper` (fully local TTS with Piper binary + ONNX voice)
    - Optional: `TTS_BACKEND=coqui` (local afro-tts, Python 3.11 required)
    - Optional: `TTS_BACKEND=huggingface` (if your selected HF TTS model is router-available)
    - `HF_AUDIO_INFERENCE_BASE_URL=https://router.huggingface.co/hf-inference/models`
    - Optional failover list: `HF_AUDIO_ALT_BASE_URLS=` (comma-separated)
    - Note: `api-inference.huggingface.co` may return `410 Gone`; prefer the router base URL above.
    - `HF_AUDIO_TIMEOUT=60`
    - `HF_AUDIO_MAX_FILE_MB=12`
    - `HF_STT_MODEL=openai/whisper-large-v3-turbo`
    - Optional STT alternates: `HF_STT_ALT_MODELS=openai/whisper-large-v3`
    - Optional voice-profile default: `TTS_VOICE_PROFILE_DEFAULT=uganda` (`auto`, `uganda`, `east_africa`, `neutral`)
    - `HF_TTS_MODEL=intronhealth/afro-tts` (when using HF backend)
    - `HF_TTS_MAX_CHARS=800`
    - Optional: `HF_TTS_VOICE_PRESET=<speaker-id>`
    - Optional HF profile overrides:
      - `HF_TTS_VOICE_PRESET_UGANDA=`
      - `HF_TTS_VOICE_PRESET_EAST_AFRICA=`
      - `HF_TTS_VOICE_PRESET_NEUTRAL=`
    - Edge TTS voices (works without model downloads):
      - `EDGE_TTS_VOICE_DEFAULT=en-NG-EzinneNeural`
      - `EDGE_TTS_VOICE_SW=sw-KE-RafikiNeural`
      - Optional profile overrides:
        - `EDGE_TTS_VOICE_UGANDA=en-KE-AsiliaNeural`
        - `EDGE_TTS_VOICE_EAST_AFRICA=sw-KE-RafikiNeural`
        - `EDGE_TTS_VOICE_NEUTRAL=en-US-AvaNeural`
      - Optional: `EDGE_TTS_RATE=+0%`, `EDGE_TTS_PITCH=+0Hz`
    - ElevenLabs settings:
      - `ELEVENLABS_API_KEY=<token>`
      - Optional: `ELEVENLABS_BASE_URL=https://api.elevenlabs.io`
      - Optional: `ELEVENLABS_VOICE_ID=JBFqnCBsd6RMkjVDRZzb`
      - Optional profile voice IDs:
        - `ELEVENLABS_VOICE_ID_UGANDA=`
        - `ELEVENLABS_VOICE_ID_EAST_AFRICA=`
        - `ELEVENLABS_VOICE_ID_NEUTRAL=`
      - Optional: `ELEVENLABS_MODEL_ID=eleven_multilingual_v2`
      - Optional: `ELEVENLABS_OUTPUT_FORMAT=mp3_44100_128`
      - Optional: `ELEVENLABS_TTS_MAX_CHARS=2000`
      - Optional tuning: `ELEVENLABS_STABILITY=0.5`, `ELEVENLABS_SIMILARITY_BOOST=0.75`, `ELEVENLABS_STYLE=0.0`, `ELEVENLABS_SPEAKER_BOOST=true`
    - Coqui local afro-tts settings:
      - `COQUI_TTS_MODEL_ID=intronhealth/afro-tts`
      - `COQUI_TTS_CONFIG_PATH=runtime/models/intronhealth/afro-tts/config.json`
      - `COQUI_TTS_CHECKPOINT_DIR=runtime/models/intronhealth/afro-tts`
      - `COQUI_TTS_SPEAKER_WAV=runtime/models/intronhealth/afro-tts/audios/reference_accent.wav`
      - Optional profile speaker WAVs:
        - `COQUI_TTS_SPEAKER_WAV_UGANDA=`
        - `COQUI_TTS_SPEAKER_WAV_EAST_AFRICA=`
        - `COQUI_TTS_SPEAKER_WAV_NEUTRAL=`
      - `COQUI_TTS_DEFAULT_LANGUAGE=en`
      - `COQUI_TTS_GPT_COND_LEN=3`
      - Ensure afro-tts checkpoint files are downloaded under `runtime/models/intronhealth/afro-tts/`.
      - Helper script: `python app/scripts/setup_afro_tts.py`
    - Piper local TTS settings:
      - `PIPER_BINARY_PATH=piper`
      - `PIPER_MODEL_PATH=/var/www/agrik.co/runtime/models/piper/<voice>.onnx`
      - Optional profile model overrides:
        - `PIPER_MODEL_PATH_UGANDA=`
        - `PIPER_MODEL_PATH_EAST_AFRICA=`
        - `PIPER_MODEL_PATH_NEUTRAL=`
      - Optional config overrides:
        - `PIPER_MODEL_CONFIG_PATH=`
        - `PIPER_MODEL_CONFIG_PATH_UGANDA=`
        - `PIPER_MODEL_CONFIG_PATH_EAST_AFRICA=`
        - `PIPER_MODEL_CONFIG_PATH_NEUTRAL=`
      - Optional speaker IDs:
        - `PIPER_SPEAKER_ID=`
        - `PIPER_SPEAKER_ID_UGANDA=`
        - `PIPER_SPEAKER_ID_EAST_AFRICA=`
        - `PIPER_SPEAKER_ID_NEUTRAL=`
      - Optional synthesis tuning:
        - `PIPER_TTS_MAX_CHARS=800`
        - `PIPER_LENGTH_SCALE=1.0`
        - `PIPER_NOISE_SCALE=0.667`
        - `PIPER_NOISE_W=0.8`
    - Install dependency: `pip install edge-tts` (fast path)
    - Optional local afro-tts dependency: `pip install -r requirements-coqui.txt` (Python 3.9-3.11 only; use a 3.11 venv)
  - `HF_VISION_MODEL=<vision_model_id>` (example: `linkanjarad/mobilenet_v2_1.0_224-plant-disease-identification`)
  - Optional: `HF_VISION_ALT_MODELS=modelA,modelB` (used for compare/deep-analysis mode)
  - `HF_VISION_MODE=classification` (strict image-classification inference path)
  - Optional: `HF_VISION_INFERENCE_BASE_URL=https://router.huggingface.co/hf-inference/models`
  - Optional: `HF_VISION_COMPARE_MAX_MODELS=3`
  - Optional: `HF_VISION_CROP_MODEL_MAP=<json>`
  - Optional vision tuning: `HF_VISION_MAX_IMAGES=6`, `HF_VISION_MAX_FILE_MB=6`, `HF_VISION_TEMPERATURE=0.1`, `HF_VISION_MAX_TOKENS=900`
  - Optional multimodal LLM mode: set `HF_VISION_MODE=chat` and use a vision-capable chat model in `HF_VISION_MODEL`
  - Optional: `HF_BASE_URL=https://router.huggingface.co/v1`
  - Optional: `HF_TIMEOUT=30`, `HF_VERIFY_SSL=true`, `HF_TEMPERATURE=0.2`, `HF_MAX_TOKENS=420`
  - Web/SMS/Voice advisory is AI-only; if provider/token/model is unavailable, advisory endpoints return `503`.
  - Optional multilingual translation:
    - `HF_TRANSLATION_ENABLED=true`
    - `HF_TRANSLATION_MODEL=CohereLabs/command-a-translate-08-2025`
    - `HF_TRANSLATION_TARGETS=sw,lg`
  - Optional external multilingual knowledge:
    - `EXTERNAL_KNOWLEDGE_ENABLED=true`
    - `EXTERNAL_KNOWLEDGE_PROVIDER=wikimedia`
    - `EXTERNAL_KNOWLEDGE_LANGS=en,sw,lg`
- Web `POST /chat/ask` now blends:
  - farmer profile + phone-linked memory
  - grounded excerpts from `app/data/uganda_manuals`
  - weather signal (Open-Meteo) when location is known
  - local market prediction signal when available
  - optional multilingual external context (Wikimedia)
  - translation guardrails for low-resource language output
- Web `POST /chat/ask-multimodal` accepts media files (`files`) + message text and fuses vision diagnosis with agronomy reasoning.
  - Optional form fields:
    - `crop_hint` (target crop selected by farmer)
    - `model_preference` (`auto`, `all`, or specific model id)
    - `deep_analysis` (`true`/`false`, enables richer multi-model diagnostics)
- Web `GET /chat/vision/options` returns available vision models (with tips) and farmer crop options for UI selectors.
- Frontend supports still photo upload and short video upload (up to 5 seconds, converted to still frames before submission).
- Web audio endpoints:
  - `POST /chat/transcribe-audio` (multipart `audio` + optional `locale_hint`) for STT.
  - `POST /chat/synthesize-audio` (`text`, optional `locale_hint`, optional `voice_hint`) for TTS.
- Realtime voice websocket scaffold:
  - `WS /chat/realtime-voice?token=<jwt>`
  - Client events: `session.update` (supports `locale_hint`, `location_hint`, optional `voice_hint`), `audio.chunk`, `audio.commit`, `text.input`, `session.stop`
  - Server events: `session.ready`, `stt.partial`, `stt.final`, `assistant.text.delta`, `assistant.text.final`, `tts.audio.chunk`, `tts.audio.end`, `error`
- Farmer Brain UI now supports:
  - voice-note upload/record for STT
  - one-click `Record & Send` mode (auto transcribe + send)
  - assistant reply playback for TTS (with optional auto-speak)
  - voice profile selector (`Ugandan`, `East African`, `Neutral`, `Auto`) applied to TTS + realtime voice
  - realtime voice scaffold controls: session connect + live chunk stream

### Ugandan voice setup (practical)
- Fastest no-training path:
  - Keep `TTS_BACKEND=edge-tts`
  - Set `TTS_VOICE_PROFILE_DEFAULT=uganda`
  - Set `EDGE_TTS_VOICE_UGANDA=en-KE-AsiliaNeural` (or `en-KE-ChilembaNeural`)
- Best custom voice quality:
  - Create a custom voice in ElevenLabs (IVC/PVC)
  - Set `ELEVENLABS_VOICE_ID_UGANDA=<your_voice_id>`
  - Keep `TTS_BACKEND=elevenlabs`
- Fully local path:
  - Use `TTS_BACKEND=coqui`
  - Capture a clean Ugandan-accent reference WAV and set `COQUI_TTS_SPEAKER_WAV_UGANDA=<path>`

See `docs/multilingual_data_sources.md` for free dataset/source options (OPUS, Masakhane, FLORES, Common Voice, Wikimedia).

## Structure
- `app/main.py` FastAPI app entry
- `app/api/` HTTP endpoints
- `app/services/` service layer (AI, memory)
- `app/db/schema.sql` initial schema
- `app/docs/architecture.md` architecture notes

## Implementing the new features
### 1. Persistence (SQLAlchemy + Postgres)
- Configure `DATABASE_URL` in `.env` or your shell.
- The app auto-creates tables on startup via `Base.metadata.create_all`.
- Data is stored in `farmers`, `farmer_profiles`, `interactions`, and `farmer_locations`.

### 2. Language detection
- Logic lives in `app/services/language.py`.
- It uses `locale_hint` when provided, then falls back to keyword matching.
- To extend: add keywords to `LANGUAGE_KEYWORDS` or swap in a real detector.

### 3. Grounded agronomy retrieval
- Corpus lives in `app/data/agronomy_stub.json`.
- Retrieval in `app/services/retrieval.py` matches crop keywords in the message.
- To extend: replace with a vector DB and real extension manuals.

### 4. SMS provider webhooks
- Twilio: `POST /sms/twilio` (expects `From`, `Body`).
- Africa's Talking: `POST /sms/africastalking` (expects `from`, `text`).
- Parsing logic in `app/services/sms_providers.py`.
- Both endpoints call the same AI + memory pipeline.
- Africa's Talking endpoint also sends outbound SMS replies.
- Twilio endpoint sends outbound SMS replies.

### 5. Outbound SMS (Africa's Talking)
- Set env vars in `.env`:
  - `AFRICASTALKING_USERNAME`
  - `AFRICASTALKING_API_KEY`
  - Optional: `AFRICASTALKING_SENDER_ID`
  - Optional: `AFRICASTALKING_BASE_URL`
- The app also accepts legacy env names `Username` and `API_KEY`.
- Sending logic lives in `app/services/outbound_sms.py`.
- On inbound Africa's Talking webhooks, the app sends a reply via the API and returns delivery status.
- Delivery report callback: `POST /sms/africastalking/dlr`

### 5b. Outbound SMS (Twilio)
- Set env vars in `.env`:
  - `TWILIO_ACCOUNT_SID`
  - `TWILIO_AUTH_TOKEN`
  - `TWILIO_FROM`
  - Optional: `TWILIO_BASE_URL`
- Delivery report callback: `POST /sms/twilio/dlr`

### 6. Voice inbound
- Generic JSON endpoint: `POST /voice/inbound`.
- Provide `farmer_id`, `phone`, and `transcript`.


### 6b. Infobip Voice (Calls API + TTS)
- Set env vars in `.env`:
  - `INFOBIP_API_KEY`
  - `INFOBIP_BASE_URL` (e.g., `https://<region>.api.infobip.com`)
  - `INFOBIP_VOICE_FROM` (caller ID)
  - `INFOBIP_CALLS_APP_ID` (Calls API application ID)
  - Optional: `INFOBIP_VOICE_LANG`, `INFOBIP_VOICE_NAME`, `INFOBIP_VOICE_GENDER`
- Outbound TTS voice message: `POST /voice/infobip/tts`
- Call-to-call (CTC) voice message: `POST /voice/infobip/ctc` (uses `destinationA`/`destinationB`)
- Outbound call (Calls API): `POST /voice/infobip/call`
- Inbound webhooks:
  - Receive URL: `POST /voice/infobip/receive`
  - Event URL: `POST /voice/infobip/events`
- If speech-capture events are enabled in Infobip, send `SPEECH_CAPTURED` events to `/voice/infobip/events` with the transcript; the handler generates advice and replies via `say`.

### 7. Marketplace (API)
- Create listing: `POST /market/listings`
- Search listings: `GET /market/listings`
- Create offer: `POST /market/offers`
- Create service: `POST /market/services`
- Search services: `GET /market/services`
- Create alert: `POST /market/alerts`
- Market prices: `GET /market/prices`
- Admin price publish: `POST /market/prices` (optional `MARKET_ADMIN_TOKEN`)

### 7c. Market intelligence + weather (API)
- Market intel (prices + predictions + Chroma insights): `GET /market/intel`
  - Optional query params: `crop`, `district`, `limit`, `refresh=true`
- Weather summary (Open-Meteo): `GET /weather/summary`
  - Uses saved `district/parish`, or pass `lat`, `lon`, `location`, `days`
- Configure price feeds and Chroma in `.env` (see `.env.example`).

Price alert example (strict crop + district required):
```json
{
  "phone": "+2567XXXXXXX",
  "alert_type": "price_above",
  "crop": "maize",
  "threshold": 1200,
  "channel": "sms",
  "location": { "district": "Lira" }
}
```

Weather alert example:
```json
{
  "phone": "+2567XXXXXXX",
  "alert_type": "rain",
  "threshold": 10,
  "channel": "sms",
  "location": { "district": "Lira" }
}
```

### 8. Auth (API)
- Register: `POST /auth/register`
- Login: `POST /auth/login`
- Verify OTP: `POST /auth/verify-otp`
- Current user: `GET /auth/me`

Register example:
```json
{ "phone": "+2567XXXXXXX", "role": "farmer" }
```

Verify OTP example:
```json
{ "phone": "+2567XXXXXXX", "code": "123456" }
```

### 8b. User profile (API)
- Profile details: `GET /profile/details`
- Update profile: `PUT /profile/details`
- Settings only: `GET /profile/settings`, `PUT /profile/settings`

### 8c. Admin (API)
- Summary: `GET /admin/summary`
- Users: `GET /admin/users`, `PATCH /admin/users/{id}`
- Listings: `GET /admin/listings`, `PATCH /admin/listings/{id}`
- Alerts: `GET /admin/alerts`
- Prices: `GET /admin/prices`, `POST /admin/prices`

### 8d. Admin auth (API)
- Admin login (email + password â†’ OTP): `POST /admin/login`
- Verify OTP: `POST /admin/verify-otp`
- Current admin: `GET /admin/me`
- Configure admin seed + SMTP in `.env` (see `.env.example`).

### Seed Uganda test marketplace data
- Seed users (all districts, role mix, test emails): `python app/scripts/seed_uganda_test_users.py`
- Seed market activity for landing and marketplace (listings, offers, services, alerts, prices): `python app/scripts/seed_uganda_market_activity.py`
- Export files:
  - `runtime/seeds/test_users_uganda.json`
  - `runtime/seeds/market_activity_uganda.json`

### 7b. Marketplace (SMS)
- `SELL maize 200kg UGX1200 Lira`
- `BUYERS maize Lira`
- `OFFER 12 UGX1150`
- `SERVICE transport UGX5000 Lira`
- `PRICE maize Lira`
- `ALERT rain Lira 10` (threshold in mm)
- `ALERT PRICE above maize 1200 Lira`

## Grounded Advice Upgrade
- Place Ugandan extension manuals in `app/data/uganda_manuals/` as `.txt` or `.md`.
- Structured JSON is supported at `app/data/uganda_manuals/manuals.json`.
- Optional language JSON: `manuals_lg.json`, `manuals_nyn.json`.
- Pest and disease cards: `pest_cards.json` (optional `pest_cards_lg.json`, `pest_cards_nyn.json`).
- Verified sources index: `app/data/uganda_manuals/verified/index.json` (replace placeholders with official excerpts).
- Retrieval splits documents into paragraphs and scores overlap with the query.
- Fallback: `app/data/agronomy_stub.json` is used if no manuals are present (optional `agronomy_stub_{lang}.json`).
- Stopword tuning: add `app/data/stopwords/common.txt` and `app/data/stopwords/{lang}.txt` if needed.
- Language-aware selection: `_lg.txt` for Luganda and `_nyn.txt` for Runyankole when detected.

## Citations & Confidence
- API responses include:
  - `citations`: list of `{source_id, title}`
  - `source_confidence`: numeric score (0.0â€“1.0)
  - `citation_text`: short formatted string for SMS
  - `MIN_CONFIDENCE_THRESHOLD` in `.env` controls confidence gating for extra-details prompts

## Verified Ingestion
- Ingest verified manuals into the index:
  - `python app/scripts/ingest_verified.py --input path/to/manuals --source-id UG-EXT-001 --title "Official Manual" --language en`
  - PDF ingestion records `page` and `file` for traceable citations

## Validation
- Run `python app/scripts/validate_manuals.py` to validate `manuals.json` and `pest_cards.json`.
- Run `python app/scripts/verify_farm_brain_ai.py` to confirm Farm Brain is using live AI and no-reply fallback is disabled.
- Run `python app/scripts/verify_vision_pipeline.py` to confirm media vision analysis is using live AI and hard-fails without token.
  - Optional custom media probe: `python app/scripts/verify_vision_pipeline.py --image-path path/to/leaf.jpg`

## Retrieval CLI
- Example:
  - `python app/scripts/test_retrieval.py --text "maize leaves have frass" --lang en`
  - `python app/scripts/test_retrieval.py --text "kasawa erina obukuba ku bikoola" --lang lg`
- Choose source and log top chunks:
   - `python app/scripts/test_retrieval.py --text "maize leaves have frass" --lang en --source pest_cards --log-top 3`

## Migrations (Alembic)
1. Set `DATABASE_URL` in `.env`.
2. Run migrations:
   - `alembic upgrade head`
3. Create a new migration after model changes:
   - `alembic revision --autogenerate -m "describe change"`
4. Ensure the Alembic template exists:
   - The repo includes `alembic/script.py.mako` so autogenerate works on clean setups.

## Phase 1 focus
- SMS + Voice ingestion
- Farmer memory
- Core crops, grounded advice
## Operations
- Start metrics endpoint at `/metrics` (Prometheus format).
- Run retry worker:
  - `python app/scripts/retry_worker.py`
- Run weather alert worker:
  - `python app/scripts/weather_alert_worker.py`
- Run price alert worker:
  - `python app/scripts/price_alert_worker.py`
- Prometheus alert rules: `monitoring/prometheus_alerts.yml`
- Grafana starter dashboard: `monitoring/grafana_dashboard.json`
- Grafana import scripts:
  - `monitoring/import_grafana.sh`
  - `monitoring/import_grafana.ps1`

## Health
- Liveness: `GET /health`
- Readiness: `GET /health/ready`

## Webhook Security
- Twilio signature validation is enforced when `TWILIO_AUTH_TOKEN` is set.
- Africaâ€™s Talking signature validation is enforced when `AFRICASTALKING_SIGNATURE_SECRET` is set.

