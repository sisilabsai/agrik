#!/usr/bin/env python
import argparse
import json
from pathlib import Path

try:
    import pdfplumber
except Exception:
    pdfplumber = None


def _chunk_text(text: str, max_len: int = 500) -> list[str]:
    parts = []
    buf = []
    count = 0
    for paragraph in text.split("\n\n"):
        p = paragraph.strip()
        if not p:
            continue
        if count + len(p) > max_len and buf:
            parts.append(" ".join(buf))
            buf = [p]
            count = len(p)
        else:
            buf.append(p)
            count += len(p)
    if buf:
        parts.append(" ".join(buf))
    return parts


def _read_text(path: Path) -> list[tuple[str, int]]:
    if path.suffix.lower() == ".pdf":
        if pdfplumber is None:
            raise RuntimeError("pdfplumber is required for PDF ingestion")
        chunks = []
        with pdfplumber.open(path) as pdf:
            for i, page in enumerate(pdf.pages, start=1):
                chunks.append((page.extract_text() or "", i))
        return chunks
    return [(path.read_text(encoding="utf-8", errors="ignore"), 0)]


def main():
    parser = argparse.ArgumentParser(description="Ingest verified manuals into index.json")
    parser.add_argument("--input", required=True, help="File or directory of .txt/.pdf")
    parser.add_argument("--source-id", required=True, help="Source ID for citations")
    parser.add_argument("--title", required=True, help="Source title")
    parser.add_argument("--language", default="en", help="Language code (en/lg/nyn)")
    parser.add_argument("--out", default="app/data/uganda_manuals/verified/index.json")
    args = parser.parse_args()

    input_path = Path(args.input)
    files = []
    if input_path.is_dir():
        files = list(input_path.glob("*.txt")) + list(input_path.glob("*.pdf"))
    else:
        files = [input_path]

    records = []
    for f in files:
        pages = _read_text(f)
        for text, page_num in pages:
            for chunk in _chunk_text(text):
                records.append(
                    {
                        "source_id": args.source_id,
                        "title": args.title,
                        "language": args.language,
                        "text": chunk,
                        "page": page_num,
                        "file": f.name,
                    }
                )

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(records, ensure_ascii=True, indent=2), encoding="utf-8")
    print(f"Wrote {len(records)} chunks to {out_path}")


if __name__ == "__main__":
    main()
