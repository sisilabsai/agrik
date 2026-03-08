import asyncio
import base64
import json
import logging
import re
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List

import httpx
from fastapi import UploadFile

from app.core.config import get_ai_provider_config

logger = logging.getLogger("agrik.vision")

DATASET_HINTS = [
    "wambugu71/crop_leaf_diseases_vit",
    "prof-freakenstein/plantnet-disease-detection",
    "IsmatS/crop_desease_detection",
]

KNOWN_VISION_MODELS = [
    "wambugu71/crop_leaf_diseases_vit",
    "prof-freakenstein/plantnet-disease-detection",
    "IsmatS/crop_desease_detection",
]

VISION_MODEL_TIPS = {
    "wambugu71/crop_leaf_diseases_vit": "Good for structured leaf disease classes and quick triage.",
    "prof-freakenstein/plantnet-disease-detection": "General disease detector with broad plant coverage.",
    "IsmatS/crop_desease_detection": "Useful as a second opinion for cross-checking uncertain images.",
}

DEFAULT_CROP_MODEL_MAP = {
    "cassava": ["prof-freakenstein/plantnet-disease-detection", "IsmatS/crop_desease_detection"],
    "maize": ["wambugu71/crop_leaf_diseases_vit", "prof-freakenstein/plantnet-disease-detection"],
    "corn": ["wambugu71/crop_leaf_diseases_vit", "prof-freakenstein/plantnet-disease-detection"],
    "beans": ["prof-freakenstein/plantnet-disease-detection", "IsmatS/crop_desease_detection"],
    "rice": ["wambugu71/crop_leaf_diseases_vit", "prof-freakenstein/plantnet-disease-detection"],
    "banana": ["prof-freakenstein/plantnet-disease-detection"],
    "plantain": ["prof-freakenstein/plantnet-disease-detection"],
    "coffee": ["prof-freakenstein/plantnet-disease-detection"],
    "groundnut": ["IsmatS/crop_desease_detection", "prof-freakenstein/plantnet-disease-detection"],
    "peanut": ["IsmatS/crop_desease_detection", "prof-freakenstein/plantnet-disease-detection"],
    "sweet potato": ["prof-freakenstein/plantnet-disease-detection", "IsmatS/crop_desease_detection"],
}

CROP_ALIASES = {
    "cassava": {"cassava", "manioc", "yuca"},
    "maize": {"maize", "corn"},
    "beans": {"bean", "beans"},
    "rice": {"rice"},
    "banana": {"banana", "plantain"},
    "coffee": {"coffee"},
    "groundnut": {"groundnut", "groundnuts", "peanut", "peanuts"},
    "sweet potato": {"sweet potato", "sweetpotato"},
}

MODEL_UNAVAILABLE_TTL_SECONDS = 900
_MODEL_UNAVAILABLE_UNTIL: Dict[str, float] = {}

SUPPORTED_IMAGE_MIME_TYPES = {"image/jpeg", "image/jpg", "image/png", "image/webp"}

HEALTHY_LABEL_TOKENS = {"healthy", "normal", "no disease", "no_disease"}
PEST_TOKENS = {
    "pest",
    "aphid",
    "borer",
    "caterpillar",
    "worm",
    "locust",
    "whitefly",
    "thrips",
    "weevil",
    "beetle",
    "fly",
    "mite",
    "insect",
    "leafminer",
    "bug",
    "larva",
}
DISEASE_TOKENS = {
    "disease",
    "blight",
    "rust",
    "mildew",
    "spot",
    "streak",
    "rot",
    "wilt",
    "mosaic",
    "virus",
    "fungal",
    "fungus",
    "bacterial",
    "anthracnose",
    "scab",
    "smut",
    "leaf spot",
}
NUTRIENT_TOKENS = {
    "deficiency",
    "chlorosis",
    "nutrient",
    "nitrogen",
    "phosphorus",
    "potassium",
    "magnesium",
    "micronutrient",
}


class VisionUnavailableError(RuntimeError):
    pass


class VisionValidationError(ValueError):
    pass


@dataclass
class ValidatedImage:
    filename: str
    mime_type: str
    content: bytes


@dataclass
class VisionIssue:
    name: str
    category: str
    confidence: float
    evidence: str
    recommended_action: str

    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "category": self.category,
            "confidence": self.confidence,
            "evidence": self.evidence,
            "recommended_action": self.recommended_action,
        }


