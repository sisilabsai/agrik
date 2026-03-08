#!/usr/bin/env python
import time
import sys
from pathlib import Path
from datetime import datetime, timezone, timedelta

# Ensure project root is on sys.path so "app" is importable
PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app.db.session import SessionLocal
from app.db.models import OutboundMessage
from app.services.outbound_queue import _send

MAX_ATTEMPTS = 5
SLEEP_SECONDS = 5


def main():
    while True:
        now = datetime.now(timezone.utc)
        db = SessionLocal()
        try:
            pending = (
                db.query(OutboundMessage)
                .filter(OutboundMessage.status == "pending")
                .filter(OutboundMessage.next_attempt_at <= now)
                .limit(50)
                .all()
            )

            for msg in pending:
                response = _send(msg.provider, msg.phone, msg.message)
                status_code = response.get("status_code", "")
                if status_code.isdigit() and 200 <= int(status_code) < 300:
                    msg.status = "sent"
                    msg.last_error = None
                    msg.next_attempt_at = None
                    msg.attempts = msg.attempts + 1
                else:
                    msg.attempts = msg.attempts + 1
                    msg.last_error = response.get("response_text", "send failed")
                    if msg.attempts >= MAX_ATTEMPTS:
                        msg.status = "failed"
                        msg.next_attempt_at = None
                    else:
                        msg.status = "pending"
                        msg.next_attempt_at = now + timedelta(seconds=(2 ** msg.attempts))
                db.commit()
        finally:
            db.close()

        time.sleep(SLEEP_SECONDS)


if __name__ == "__main__":
    main()
