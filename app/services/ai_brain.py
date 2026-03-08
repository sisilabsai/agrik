from dataclasses import dataclass
from typing import List, Dict
from app.services.language import detect_language
from app.services.retrieval import retrieve_grounded_advice
from app.core.config import get_min_confidence_threshold
from app.services.citations import format_citations_short


@dataclass
class AdviceResult:
    reply: str
    language: str
    confidence: float
    sources: List[str]
    citations: List[Dict[str, str]]
    source_confidence: float
    citation_text: str
    follow_ups: List[str] | None = None


def generate_advice(
    farmer_id: str,
    message: str,
    locale_hint: str | None,
    location_hint: str | None,
    channel: str,
    retrieval_source: str = "all",
    log_top_k: int = 0,
) -> AdviceResult:
    language, lang_conf = detect_language(message, locale_hint)
    grounded_items = retrieve_grounded_advice(
        message,
        language=language,
        source=retrieval_source,
        log_top_k=log_top_k,
    )

    sources: List[str] = []
    citations: List[Dict[str, str]] = []
    source_confidence = 0.0
    if grounded_items:
        reply = " ".join([g["text"] for g in grounded_items][:2])
        for g in grounded_items:
            if g.get("source_id") or g.get("title"):
                sources.append(f"{g.get('title','')}".strip() or g.get("source_id", ""))
                citations.append(
                    {
                        "source_id": g.get("source_id", ""),
                        "title": g.get("title", ""),
                        "page": g.get("page", ""),
                        "file": g.get("file", ""),
                    }
                )
        confidence = 0.6
        source_confidence = min(1.0, 0.5 + (0.1 * len(citations)))
    else:
        reply = (
            "Thank you. I have recorded your message. "
            "A grounded agronomy response will follow."
        )
        confidence = 0.25
        source_confidence = 0.0

    min_threshold = get_min_confidence_threshold()
    if confidence < min_threshold:
        reply = (
            "Thanks. I need a bit more detail (crop, stage, location) to give grounded advice."
        )
        citations = []
        sources = []
        citation_text = ""

    citation_text = format_citations_short(citations)

    return AdviceResult(
        reply=reply,
        language=language,
        confidence=confidence + (lang_conf * 0.1),
        sources=sources,
        citations=citations,
        source_confidence=source_confidence,
        citation_text=citation_text,
    )