@dataclass
class VisionAnalysisResult:
    overall_assessment: str
    likely_issues: List[VisionIssue]
    immediate_actions: List[str]
    field_checks: List[str]
    media_count: int
    model: str
    selected_model_reason: str = ""
    crop_hint: str = ""
    deep_analysis: bool = False
    top_labels: List[str] = field(default_factory=list)
    per_image_notes: List[str] = field(default_factory=list)
    model_runs: List[Dict[str, Any]] = field(default_factory=list)
    raw_output: str = ""

    def to_prompt_context(self) -> str:
        issue_lines = []
        for issue in self.likely_issues[:5]:
            issue_lines.append(
                f"- {issue.name} ({issue.category}, confidence {issue.confidence:.2f}): "
                f"{issue.evidence}. Action: {issue.recommended_action}"
            )
        if not issue_lines:
            issue_lines = ["- No high-confidence issue identified from visuals alone."]

        action_lines = [f"- {item}" for item in self.immediate_actions[:5]] or ["- Request additional close-up photos."]
        check_lines = [f"- {item}" for item in self.field_checks[:5]] or ["- Verify spread pattern across multiple plants."]

        return (
            f"Vision model: {self.model}\n"
            f"Media analyzed: {self.media_count} image(s)\n"
            f"Target crop hint: {self.crop_hint or 'not provided'}\n"
            f"Deep analysis: {'enabled' if self.deep_analysis else 'disabled'}\n"
            f"Model selection notes: {self.selected_model_reason or 'single-model run'}\n"
            f"Overall assessment: {self.overall_assessment or 'No summary provided.'}\n"
            "Likely issues:\n"
            f"{chr(10).join(issue_lines)}\n"
            "Immediate actions:\n"
            f"{chr(10).join(action_lines)}\n"
            "Field checks:\n"
            f"{chr(10).join(check_lines)}"
        )

    def to_response_dict(self) -> Dict[str, Any]:
        return {
            "overall_assessment": self.overall_assessment,
            "likely_issues": [issue.to_dict() for issue in self.likely_issues],
            "immediate_actions": self.immediate_actions,
            "field_checks": self.field_checks,
            "media_count": self.media_count,
            "model": self.model,
            "selected_model_reason": self.selected_model_reason,
            "crop_hint": self.crop_hint or None,
            "deep_analysis": self.deep_analysis,
            "top_labels": self.top_labels,
            "per_image_notes": self.per_image_notes,
            "model_runs": self.model_runs,
            "raw_output": self.raw_output,
        }


def _trim(text: str, limit: int) -> str:
    cleaned = str(text or "").strip()
    if len(cleaned) <= limit:
        return cleaned
    return f"{cleaned[: max(0, limit - 3)].rstrip()}..."


def _extract_completion_text(payload: Dict[str, Any]) -> str:
    choices = payload.get("choices")
    if not isinstance(choices, list) or not choices:
        return ""
    first = choices[0] if isinstance(choices[0], dict) else {}
    message = first.get("message") if isinstance(first, dict) else {}
    content = message.get("content") if isinstance(message, dict) else ""
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts: List[str] = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
                continue
            if not isinstance(item, dict):
                continue
            chunk = item.get("text") or item.get("content")
            if isinstance(chunk, str):
                parts.append(chunk)
        return "\n".join([part.strip() for part in parts if part and part.strip()]).strip()
    return ""


def _looks_like_image(content: bytes, mime_type: str) -> bool:
    if mime_type in SUPPORTED_IMAGE_MIME_TYPES:
        return True
    if content.startswith(b"\xff\xd8\xff"):
        return True
    if content.startswith(b"\x89PNG\r\n\x1a\n"):
        return True
    if content.startswith(b"RIFF") and b"WEBP" in content[:32]:
        return True
    return False


def _normalize_mime_type(content: bytes, mime_type: str) -> str:
    lower = (mime_type or "").strip().lower()
    if lower in SUPPORTED_IMAGE_MIME_TYPES:
        return "image/jpeg" if lower == "image/jpg" else lower
    if content.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if content.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if content.startswith(b"RIFF") and b"WEBP" in content[:32]:
        return "image/webp"
    return lower or "image/jpeg"


def _coerce_list(value: Any, limit: int = 6) -> List[str]:
    if not isinstance(value, list):
        return []
    items: List[str] = []
    for raw in value:
        text = _trim(str(raw or ""), 180)
        if not text:
            continue
        items.append(text)
        if len(items) >= limit:
            break
    return items


def _strip_code_fence(text: str) -> str:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.IGNORECASE)
        cleaned = re.sub(r"\s*```$", "", cleaned)
    return cleaned.strip()


def _parse_vision_payload(raw_text: str, media_count: int, model: str) -> VisionAnalysisResult:
    cleaned = _strip_code_fence(raw_text)
    parsed: Dict[str, Any] = {}
    if cleaned:
        try:
            maybe = json.loads(cleaned)
            if isinstance(maybe, dict):
                parsed = maybe
        except ValueError:
            match = re.search(r"\{.*\}", cleaned, flags=re.DOTALL)
            if match:
                try:
                    maybe = json.loads(match.group(0))
                    if isinstance(maybe, dict):
                        parsed = maybe
                except ValueError:
                    parsed = {}

    issues: List[VisionIssue] = []
    raw_issues = parsed.get("likely_issues") if isinstance(parsed.get("likely_issues"), list) else []
    for raw_issue in raw_issues[:6]:
        if not isinstance(raw_issue, dict):
            continue
        name = _trim(str(raw_issue.get("name") or ""), 90)
        category = _trim(str(raw_issue.get("category") or "unknown"), 40)
        evidence = _trim(str(raw_issue.get("evidence") or ""), 220)
        action = _trim(str(raw_issue.get("recommended_action") or ""), 220)
        try:
            confidence = float(raw_issue.get("confidence", 0.0))
        except (TypeError, ValueError):
            confidence = 0.0
        confidence = max(0.0, min(1.0, confidence))
        if not name:
            continue
        issues.append(
            VisionIssue(
                name=name,
                category=category or "unknown",
                confidence=confidence,
                evidence=evidence or "Visual pattern requires field confirmation.",
                recommended_action=action or "Confirm symptoms on multiple plants before treatment.",
            )
        )

    overall = _trim(str(parsed.get("overall_assessment") or ""), 400)
    if not overall:
        overall = _trim(cleaned, 400)

    return VisionAnalysisResult(
        overall_assessment=overall,
        likely_issues=issues,
        immediate_actions=_coerce_list(parsed.get("immediate_actions"), limit=6),
        field_checks=_coerce_list(parsed.get("field_checks"), limit=6),
        media_count=media_count,
        model=model,
        raw_output=_trim(raw_text, 1200),
    )


