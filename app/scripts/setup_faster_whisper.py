from app.core.config import get_ai_provider_config
from app.services.audio import _ensure_faster_whisper_model


def main() -> None:
    cfg = get_ai_provider_config()
    model = _ensure_faster_whisper_model(cfg)
    print(
        "faster-whisper ready:",
        {
            "model_size": cfg.get("faster_whisper_model_size", "small"),
            "model_dir": cfg.get("faster_whisper_model_dir", "runtime/models/faster-whisper"),
            "device": cfg.get("faster_whisper_device", "cpu"),
            "compute_type": cfg.get("faster_whisper_compute_type", "int8"),
            "model_class": model.__class__.__name__,
        },
    )


if __name__ == "__main__":
    main()
