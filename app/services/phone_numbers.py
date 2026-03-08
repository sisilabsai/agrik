import re

UGANDA_COUNTRY_CODE = "256"
UGANDA_LOCAL_LENGTH = 9


def _digits_only(value: str) -> str:
    return "".join(ch for ch in value if ch.isdigit())


def normalize_ugandan_phone(phone: str) -> str:
    raw = (phone or "").strip()
    if not raw:
        raise ValueError("phone is required")

    compact = re.sub(r"[^\d+]", "", raw)
    if compact.startswith("00"):
        compact = f"+{compact[2:]}"

    digits = _digits_only(compact)
    if not digits:
        raise ValueError("phone must include digits")

    local = ""
    if compact.startswith("+"):
        if not digits.startswith(UGANDA_COUNTRY_CODE):
            raise ValueError("phone must be a Uganda number (+256)")
        local = digits[len(UGANDA_COUNTRY_CODE) :]
    elif digits.startswith(UGANDA_COUNTRY_CODE):
        local = digits[len(UGANDA_COUNTRY_CODE) :]
    elif digits.startswith("0"):
        local = digits[1:]
    elif len(digits) == UGANDA_LOCAL_LENGTH:
        local = digits
    else:
        raise ValueError("phone must be a valid Uganda number")

    # Handle numbers supplied as 2560XXXXXXXXX.
    if len(local) == UGANDA_LOCAL_LENGTH + 1 and local.startswith("0"):
        local = local[1:]

    if len(local) != UGANDA_LOCAL_LENGTH:
        raise ValueError("phone must be a valid Uganda number")

    return f"+{UGANDA_COUNTRY_CODE}{local}"


def phone_lookup_variants(phone: str) -> list[str]:
    normalized = normalize_ugandan_phone(phone)
    local = normalized[len(f"+{UGANDA_COUNTRY_CODE}") :]
    variants = [
        normalized,
        f"{UGANDA_COUNTRY_CODE}{local}",
        f"0{local}",
        local,
    ]
    deduped: list[str] = []
    seen: set[str] = set()
    for item in variants:
        if item in seen:
            continue
        seen.add(item)
        deduped.append(item)
    return deduped
