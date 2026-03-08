import hashlib
import secrets


def hash_password(password: str, iterations: int = 200000) -> str:
    salt = secrets.token_hex(16)
    derived = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), iterations)
    return f"pbkdf2${iterations}${salt}${derived.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, iter_str, salt, digest = stored.split("$", 3)
        if scheme != "pbkdf2":
            return False
        iterations = int(iter_str)
    except (ValueError, AttributeError):
        return False

    derived = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), iterations)
    return secrets.compare_digest(derived.hex(), digest)
