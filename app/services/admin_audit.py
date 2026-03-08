from typing import Any, Dict, Optional
from sqlalchemy.orm import Session

from app.db.models import AdminActivity


def record_admin_activity(
    db: Session,
    admin_id: str,
    action: str,
    details: Optional[Dict[str, Any]] = None,
    ip_address: Optional[str] = None,
) -> None:
    entry = AdminActivity(
        admin_id=admin_id,
        action=action,
        details=details or {},
        ip_address=ip_address,
    )
    db.add(entry)
    db.commit()
