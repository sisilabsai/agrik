from __future__ import annotations

import uuid
from pathlib import Path
from typing import Iterable

from fastapi import UploadFile

from app.core.config import get_media_storage_config


_MIME_EXTENSION_MAP = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/heic": ".heic",
    "image/heif": ".heif",
}


def _safe_extension(content_type: str, filename: str) -> str:
    suffix = Path(filename or "").suffix.lower().strip()
    if suffix and suffix.startswith(".") and 1 <= len(suffix) <= 10 and suffix[1:].isalnum():
        return suffix
    return _MIME_EXTENSION_MAP.get(content_type.lower(), ".jpg")


def _ensure_market_media_dir() -> Path:
    cfg = get_media_storage_config()
    directory = Path(cfg["market_media_dir"])
    if not directory.is_absolute():
        directory = Path.cwd() / directory
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def _validate_upload(content_type: str, size_bytes: int) -> None:
    cfg = get_media_storage_config()
    if not content_type.lower().startswith("image/"):
        raise ValueError("Only image media files are supported for marketplace evidence.")

    max_bytes = cfg["market_media_max_file_mb"] * 1024 * 1024
    if size_bytes > max_bytes:
        raise ValueError(f"File exceeds maximum allowed size of {cfg['market_media_max_file_mb']} MB.")


async def save_market_media_files(files: Iterable[UploadFile], base_url: str) -> list[dict]:
    cfg = get_media_storage_config()
    upload_list = list(files)
    if not upload_list:
        raise ValueError("No files provided.")
    if len(upload_list) > cfg["market_media_max_files"]:
        raise ValueError(f"Maximum {cfg['market_media_max_files']} files allowed per upload request.")

    storage_dir = _ensure_market_media_dir()
    root_url = (base_url or "").rstrip("/")
    results: list[dict] = []

    for media in upload_list:
        content_type = str(media.content_type or "").strip().lower()
        data = await media.read()
        size_bytes = len(data)
        _validate_upload(content_type, size_bytes)

        extension = _safe_extension(content_type, media.filename or "")
        file_name = f"{uuid.uuid4().hex}{extension}"
        destination = storage_dir / file_name
        destination.write_bytes(data)

        media_url = f"{root_url}/media/market/{file_name}" if root_url else f"/media/market/{file_name}"
        results.append(
            {
                "filename": file_name,
                "url": media_url,
                "content_type": content_type,
                "size_bytes": size_bytes,
            }
        )

        await media.close()

    return results
