# Architecture (Phase 1)

## Goals
- SMS + Voice first
- Simple, modular services
- Farmer memory as core IP

## Components
- API Service (FastAPI)
- Postgres + PostGIS
- Vector DB (later in Phase 1.5)
- Background worker (later)

## Data Flow
1. SMS/Voice inbound hits API
2. AI Brain generates grounded response
3. Interaction stored with farmer memory
4. Future: alert engine + outbound messaging

## Next
- Add database access layer
- Add language detection
- Add retrieval from agronomic corpus
