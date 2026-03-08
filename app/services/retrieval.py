import json
import math
import re
import logging
import unicodedata
from pathlib import Path
from typing import List, Tuple, Optional, Set, Dict, Any


DATA_DIR = Path(__file__).resolve().parent.parent / "data"
DATA_PATH = DATA_DIR / "agronomy_stub.json"
MANUALS_DIR = DATA_DIR / "uganda_manuals"
MANUALS_JSON = MANUALS_DIR / "manuals.json"
MANUALS_JSON_LG = MANUALS_DIR / "manuals_lg.json"
MANUALS_JSON_NYN = MANUALS_DIR / "manuals_nyn.json"
PEST_CARDS_JSON = MANUALS_DIR / "pest_cards.json"
PEST_CARDS_JSON_LG = MANUALS_DIR / "pest_cards_lg.json"
PEST_CARDS_JSON_NYN = MANUALS_DIR / "pest_cards_nyn.json"
VERIFIED_DIR = MANUALS_DIR / "verified"
VERIFIED_INDEX = VERIFIED_DIR / "index.json"
STOPWORDS_DIR = DATA_DIR / "stopwords"

logger = logging.getLogger("agrik.retrieval")

STOPWORDS_COMMON = {
    "hi", "hello", "ok", "okay", "thanks", "thank", "please", "help", "kindly",
    "urgent", "sir", "madam", "version", "starter", "translation",
}
STOPWORDS_EN = {
    "the", "and", "or", "to", "of", "in", "for", "with", "on", "at", "by", "from",
    "is", "are", "was", "were", "be", "been", "a", "an", "as", "if", "it", "this",
    "that", "these", "those", "your", "you", "we", "they", "them", "their", "i", "me",
    "my", "mine", "our", "ours", "us", "he", "him", "his", "she", "her", "hers", "its",
    "what", "when", "where", "why", "which", "who", "whom", "how", "can", "could",
    "should", "would", "will", "shall", "may", "might", "do", "does", "did", "about",
    "into", "over", "under", "after", "before", "during", "per", "via", "tell", "ask",
    "question", "farmer", "farmers", "farm", "farming", "field", "fields", "crop", "crops",
    "plant", "plants", "problem", "issue", "need", "want",
}
STOPWORDS_LG = {"ne", "ku", "mu", "na", "era", "buli", "omu", "ab", "nga", "olwo"}
STOPWORDS_NYN = {"na", "omu", "oku", "obu", "kandi", "buri", "aba", "sho"}
LOCAL_MANUAL_LANGS = {"en", "lg", "nyn"}
LANGUAGE_SUFFIXES = ("_lg", "_nyn")
QUERY_ALIASES = {
    "sw": {
        "mahindi": "maize",
        "maharage": "beans",
        "mihogo": "cassava",
        "ndizi": "banana",
        "karanga": "groundnut",
        "viazi": "sweet potato",
        "mchele": "rice",
        "mtama": "sorghum",
        "ulezi": "millet",
        "wadudu": "pests",
        "ugonjwa": "disease",
        "majani": "leaves",
        "njano": "yellow",
        "madoa": "spots",
        "kinga": "protection",
        "orodha": "checklist",
        "wiki": "weekly",
    },
    "lg": {
        "kasooli": "maize",
        "ebinyeebwa": "beans",
        "mwogo": "cassava",
        "matooke": "banana",
        "ebijanjaalo": "groundnut",
        "lumonde": "sweet potato",
        "bulwadde": "disease",
        "obuwuka": "pests",
        "bikoola": "leaves",
    },
}

