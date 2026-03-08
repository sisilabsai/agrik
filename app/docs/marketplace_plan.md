# Marketplace Plan (Phase 1+)

## Purpose
Define a clear, phased Marketplace implementation for AGRIK that serves farmers, buyers, service providers, and input suppliers across SMS, voice, web, and mobile channels.

## Assumptions
- Phase 1 focuses on Uganda, starting with verified phone numbers.
- SMS is the primary channel, voice is supported where feasible, and web/mobile provide richer workflows.
- We will ship in phases to avoid overengineering and protect reliability.

## Target Users
- Farmers: list produce for sale, find buyers, compare prices, request transport.
- Buyers and aggregators: post buy offers, find nearby supply, contact sellers.
- Service providers: mechanization, spraying, transport, soil testing, storage.
- Input suppliers: seeds, fertilizer, agrochemicals, tools.
- Extension officers: monitor supply and demand signals, assist onboarding.

## Channels
- SMS: listing creation, search, alerts, and callback requests.
- Voice: assisted listing creation and search for low literacy users.
- Web: admin, moderation, data entry, and analytics.
- Mobile app: richer listing management, photos, and maps (Phase 2).

## MVP Features (Phase 1A)
- Listings: create sell or buy offers with crop, quantity, price, location, and availability window.
- Discovery: search listings by crop, district, parish, and radius.
- Contact: SMS-based contact flow or callback request.
- Trust: verified phone number badge and basic reputation score.
- Alerts: price change alerts and new nearby listings.
- Admin: listing review, takedown, and user verification.

## Phase 1B Features
- Service listings: mechanization, transport, spraying, storage.
- Input suppliers catalog: seeds, fertilizer, pesticides with prices.
- Simple bargaining: counter offer and accept via SMS.
- Transaction status: open, negotiating, completed, cancelled.

## Phase 2 Features
- Mobile app for listings with photos and richer profiles.
- Payments and escrow (only if explicitly approved later).
- Logistics coordination and delivery tracking.
- Advanced reputation and dispute resolution.

## Geospatial Design
- Store location at parish and district, with optional GPS or WKT geometry.
- Use radius search for nearby listings and service providers.
- Support location-based alerts such as "buyers within 20km" or "price spike in district".

## Notifications
- Weather alerts: heavy rain, drought risk, and flood risk.
- Market alerts: price up or down thresholds by crop and location.
- Supply demand alerts: sudden buyer demand for a crop in a district.
- Listing alerts: when a matching buy or sell offer appears nearby.

## Data Model (Proposed)
- users: id, phone, role, verification_status, preferred_language, created_at.
- locations: id, parish, district, geometry_wkt, updated_at.
- listings: id, user_id, role (seller or buyer), crop, quantity, unit, price, currency, grade, location_id, availability_start, availability_end, status, created_at.
- services: id, user_id, service_type, coverage_radius_km, price, location_id, status.
- offers: id, listing_id, user_id, price, quantity, status, created_at.
- alerts: id, user_id, alert_type, crop, location_id, threshold, channel, active.
- prices: id, crop, market, district, price, currency, source, captured_at.
- interactions: reuse existing interactions table for SMS and voice trails.

## API Endpoints (Proposed)
- POST /market/listings
- GET /market/listings
- POST /market/listings/{id}/interest
- POST /market/offers
- POST /market/alerts
- GET /market/prices
- POST /market/prices (admin)
- POST /market/services
- GET /market/services

## SMS Flows (Examples)
- Create listing example: "SELL MAIZE 200KG UGX1200 LIRA". System reply confirms listing and ID.
- Search example: "BUYERS MAIZE LIRA". System returns top matches and call instructions.
- Offer example: "OFFER 123 UGX1150". System relays offer to listing owner.

## Voice Flows (Examples)
- Voice inbound asks for crop, quantity, price, and location, then confirms the listing by SMS.
- Voice search reads back top 2 matches and offers callback requests.

## Web and Mobile
- Web admin: approve listings, verify users, adjust prices feed, handle disputes.
- Web dashboard: listing stats, supply demand heatmap, alert tuning.
- Mobile app: listing creation with photos, maps, and chat-like follow up.

## Integrations
- Weather API for forecast and rainfall alerts.
- Price feeds from partners or manual entry by verified admins.
- Maps or GIS services for geocoding and radius queries.

## Security and Compliance
- Consent required for listing publication and phone visibility.
- Basic fraud detection for repeated spam listings.
- Data retention policies and audit logs for actions.

## Metrics
- Listings created per day and per crop.
- Search to contact conversion rate.
- Offer acceptance rate.
- Alert delivery success rate.

## Implementation Plan
- Milestone 1: Listing and search via SMS with simple geofilters.
- Milestone 2: Alerts engine for prices and new nearby listings.
- Milestone 3: Services marketplace and admin web tools.
- Milestone 4: Voice flows and mobile app (if stable).

## Open Questions
- Initial pilot districts and markets for price feeds.
- Maximum search radius for SMS returns.
- How to verify users and suppliers at scale.
- Whether to allow listings without price for negotiation.
