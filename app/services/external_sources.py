import html
import logging
import re
from typing import Any, Dict, List
from urllib.parse import quote

import httpx

from app.core.config import get_external_knowledge_config

logger = logging.getLogger("agrik.external_sources")

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
        "ugonjwa": "disease",
        "wadudu": "pest",
    },
    "lg": {
        "kasooli": "maize",
        "ebinyeebwa": "beans",
        "mwogo": "cassava",
        "matooke": "banana",
        "ebijanjaalo": "groundnut",
        "lumonde": "sweet potato",
        "bulwadde": "disease",
        "obuwuka": "pest",
        "bikoola": "leaves",
    },
}
AGRI_TERMS = {
    "agriculture",
    "agricultural",
    "crop",
    "crops",
    "farm",
    "farming",
    "farmer",
    "farmers",
    "pest",
    "pests",
    "disease",
    "diseases",
    "soil",
    "fertilizer",
    "rain",
    "weather",
    "yield",
    "maize",
    "beans",
    "cassava",
    "banana",
    "groundnut",
    "rice",
    "sorghum",
    "millet",
    "mahindi",
    "maharage",
    "mihogo",
    "ndizi",
    "kasooli",
    "ebinyeebwa",
    "mwogo",
    "matooke",
    "kiuadudu",
    "obuwuka",
    "bulwadde",
}
CROP_TERMS = {
    "maize",
    "beans",
    "cassava",
    "banana",
    "groundnut",
    "rice",
    "sorghum",
    "millet",
    "mahindi",
    "maharage",
    "mihogo",
    "ndizi",
    "karanga",
    "mchele",
    "mtama",
    "ulezi",
    "kasooli",
    "ebinyeebwa",
    "mwogo",
    "matooke",
    "ebijanjaalo",
}
NEGATIVE_TERMS = {"recipe", "recipes", "cuisine", "dish", "food", "chef", "mapishi", "cook", "cooking", "household"}
QUERY_STOPWORDS = {
    "the",
    "a",
    "an",
    "for",
    "of",
    "and",
    "to",
    "my",
    "me",
    "give",
    "weekly",
    "checklist",
    "orodha",
    "wiki",
    "olukalala",
}