SECTION_WEIGHTS = {
    "crop": 2.0,
    "scientific_name": 1.3,
    "regional_notes": 1.0,
    "varietal_notes": 1.0,
    "symptoms": 1.6,
    "advice": 1.2,
}
PEST_CARD_WEIGHTS = {
    "crop": 1.4,
    "name": 1.6,
    "symptoms": 1.7,
    "actions": 1.3,
    "treatment_thresholds": 1.1,
    "local_suppliers": 1.0,
}
SOURCE_BOOSTS = {
    "verified": 1.15,
    "manuals": 1.0,
    "pest_cards": 1.05,
}
CROP_SYNONYMS = {
    "maize": {"corn"},
    "cassava": {"manioc", "yuca", "kasava"},
    "groundnut": {"groundnuts", "peanut", "peanuts"},
    "sweet potato": {"sweetpotato", "batata"},
    "banana": {"matooke", "plantain"},
    "beans": {"bean"},
    "rice": {"paddy"},
}
MIN_TOKEN_LEN = 2


def _normalize(text: str) -> str:
    # Normalize diacritics and casing for Luganda/Runyankole and general text
    normalized = unicodedata.normalize("NFKD", text)
    stripped = "".join(ch for ch in normalized if not unicodedata.combining(ch))
    return stripped.casefold()


def _load_stopwords_from_file(language: Optional[str]) -> Set[str]:
    if not STOPWORDS_DIR.exists():
        return set()
    candidates = []
    if language:
        candidates.append(STOPWORDS_DIR / f"{language}.txt")
        candidates.append(STOPWORDS_DIR / f"stopwords_{language}.txt")
    candidates.append(STOPWORDS_DIR / "common.txt")

    stopwords: Set[str] = set()
    for path in candidates:
        if not path.exists():
            continue
        for line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
            cleaned = _normalize(line.strip())
            if not cleaned or cleaned.startswith("#"):
                continue
            stopwords.add(cleaned)
    return stopwords


def _stopwords(language: Optional[str]) -> Set[str]:
    sw = set(STOPWORDS_COMMON)
    if language == "lg":
        sw |= STOPWORDS_LG
    elif language == "nyn":
        sw |= STOPWORDS_NYN
    else:
        sw |= STOPWORDS_EN
    sw |= _load_stopwords_from_file(language)
    return sw


def _canonical_local_language(language: Optional[str]) -> str:
    code = (language or "").strip().lower()
    if code in {"", "none"}:
        return "en"
    if code in LOCAL_MANUAL_LANGS:
        return code
    return "en"


def _expand_query_aliases(message: str, language: Optional[str]) -> str:
    code = (language or "").strip().lower()
    alias_map = QUERY_ALIASES.get(code, {})
    if not alias_map:
        return message

    tokens = _tokenize(message, code or None)
    aliases: List[str] = []
    for token in tokens:
        alias = alias_map.get(token)
        if alias:
            aliases.append(alias)
    if not aliases:
        return message
    return f"{message} {' '.join(sorted(set(aliases)))}"


def _tokenize(text: str, language: Optional[str]) -> List[str]:
    tokens = re.findall(r"[a-z0-9]+", _normalize(text))
    sw = _stopwords(language)
    cleaned = []
    for t in tokens:
        if t in sw:
            continue
        if len(t) < MIN_TOKEN_LEN and not t.isdigit():
            continue
        cleaned.append(t)
    return cleaned


def _tf_idf_score(query_tokens: List[str], doc_tokens: List[str], df: dict, n_docs: int, boost: float) -> float:
    if not query_tokens or not doc_tokens or n_docs == 0:
        return 0.0
    doc_tf = {}
    for t in doc_tokens:
        doc_tf[t] = doc_tf.get(t, 0) + 1

    score = 0.0
    for t in query_tokens:
        if t in doc_tf:
            idf = math.log((n_docs + 1) / (df.get(t, 0) + 1)) + 1.0
            score += (1.0 + math.log(doc_tf[t])) * idf
    return score * boost


def _boost_for_symptoms(chunk: str) -> float:
    # Heuristic boost: symptoms/diagnosis sections carry higher weight than advice
    lowered = chunk.lower()
    if "symptom" in lowered or "disease" in lowered or "pest" in lowered:
        return 1.25
    if "ebimuli" in lowered or "obumanyiso" in lowered:
        return 1.25
    return 1.0


