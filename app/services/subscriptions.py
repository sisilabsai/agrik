from datetime import datetime, timedelta, timezone
from typing import Optional
from sqlalchemy.orm import Session
from app.db.models import AuthSubscription


def _now() -> datetime:
    return datetime.now(timezone.utc)


def get_latest_subscription(db: Session, user_id: str) -> Optional[AuthSubscription]:
    return (
        db.query(AuthSubscription)
        .filter(AuthSubscription.user_id == user_id)
        .order_by(AuthSubscription.created_at.desc())
        .first()
    )


def list_subscriptions(db: Session, user_id: str, limit: int = 50) -> list[AuthSubscription]:
    return (
        db.query(AuthSubscription)
        .filter(AuthSubscription.user_id == user_id)
        .order_by(AuthSubscription.created_at.desc())
        .limit(limit)
        .all()
    )


def create_subscription(
    db: Session,
    user_id: str,
    plan: str,
    status: Optional[str] = None,
    ends_at: Optional[datetime] = None,
    provider: Optional[str] = None,
    external_ref: Optional[str] = None,
) -> AuthSubscription:
    final_status = status or "trial"
    start_time = _now()
    if final_status == "trial" and ends_at is None:
        ends_at = start_time + timedelta(days=14)

    subscription = AuthSubscription(
        user_id=user_id,
        plan=plan,
        status=final_status,
        starts_at=start_time,
        ends_at=ends_at,
        provider=provider,
        external_ref=external_ref,
    )
    db.add(subscription)
    db.commit()
    db.refresh(subscription)
    return subscription