def _dedupe_keep_order(items: List[str]) -> List[str]:
    seen: set[str] = set()
    ordered: List[str] = []
    for raw in items:
        item = str(raw or "").strip()
        if not item:
            continue
        key = item.lower()
        if key in seen:
            continue
        seen.add(key)
        ordered.append(item)
    return ordered


def _normalize_crop_hint(crop_hint: str | None) -> str:
    return re.sub(r"\s+", " ", str(crop_hint or "").strip().lower())


def _normalize_model_preference(model_preference: str | None) -> str:
    pref = str(model_preference or "").strip()
    lowered = pref.lower()
    if lowered in {"", "auto", "default"}:
        return "auto"
    if lowered in {"all", "ensemble", "compare"}:
        return "all"
    return pref


def _parse_crop_model_map(cfg: Dict[str, Any]) -> Dict[str, List[str]]:
    mapping: Dict[str, List[str]] = {k: _dedupe_keep_order(v) for k, v in DEFAULT_CROP_MODEL_MAP.items()}
    raw_map = str(cfg.get("hf_vision_crop_model_map") or "").strip()
    if not raw_map:
        return mapping
    try:
        parsed = json.loads(raw_map)
    except ValueError:
        logger.warning("Invalid HF_VISION_CROP_MODEL_MAP JSON. Ignoring custom map.")
        return mapping
    if not isinstance(parsed, dict):
        return mapping
    for raw_crop, raw_models in parsed.items():
        crop = _normalize_crop_hint(str(raw_crop))
        if not crop:
            continue
        if isinstance(raw_models, str):
            models = _dedupe_keep_order([raw_models])
        elif isinstance(raw_models, list):
            models = _dedupe_keep_order([str(item) for item in raw_models])
        else:
            continue
        if not models:
            continue
        mapping[crop] = models
    return mapping


def _resolve_candidate_models(
    cfg: Dict[str, Any],
    crop_hint: str | None,
    model_preference: str | None,
    deep_analysis: bool,
) -> List[str]:
    primary_model = str(cfg.get("hf_vision_model") or "").strip()
    alt_models = cfg.get("hf_vision_alt_models") or []
    alt_models = [str(item).strip() for item in alt_models if str(item).strip()]

    pool = _dedupe_keep_order([primary_model, *alt_models, *KNOWN_VISION_MODELS])
    pool = [item for item in pool if item]
    if not pool:
        return []

    preference = _normalize_model_preference(model_preference)
    if preference not in {"auto", "all"}:
        return [preference]

    compare_max = max(1, int(cfg.get("hf_vision_compare_max_models", 3)))
    crop = _normalize_crop_hint(crop_hint)
    crop_model_map = _parse_crop_model_map(cfg)
    mapped: List[str] = []
    if crop:
        for key, models in crop_model_map.items():
            if key == crop or key in crop or crop in key:
                mapped.extend(models)
    ordered = _dedupe_keep_order([*mapped, *pool])

    if preference == "all":
        return ordered[:compare_max]
    if deep_analysis and len(ordered) > 1:
        return ordered[:compare_max]
    if not ordered:
        return []
    fallback_chain = _dedupe_keep_order([ordered[0], primary_model])
    return fallback_chain[:2]


def _is_model_temporarily_unavailable(model_id: str) -> bool:
    until = _MODEL_UNAVAILABLE_UNTIL.get(str(model_id or "").strip().lower(), 0.0)
    return time.time() < until


def _mark_model_unavailable(model_id: str) -> None:
    key = str(model_id or "").strip().lower()
    if not key:
        return
    _MODEL_UNAVAILABLE_UNTIL[key] = time.time() + MODEL_UNAVAILABLE_TTL_SECONDS


def _extract_crop_aliases(crop_hint: str | None) -> set[str]:
    crop = _normalize_crop_hint(crop_hint)
    if not crop:
        return set()
    aliases = set()
    for canonical, values in CROP_ALIASES.items():
        if crop == canonical or crop in canonical or canonical in crop or crop in values:
            aliases.update(values)
            aliases.add(canonical)
    if not aliases:
        aliases.add(crop)
    return aliases


def _result_text_blob(result: VisionAnalysisResult) -> str:
    parts = [result.overall_assessment]
    parts.extend([issue.name for issue in result.likely_issues])
    parts.extend(result.top_labels or [])
    return " ".join([str(part or "") for part in parts]).lower()


