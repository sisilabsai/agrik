import logging
import smtplib
from email.message import EmailMessage

from app.core.config import get_smtp_config

logger = logging.getLogger("agrik.email")


def send_email(to_address: str, subject: str, body: str) -> bool:
    cfg = get_smtp_config()
    if not cfg["host"] or not cfg["username"] or not cfg["password"] or not cfg["from_address"]:
        logger.warning("SMTP not configured; cannot send email.")
        return False

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = cfg["from_address"]
    msg["To"] = to_address
    msg.set_content(body)

    try:
        if cfg["use_ssl"]:
            with smtplib.SMTP_SSL(cfg["host"], cfg["port"], timeout=10) as server:
                server.login(cfg["username"], cfg["password"])
                server.send_message(msg)
        else:
            with smtplib.SMTP(cfg["host"], cfg["port"], timeout=10) as server:
                if cfg["use_tls"]:
                    server.starttls()
                server.login(cfg["username"], cfg["password"])
                server.send_message(msg)
        return True
    except smtplib.SMTPException as exc:
        logger.warning("Email send failed: %s", exc)
        return False
