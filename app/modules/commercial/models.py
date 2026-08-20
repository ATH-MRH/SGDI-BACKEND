from datetime import date

from sqlalchemy import Boolean, Date, Float, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


class Client(Base, TimestampMixin):
    __tablename__ = "clients"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(180), index=True)
    legal_name: Mapped[str | None] = mapped_column(String(220), index=True)
    society: Mapped[str | None] = mapped_column(String(150), index=True)
    structure: Mapped[str | None] = mapped_column(String(120), index=True)
    status: Mapped[str] = mapped_column(String(60), default="actif", index=True)
    contact_name: Mapped[str | None] = mapped_column(String(180))
    contact_position: Mapped[str | None] = mapped_column(String(140))
    phone: Mapped[str | None] = mapped_column(String(60))
    email: Mapped[str | None] = mapped_column(String(180))
    address: Mapped[str | None] = mapped_column(Text)
    nif: Mapped[str | None] = mapped_column(String(100))
    ai: Mapped[str | None] = mapped_column(String(100))
    nis: Mapped[str | None] = mapped_column(String(100))
    rc: Mapped[str | None] = mapped_column(String(100))
    services: Mapped[str | None] = mapped_column(Text)
    contract_start: Mapped[date | None] = mapped_column(Date)
    contract_duration: Mapped[str | None] = mapped_column(String(80))
    contract_end: Mapped[date | None] = mapped_column(Date, index=True)
    notes: Mapped[str | None] = mapped_column(Text)
    data: Mapped[dict | None] = mapped_column(JSON)
    # Portail client (module de signalement indépendant, un sous-domaine dédié par client) :
    # portal_slug est le premier label du sous-domaine (ex. "sonatrach" -> sonatrach.irongs.com).
    portal_slug: Mapped[str | None] = mapped_column(String(80), unique=True, index=True, nullable=True)
    portal_enabled: Mapped[bool] = mapped_column(Boolean, default=True)


class CommercialDcSettings(Base, TimestampMixin):
    """Réglages du module Commercial autonome (dc.irongs.com) — une seule ligne (id=1),
    éditée depuis Administration système. Séparé du reste du module commercial (Client)
    qui reste partagé avec l'ancien écran interne."""

    __tablename__ = "commercial_dc_settings"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    default_tva: Mapped[float] = mapped_column(Float, default=19)
    devis_prefix: Mapped[str] = mapped_column(String(20), default="DEV-")
    commande_prefix: Mapped[str] = mapped_column(String(20), default="CMD-")
    bl_prefix: Mapped[str] = mapped_column(String(20), default="BL-")
    active_societies: Mapped[list | None] = mapped_column(JSON, nullable=True)
