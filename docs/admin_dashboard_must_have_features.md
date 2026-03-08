# AGRIK Admin Dashboard Must-Have Features

## Purpose
- Define the non-negotiable product and UX requirements for the AGRIK admin workspace before the next implementation pass.
- Keep the admin experience polished, easy to use, and operationally powerful across overview, users, listings, prices, alerts, services, and audit activity.
- Use the current codebase and API surface as the baseline, not a greenfield assumption.

## Current State Audit

### Already in place
- Dedicated admin shell with sidebar navigation for Overview, Users, Listings, Prices, Alerts, Services, and Activity.
- Admin authentication flow with login, OTP verification, and authenticated session handling.
- Overview page already wired to summary and operational data.
- Users page already supports rich filtering, role and status updates, date-range driven views, and multiple display modes.
- Listings page already supports basic moderation filters and status updates.
- Prices page already supports price creation, editing, filtering, and metadata-backed form inputs.
- Alerts page already supports alert creation, bulk creation, editing, filtering, and deletion.
- Services page already supports platform service creation, editing, filtering, and deletion.
- Activity page already exposes a basic audit log feed.
- Admin API surface already exists for summary, users, listings, prices, alerts, services, metadata, and activity.

### Gaps in the current admin experience
- The workspace is functional, but not yet opinionated enough for fast daily operations.
- Several pages behave like CRUD pages instead of decision-making control centers.
- Cross-page workflows are still weak. An admin can update records, but it is harder to move from a signal to the next correct action.
- Bulk moderation, escalation, review queues, and exception handling are still thin.
- Visibility into risk, abuse, pending review, and operational bottlenecks is not strong enough.
- Auditability exists, but investigation workflows are still shallow.
- Mobile and small-screen admin usability needs tighter prioritization of content and actions.
- The UI needs stronger density control, clearer hierarchy, and less cognitive switching between list, filters, metrics, and actions.

## Product Principles
- Show what needs attention first.
- Keep common admin actions one or two clicks away.
- Separate signal, review, and action clearly on every page.
- Support both high-volume scanning and deep investigation.
- Make every state explain itself: pending, approved, paused, flagged, failed, verified, inactive.
- Preserve trust with audit history, actor tracking, and safe mutation patterns.
- Stay usable on laptops first, but remain workable on tablets and smaller screens.

## Must-Have Admin Capabilities

### 1. Admin Overview Must Act Like a Command Center
- Surface priority queues first: pending verifications, flagged listings, stalled alerts, failed price updates, inactive providers with open demand, and suspicious activity.
- Add clear “needs action now” sections, not just KPI cards.
- Support drill-down from every KPI into the filtered destination page.
- Show trend movement, not just totals: daily/weekly change, rising districts, declining activity, approval backlog.
- Add recent critical events stream with severity labels.
- Add quick actions for the highest-frequency tasks:
  - review pending users
  - moderate flagged listings
  - publish price update
  - create targeted alert
  - inspect suspicious activity

### 2. User Management Must Support Review, Trust, and Intervention
- Keep the strong existing filters, but add saved views for:
  - pending verification
  - inactive but recently registered
  - providers with no active services
  - buyers/farmers with repeated failed activity
  - high-activity users
- Add a user detail drawer or detail page with:
  - profile summary
  - verification state
  - listing and service footprint
  - alert subscriptions
  - recent activity timeline
  - moderation notes
- Add bulk actions for status, verification, and role-safe interventions.
- Add an internal notes field and review history for each user.
- Show warning signals such as duplicated phone patterns, repeated edits, suspicious posting velocity, or inactive onboarding.

### 3. Listings Management Must Become a True Moderation Console
- Replace plain listing rows with moderation-ready cards or rows that separate:
  - title and crop/service
  - owner
  - district/parish
  - price and quantity
  - evidence/media status
  - publication date
  - moderation status
  - risk or quality flags
- Add moderation queues:
  - pending review
  - flagged
  - low-evidence
  - stale but still open
  - price outliers
  - duplicate or near-duplicate listings
- Add bulk moderation actions for approve, pause, close, and flag.
- Add moderator notes and reason capture on status changes.
- Add listing detail review with media preview, contact visibility status, owner history, and related listings.
- Make quality issues obvious without opening each listing.

### 4. Prices Must Support Publishing Discipline and Confidence
- Keep create and edit flows, but add stronger publishing workflow:
  - draft
  - ready to publish
  - published
  - superseded
- Show price history clearly by crop, market, district, and date.
- Highlight outliers, missing districts, stale prices, and sudden swings.
- Add approval or confirmation state before publishing sensitive updates.
- Add a “today’s price coverage” view to show which crops or markets still need updates.
- Support export of filtered price data for reporting.

