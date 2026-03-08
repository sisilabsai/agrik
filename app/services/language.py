import re
from typing import Tuple


LANGUAGE_KEYWORDS = {
    "sw": ["mahindi", "maharage", "mihogo", "ndizi", "ugonjwa", "wadudu", "shamba", "wiki", "orodha", "kinga"],
    "lg": ["oyagala", "sanyu", "mmer", "ebirimwa", "ennaku", "ebitono"],
    "nyn": ["orikurima", "embeere", "ekyokurya", "oburo"],
    "ach": ["ajwaka", "kwo", "cam", "lobo"],
    "teo": ["apolon", "ekar", "akaru", "adakar"],
    "en": ["plant", "crop", "pest", "disease", "maize", "beans"],
}

LOCALE_ALIASES = {
    "en": "en",
    "eng": "en",
    "english": "en",
    "sw": "sw",
    "swa": "sw",
    "swahili": "sw",
    "kiswahili": "sw",
    "lg": "lg",
    "luganda": "lg",
    "ganda": "lg",
    "nyn": "nyn",
    "runyankole": "nyn",
    "nyankole": "nyn",
    "ankole": "nyn",
    "ach": "ach",
    "acholi": "ach",
    "teo": "teo",
    "ateso": "teo",
    "teso": "teo",
}


def normalize_locale_hint(locale_hint: str | None) -> str | None:
    if not locale_hint:
        return None

    hint = locale_hint.strip().lower()
    if not hint:
        return None

    if hint in LOCALE_ALIASES:
        return LOCALE_ALIASES[hint]

    tokens = [token for token in re.split(r"[^a-z]+", hint) if token]
    for token in tokens:
        if token in LOCALE_ALIASES:
            return LOCALE_ALIASES[token]

    return None


def detect_language(text: str, locale_hint: str | None) -> Tuple[str, float]:
    normalized_hint = normalize_locale_hint(locale_hint)
    if normalized_hint:
        return normalized_hint, 0.7

    lowered = text.lower()
    tokens = [token for token in re.findall(r"[a-z\u00c0-\u024f']+", lowered) if token]
    token_set = set(tokens)

    best_lang = "en"
    best_score = 0
    for lang, keywords in LANGUAGE_KEYWORDS.items():
        score = 0
        for kw in keywords:
            if kw in token_set:
                score += 1
                continue
            if any(token.startswith(kw) for token in token_set):
                score += 1
        if score > best_score:
            best_lang = lang
            best_score = score

    if best_score > 0:
        confidence = min(0.78, 0.45 + (best_score * 0.08))
        return best_lang, confidence

    # Last pass for substring matches when tokenization is weak.
    for lang, keywords in LANGUAGE_KEYWORDS.items():
        for kw in keywords:
            if kw in lowered:
                return lang, 0.55

    return "en", 0.3