def _crop_alignment_score(result: VisionAnalysisResult, crop_hint: str | None) -> float:
    aliases = _extract_crop_aliases(crop_hint)
    if not aliases:
        return 0.0
    text_blob = _result_text_blob(result)
    if not text_blob:
        return 0.0

    target_hit = any(alias in text_blob for alias in aliases)
    other_hits = 0
    for canonical, known_aliases in CROP_ALIASES.items():
        merged = set(known_aliases) | {canonical}
        if merged.intersection(aliases):
            continue
        if any(alias in text_blob for alias in merged):
            other_hits += 1

    score = 0.0
    if target_hit:
        score += 0.22
    if other_hits > 0 and not target_hit:
        score -= 0.2
    if other_hits > 0 and target_hit:
        score -= min(0.14, other_hits * 0.07)
    return score


def _model_quality_score(result: VisionAnalysisResult, crop_hint: str | None) -> float:
    confidences = [max(0.0, min(1.0, issue.confidence)) for issue in result.likely_issues]
    if confidences:
        max_conf = max(confidences)
        avg_conf = sum(confidences) / len(confidences)
        issue_factor = min(1.0, len(confidences) / 4.0)
        base = (0.5 * max_conf) + (0.3 * avg_conf) + (0.2 * issue_factor)
    else:
        base = 0.2

    invalid_markers = {"unknown", "invalid", "other", "background"}
    top_blob = " ".join([label.lower() for label in (result.top_labels or [])])
    if top_blob and any(marker in top_blob for marker in invalid_markers):
        base -= 0.08

    base += _crop_alignment_score(result, crop_hint)
    return round(max(0.0, min(1.0, base)), 4)


def _build_model_run_summary(result: VisionAnalysisResult, quality_score: float) -> Dict[str, Any]:
    return {
        "model": result.model,
        "quality_score": quality_score,
        "overall_assessment": _trim(result.overall_assessment, 220),
        "top_labels": (result.top_labels or [])[:6],
        "likely_issues": [issue.to_dict() for issue in result.likely_issues[:4]],
    }


def get_vision_model_options() -> List[Dict[str, str]]:
    cfg = get_ai_provider_config()
    primary_model = str(cfg.get("hf_vision_model") or "").strip()
    alt_models = cfg.get("hf_vision_alt_models") or []
    alt_models = [str(item).strip() for item in alt_models if str(item).strip()]
    models = _dedupe_keep_order([primary_model, *alt_models, *KNOWN_VISION_MODELS])
    options: List[Dict[str, str]] = [
        {
            "id": "auto",
            "label": "Auto (crop-aware)",
            "tip": "Uses crop hint and confidence scoring to select the best model.",
        },
        {
            "id": "all",
            "label": "Compare All",
            "tip": "Runs multiple models and picks the strongest result (slower but safer).",
        },
    ]
    for model in models:
        options.append(
            {
                "id": model,
                "label": model,
                "tip": VISION_MODEL_TIPS.get(model, "General-purpose vision model for crop image triage."),
            }
        )
    return options


def _parse_error_detail(payload: Any, fallback_text: str = "") -> str:
    if isinstance(payload, dict):
        for key in ("error", "message", "detail", "warning"):
            value = payload.get(key)
            if isinstance(value, str) and value.strip():
                return _trim(value, 260)
    if isinstance(payload, list) and payload:
        first = payload[0]
        if isinstance(first, dict):
            detail = _parse_error_detail(first, "")
            if detail:
                return detail
        if isinstance(first, str) and first.strip():
            return _trim(first, 260)
    return _trim(fallback_text, 260) if fallback_text else "Unknown model error."


def _extract_estimated_wait(payload: Any, default_wait: float) -> float:
    if isinstance(payload, dict):
        raw = payload.get("estimated_time")
        try:
            wait = float(raw)
        except (TypeError, ValueError):
            wait = default_wait
        return min(12.0, max(0.5, wait))
    return min(12.0, max(0.5, default_wait))


def _normalize_label_key(label: str) -> str:
    cleaned = re.sub(r"[_\-]+", " ", str(label or "").strip().lower())
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned


def _display_label(label: str) -> str:
    cleaned = re.sub(r"[_\-]+", " ", str(label or "").strip())
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    if not cleaned:
        return "Unknown issue"
    return f"{cleaned[0].upper()}{cleaned[1:]}"


def _to_score(raw: Any) -> float:
    try:
        score = float(raw)
    except (TypeError, ValueError):
        return 0.0
    if score > 1.0:
        score = score / 100.0
    return max(0.0, min(1.0, score))


def _extract_classifier_predictions(payload: Any) -> List[Dict[str, Any]]:
    collected: List[Dict[str, Any]] = []

    def _walk(node: Any) -> None:
        if isinstance(node, list):
            for item in node:
                _walk(item)
            return
        if not isinstance(node, dict):
            return

        label = node.get("label") or node.get("class") or node.get("name")
        if isinstance(label, str) and label.strip():
            score = _to_score(node.get("score", node.get("confidence", node.get("probability", 0.0))))
            collected.append({"label": _display_label(label), "score": score})
            return

        labels = node.get("labels")
        scores = node.get("scores")
        if isinstance(labels, list) and isinstance(scores, list):
            for raw_label, raw_score in zip(labels, scores):
                if not isinstance(raw_label, str) or not raw_label.strip():
                    continue
                collected.append({"label": _display_label(raw_label), "score": _to_score(raw_score)})

        for key in ("predictions", "results", "output", "data"):
            if key in node:
                _walk(node.get(key))

    _walk(payload)
    collected.sort(key=lambda item: item.get("score", 0.0), reverse=True)
    return collected


