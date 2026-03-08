from sqlalchemy import Column, String, Text, DateTime, JSON, BigInteger, ForeignKey, func, Float, Boolean, Integer
from sqlalchemy.orm import relationship
from app.db.session import Base


class Farmer(Base):
    __tablename__ = "farmers"

    id = Column(String, primary_key=True)
    phone = Column(String, nullable=False)
    preferred_language = Column(String)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    profile = relationship("FarmerProfile", back_populates="farmer", uselist=False)
    location = relationship("FarmerLocation", back_populates="farmer", uselist=False)


class FarmerProfile(Base):
    __tablename__ = "farmer_profiles"

    farmer_id = Column(String, ForeignKey("farmers.id"), primary_key=True)
    crops = Column(JSON, nullable=False, default=list)
    planting_dates = Column(JSON, nullable=False, default=list)
    soil_profile = Column(JSON, nullable=False, default=dict)
    climate_exposure = Column(JSON, nullable=False, default=dict)
    yield_estimates = Column(JSON, nullable=False, default=list)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    farmer = relationship("Farmer", back_populates="profile", primaryjoin="FarmerProfile.farmer_id==Farmer.id")


class Interaction(Base):
    __tablename__ = "interactions"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    farmer_id = Column(String, nullable=False)
    channel = Column(String, nullable=False)
    message = Column(Text, nullable=False)
    response = Column(Text, nullable=False)
    language = Column(String, nullable=False)
    citations = Column(JSON, nullable=False, default=list)
    source_confidence = Column(String)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class FarmerLocation(Base):
    __tablename__ = "farmer_locations"

    farmer_id = Column(String, ForeignKey("farmers.id"), primary_key=True)
    parish = Column(String)
    district = Column(String)
    geometry_wkt = Column(Text)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    farmer = relationship("Farmer", back_populates="location", primaryjoin="FarmerLocation.farmer_id==Farmer.id")


