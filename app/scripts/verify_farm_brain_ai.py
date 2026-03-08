#!/usr/bin/env python
import argparse
import os
import sys
import time
import uuid
from pathlib import Path

# Ensure project root is on sys.path so "app" is importable
PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app.db.models import AuthUser
from app.db.session import SessionLocal
from app.services.grik_copilot import AIUnavailableError, generate_grik_chat_advice


def _ensure_probe_user(db, phone: str) -> AuthUser:
    user = db.query(AuthUser).filter(AuthUser.phone == phone).first()
    if user:
        changed = False
        if user.role != "farmer":
            user.role = "farmer"
            changed = True
        if user.status != "active":
            user.status = "active"
            changed = True
        if user.verification_status != "verified":
            user.verification_status = "verified"
            changed = True
        if changed:
            db.commit()
            db.refresh(user)
        return user

    user = AuthUser(
        id=uuid.uuid4().hex,
        phone=phone,
        role="farmer",
        status="active",
        verification_status="verified",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _assert_live_ai_response(
    db,
    user: AuthUser,
    message: str,
    locale: str,
    location: str | None,
    attempts: int,
) -> None:
    advice = None
    last_exc: Exception | None = None
    max_attempts = max(1, attempts)
    for attempt in range(1, max_attempts + 1):
        try:
            advice = generate_grik_chat_advice(
                db=db,
                user=user,
                message=message,
                locale_hint=locale,
                location_hint=location,
            )
            break
        except AIUnavailableError as exc:
            last_exc = exc
            if attempt >= max_attempts:
                raise
            print(f"WARN: AI attempt {attempt} failed: {exc}")
            time.sleep(1.5)

    if advice is None:
        if last_exc:
            raise last_exc
        raise RuntimeError("Farm Brain AI probe did not produce an advisory.")
    if not advice.reply.strip():
        raise RuntimeError("Farm Brain returned an empty reply.")

    lowered = advice.reply.lower()
    fallback_markers = [
        "a grounded agronomy response will follow",
        "i need a bit more detail (crop, stage, location)",
    ]
    if any(marker in lowered for marker in fallback_markers):
        raise RuntimeError("Farm Brain returned legacy fallback text instead of AI output.")
    if "### " not in advice.reply:
        raise RuntimeError("Farm Brain response does not look like generated markdown guidance.")

    print("PASS: Live Farm Brain AI response generated.")
    print(f"Language: {advice.language}")
    print(f"Source confidence: {advice.source_confidence}")
    print(f"Citations: {len(advice.citations or [])}")
    print("--- Reply preview ---")
    preview = advice.reply[:800].encode("ascii", errors="replace").decode("ascii")
    print(preview)


def _assert_fallback_disabled(db, user: AuthUser, message: str, locale: str, location: str | None) -> None:
    original_provider = os.environ.get("AI_PROVIDER")
    original_model = os.environ.get("HF_MODEL")
    original_token = os.environ.get("HUGGINGFACE_API_TOKEN")

    try:
        os.environ["AI_PROVIDER"] = "huggingface"
        if not (original_model or "").strip():
            raise RuntimeError("HF_MODEL is not configured, cannot verify strict no-fallback behavior.")
        os.environ["HUGGINGFACE_API_TOKEN"] = ""

        try:
            generate_grik_chat_advice(
                db=db,
                user=user,
                message=message,
                locale_hint=locale,
                location_hint=location,
            )
        except AIUnavailableError:
            print("PASS: Missing token causes hard failure (fallback is disabled).")
            return

        raise RuntimeError("Farm Brain still returned content without HF token, fallback is still active.")
    finally:
        if original_provider is None:
            os.environ.pop("AI_PROVIDER", None)
        else:
            os.environ["AI_PROVIDER"] = original_provider

        if original_model is None:
            os.environ.pop("HF_MODEL", None)
        else:
            os.environ["HF_MODEL"] = original_model

        if original_token is None:
            os.environ.pop("HUGGINGFACE_API_TOKEN", None)
        else:
            os.environ["HUGGINGFACE_API_TOKEN"] = original_token


def main() -> None:
    parser = argparse.ArgumentParser(description="Verify that GRIK Farm Brain is using live AI and no local fallback.")
    parser.add_argument(
        "--message",
        default="My maize leaves are yellow. Give immediate actions for today and this week.",
        help="Probe message sent to Farm Brain.",
    )
    parser.add_argument("--locale", default="en", help="Locale hint for the probe request.")
    parser.add_argument("--location", default="Lira, Uganda", help="Location hint for the probe request.")
    parser.add_argument("--phone", default="+256700000001", help="Phone number for probe user.")
    parser.add_argument(
        "--attempts",
        type=int,
        default=3,
        help="How many times to retry live AI probe before failing.",
    )
    parser.add_argument(
        "--hf-timeout",
        type=float,
        default=None,
        help="Optional temporary HF timeout (seconds) applied during this script run.",
    )
    parser.add_argument(
        "--skip-no-token-check",
        action="store_true",
        help="Skip the negative test that removes HF token to confirm fallback is disabled.",
    )
    args = parser.parse_args()

    db = SessionLocal()
    try:
        if args.hf_timeout is not None:
            os.environ["HF_TIMEOUT"] = str(args.hf_timeout)
        user = _ensure_probe_user(db, args.phone)
        _assert_live_ai_response(db, user, args.message, args.locale, args.location, attempts=args.attempts)
        if not args.skip_no_token_check:
            _assert_fallback_disabled(db, user, args.message, args.locale, args.location)
    finally:
        db.close()


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"FAIL: {exc}")
        raise SystemExit(1)
