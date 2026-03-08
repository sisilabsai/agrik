# Multilingual Data Sources (Luganda, Swahili, etc.)

This document lists practical, free sources we can use to improve AGRIK multilingual support without training/downloading local foundation models.

## 1) Parallel text datasets (for translation and phrasing)

- OPUS (open parallel corpora across many domains and language pairs)
  - https://opus.nlpl.eu/
- Masakhane MT benchmark datasets on Hugging Face
  - https://huggingface.co/masakhane
- FLORES-200 (evaluation and small parallel sets for many languages)
  - https://huggingface.co/datasets/facebook/flores
- JW300 multilingual corpus (includes many African languages via OPUS)
  - https://opus.nlpl.eu/JW300.php

## 2) Speech + transcription resources

- Mozilla Common Voice (speech datasets for ASR/TTS pipelines)
  - https://commonvoice.mozilla.org/

## 3) External multilingual knowledge for runtime grounding

- Wikimedia Core API (Luganda/Swahili/English pages)
  - Example: `https://api.wikimedia.org/core/v1/wikipedia/lg/search/page?q=kasooli&limit=3`
  - Example: `https://api.wikimedia.org/core/v1/wikipedia/sw/search/page?q=mahindi&limit=3`

## Recommended short-term strategy

1. Use local agronomy manuals as the primary source.
2. Add Wikimedia runtime search as a secondary source for non-English coverage gaps.
3. Translate structured English advisory using router-hosted translation model.
4. Keep a reliability guard: if translation quality is low, show English guidance + language-mode note.

## Recommended medium-term strategy

1. Build a cleaned domain corpus:
   - Luganda/Swahili agricultural extension documents
   - district advisories
   - pest bulletins
2. Store as structured JSON in `app/data/uganda_manuals/` by language.
3. Re-score retrieval to prefer local verified sources over general web content.
