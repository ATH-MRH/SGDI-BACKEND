import os

from fastapi import HTTPException

from app.db.session import SessionLocal
from app.modules.auth.schemas import UserCreate
from app.modules.auth.service import create_user


def main() -> None:
    username = os.environ.get("ADMIN_INITIAL_USERNAME", "").strip()
    password = os.environ.get("ADMIN_INITIAL_PASSWORD", "")
    full_name = os.environ.get("ADMIN_INITIAL_FULL_NAME", "Administrateur").strip() or username
    email = os.environ.get("ADMIN_INITIAL_EMAIL") or None

    if not username or not password:
        raise SystemExit("ADMIN_INITIAL_USERNAME et ADMIN_INITIAL_PASSWORD sont obligatoires")

    db = SessionLocal()
    try:
        create_user(
            db,
            UserCreate(
                username=username,
                email=email,
                full_name=full_name,
                role="admin",
                password=password,
            ),
        )
    except HTTPException as exc:
        raise SystemExit(str(exc.detail)) from exc
    finally:
        db.close()

    print("Compte administrateur créé")


if __name__ == "__main__":
    main()
