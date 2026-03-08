# Frontend Implementation Plan (Web + Admin + Auth)

## Purpose
Build the AGRIK web frontend (landing page, authentication, user dashboards, admin dashboard) using real API data only. No mock data in production flows.

## Scope
- Web landing page
- Authentication (role-aware)
- User dashboards (farmers, buyers, service providers)
- Admin dashboard
- Mobile app planning (Phase 2, but API-ready now)

## Target Roles
- Farmer
- Buyer / Aggregator
- Service Provider
- Input Supplier
- Admin / Extension Officer

## Non-Negotiables
- Use real API data only. If data is missing, build the API endpoint first.
- Phone-first experience (SMS and voice remain primary in the field).
- Simple, fast pages. Optimize for low bandwidth.
- Clear audit trail for admin actions.

## Required Backend Capabilities (must exist before UI)
1. Authentication and Roles
- POST /auth/register
- POST /auth/login
- POST /auth/verify-otp (if SMS OTP)
- GET /auth/me
- Role claims: farmer, buyer, service_provider, input_supplier, admin

2. Marketplace
- POST /market/listings
- GET /market/listings
- POST /market/offers
- POST /market/services
- GET /market/services
- POST /market/alerts
- GET /market/prices
- POST /market/prices (admin only)

3. Admin
- GET /admin/users
- PATCH /admin/users/{id}
- GET /admin/listings
- PATCH /admin/listings/{id}
- GET /admin/alerts
- GET /admin/prices
- POST /admin/prices

4. System Metrics
- GET /metrics (already present)
- GET /market/summary (counts, listings, offers, alerts)

## Data Contracts (frontend expects)
- User: id, phone, role, verification_status
- Listing: id, user_id, crop, quantity, unit, price, currency, district/parish, status
- Offer: id, listing_id, price, quantity, status
- Service: id, service_type, coverage_radius_km, price, currency, district/parish
- Alert: id, alert_type, crop, threshold, channel, min_interval_hours
- Price: id, crop, district, market, price, currency, captured_at

## Step-by-Step Implementation

### Step 1. Auth + User Profile API
- Decide on auth method: SMS OTP (recommended) or email/password.
- Implement session or JWT-based auth.
- Add role assignment at registration.
- Add admin-only endpoints for role changes and verification.

### Step 2. Frontend Setup
- Web framework: React + Vite or Next.js.
- Auth state management.
- API client with token handling and error mapping.
- Simple design system (typography, colors, buttons, alerts).

### Step 3. Landing Page
Features:
- Clear value proposition
- Primary CTA: "Join as Farmer" / "Join as Buyer" / "Join as Service Provider"
- Live stats from /market/summary
- Testimonials or proof points (optional)

API:
- GET /market/summary for real-time stats

### Step 4. Authentication Page
Features:
- Phone input, OTP flow
- Role selection at signup
- Support for existing users

API:
- POST /auth/register
- POST /auth/login
- POST /auth/verify-otp
- GET /auth/me

### Step 5. Farmer Dashboard
Features:
- My Listings
- Create Listing
- Offers received
- Alerts (weather + price)
- Market prices

API:
- GET /market/listings?user_id=
- POST /market/listings
- GET /market/prices
- POST /market/alerts

### Step 6. Buyer Dashboard
Features:
- Search listings
- Create offers
- Track offers

API:
- GET /market/listings
- POST /market/offers

### Step 7. Service Provider Dashboard
Features:
- Create service listing
- Search for leads

API:
- POST /market/services
- GET /market/services

### Step 8. Admin Dashboard
Features:
- User verification and role management
- Listing moderation
- Price publishing
- Alert monitoring
- System health and metrics

API:
- GET /admin/users
- PATCH /admin/users/{id}
- GET /admin/listings
- PATCH /admin/listings/{id}
- GET /admin/prices
- POST /admin/prices
- GET /metrics

## Real Data Rule (No Mockups)
- Use development database with seed data.
- If a page requires data that does not exist, build the API first.
- Avoid placeholder charts; use live stats or hide if empty.

## Mobile App (Phase 2)
- Use same APIs as web.
- Add offline cache for listings and prices.
- Push notifications for alerts.

## Open Questions
- Preferred auth approach: OTP or password?
- Which pilot districts should be enabled by default?
- Should admin users manage price feeds manually or import CSV?

## Acceptance Criteria
- All UI screens load real data without errors.
- Role-based access enforced end-to-end.
- Admin actions are auditable.
- Dashboard pages support low bandwidth use.
