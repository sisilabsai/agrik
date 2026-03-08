# AGRIK Admin Dashboard Plan

## Goals
- Replace the single flat page with a real admin console layout (sidebar, topbar, content regions).
- Provide clear navigation and page hierarchy for all admin workflows.
- Wire every view to existing admin APIs (no mock data).
- Keep the UI compact and professional with strong visual hierarchy and mobile readiness.

## Information Architecture
- Overview (KPI snapshot, recent activity, quick actions)
- Users (roles, verification, status management)
- Listings (moderation queue)
- Prices (publish + history)
- Alerts (weather/price monitoring)
- Services (provider network)
- Activity (audit log)
- Settings (admin profile, security, integrations)

## Layout Components
- `AdminShell` layout: sidebar + topbar + main content
- `AdminSidebar`: brand, navigation, admin profile, sign out
- `AdminTopbar`: page title, quick actions, menu toggle
- `PageHeader`: title, subtitle, primary action
- `FilterBar`: search + selects + action button
- `KpiGrid` + `KpiCard`
- `DataTable` / `DataList` with row actions
- `StatusPill` + `EmptyState`
- `SidePanel` (optional, for details on wide screens)

## Page Features (Phase 1)
- Overview
  - KPI cards (users, listings, services, alerts, prices)
  - Recent listings, prices, and alerts
  - Admin activity feed
- Users
  - Filter by role, status, verification
  - Inline edits with save action
- Listings
  - Filter by crop, district, role, status
  - Approve / pause / close actions
- Prices
  - Manual price publishing
  - Recent price list + filters
- Alerts
  - Active/all filter
  - Alert details list
  - Manual alert creation with schedule (min interval / times per week)
  - Location + crop dropdowns, target user selection
- Services
  - Provider list (type, location, price)
  - Create, edit, delete services
  - Seed default services for a provider
- Activity
  - Audit stream (action, time, IP, details)

## API Wiring Map
- Overview
  - `GET /admin/summary`
  - `GET /admin/listings?limit=5`
  - `GET /admin/prices?limit=5`
  - `GET /admin/alerts?limit=5`
  - `GET /admin/activity?limit=10`
  - `GET /market/services?limit=5`
- Users
  - `GET /admin/users`
  - `PATCH /admin/users/{id}`
- Listings
  - `GET /admin/listings`
  - `PATCH /admin/listings/{id}`
- Prices
  - `GET /admin/prices`
  - `POST /admin/prices`
- Alerts
  - `GET /admin/alerts`
  - `POST /admin/alerts`
  - `PATCH /admin/alerts/{id}`
  - `DELETE /admin/alerts/{id}`
- Services
  - `GET /admin/services`
  - `POST /admin/services`
  - `PATCH /admin/services/{id}`
  - `DELETE /admin/services/{id}`
  - `POST /admin/services/seed`
- Metadata
  - `GET /admin/metadata`
- Activity
  - `GET /admin/activity`

## Build Steps
1. Create `AdminShell` layout with sidebar + topbar + responsive behavior.
2. Add admin routes for each page (Overview, Users, Listings, Prices, Alerts, Services, Activity).
3. Split the existing admin dashboard into dedicated pages wired to APIs.
4. Add an activity API and page for audit events.
5. Polish styles: compact cards, tables, consistent padding, mobile behavior.

## Progress Log
- [x] Admin auth + OTP flow
- [x] Admin API base endpoints
- [x] Admin shell + navigation
- [x] Admin pages wired to APIs
- [x] Activity stream endpoint + UI
- [ ] Final polish + responsive refinements