def _strip_html(raw: str) -> str:
    text = html.unescape(raw or "")
    text = re.sub(r"<[^>]+>", "", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def _build_query_variants(message: str, language: str | None) -> List[str]:
    base = message.strip()
    if not base:
        return []

    variants: List[str] = []
    code = (language or "").strip().lower()
    alias_map = QUERY_ALIASES.get(code, {})
    aliases: List[str] = []
    if alias_map:
        tokens = [token.lower() for token in re.findall(r"[a-zA-Z']+", base)]
        aliases = sorted({alias_map[token] for token in tokens if token in alias_map})

    topic_tokens = [token for token in _tokenize_for_relevance(base) if token in CROP_TERMS]
    primary_crop = aliases[0] if aliases else (sorted(set(topic_tokens))[0] if topic_tokens else "")
    if primary_crop:
        variants.append(f"{primary_crop} pest disease management")
    if aliases:
        variants.append(" ".join(aliases))
    variants.append(base)
    if aliases:
        variants.append(f"{base} {' '.join(aliases)}")

    deduped: List[str] = []
    seen: set[str] = set()
    for candidate in variants:
        cleaned = candidate.strip()
        if not cleaned:
            continue
        lowered = cleaned.lower()
        if lowered in seen:
            continue
        seen.add(lowered)
        deduped.append(cleaned)
    return deduped


def _tokenize_for_relevance(text: str) -> set[str]:
    return {token.lower() for token in re.findall(r"[a-zA-Z]+", text)}


def _relevance_score(query: str, title: str, excerpt: str) -> int:
    query_tokens = {token for token in _tokenize_for_relevance(query) if token not in QUERY_STOPWORDS}
    text_tokens = _tokenize_for_relevance(f"{title} {excerpt}")
    if not query_tokens or not text_tokens:
        return 0

    excerpt_lower = excerpt.lower()
    if " is a country" in excerpt_lower or " ni nchi" in excerpt_lower:
        return 0

    title_tokens = _tokenize_for_relevance(title)
    overlap = len(query_tokens.intersection(text_tokens))
    agri_hits = len(text_tokens.intersection(AGRI_TERMS))
    negative_hits = len(text_tokens.intersection(NEGATIVE_TERMS))
    score = (overlap * 2) + agri_hits - (negative_hits * 2)

    query_crop_tokens = query_tokens.intersection(CROP_TERMS)
    title_agri = bool(title_tokens.intersection(AGRI_TERMS.union(CROP_TERMS)))
    if query_crop_tokens and not query_crop_tokens.intersection(title_tokens) and not title_agri:
        return 0
    if query_crop_tokens and negative_hits > 0 and not query_crop_tokens.intersection(title_tokens):
        return 0
    if query_crop_tokens and not query_crop_tokens.intersection(title_tokens):
        score -= 1

    return score


def _search_wikimedia(query: str, language: str, max_items: int, timeout_seconds: int, user_agent: str) -> List[Dict[str, Any]]:
    url = f"https://api.wikimedia.org/core/v1/wikipedia/{language}/search/page"
    params = {"q": query, "limit": max_items}
    headers = {"User-Agent": user_agent}
    items: List[Dict[str, Any]] = []

    try:
        with httpx.Client(timeout=float(timeout_seconds)) as client:
            response = client.get(url, params=params, headers=headers)
            response.raise_for_status()
            payload = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        logger.warning("Wikimedia search failed lang=%s query=%s error=%s", language, query, exc)
        return []

    pages = payload.get("pages") if isinstance(payload, dict) else []
    if not isinstance(pages, list):
        return []

    for page in pages:
        if not isinstance(page, dict):
            continue
        key = str(page.get("key") or "").strip()
        title = str(page.get("title") or "").strip() or key
        excerpt = _strip_html(str(page.get("excerpt") or ""))
        if not key or not excerpt:
            continue
        page_url = f"https://{language}.wikipedia.org/wiki/{quote(key.replace(' ', '_'))}"
        items.append(
            {
                "text": excerpt,
                "source_id": f"wikimedia:{language}:{key}",
                "title": title,
                "page": "",
                "file": "",
                "url": page_url,
                "source_type": "external_wikimedia",
                "crop": "",
            }
        )
    return items


def fetch_external_knowledge(message: str, language: str | None = None) -> List[Dict[str, Any]]:
    cfg = get_external_knowledge_config()
    if not cfg["enabled"]:
        return []
    if cfg["provider"] != "wikimedia":
        return []

    max_items = max(1, int(cfg["max_items"]))
    search_limit = max(4, max_items * 4)
    timeout_seconds = max(5, int(cfg["timeout_seconds"]))
    user_agent = cfg["wikimedia_user_agent"] or "AGRIK/0.1"
    allowed_languages = cfg["languages"] or ["en"]

    query = message.strip()
    if not query:
        return []
    query_variants = _build_query_variants(query, language)[:2]
    if not query_variants:
        return []

    language_order: List[str] = []
    if language and language in allowed_languages:
        language_order.append(language)
    if "en" in allowed_languages and "en" not in language_order:
        language_order.append("en")
    for lang in allowed_languages:
        if lang not in language_order:
            language_order.append(lang)

    ranked: Dict[str, tuple[int, Dict[str, Any]]] = {}
    for lang in language_order:
        for query_variant in query_variants:
            items = _search_wikimedia(
                query_variant,
                lang,
                max_items=search_limit,
                timeout_seconds=timeout_seconds,
                user_agent=user_agent,
            )
            for item in items:
                source_id = str(item.get("source_id") or "")
                if not source_id:
                    continue
                score = _relevance_score(
                    query_variant,
                    str(item.get("title") or ""),
                    str(item.get("text") or ""),
                )
                if score < 2:
                    continue
                current = ranked.get(source_id)
                if current and current[0] >= score:
                    continue
                ranked[source_id] = (score, item)
                if len(ranked) >= max_items:
                    top_scores = sorted((value[0] for value in ranked.values()), reverse=True)[:max_items]
                    if top_scores and all(score_value >= 3 for score_value in top_scores):
                        ordered = sorted(ranked.values(), key=lambda pair: pair[0], reverse=True)
                        return [entry for _, entry in ordered[:max_items]]

    if not ranked:
        return []
    ordered = sorted(ranked.values(), key=lambda pair: pair[0], reverse=True)
    return [item for _, item in ordered[:max_items]]
