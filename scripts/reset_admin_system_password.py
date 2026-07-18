import argparse
import base64
import hashlib
import os
import secrets

from sqlalchemy import create_engine
from sqlalchemy import func
from sqlalchemy.orm import sessionmaker

from app.modules.auth.models import User


PBKDF2_ROUNDS = 260_000


def normalize_database_url(url: str) -> str:
    if url.startswith("postgres://"):
        return url.replace("postgres://", "postgresql+psycopg2://", 1)
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+psycopg2://", 1)
    return url


def hash_password(password: str) -> str:
    salt = secrets.token_urlsafe(18)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), PBKDF2_ROUNDS)
    encoded = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
    return f"pbkdf2_sha256${PBKDF2_ROUNDS}${salt}${encoded}"


def reset_admin_system_password(password: str, username: str = "ADG01", database_url: str | None = None) -> str:
    clean_username = (username or "ADG01").strip().upper()
    if not clean_username.startswith(("ADG", "ADM")) and clean_username != "ADMIN":
        raise SystemExit("Identifiant admin système invalide. Utilisez ADG01, ADM01, etc.")
    if not password:
        raise SystemExit("Mot de passe obligatoire")
    database_url = database_url or os.environ.get("DATABASE_URL")
    if not database_url:
        raise SystemExit(
            "DATABASE_URL manquant. Lancez par exemple :\n"
            "DATABASE_URL='postgresql://user:motdepasse@hote:5432/base' "
            "python3 -m scripts.reset_admin_system_password AD159"
        )

    SessionLocal = sessionmaker(
        bind=create_engine(normalize_database_url(database_url), future=True, pool_pre_ping=True),
        autoflush=False,
        autocommit=False,
        future=True,
    )
    db = SessionLocal()
    try:
        user = (
            db.query(User)
            .filter(func.lower(User.username) == clean_username.lower())
            .one_or_none()
        )
        if user is None:
            user = User(
                username=clean_username,
                email=None,
                full_name="Administrateur système",
                role="admin",
                access_level="H5",
                authorized_societies=[],
                authorized_structures=["admin"],
                authorized_sites=[],
                password_hash=hash_password(password),
                is_active=True,
            )
            db.add(user)
        else:
            user.role = "admin"
            user.access_level = "H5"
            user.authorized_structures = ["admin"]
            user.password_hash = hash_password(password)
            user.is_active = True
        db.commit()
        return clean_username
    finally:
        db.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Réinitialise le mot de passe Administration système.")
    parser.add_argument("password", help="Nouveau mot de passe")
    parser.add_argument("--username", default="ADG01", help="Compte admin système à réinitialiser")
    parser.add_argument("--database-url", default=None, help="URL PostgreSQL si DATABASE_URL n'est pas exporté")
    args = parser.parse_args()
    username = reset_admin_system_password(args.password, args.username, args.database_url)
    print(f"Mot de passe Administration système réinitialisé pour {username}")


if __name__ == "__main__":
    main()
