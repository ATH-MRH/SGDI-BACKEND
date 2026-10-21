"""Champs métier autorisés par utilisateur (module × ressource × champ).

Module volontairement distinct de auth/models.py : la migration initiale historique
(20260503_0001, Base.metadata.create_all) et migrations/env.py importent auth/models.py, ce qui
matérialiserait cette table sur toute base reconstruite depuis zéro avant même sa migration
(20261024_0001). Ici, seule l'application (via app/core/granular_permissions.py) la charge : une
base vierge suit exactement le même chemin que la production.
"""
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.modules.auth.models import User  # noqa: F401  (table users référencée par les clés étrangères)


class UserFieldPermission(Base):
    """Champ métier explicitement lisible par un utilisateur : module × ressource × champ.

    Une ligne = un champ autorisé ; l'absence de ligne = champ refusé (deny by default, jamais
    « liste vide = tout »). Les clés valides vivent dans le catalogue applicatif de la ressource
    (ex. app/modules/site_workforce/position_file.py) et non dans une contrainte CHECK : le
    catalogue peut évoluer sans migration, une clé inconnue est refusée à l'écriture et
    ignorée à la lecture. Premier usage : site_workforce / position_file.
    """

    __tablename__ = "user_field_permissions"
    __table_args__ = (
        UniqueConstraint("user_id", "module_key", "resource_key", "field_key", name="uq_user_field_permission"),
        Index("ix_user_field_permissions_user_resource", "user_id", "module_key", "resource_key"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    module_key: Mapped[str] = mapped_column(String(80), nullable=False)
    resource_key: Mapped[str] = mapped_column(String(80), nullable=False)
    field_key: Mapped[str] = mapped_column(String(120), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    created_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