def _is_healthy_label(label: str) -> bool:
    lowered = _normalize_label_key(label)
    return any(token in lowered for token in HEALTHY_LABEL_TOKENS)


def _infer_issue_category(label: str) -> str:
    lowered = _normalize_label_key(label)
    if any(token in lowered for token in HEALTHY_LABEL_TOKENS):
        return "healthy_signal"
    if any(token in lowered for token in PEST_TOKENS):
        return "pest"
    if any(token in lowered for token in DISEASE_TOKENS):
        return "disease"
    if any(token in lowered for token in NUTRIENT_TOKENS):
        return "nutrient_stress"
    return "unknown"


def _issue_action(category: str) -> str:
    if category == "pest":
        return "Scout leaf undersides and stems on 20 plants, remove severe hotspots, then apply targeted IPM only after field confirmation."
    if category == "disease":
        return "Isolate heavily affected plants or leaves, avoid overhead irrigation, and prepare crop-appropriate fungicide guidance after confirmation."
    if category == "nutrient_stress":
        return "Check soil moisture and nutrient history first; correct nutrition only after ruling out pest or disease spread."
    return "Collect closer images (top and underside of leaves) and verify the pattern on multiple plants before treatment."


def _build_classification_result(
    *,
    model: str,
    media_count: int,
    farmer_message: str,
    per_image_predictions: List[Dict[str, Any]],
    crop_hint: str | None = None,
    deep_analysis: bool = False,
) -> VisionAnalysisResult:
    stats: Dict[str, Dict[str, Any]] = {}
    for image_item in per_image_predictions:
        seen_in_image: set[str] = set()
        predictions = image_item.get("predictions")
        if not isinstance(predictions, list):
            continue
        for item in predictions:
            if not isinstance(item, dict):
                continue
            label = str(item.get("label") or "").strip()
            if not label:
                continue
            score = _to_score(item.get("score"))
            key = _normalize_label_key(label)
            if not key:
                continue
            entry = stats.setdefault(
                key,
                {
                    "label": label,
                    "max_score": 0.0,
                    "sum_score": 0.0,
                    "score_count": 0,
                    "image_hits": 0,
                },
            )
            if score >= entry["max_score"]:
                entry["max_score"] = score
                entry["label"] = label
            entry["sum_score"] += score
            entry["score_count"] += 1
            if key not in seen_in_image:
                entry["image_hits"] += 1
                seen_in_image.add(key)

    aggregated: List[Dict[str, Any]] = []
    for item in stats.values():
        score_count = max(1, int(item.get("score_count", 0)))
        avg_score = float(item.get("sum_score", 0.0)) / score_count
        aggregated.append(
            {
                "label": item.get("label", "Unknown issue"),
                "max_score": _to_score(item.get("max_score")),
                "avg_score": _to_score(avg_score),
                "image_hits": int(item.get("image_hits", 0)),
            }
        )
    aggregated.sort(
        key=lambda row: (row.get("max_score", 0.0), row.get("image_hits", 0), row.get("avg_score", 0.0)),
        reverse=True,
    )
    top_labels = aggregated[:6]
    top_label_names = [str(item.get("label") or "Unknown issue") for item in top_labels]

    per_image_notes: List[str] = []
    for image_item in per_image_predictions:
        file_name = str(image_item.get("file") or "uploaded-image")
        preds = image_item.get("predictions")
        if not isinstance(preds, list):
            continue
        top_for_image: List[str] = []
        for pred in preds[:3]:
            if not isinstance(pred, dict):
                continue
            label = str(pred.get("label") or "").strip()
            score = _to_score(pred.get("score"))
            if not label:
                continue
            top_for_image.append(f"{label} ({score * 100:.0f}%)")
        if top_for_image:
            per_image_notes.append(f"{file_name}: {', '.join(top_for_image)}")

    likely_issues: List[VisionIssue] = []
    actionable = [item for item in top_labels if not _is_healthy_label(str(item.get("label", "")))]
    for item in actionable[:5]:
        label = str(item.get("label") or "Unknown issue")
        category = _infer_issue_category(label)
        max_score = _to_score(item.get("max_score"))
        image_hits = int(item.get("image_hits", 0))
        avg_score = _to_score(item.get("avg_score"))
        likely_issues.append(
            VisionIssue(
                name=label,
                category=category,
                confidence=max_score,
                evidence=(
                    f"Detected in {image_hits}/{media_count} image(s), max score {max_score:.2f}, "
                    f"mean score {avg_score:.2f}."
                ),
                recommended_action=_issue_action(category),
            )
        )

    if not top_labels:
        overall = "Vision model returned no interpretable label scores from the uploaded media."
        immediate_actions = [
            "Capture new close-up photos in daylight (top and underside of affected leaves).",
            "Include at least one whole-plant shot and one symptomatic close-up for each crop.",
            "Avoid treatment changes until symptoms are verified on multiple plants.",
        ]
    elif not actionable:
        top = top_labels[0]
        overall = (
            f"Visual signal is mostly healthy/normal foliage ({top['label']} at {top['max_score'] * 100:.0f}%). "
            "No strong disease or pest pattern was detected from visuals alone."
        )
        immediate_actions = [
            "Continue scouting twice this week across multiple field sections.",
            "Check leaf undersides and stems for early pest activity before spraying.",
            "Upload sharper close-up images if symptoms worsen.",
        ]
    else:
        top_text = ", ".join([f"{item['label']} ({item['max_score'] * 100:.0f}%)" for item in actionable[:3]])
        overall = (
            f"Top visual issue signals: {top_text}. Treat this as probabilistic triage and confirm in-field before intervention."
        )
        immediate_actions = [
            "Prioritize scouting of the most affected field blocks first.",
            "Isolate severe hotspots and avoid blanket spraying until diagnosis is confirmed.",
            "Document spread pattern over 48 hours to validate the likely cause.",
        ]
        if deep_analysis:
            immediate_actions.extend(
                [
                    "Create a per-image severity log (mild/moderate/severe) and compare by field block.",
                    "Take paired close-up photos (front/back) for each symptom cluster to improve confirmation.",
                ]
            )

    field_checks = [
        "Inspect at least 20 plants across different field zones before selecting treatment.",
        "Compare symptom pattern on new vs old leaves and record where damage starts.",
        "Confirm whether symptoms are clustered, edge-based, or evenly distributed.",
        "Cross-check top visual labels with known local crop stage and recent weather.",
    ]
    if deep_analysis:
        field_checks.extend(
            [
                "Estimate incidence and severity separately for each block before treatment decisions.",
                "Re-capture the same leaves after 48-72 hours to measure progression objectively.",
            ]
        )

    raw_output = _trim(
        json.dumps(
            {
                "mode": "classification",
                "model": model,
                "farmer_message": _trim(farmer_message, 200),
                "image_predictions": per_image_predictions,
                "aggregated_top_labels": top_labels,
            },
            ensure_ascii=True,
        ),
        1200,
    )

    return VisionAnalysisResult(
        overall_assessment=overall,
        likely_issues=likely_issues,
        immediate_actions=immediate_actions[:6],
        field_checks=field_checks[:6],
        media_count=media_count,
        model=model,
        crop_hint=str(crop_hint or ""),
        deep_analysis=deep_analysis,
        top_labels=top_label_names[:8],
        per_image_notes=per_image_notes[:12],
        raw_output=raw_output,
    )


