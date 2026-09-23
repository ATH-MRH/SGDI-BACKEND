"""ATLAS Site Workforce — trois tables réellement absentes du schéma existant (voir
docs/site-workforce-baseline.md, §B1) : tout le reste du domaine (Employee, Site,
Assignment, DailyPresence, Leave, Sanction, Document, AuditEvent) est réutilisé tel quel,
jamais dupliqué.

Reclamation : workflow dédié, aucune table équivalente n'existe.

Transmission : polymorphe (resource_type/resource_id) — réutilise le dossier SOURCE
(Sanction/Reclamation/Leave/Document) sans jamais le dupliquer (§B16), une seule table
pour tous les types plutôt qu'un jeu de colonnes "transmitted_*" répété sur chaque table.

SiteNotification : notifications scopées à UN site (§B17). Le moteur "alerts" existant
(app/modules/alerts/models.py) est un moteur de détection à règles pour un domaine
différent (fraude/conformité) — le réutiliser ici l'aurait dénaturé, d'où une table dédiée
et volontairement simple.
"""
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


class Reclamation(Base, TimestampMixin):
    __tablename__ = "reclamations"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id", ondelete="CASCADE"), index=True)
    site_id: Mapped[int] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"), index=True)
    category: Mapped[str | None] = mapped_column(String(80))
    subject: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text)
    priority: Mapped[str] = mapped_column(String(20), default="normale")
    # Nouvelle -> En cours -> Transmise -> Réponse reçue -> Clôturée (§B14).
    status: Mapped[str] = mapped_column(String(30), default="nouvelle", index=True)
    response: Mapped[str | None] = mapped_column(Text)
    responded_by: Mapped[str | None] = mapped_column(String(120))
    responded_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_by: Mapped[str | None] = mapped_column(String(120))


class Transmission(Base, TimestampMixin):
    __tablename__ = "transmissions"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    # "sanction" | "reclamation" | "leave" | "document" — jamais une copie du dossier lui-même.
    resource_type: Mapped[str] = mapped_column(String(40), index=True)
    resource_id: Mapped[int] = mapped_column(Integer, index=True)
    site_id: Mapped[int] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"), index=True)
    # "drh" | "ops" | "direction" (§B14/§B16).
    destinataire: Mapped[str] = mapped_column(String(30), index=True)
    objet: Mapped[str] = mapped_column(String(200))
    commentaire: Mapped[str | None] = mapped_column(Text)
    priority: Mapped[str] = mapped_column(String(20), default="normale")
    source: Mapped[str] = mapped_column(String(60))
    created_by: Mapped[str | None] = mapped_column(String(120))
    # "envoyee" | "accusee" | "traitee" — statut de LA TRANSMISSION elle-même, jamais du
    # dossier source (même principe de séparation stricte qu'entre document et absence, §B9).
    status: Mapped[str] = mapped_column(String(20), default="envoyee", index=True)


class SiteNotification(Base, TimestampMixin):
    __tablename__ = "site_notifications"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    site_id: Mapped[int] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"), index=True)
    employee_id: Mapped[int | None] = mapped_column(ForeignKey("employees.id", ondelete="SET NULL"), index=True)
    # absence_sans_justificatif | justificatif_recu | justificatif_a_verifier | depart_conge |
    # retour_conge | maladie | reclamation | discipline | pointage_incomplet (§B17).
    notif_type: Mapped[str] = mapped_column(String(40), index=True)
    message: Mapped[str] = mapped_column(String(300))
    level: Mapped[str] = mapped_column(String(20), default="info")
    status: Mapped[str] = mapped_column(String(20), default="nouvelle", index=True)
    read_at: Mapped[datetime | None] = mapped_column(DateTime)
    read_by: Mapped[str | None] = mapped_column(String(120))