class DeliveryReport(Base):
    __tablename__ = "delivery_reports"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    provider = Column(String, nullable=False)
    provider_message_id = Column(String)
    phone = Column(String)
    status = Column(String, nullable=False)
    failure_reason = Column(String)
    raw_payload = Column(JSON, nullable=False, default=dict)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class OutboundMessage(Base):
    __tablename__ = "outbound_messages"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    provider = Column(String, nullable=False)
    phone = Column(String, nullable=False)
    message = Column(Text, nullable=False)
    status = Column(String, nullable=False, default="pending")
    attempts = Column(BigInteger, nullable=False, default=0)
    last_error = Column(Text)
    next_attempt_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class AuthUser(Base):
    __tablename__ = "auth_users"

    id = Column(String, primary_key=True)
    phone = Column(String, nullable=False, unique=True, index=True)
    password_hash = Column(String)
    role = Column(String, nullable=False)
    status = Column(String, nullable=False, default="pending")
    verification_status = Column(String, nullable=False, default="unverified")
    otp_hash = Column(String)
    otp_expires_at = Column(DateTime(timezone=True))
    otp_attempts = Column(Integer, nullable=False, default=0)
    otp_last_sent_at = Column(DateTime(timezone=True))
    last_login_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class MarketUser(Base):
    __tablename__ = "market_users"

    id = Column(String, primary_key=True)
    phone = Column(String, nullable=False, unique=True)
    role = Column(String, nullable=False)
    verification_status = Column(String, nullable=False, default="unverified")
    preferred_language = Column(String)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class MarketLocation(Base):
    __tablename__ = "market_locations"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    user_id = Column(String, ForeignKey("market_users.id"), nullable=False)
    parish = Column(String)
    district = Column(String)
    latitude = Column(Float)
    longitude = Column(Float)
    geometry_wkt = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class MarketListing(Base):
    __tablename__ = "market_listings"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    user_id = Column(String, ForeignKey("market_users.id"), nullable=False)
    role = Column(String, nullable=False)
    crop = Column(String, nullable=False)
    quantity = Column(Float)
    unit = Column(String)
    price = Column(Float)
    currency = Column(String, nullable=False, default="UGX")
    grade = Column(String)
    description = Column(Text)
    contact_name = Column(String)
    contact_phone = Column(String)
    contact_whatsapp = Column(String)
    media_urls = Column(JSON, nullable=False, default=list)
    availability_start = Column(DateTime(timezone=True))
    availability_end = Column(DateTime(timezone=True))
    status = Column(String, nullable=False, default="open")
    location_id = Column(BigInteger, ForeignKey("market_locations.id"))
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class MarketOffer(Base):
    __tablename__ = "market_offers"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    listing_id = Column(BigInteger, ForeignKey("market_listings.id"), nullable=False)
    user_id = Column(String, ForeignKey("market_users.id"), nullable=False)
    price = Column(Float)
    quantity = Column(Float)
    status = Column(String, nullable=False, default="open")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class MarketService(Base):
    __tablename__ = "market_services"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    user_id = Column(String, ForeignKey("market_users.id"), nullable=False)
    service_type = Column(String, nullable=False)
    description = Column(Text)
    media_urls = Column(JSON, nullable=False, default=list)
    coverage_radius_km = Column(Float)
    price = Column(Float)
    currency = Column(String, nullable=False, default="UGX")
    status = Column(String, nullable=False, default="open")
    location_id = Column(BigInteger, ForeignKey("market_locations.id"))
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class PlatformService(Base):
    __tablename__ = "platform_services"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    service_type = Column(String, nullable=False)
    description = Column(Text)
    price = Column(Float)
    currency = Column(String, nullable=False, default="UGX")
    status = Column(String, nullable=False, default="open")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class MarketAlert(Base):
    __tablename__ = "market_alerts"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    user_id = Column(String, ForeignKey("market_users.id"), nullable=False)
    alert_type = Column(String, nullable=False)
    crop = Column(String)
    threshold = Column(Float)
    channel = Column(String, nullable=False, default="sms")
    active = Column(Boolean, nullable=False, default=True)
    location_id = Column(BigInteger, ForeignKey("market_locations.id"))
    min_interval_hours = Column(Integer, nullable=False, default=24)
    last_notified_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class MarketPrice(Base):
    __tablename__ = "market_prices"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    crop = Column(String, nullable=False)
    market = Column(String)
    district = Column(String)
    price = Column(Float, nullable=False)
    currency = Column(String, nullable=False, default="UGX")
    source = Column(String)
    captured_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class AuthUserSettings(Base):
    __tablename__ = "auth_user_settings"

    user_id = Column(String, ForeignKey("auth_users.id"), primary_key=True)
    preferred_language = Column(String)
    district = Column(String)
    parish = Column(String)
    sms_opt_in = Column(Boolean, nullable=False, default=True)
    voice_opt_in = Column(Boolean, nullable=False, default=True)
    weather_alerts = Column(Boolean, nullable=False, default=True)
    price_alerts = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class AuthUserProfile(Base):
    __tablename__ = "auth_user_profiles"

    user_id = Column(String, ForeignKey("auth_users.id"), primary_key=True)
    full_name = Column(String, nullable=False)
    district = Column(String, nullable=False)
    parish = Column(String, nullable=False)
    crops = Column(JSON, nullable=False, default=list)
    organization_name = Column(String)
    service_categories = Column(JSON, nullable=False, default=list)
    focus_crops = Column(JSON, nullable=False, default=list)
    onboarding_stage = Column(String, nullable=False, default="completed")
    profile_data = Column(JSON, nullable=False, default=dict)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class AuthSubscription(Base):
    __tablename__ = "auth_subscriptions"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    user_id = Column(String, ForeignKey("auth_users.id"), nullable=False, index=True)
    plan = Column(String, nullable=False)
    status = Column(String, nullable=False, default="trial")
    starts_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    ends_at = Column(DateTime(timezone=True))
    provider = Column(String)
    external_ref = Column(String)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    user_id = Column(String, ForeignKey("auth_users.id"), nullable=False, index=True)
    role = Column(String, nullable=False)
    message = Column(Text, nullable=False)
    channel = Column(String, nullable=False, default="web")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class AdminUser(Base):
    __tablename__ = "admin_users"

    id = Column(String, primary_key=True)
    email = Column(String, nullable=False, unique=True, index=True)
    password_hash = Column(String, nullable=False)
    status = Column(String, nullable=False, default="active")
    verification_status = Column(String, nullable=False, default="unverified")
    otp_hash = Column(String)
    otp_expires_at = Column(DateTime(timezone=True))
    otp_attempts = Column(Integer, nullable=False, default=0)
    otp_last_sent_at = Column(DateTime(timezone=True))
    last_login_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class AdminActivity(Base):
    __tablename__ = "admin_activities"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    admin_id = Column(String, nullable=False)
    action = Column(String, nullable=False)
    details = Column(JSON, nullable=False, default=dict)
    ip_address = Column(String)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
