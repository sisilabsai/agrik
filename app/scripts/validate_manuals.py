#!/usr/bin/env python
import json
from pathlib import Path

BASE = Path(__file__).resolve().parents[1] / "data" / "uganda_manuals"

MANUALS_JSON = BASE / "manuals.json"
MANUALS_JSON_LG = BASE / "manuals_lg.json"
MANUALS_JSON_NYN = BASE / "manuals_nyn.json"
PEST_CARDS_JSON = BASE / "pest_cards.json"
PEST_CARDS_JSON_LG = BASE / "pest_cards_lg.json"
PEST_CARDS_JSON_NYN = BASE / "pest_cards_nyn.json"


def _fail(msg: str) -> None:
    raise SystemExit(msg)


def validate_manuals():
    def _validate(path: Path, label: str):
        if not path.exists():
            return
        data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data, list):
            _fail(f"{label} must be a list")
        required = {"crop", "scientific_name", "regional_notes", "varietal_notes", "symptoms", "advice"}
        for i, entry in enumerate(data):
            if not isinstance(entry, dict):
                _fail(f"{label} entry {i} must be an object")
            missing = required - set(entry.keys())
            if missing:
                _fail(f"{label} entry {i} missing keys: {sorted(missing)}")
            for k in ["regional_notes", "varietal_notes", "symptoms", "advice"]:
                if not isinstance(entry[k], list):
                    _fail(f"{label} entry {i} key {k} must be a list")

    if not MANUALS_JSON.exists():
        _fail(f"Missing {MANUALS_JSON}")
    _validate(MANUALS_JSON, "manuals.json")
    _validate(MANUALS_JSON_LG, "manuals_lg.json")
    _validate(MANUALS_JSON_NYN, "manuals_nyn.json")


def _validate_pest_cards(path: Path, label: str, required: bool) -> None:
    if not path.exists():
        if required:
            _fail(f"Missing {path}")
        return
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, list):
        _fail(f"{label} must be a list")
    for i, entry in enumerate(data):
        if not isinstance(entry, dict) or "crop" not in entry or "cards" not in entry:
            _fail(f"{label} entry {i} must have crop and cards")
        if not isinstance(entry["cards"], list):
            _fail(f"{label} entry {i} cards must be a list")
        for j, card in enumerate(entry["cards"]):
            if not isinstance(card, dict):
                _fail(f"{label} entry {i} card {j} must be object")
            for key in ["name", "symptoms", "actions", "treatment_thresholds", "local_suppliers"]:
                if key not in card:
                    _fail(f"{label} entry {i} card {j} missing {key}")


def validate_pest_cards():
    _validate_pest_cards(PEST_CARDS_JSON, "pest_cards.json", required=True)
    _validate_pest_cards(PEST_CARDS_JSON_LG, "pest_cards_lg.json", required=False)
    _validate_pest_cards(PEST_CARDS_JSON_NYN, "pest_cards_nyn.json", required=False)


def main():
    validate_manuals()
    validate_pest_cards()
    print("Manuals JSON validated OK")


if __name__ == "__main__":
    main()
