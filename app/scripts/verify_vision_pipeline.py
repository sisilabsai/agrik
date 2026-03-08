#!/usr/bin/env python
import argparse
import asyncio
import os
import struct
import sys
import time
import zlib
from io import BytesIO
from pathlib import Path

from starlette.datastructures import Headers, UploadFile

# Ensure project root is on sys.path so "app" is importable
PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app.services.vision import VisionUnavailableError, VisionValidationError, analyze_crop_media


def _png_chunk(kind: bytes, data: bytes) -> bytes:
    head = struct.pack(">I", len(data)) + kind + data
    crc = struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
    return head + crc


def _build_probe_png(width: int = 96, height: int = 96) -> bytes:
    rows = bytearray()
    for y in range(height):
        rows.append(0)  # filter: None
        for x in range(width):
            # Synthetic RGB pattern with contrast so classifier has edges/colors.
            r = int((x / max(1, width - 1)) * 255)
            g = int((y / max(1, height - 1)) * 255)
            b = int(((x + y) / max(1, width + height - 2)) * 255)
            rows.extend((r, g, b))

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    idat = zlib.compress(bytes(rows), level=9)
    return b"".join(
        [
            b"\x89PNG\r\n\x1a\n",
            _png_chunk(b"IHDR", ihdr),
            _png_chunk(b"IDAT", idat),
            _png_chunk(b"IEND", b""),
        ]
    )


def _guess_mime(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix in {".jpg", ".jpeg"}:
        return "image/jpeg"
    if suffix == ".png":
        return "image/png"
    if suffix == ".webp":
        return "image/webp"
    return "application/octet-stream"


def _make_probe_upload(image_path: str | None = None) -> UploadFile:
    if image_path:
        path = Path(image_path).expanduser().resolve()
        if not path.exists():
            raise FileNotFoundError(f"Image file not found: {path}")
        data = path.read_bytes()
        filename = path.name
        mime_type = _guess_mime(path)
    else:
        data = _build_probe_png()
        filename = "vision-probe.png"
        mime_type = "image/png"

    return UploadFile(
        file=BytesIO(data),
        filename=filename,
        headers=Headers({"content-type": mime_type}),
    )


async def _run_live_probe(question: str, attempts: int, image_path: str | None) -> None:
    max_attempts = max(1, attempts)
    last_exc: Exception | None = None
    for attempt in range(1, max_attempts + 1):
        try:
            analysis = await analyze_crop_media(
                files=[_make_probe_upload(image_path)],
                farmer_message=question,
            )
            print("PASS: Vision AI response generated.")
            print(f"Model: {analysis.model}")
            print(f"Media count: {analysis.media_count}")
            print(f"Likely issues: {len(analysis.likely_issues)}")
            print("Overall assessment preview:")
            print((analysis.overall_assessment or "")[:240])
            return
        except (VisionUnavailableError, VisionValidationError) as exc:
            last_exc = exc
            if attempt >= max_attempts:
                raise
            print(f"WARN: Vision attempt {attempt} failed: {exc}")
            time.sleep(1.5)
    if last_exc:
        raise last_exc
    raise RuntimeError("Vision probe failed with unknown error.")


async def _assert_no_token_fails(question: str, image_path: str | None) -> None:
    original_provider = os.environ.get("AI_PROVIDER")
    original_model = os.environ.get("HF_VISION_MODEL")
    original_token = os.environ.get("HUGGINGFACE_API_TOKEN")
    try:
        os.environ["AI_PROVIDER"] = "huggingface"
        if not (original_model or "").strip():
            raise RuntimeError("HF_VISION_MODEL is not configured.")
        os.environ["HUGGINGFACE_API_TOKEN"] = ""
        try:
            await analyze_crop_media(files=[_make_probe_upload(image_path)], farmer_message=question)
        except VisionUnavailableError:
            print("PASS: Missing token causes hard vision failure (fallback disabled).")
            return
        raise RuntimeError("Vision request succeeded without token; fallback is still active.")
    finally:
        if original_provider is None:
            os.environ.pop("AI_PROVIDER", None)
        else:
            os.environ["AI_PROVIDER"] = original_provider
        if original_model is None:
            os.environ.pop("HF_VISION_MODEL", None)
        else:
            os.environ["HF_VISION_MODEL"] = original_model
        if original_token is None:
            os.environ.pop("HUGGINGFACE_API_TOKEN", None)
        else:
            os.environ["HUGGINGFACE_API_TOKEN"] = original_token


async def _main_async(args) -> None:
    await _run_live_probe(args.question, attempts=args.attempts, image_path=args.image_path)
    if not args.skip_no_token_check:
        await _assert_no_token_fails(args.question, image_path=args.image_path)


def main() -> None:
    parser = argparse.ArgumentParser(description="Verify GRIK vision pipeline (AI-only).")
    parser.add_argument(
        "--question",
        default="Analyze this crop image for likely disease or pest and list immediate actions.",
        help="Prompt to send with the probe image.",
    )
    parser.add_argument("--attempts", type=int, default=3, help="Retry attempts for live vision call.")
    parser.add_argument(
        "--image-path",
        default=None,
        help="Optional local image path to use instead of the generated probe PNG.",
    )
    parser.add_argument("--skip-no-token-check", action="store_true", help="Skip the negative token-removal test.")
    args = parser.parse_args()
    asyncio.run(_main_async(args))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"FAIL: {exc}")
        raise SystemExit(1)
