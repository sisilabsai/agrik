from typing import List
from sqlalchemy.orm import Session
from app.db.models import ChatMessage


def create_message(db: Session, user_id: str, role: str, message: str, channel: str = "web") -> ChatMessage:
    entry = ChatMessage(user_id=user_id, role=role, message=message, channel=channel)
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry


def list_messages(db: Session, user_id: str, limit: int = 30) -> List[ChatMessage]:
    return (
        db.query(ChatMessage)
        .filter(ChatMessage.user_id == user_id)
        .order_by(ChatMessage.created_at.desc())
        .limit(limit)
        .all()
    )