async def _validate_media_files(files: List[UploadFile], cfg: Dict[str, Any]) -> List[ValidatedImage]:
    if not files:
        raise VisionValidationError("Attach at least one image or extracted video frame.")

    max_images = max(1, int(cfg.get("hf_vision_max_images", 6)))
    if len(files) > max_images:
        raise VisionValidationError(f"Too many files. Maximum allowed is {max_images}.")

    max_file_mb = max(1, int(cfg.get("hf_vision_max_file_mb", 6)))
    max_bytes = max_file_mb * 1024 * 1024

    validated: List[ValidatedImage] = []
    for upload in files:
        filename = upload.filename or "uploaded-image"
        content = await upload.read()
        await upload.close()
        if not content:
            raise VisionValidationError(f"Empty file uploaded: {filename}.")
        if len(content) > max_bytes:
            raise VisionValidationError(f"File too large: {filename}. Limit is {max_file_mb} MB per file.")

        incoming_mime = str(upload.content_type or "").split(";")[0].strip().lower()
        if not _looks_like_image(content, incoming_mime):
            raise VisionValidationError(
                f"Unsupported file type for {filename}. Upload image files or extracted video frames."
            )

        validated.append(
            ValidatedImage(
                filename=filename,
                mime_type=_normalize_mime_type(content, incoming_mime),
                content=content,
            )
        )
    return validated


async def _infer_classification_labels(
    *,
    client: httpx.AsyncClient,
    endpoint: str,
    token: str,
    image: ValidatedImage,
) -> List[Dict[str, Any]]:
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": image.mime_type,
        "Accept": "application/json",
    }
    attempts = 3
    for attempt in range(1, attempts + 1):
        try:
            response = await client.post(endpoint, headers=headers, content=image.content)
        except httpx.HTTPError as exc:
            if attempt >= attempts:
                raise VisionUnavailableError(f"Hugging Face vision request failed for {image.filename}: {exc}")
            await asyncio.sleep(1.1 * attempt)
            continue

        payload: Any = None
        try:
            payload = response.json()
        except ValueError:
            payload = None

        if response.status_code >= 400:
            detail = _parse_error_detail(payload, response.text)
            can_retry = response.status_code in {429, 503} and attempt < attempts
            if can_retry:
                wait_for = _extract_estimated_wait(payload, default_wait=1.2 * attempt)
                logger.warning(
                    "Vision classification retry status=%s model_endpoint=%s file=%s wait=%.1fs detail=%s",
                    response.status_code,
                    endpoint,
                    image.filename,
                    wait_for,
                    detail,
                )
                await asyncio.sleep(wait_for)
                continue
            raise VisionUnavailableError(
                f"Hugging Face vision model error ({response.status_code}) for {image.filename}: {detail}"
            )

        if isinstance(payload, dict) and payload.get("error"):
            detail = _parse_error_detail(payload, "")
            if attempt < attempts:
                wait_for = _extract_estimated_wait(payload, default_wait=1.2 * attempt)
                logger.warning(
                    "Vision classification warmup retry endpoint=%s file=%s wait=%.1fs detail=%s",
                    endpoint,
                    image.filename,
                    wait_for,
                    detail,
                )
                await asyncio.sleep(wait_for)
                continue
            raise VisionUnavailableError(f"Hugging Face vision model error for {image.filename}: {detail}")

        labels = _extract_classifier_predictions(payload)
        if labels:
            return labels
        raise VisionUnavailableError(
            f"Hugging Face vision model returned no label scores for {image.filename}. "
            "Check HF_VISION_MODEL compatibility with image-classification."
        )

    raise VisionUnavailableError(f"Hugging Face vision request failed for {image.filename}.")


