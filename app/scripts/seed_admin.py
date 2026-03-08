from app.db.session import SessionLocal
from app.services.admin_auth import seed_admin_user


def main() -> None:
    db = SessionLocal()
    try:
        admin = seed_admin_user(db)
        if admin:
            print(f"Seeded admin: {admin.email} (status={admin.status})")
        else:
            print("No admin seed configured (set ADMIN_SEED_EMAIL/ADMIN_SEED_PASSWORD).")
    finally:
        db.close()


if __name__ == "__main__":
    main()
