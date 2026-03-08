#!/usr/bin/env python
import argparse
import logging
import sys
from pathlib import Path

# Ensure project root is on sys.path so "app" is importable
PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app.services.ai_brain import generate_advice


def main():
    parser = argparse.ArgumentParser(description="Test AGRIK retrieval by language")
    parser.add_argument("--text", required=True, help="Farmer query text")
    parser.add_argument("--lang", default=None, help="Language hint (e.g., en, lg, nyn)")
    parser.add_argument(
        "--source",
        default="all",
        choices=["all", "manuals", "pest_cards"],
        help="Retrieval source",
    )
    parser.add_argument("--log-top", type=int, default=3, help="Log top-k chunks for debugging")
    args = parser.parse_args()

    if args.log_top > 0:
        logging.basicConfig(level=logging.DEBUG)

    result = generate_advice(
        farmer_id="test",
        message=args.text,
        locale_hint=args.lang,
        location_hint=None,
        channel="sms",
        retrieval_source=args.source,
        log_top_k=args.log_top,
    )

    print("Language:", result.language)
    print("Confidence:", result.confidence)
    print("Reply:")
    print(result.reply)
    if result.sources:
        print("Sources:")
        for s in result.sources:
            print("-", s)
    if result.citations:
        print("Citations:")
        for c in result.citations:
            print("-", c.get("source_id"), c.get("title"), c.get("file"), c.get("page"))
    print("Source confidence:", result.source_confidence)
    print("Citation text:", result.citation_text)


if __name__ == "__main__":
    main()
