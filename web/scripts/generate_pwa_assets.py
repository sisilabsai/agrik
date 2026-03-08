from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "src" / "assets" / "logo_clear.png"
OUTPUT = ROOT / "public" / "pwa"
BACKGROUND = "#f4f5ef"
MASKABLE_BG = "#11442d"


def contain(image: Image.Image, box: tuple[int, int], padding: float = 0.12) -> Image.Image:
    target_w, target_h = box
    inner_w = int(target_w * (1 - padding * 2))
    inner_h = int(target_h * (1 - padding * 2))
    ratio = min(inner_w / image.width, inner_h / image.height)
    resized = image.resize((max(1, int(image.width * ratio)), max(1, int(image.height * ratio))), Image.LANCZOS)
    canvas = Image.new("RGBA", box, (0, 0, 0, 0))
    offset = ((target_w - resized.width) // 2, (target_h - resized.height) // 2)
    canvas.paste(resized, offset, resized)
    return canvas


def save_square_icon(image: Image.Image, size: int, name: str, background: str) -> None:
    canvas = Image.new("RGBA", (size, size), background)
    contained = contain(image, (size, size), padding=0.14 if size >= 192 else 0.12)
    canvas.alpha_composite(contained)
    canvas.save(OUTPUT / name)


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    image = Image.open(SOURCE).convert("RGBA")

    save_square_icon(image, 16, "favicon-16.png", BACKGROUND)
    save_square_icon(image, 32, "favicon-32.png", BACKGROUND)
    save_square_icon(image, 64, "icon-64.png", BACKGROUND)
    save_square_icon(image, 180, "apple-touch-icon.png", BACKGROUND)
    save_square_icon(image, 192, "icon-192.png", BACKGROUND)
    save_square_icon(image, 256, "icon-256.png", BACKGROUND)
    save_square_icon(image, 512, "icon-512.png", BACKGROUND)
    save_square_icon(image, 192, "maskable-192.png", MASKABLE_BG)
    save_square_icon(image, 512, "maskable-512.png", MASKABLE_BG)

    favicon = Image.new("RGBA", (32, 32), BACKGROUND)
    favicon.alpha_composite(contain(image, (32, 32), padding=0.12))
    favicon.save(ROOT / "public" / "favicon.ico", sizes=[(16, 16), (32, 32)])


if __name__ == "__main__":
    main()