def _source_boost(source_type: Optional[str]) -> float:
    if not source_type:
        return 1.0
    return SOURCE_BOOSTS.get(source_type, 1.0)


def _expand_crop_tokens(crop: str) -> Set[str]:
    tokens = set(_tokenize(crop, None))
    crop_key = _normalize(crop)
    for synonym in CROP_SYNONYMS.get(crop_key, set()):
        tokens.update(_tokenize(synonym, None))
    return tokens


def _crop_match_boost(query_tokens: Set[str], crop: Optional[str]) -> float:
    if not crop:
        return 1.0
    crop_tokens = _expand_crop_tokens(crop)
    if crop_tokens and query_tokens.intersection(crop_tokens):
        return 1.2
    return 1.0


def _field_weight(field: str, source_type: Optional[str]) -> float:
    if source_type == "pest_cards":
        return PEST_CARD_WEIGHTS.get(field, 1.0)
    return SECTION_WEIGHTS.get(field, 1.0)


def _select_manuals_json(language: Optional[str]) -> Path:
    if language == "lg" and MANUALS_JSON_LG.exists():
        return MANUALS_JSON_LG
    if language == "nyn" and MANUALS_JSON_NYN.exists():
        return MANUALS_JSON_NYN
    return MANUALS_JSON


def _select_pest_cards_json(language: Optional[str]) -> Path:
    if language == "lg" and PEST_CARDS_JSON_LG.exists():
        return PEST_CARDS_JSON_LG
    if language == "nyn" and PEST_CARDS_JSON_NYN.exists():
        return PEST_CARDS_JSON_NYN
    return PEST_CARDS_JSON


def _crop_from_filename(stem: str) -> str:
    for suffix in ("_lg", "_nyn"):
        if stem.endswith(suffix):
            stem = stem[: -len(suffix)]
            break
    return stem.replace("_", " ").replace("-", " ").strip()


def _join_list(value: Any) -> str:
    if isinstance(value, list):
        return " ".join([str(v) for v in value if v])
    if value is None:
        return ""
    return str(value)


