-- AGRIK core schema (initial)
-- PostgreSQL + PostGIS

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS farmers (
    id TEXT PRIMARY KEY,
    phone TEXT NOT NULL,
    preferred_language TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS farmer_profiles (
    farmer_id TEXT PRIMARY KEY REFERENCES farmers(id),
    crops JSONB NOT NULL DEFAULT '[]',
    planting_dates JSONB NOT NULL DEFAULT '[]',
    soil_profile JSONB NOT NULL DEFAULT '{}',
    climate_exposure JSONB NOT NULL DEFAULT '{}',
    yield_estimates JSONB NOT NULL DEFAULT '[]',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS interactions (
    id BIGSERIAL PRIMARY KEY,
    farmer_id TEXT NOT NULL REFERENCES farmers(id),
    channel TEXT NOT NULL,
    message TEXT NOT NULL,
    response TEXT NOT NULL,
    language TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS farmer_locations (
    farmer_id TEXT PRIMARY KEY REFERENCES farmers(id),
    parish TEXT,
    district TEXT,
    geometry_wkt TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
