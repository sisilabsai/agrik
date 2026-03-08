# AGRIK PWA Rollout Plan

## Objective

Turn AGRIK into a reliable installable field app for weak-network and mobile-first use, without breaking the live web deployment.

## Phase 1: Installability and identity

- real app icons and favicon
- web manifest with install metadata
- theme color and mobile app meta tags
- stable brand identity across public and dashboard shells

## Phase 2: Safe offline shell

- service worker for static asset caching
- offline fallback page
- cache-first strategy for brand assets and shell bundles
- network-first strategy for live API data

## Phase 3: Reliable field workflows

- retry-aware offline draft storage for auth-safe forms
- local queue for advisory prompts and marketplace drafts
- background sync for pending submissions
- visible sync state in the UI

## Phase 4: Production hardening

- versioned cache invalidation
- stale asset cleanup on release
- install metrics and update prompts
- push notification strategy for alerts after browser support review

## Guardrails

- never cache auth tokens in service worker code
- never serve stale API mutations as successful
- keep rollout incremental behind reliable fallbacks
- preserve current live deployment path before enabling offline behavior

## Immediate next implementation

- add manifest and generated icons
- replace text logo with real logo
- keep deployment safe for certbot-managed Nginx
- add service worker only after deployment safeguards are in place
