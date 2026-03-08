from typing import List, Dict


def format_citations_short(citations: List[Dict[str, str]]) -> str:
    if not citations:
        return ""
    # Keep SMS short: title + page if available
    parts = []
    for c in citations[:2]:
        title = c.get("title") or c.get("source_id", "")
        page = c.get("page", "")
        if page:
            parts.append(f"{title} p.{page}")
        else:
            parts.append(title)
    return "Src: " + "; ".join([p for p in parts if p])