### 5. Alerts Must Support Targeting, Reliability, and Review
- Keep current creation tools, but add operational views for:
  - active alerts
  - paused alerts
  - failed or never-triggered alerts
  - high-frequency alerts
  - alerts by district, crop, and channel
- Show delivery confidence indicators where possible:
  - last sent
  - last failed
  - next likely send window
  - audience size
- Add reusable alert templates for recurring admin actions.
- Add better bulk operations for pausing, resuming, retargeting, and deleting.
- Add a clearer separation between manual alerts and automated system alerts.

### 6. Services Must Support Platform Catalog Governance
- Keep platform service CRUD, but add service health views:
  - active services
  - paused services
  - retired services
  - services with incomplete descriptions or pricing
- Show where each service is actually being used or promoted in the platform.
- Add service detail view with adoption and dependency context.
- Prevent weak catalog entries by enforcing completeness and clear admin prompts.
- Add seeded-service management as a first-class workflow, not a hidden utility.

### 7. Activity Must Support Real Investigation
- Keep the audit log, but improve it beyond a flat stream.
- Add filters for actor, action type, entity type, date range, and severity.
- Add structured entity links from activity rows to the affected user, listing, alert, price, or service.
- Expand row detail to show before/after values when available.
- Highlight sensitive actions:
  - role changes
  - verification overrides
  - listing closures
  - alert deletions
  - price edits after publish
- Add investigation-friendly grouping by session or actor.

## UX and Interaction Requirements

### Navigation
- Keep the sidebar, but make the active section and subsection state more obvious.
- Add page-level secondary navigation or tabs only when it reduces clutter.
- Keep topbar actions page-specific and minimal.

### Filters
- Every data-heavy page needs a compact sticky filter bar on desktop.
- Mobile filters should open in a dedicated sheet or drawer, not compress the table into unusable form fields.
- Show active filters as removable chips.
- Support reset, saved views, and predictable defaults.

### Data Presentation
- Use stronger row and card structure with visual separation between identity, metrics, state, and actions.
- Use tables where comparison matters and cards where triage matters.
- Protect readability with consistent spacing, stronger labels, and reduced line-noise.
- Prefer scannable metadata blocks over long unbroken text strings.

### Actions
- Distinguish primary, secondary, and destructive actions clearly.
- Destructive actions must require confirmation and capture a reason where appropriate.
- Inline editing is good for quick operations, but deeper edits need a drawer or detail screen.
- Bulk selection must remain visible while scrolling a long results list.

### Feedback
- Every mutation needs visible success, failure, and pending states.
- Empty states should tell the admin what is missing and what to do next.
- Slow loads need skeletons or clear loading placeholders, not blank spaces.

### Responsive Behavior
- Desktop should prioritize speed and information density.
- Tablet should preserve two-column decision areas where possible.
- Mobile should collapse non-essential metrics and keep only identity, status, and top actions visible first.

## Non-Negotiable Features Before Calling the Admin Dashboard Polished
- Cross-page drill-down from overview cards into pre-filtered destination pages.
- Saved views for repeat admin workflows.
- Bulk actions on users and listings.
- Moderator or admin notes on sensitive records.
- Better audit detail and entity linking.
- Stronger moderation and exception queues.
- Clear empty, loading, and error states across all admin pages.
- Mobile-safe filters and action patterns.
- Export support where admins need reporting or handoff.
- Consistent typography, spacing, card density, and state styling across the whole admin workspace.

## Priority Implementation Order

### Phase 1: Operational Clarity
- Tighten the admin shell, page headers, filter patterns, and data hierarchy.
- Upgrade Overview into a true action-first command center.
- Improve Listings and Activity because they are the weakest control surfaces right now.

### Phase 2: High-Leverage Admin Workflows
- Add saved views, bulk actions, notes, and better drill-down flows.
- Strengthen Users with a deeper detail view and intervention tools.
- Strengthen Prices and Alerts with clearer operational states and exception handling.

### Phase 3: Depth and Governance
- Add service governance depth, investigation workflows, and richer audit context.
- Add stronger reporting and export patterns.
- Add smarter anomaly surfacing and backlog visibility.

## Acceptance Criteria
- An admin can identify the top five urgent issues within 10 seconds of landing on the overview page.
- An admin can moderate multiple listings or user records without opening each one individually.
- An admin can understand why an item is risky, stale, incomplete, or blocked without guessing.
- An admin can move from a dashboard signal to the exact filtered records behind it in one click.
- An admin can use every core page comfortably on a laptop and still complete essential actions on mobile.
- The system feels consistent across overview, users, listings, prices, alerts, services, and activity.

## Recommendation Before Implementation
- Treat the next admin pass as a workflow and control-surface redesign, not a styling pass.
- Start with Overview, Listings, and Activity first, then tighten Users, Prices, Alerts, and Services around the same interaction model.