async def _analyze_via_classification(
    *,
    images: List[ValidatedImage],
    farmer_message: str,
    cfg: Dict[str, Any],
    vision_model: str,
    crop_hint: str | None = None,
    deep_analysis: bool = False,
) -> VisionAnalysisResult:
    base_url = str(cfg.get("hf_vision_inference_base_url") or "").rstrip("/")
    if not base_url:
        raise VisionUnavailableError("HF_VISION_INFERENCE_BASE_URL is missing. Vision fallback is disabled.")
    token = str(cfg.get("hf_token") or "").strip()
    endpoint = f"{base_url}/{vision_model}"

    per_image_predictions: List[Dict[str, Any]] = []
    failed_images: List[str] = []
    async with httpx.AsyncClient(timeout=cfg.get("hf_timeout", 30.0), verify=cfg.get("hf_verify_ssl", True)) as client:
        for image in images:
            try:
                labels = await _infer_classification_labels(
                    client=client,
                    endpoint=endpoint,
                    token=token,
                    image=image,
                )
            except VisionUnavailableError as exc:
                detail = _trim(str(exc), 240)
                failed_images.append(f"{image.filename}: {detail}")
                logger.warning(
                    "Vision classification skipped file=%s model=%s detail=%s",
                    image.filename,
                    vision_model,
                    detail,
                )
                continue

            per_image_predictions.append(
                {
                    "file": image.filename,
                    "predictions": labels[:8],
                }
            )

    if not per_image_predictions:
        if failed_images:
            sample = "; ".join(failed_images[:2])
            raise VisionUnavailableError(
                f"No uploaded image could be analyzed by model '{vision_model}'. Details: {sample}"
            )
        raise VisionUnavailableError(f"No uploaded image could be analyzed by model '{vision_model}'.")

    result = _build_classification_result(
        model=vision_model,
        media_count=len(per_image_predictions),
        farmer_message=farmer_message,
        per_image_predictions=per_image_predictions,
        crop_hint=crop_hint,
        deep_analysis=deep_analysis,
    )
    if failed_images:
        skipped = len(failed_images)
        result.overall_assessment = _trim(
            f"{result.overall_assessment} Note: {skipped} file(s) were skipped due to model-side errors.",
            400,
        )
        failed_blob = _trim(json.dumps({"skipped_files": failed_images}, ensure_ascii=True), 500)
        result.raw_output = _trim(f"{result.raw_output}\n{failed_blob}", 1200)
    return result


async def _analyze_via_chat_completions(
    *,
    images: List[ValidatedImage],
    farmer_message: str,
    cfg: Dict[str, Any],
    vision_model: str,
    crop_hint: str | None = None,
    deep_analysis: bool = False,
) -> VisionAnalysisResult:
    dataset_hint = ", ".join(DATASET_HINTS)
    prompt = (
        "You are GRIK Vision, a crop pest and disease triage assistant for Uganda.\n"
        f"Use practical taxonomy patterns aligned to these datasets: {dataset_hint}.\n"
        "Do not claim certainty. If unsure, lower confidence and recommend field verification.\n"
        "Return strict JSON only with keys:\n"
        "overall_assessment (string),\n"
        "likely_issues (array of objects: name, category, confidence, evidence, recommended_action),\n"
        "immediate_actions (array of short strings),\n"
        "field_checks (array of short strings).\n"
        "Confidence must be between 0 and 1."
    )
    user_text = (
        f"Farmer message: {farmer_message}\n"
        "Analyze the attached crop media and provide issue candidates, evidence, and immediate actions."
    )

    content_blocks: List[Dict[str, Any]] = [{"type": "text", "text": user_text}]
    for image in images:
        encoded = base64.b64encode(image.content).decode("ascii")
        content_blocks.append({"type": "image_url", "image_url": {"url": f"data:{image.mime_type};base64,{encoded}"}})

    base_url = str(cfg.get("hf_base_url") or "").rstrip("/")
    if not base_url:
        raise VisionUnavailableError("HF_BASE_URL is missing. Vision fallback is disabled.")
    endpoint = f"{base_url}/chat/completions"
    headers = {
        "Authorization": f"Bearer {cfg.get('hf_token')}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": vision_model,
        "messages": [
            {"role": "system", "content": prompt},
            {"role": "user", "content": content_blocks},
        ],
        "temperature": float(cfg.get("hf_vision_temperature", 0.1)),
        "max_tokens": int(cfg.get("hf_vision_max_tokens", 900)),
    }

    try:
        async with httpx.AsyncClient(timeout=cfg.get("hf_timeout", 30.0), verify=cfg.get("hf_verify_ssl", True)) as client:
            response = await client.post(endpoint, headers=headers, json=payload)
    except httpx.HTTPError as exc:
        logger.warning("Vision chat request failed model=%s error=%s", vision_model, exc)
        raise VisionUnavailableError(f"Hugging Face vision inference failed: {exc}")

    data: Any = None
    try:
        data = response.json()
    except ValueError:
        data = None

    if response.status_code >= 400:
        detail = _parse_error_detail(data, response.text)
        raise VisionUnavailableError(
            f"Hugging Face vision model error ({response.status_code}) in chat mode: {detail}"
        )

    data_dict = data if isinstance(data, dict) else {}
    text = _extract_completion_text(data_dict)
    if not text.strip():
        raise VisionUnavailableError("Vision model returned no usable output. Fallback is disabled.")

    parsed = _parse_vision_payload(text, media_count=len(images), model=vision_model)
    parsed.crop_hint = str(crop_hint or "")
    parsed.deep_analysis = deep_analysis
    return parsed


