from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


class ClientPortalUser(Base, TimestampMixin):
    """Compte nominatif d'un interlocuteur externe (le client) sur son portail dédié.

    Identité volontairement séparée de la table `users` (comptes internes) : un compte
    client ne doit jamais pouvoir hériter d'une permission interne par un chemin de code
    oublié. Voir app/modules/client_portal/security.py pour l'authentification associée.
    """

    __tablename__ = "client_portal_users"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    client_id: Mapped[int] = mapped_column(ForeignKey("clients.id", ondelete="CASCADE"), index=True)
    full_name: Mapped[str] = mapped_column(String(150))
    username: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=True)


class ClientObservation(Base, TimestampMixin):
    """Observation ou signalement soumis par un client sur un agent affecté à ses sites."""

    __tablename__ = "client_observations"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    client_id: Mapped[int] = mapped_column(ForeignKey("clients.id", ondelete="CASCADE"), index=True)
    client_user_id: Mapped[int] = mapped_column(ForeignKey("client_portal_users.id", ondelete="SET NULL"), nullable=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id", ondelete="CASCADE"), index=True)
    site_id: Mapped[int | None] = mapped_column(ForeignKey("sites.id", ondelete="SET NULL"), nullable=True, index=True)
    kind: Mapped[str] = mapped_column(String(20), default="observation", index=True)  # observation | probleme
    categories: Mapped[list | None] = mapped_column(JSON, nullable=True)
    severity: Mapped[str] = mapped_column(String(20), default="normale", index=True)  # normale | urgente
    description: Mapped[str] = mapped_column(Text)
    incident_date: Mapped[date] = mapped_column(Date, index=True)
    status: Mapped[str] = mapped_column(String(20), default="nouveau", index=True)  # nouveau | en_cours | traite
    resolution_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    resolved_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
