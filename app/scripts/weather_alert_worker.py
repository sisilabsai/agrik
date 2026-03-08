#!/usr/bin/env python
import time
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app.db.session import SessionLocal
from app.services.weather_alerts import process_weather_alerts

SLEEP_SECONDS = 300


def main():
    while True:
        db = SessionLocal()
        try:
            sent = process_weather_alerts(db)
            if sent:
                print(f"Weather alerts sent: {sent}")
        finally:
            db.close()
        time.sleep(SLEEP_SECONDS)


if __name__ == "__main__":
    main()
