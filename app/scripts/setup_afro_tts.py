import argparse
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description="Prepare local intronhealth/afro-tts model assets.")
    parser.add_argument("--model-id", default="intronhealth/afro-tts")
    parser.add_argument("--model-dir", default="runtime/models/intronhealth/afro-tts")
    parser.add_argument("--skip-download", action="store_true")
    args = parser.parse_args()

    model_dir = Path(args.model_dir)
    model_dir.mkdir(parents=True, exist_ok=True)

    if not args.skip_download:
        try:
            from huggingface_hub import snapshot_download  # type: ignore
        except ImportError:
            print("huggingface_hub is missing. Install it with: pip install huggingface-hub")
            return 1

        print(f"Downloading {args.model_id} into {model_dir} ...")
        snapshot_download(
            repo_id=args.model_id,
            local_dir=str(model_dir),
            local_dir_use_symlinks=False,
        )

    required_files = [
        "config.json",
        "model.pth",
        "dvae.pth",
        "mel_stats.pth",
        "vocab.json",
    ]
    missing = [str(model_dir / name) for name in required_files if not (model_dir / name).exists()]
    if missing:
        print("Afro-TTS assets are incomplete. Missing files:")
        for path in missing:
            print(f"- {path}")
        return 1

    print("Afro-TTS assets are present.")
    print("Next:")
    print("1) Put a reference accent WAV file and set COQUI_TTS_SPEAKER_WAV in .env")
    print("   Suggested path: runtime/models/intronhealth/afro-tts/audios/reference_accent.wav")
    print("2) Ensure TTS is installed: pip install TTS")
    print("3) Restart API server")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