async def _analyze_with_model(
    *,
    images: List[ValidatedImage],
    farmer_message: str,
    cfg: Dict[str, Any],
    vision_model: str,
    crop_hint: str | None,
    deep_analysis: bool,
) -> VisionAnalysisResult:
    mode = str(cfg.get("hf_vision_mode") or "classification").strip().lower()
    if mode == "classification":
        return await _analyze_via_classification(
            images=images,
            farmer_message=farmer_message,
            cfg=cfg,
            vision_model=vision_model,
            crop_hint=crop_hint,
            deep_analysis=deep_analysis,
        )
    if mode in {"chat", "chat_completions", "multimodal"}:
        return await _analyze_via_chat_completions(
            images=images,
            farmer_message=farmer_message,
            cfg=cfg,
            vision_model=vision_model,
            crop_hint=crop_hint,
            deep_analysis=deep_analysis,
        )
    raise VisionUnavailableError(f"Unsupported HF_VISION_MODE='{mode}'. Use 'classification' or 'chat'.")


async def analyze_crop_media(
    files: List[UploadFile],
    farmer_message: str,
    crop_hint: str | None = None,
    model_preference: str | None = None,
    deep_analysis: bool = False,
) -> VisionAnalysisResult:
    cfg = get_ai_provider_config()
    if cfg.get("provider") != "huggingface":
        raise VisionUnavailableError("Vision analysis requires AI_PROVIDER=huggingface.")
    if not cfg.get("hf_token"):
        raise VisionUnavailableError("HUGGINGFACE_API_TOKEN is missing. Vision fallback is disabled.")
    if not str(cfg.get("hf_vision_model") or "").strip():
        raise VisionUnavailableError("HF_VISION_MODEL is missing. Vision fallback is disabled.")

    images = await _validate_media_files(files, cfg)
    normalized_crop = _normalize_crop_hint(crop_hint)
    preference = _normalize_model_preference(model_preference)
    candidates = _resolve_candidate_models(
        cfg=cfg,
        crop_hint=normalized_crop or None,
        model_preference=preference,
        deep_analysis=deep_analysis,
    )
    if not candidates:
        raise VisionUnavailableError("No vision model candidates are configured.")

    successes: List[tuple[VisionAnalysisResult, float]] = []
    failures: List[str] = []
    for model_id in candidates:
        if _is_model_temporarily_unavailable(model_id):
            failures.append(f"{model_id}: skipped due to recent unsupported-model error.")
            continue
        try:
            result = await _analyze_with_model(
                images=images,
                farmer_message=farmer_message,
                cfg=cfg,
                vision_model=model_id,
                crop_hint=normalized_crop or None,
                deep_analysis=deep_analysis,
            )
        except VisionUnavailableError as exc:
            detail = _trim(str(exc), 260)
            failures.append(f"{model_id}: {detail}")
            logger.warning("Vision model failed model=%s error=%s", model_id, detail)
            if "404" in detail or "Not Found" in detail:
                _mark_model_unavailable(model_id)
            continue

        quality_score = _model_quality_score(result, normalized_crop or None)
        successes.append((result, quality_score))

    if not successes:
        sample = "; ".join(failures[:2]) if failures else "Unknown model failure."
        raise VisionUnavailableError(f"All candidate vision models failed. Details: {sample}")

    successes.sort(key=lambda item: item[1], reverse=True)
    selected, selected_score = successes[0]
    run_summaries = [_build_model_run_summary(result, score) for result, score in successes]
    selected.model_runs = run_summaries
    selected.crop_hint = normalized_crop
    selected.deep_analysis = deep_analysis

    if len(successes) == 1:
        selected.selected_model_reason = (
            f"Ran single model '{selected.model}' with quality score {selected_score:.2f}."
        )
    else:
        selected.selected_model_reason = (
            f"Compared {len(successes)} model(s) and selected '{selected.model}' "
            f"(score {selected_score:.2f}) using confidence and crop-alignment checks."
        )

    if failures:
        failure_note = _trim("; ".join(failures[:2]), 260)
        selected.selected_model_reason = _trim(
            f"{selected.selected_model_reason} Some models failed: {failure_note}",
            320,
        )

    return selected
