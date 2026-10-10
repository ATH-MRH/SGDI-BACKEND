from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class MobileDevice(Base):
    """Appareil ATLAS MOBILE autorisé à recevoir des notifications push.

    Lié à la session qui l'a enregistré : un appareil dont la session est révoquée ou
    expirée ne doit plus rien recevoir (voir `active_devices`)."""

    __tablename__ = "mobile_devices"
    # Mêmes noms que la migration 20261013_0002.
    __table_args__ = (
        UniqueConstraint("push_token", name="uq_mobile_devices_push_token"),
        Index("ix_mobile_devices_user_active", "user_id", "revoked_at"),
        # La révocation d'une session supprime ses appareils en cascade : sans cet index,
        # chaque suppression de session parcourrait toute la table.
        Index("ix_mobile_devices_session_id", "session_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    session_id: Mapped[int | None] = mapped_column(ForeignKey("auth_sessions.id", ondelete="CASCADE"), nullable=True)
    push_token: Mapped[str] = mapped_column(String(255), nullable=False)
    provider: Mapped[str] = mapped_column(String(10), nullable=False)
    platform: Mapped[str] = mapped_column(String(10), nullable=False)
    environment: Mapped[str] = mapped_column(String(20), nullable=False)
    app_version: Mapped[str | None] = mapped_column(String(20), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