def _manual_entry_to_chunk(entry: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    crop = str(entry.get("crop", "")).strip()
    fields = {
        "crop": crop,
        "scientific_name": str(entry.get("scientific_name", "")).strip(),
        "regional_notes": _join_list(entry.get("regional_notes", [])),
        "varietal_notes": _join_list(entry.get("varietal_notes", [])),
        "symptoms": _join_list(entry.get("symptoms", [])),
        "advice": _join_list(entry.get("advice", [])),
    }
    combined = " ".join([v for v in fields.values() if v]).strip()
    if not combined:
        return None
    return {
        "text": combined,
        "fields": fields,
        "crop": crop,
        "source_type": "manuals",
        "source_id": "",
        "title": "",
    }


def _load_manual_json(path: Path) -> List[Dict[str, Any]]:
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (ValueError, TypeError):
        return []

    chunks: List[Dict[str, Any]] = []
    for entry in data:
        if not isinstance(entry, dict):
            continue
        chunk = _manual_entry_to_chunk(entry)
        if chunk:
            chunks.append(chunk)
    return chunks


def _load_manual_text_chunks(language: Optional[str]) -> List[Dict[str, Any]]:
    if language in {"lg", "nyn"}:
        txt_patterns = [f"*_{language}.txt"]
        md_patterns = [f"*_{language}.md"]
    else:
        txt_patterns = ["*.txt"]
        md_patterns = ["*.md"]

    chunks: List[Dict[str, Any]] = []
    for pattern in txt_patterns:
        for path in MANUALS_DIR.glob(pattern):
            stem = path.stem.lower()
            if language in {"lg", "nyn"} and not stem.endswith(f"_{language}"):
                continue
            if language not in {"lg", "nyn"} and stem.endswith(LANGUAGE_SUFFIXES):
                continue
            text = path.read_text(encoding="utf-8", errors="ignore")
            crop = _crop_from_filename(path.stem)
            for chunk in text.split("\n\n"):
                cleaned = chunk.strip()
                if cleaned:
                    chunks.append(
                        {
                            "text": cleaned,
                            "fields": {},
                            "crop": crop,
                            "source_type": "manuals",
                            "source_id": "",
                            "title": "",
                        }
                    )
    for pattern in md_patterns:
        for path in MANUALS_DIR.glob(pattern):
            if path.name.lower() == "readme.md":
                continue
            stem = path.stem.lower()
            if language in {"lg", "nyn"} and not stem.endswith(f"_{language}"):
                continue
            if language not in {"lg", "nyn"} and stem.endswith(LANGUAGE_SUFFIXES):
                continue
            text = path.read_text(encoding="utf-8", errors="ignore")
            crop = _crop_from_filename(path.stem)
            for chunk in text.split("\n\n"):
                cleaned = chunk.strip()
                if cleaned:
                    chunks.append(
                        {
                            "text": cleaned,
                            "fields": {},
                            "crop": crop,
                            "source_type": "manuals",
                            "source_id": "",
                            "title": "",
                        }
                    )
    return chunks


def _load_manual_chunks(language: Optional[str]) -> List[Dict[str, Any]]:
    if not MANUALS_DIR.exists():
        return []

    chunks: List[Dict[str, Any]] = []
    manuals_json = _select_manuals_json(language)
    json_chunks = _load_manual_json(manuals_json)
    if not json_chunks and language in {"lg", "nyn"} and manuals_json != MANUALS_JSON:
        json_chunks = _load_manual_json(MANUALS_JSON)
    chunks.extend(json_chunks)

    text_chunks = _load_manual_text_chunks(language)
    if not text_chunks and language in {"lg", "nyn"}:
        text_chunks = _load_manual_text_chunks(None)
    chunks.extend(text_chunks)
    return chunks


def _pest_card_to_chunk(crop: str, card: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    fields = {
        "crop": crop,
        "name": str(card.get("name", "")).strip(),
        "symptoms": _join_list(card.get("symptoms", [])),
        "actions": _join_list(card.get("actions", [])),
        "treatment_thresholds": _join_list(card.get("treatment_thresholds", [])),
        "local_suppliers": _join_list(card.get("local_suppliers", [])),
    }
    combined = " ".join([v for v in fields.values() if v]).strip()
    if not combined:
        return None
    return {
        "text": combined,
        "fields": fields,
        "crop": crop,
        "source_type": "pest_cards",
        "source_id": "",
        "title": "",
    }


def _load_pest_cards(language: Optional[str]) -> List[Dict[str, Any]]:
    path = _select_pest_cards_json(language)
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (ValueError, TypeError):
        return []

    cards: List[Dict[str, Any]] = []
    for entry in data:
        if not isinstance(entry, dict):
            continue
        crop = str(entry.get("crop", "")).strip()
        for card in entry.get("cards", []):
            if not isinstance(card, dict):
                continue
            chunk = _pest_card_to_chunk(crop, card)
            if chunk:
                cards.append(chunk)

    if not cards and language in {"lg", "nyn"} and path != PEST_CARDS_JSON:
        return _load_pest_cards(None)
    return cards


def _load_verified_chunks(language: Optional[str]) -> List[Dict[str, str]]:
    if not VERIFIED_INDEX.exists():
        return []
    try:
        data = json.loads(VERIFIED_INDEX.read_text(encoding="utf-8"))
        chunks: List[Dict[str, str]] = []
        for entry in data:
            if language and entry.get("language") and entry.get("language") != language:
                continue
            text = str(entry.get("text", "")).strip()
            if not text:
                continue
            chunks.append(
                {
                    "text": text,
                    "source_id": str(entry.get("source_id", "")),
                    "title": str(entry.get("title", "")),
                    "page": str(entry.get("page", "")),
                    "file": str(entry.get("file", "")),
                    "fields": {},
                    "crop": "",
                    "source_type": "verified",
                }
            )
        return chunks
    except (ValueError, TypeError):
        return []


def _score_chunk(
    query_tokens: List[str],
    query_token_set: Set[str],
    chunk: Dict[str, Any],
    df: dict,
    n_docs: int,
    language: Optional[str],
) -> float:
    score = 0.0
    fields = chunk.get("fields") or {}
    if fields:
        for field, text in fields.items():
            if not text:
                continue
            weight = _field_weight(field, chunk.get("source_type"))
            score += _tf_idf_score(query_tokens, _tokenize(text, language), df, n_docs, weight)
    else:
        score = _tf_idf_score(query_tokens, _tokenize(chunk.get("text", ""), language), df, n_docs, 1.0)

    score *= _boost_for_symptoms(chunk.get("text", ""))
    score *= _source_boost(chunk.get("source_type"))
    score *= _crop_match_boost(query_token_set, chunk.get("crop"))
    return score


def _stub_path_for_language(language: Optional[str]) -> Path:
    if language:
        candidate = DATA_DIR / f"agronomy_stub_{language}.json"
        if candidate.exists():
            return candidate
    return DATA_PATH


def retrieve_grounded_advice(
    message: str,
    language: Optional[str] = None,
    source: str = "all",
    log_top_k: int = 0,
    top_k: int = 2,
    allow_cross_language_fallback: bool = True,
) -> List[Dict[str, Any]]:
    requested_language = (language or "").strip().lower() or None
    retrieval_language = _canonical_local_language(requested_language)
    query_text = _expand_query_aliases(message, requested_language)
    query_tokens = _tokenize(query_text, retrieval_language)

    manual_chunks = _load_manual_chunks(retrieval_language) if source in {"all", "manuals"} else []
    pest_cards = _load_pest_cards(retrieval_language) if source in {"all", "pest_cards"} else []
    verified_chunks = _load_verified_chunks(retrieval_language) if source in {"all", "manuals"} else []

    all_chunks: List[Dict[str, Any]] = [*manual_chunks, *pest_cards, *verified_chunks]

    if all_chunks:
        df: Dict[str, int] = {}
        for chunk in all_chunks:
            tokens = set(_tokenize(chunk.get("text", ""), language))
            for t in tokens:
                df[t] = df.get(t, 0) + 1

        scored: List[Tuple[float, Dict[str, Any]]] = []
        n_docs = len(all_chunks)
        query_token_set = set(query_tokens)
        for chunk in all_chunks:
            score = _score_chunk(query_tokens, query_token_set, chunk, df, n_docs, retrieval_language)
            if score > 0:
                scored.append((score, chunk))
        scored.sort(key=lambda x: x[0], reverse=True)
        if log_top_k > 0:
            for i, (score, chunk) in enumerate(scored[:log_top_k], start=1):
                logger.debug(
                    "Top%d score=%.3f source=%s crop=%s chunk=%s",
                    i,
                    score,
                    chunk.get("source_type", ""),
                    chunk.get("crop", ""),
                    chunk.get("text", "")[:200],
                )
        limit = max(1, top_k)
        if scored:
            return [c for _, c in scored[:limit]]

    if allow_cross_language_fallback and requested_language in {"lg", "nyn", "sw", "ach", "teo"} and retrieval_language != "en":
        fallback = retrieve_grounded_advice(
            message=message,
            language="en",
            source=source,
            log_top_k=log_top_k,
            top_k=top_k,
            allow_cross_language_fallback=False,
        )
        if fallback:
            return fallback

    # fallback to stub if no manuals are available
    stub_path = _stub_path_for_language(retrieval_language)
    if stub_path.exists():
        with stub_path.open("r", encoding="utf-8") as f:
            corpus = json.load(f)
        lowered = query_text.lower()
        for crop, tips in corpus.items():
            if crop in lowered:
                return [{"text": t, "source_id": "stub", "title": "agronomy_stub"} for t in tips]

    return []
