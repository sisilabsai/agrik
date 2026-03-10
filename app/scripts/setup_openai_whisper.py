from pathlib import Path
import sys

ROOT_DIR = Path(__file__).resolve().parents[2]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from app.core.config import get_ai_provider_config
from app.services.audio import _ensure_openai_whisper_model


def main() -> None:
    cfg = get_ai_provider_config()
    model = _ensure_openai_whisper_model(cfg)
    print(
        "openai-whisper ready:",
        {
            "model": cfg.get("openai_whisper_model", "small"),
            "model_path": cfg.get("openai_whisper_model_path", ""),
            "model_dir": cfg.get("openai_whisper_model_dir", "runtime/models/openai-whisper"),
            "device": cfg.get("openai_whisper_device", "cpu"),
            "model_class": model.__class__.__name__,
        },
    )


if __name__ == "__main__":
    main()
