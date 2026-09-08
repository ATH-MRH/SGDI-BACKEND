from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Index, JSON, String, Text, UniqueConstraint, event
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin
from app.core.permission_catalog import CANONICAL_ACTIONS, CANONICAL_FEATURE_PAIRS, CANONICAL_MODULES


class User(Base, TimestampMixin):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    username: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    email: Mapped[str | None] = mapped_column(String(150), unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(150))
    role: Mapped[str] = mapped_column(String(40), default="user", index=True)
    access_level: Mapped[str | None] = mapped_column(String(40), nullable=True)
    authorized_societies: Mapped[list | None] = mapped_column(JSON, nullable=True)
    authorized_structures: Mapped[list | None] = mapped_column(JSON, nullable=True)
    authorized_sites: Mapped[list | None] = mapped_column(JSON, nullable=True)
    # Liste vide = héritage du profil. Une liste renseignée devient la politique
    # individuelle effective pour toutes les routes authentifiées.
    authorized_actions: Mapped[list | None] = mapped_column(JSON, nullable=True)
    # Sous-domaines/modules utilisables avec cette identité centrale. NULL conserve
    # la politique historique des comptes existants; [] signifie aucun module dédié.
    authorized_modules: Mapped[list | None] = mapped_column(JSON, nullable=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    validation_password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    # Superviseur terrain : par défaut lecture seule (comportement historique, non
    # configurable jusqu'ici — voir isOpsSupervisorReadOnlySession côté frontend). Un admin
    # peut désactiver cette restriction pour un compte précis depuis Périmètres superviseurs.
    supervisor_read_only: Mapped[bool] = mapped_column(Boolean, default=True)
    # Seul ce droit explicite autorise un périmètre toutes sociétés.
    global_society_access: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)



class AccessRule(Base, TimestampMixin):
    __tablename__ = "access_rules"
    __table_args__ = (UniqueConstraint("module_key", "role", name="uq_access_rules_module_role"),)

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    module_key: Mapped[str] = mapped_column(String(80), index=True)
    role: Mapped[str] = mapped_column(String(40), index=True)
    allowed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)


class UserModulePermission(Base):
    """Autorisation explicite utilisateur × module × action.

    L'absence de ligne signifie absence de permission. Le modèle reste inerte
    tant que le futur moteur n'est pas branché sur les routes.
    """

    __tablename__ = "user_module_permissions"
    __table_args__ = (
        UniqueConstraint("user_id", "module_key", "action_key", name="uq_user_module_permission"),
        CheckConstraint(
            "module_key IN (" + ", ".join(repr(value) for value in CANONICAL_MODULES) + ")",
            name="ck_user_module_permission_module",
        ),
        CheckConstraint(
            "action_key IN (" + ", ".join(repr(value) for value in CANONICAL_ACTIONS) + ")",
            name="ck_user_module_permission_action",
        ),
        Index("ix_user_module_permissions_user_module", "user_id", "module_key"),
        Index("ix_user_module_permissions_module_action", "module_key", "action_key"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    module_key: Mapped[str] = mapped_column(String(80), nullable=False)
    action_key: Mapped[str] = mapped_column(String(40), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    created_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )


def _feature_pair_check_sql() -> str:
    by_module: dict[str, list[str]] = {}
    for module_key, feature_key in sorted(CANONICAL_FEATURE_PAIRS):
        by_module.setdefault(module_key, []).append(feature_key)
    return " OR ".join(
        f"(module_key = {module_key!r} AND feature_key IN ({', '.join(repr(value) for value in feature_keys)}))"
        for module_key, feature_keys in by_module.items()
    )


def _feature_action_check_sql() -> str:
    from app.core.permission_catalog import FEATURE_CATALOG
    return " OR ".join(
        "(module_key = {module!r} AND feature_key = {feature!r} AND action_key IN ({actions}))".format(
            module=module_key,
            feature=feature_key,
            actions=", ".join(repr(value) for value in feature[2]),
        )
        for module_key, module in FEATURE_CATALOG.items()
        for feature_key, feature in module["features"].items()
    )


class UserFeaturePermission(Base):
    """Permission préparée utilisateur × module × fonctionnalité × action.

    Cette table est indépendante du stockage 0.5-A et n'est consultée par aucun
    endpoint métier.
    """

    __tablename__ = "user_feature_permissions"
    __table_args__ = (
        UniqueConstraint(
            "user_id", "module_key", "feature_key", "action_key",
            name="uq_user_feature_permission",
        ),
        CheckConstraint(
            "module_key IN (" + ", ".join(repr(value) for value in CANONICAL_MODULES) + ")",
            name="ck_user_feature_permission_module",
        ),
        CheckConstraint(_feature_pair_check_sql(), name="ck_user_feature_permission_feature"),
        CheckConstraint(
            "action_key IN (" + ", ".join(repr(value) for value in CANONICAL_ACTIONS) + ")",
            name="ck_user_feature_permission_action",
        ),
        CheckConstraint(
            _feature_action_check_sql(),
            name="ck_user_feature_permission_applicable",
        ),
        Index("ix_user_feature_permissions_user_module", "user_id", "module_key"),
        Index("ix_user_feature_permissions_module_feature", "module_key", "feature_key"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    module_key: Mapped[str] = mapped_column(String(80), nullable=False)
    feature_key: Mapped[str] = mapped_column(String(100), nullable=False)
    action_key: Mapped[str] = mapped_column(String(40), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    created_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )


class AuditEvent(Base):
    __tablename__ = "audit_events"
    __table_args__ = (
        Index("ix_audit_events_user_created", "username", "created_at"),
        Index("ix_audit_events_society_created", "society", "created_at"),
        Index("ix_audit_events_action_resource", "action", "resource"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    user_id: Mapped[int | None] = mapped_column(nullable=True, index=True)
    username: Mapped[str | None] = mapped_column(String(80), nullable=True, index=True)
    action: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    resource: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    resource_id: Mapped[str | None] = mapped_column(String(180), nullable=True)
    society: Mapped[str | None] = mapped_column(String(150), nullable=True, index=True)
    result: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    ip_address: Mapped[str | None] = mapped_column(String(64), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(300), nullable=True)
    old_state: Mapped[str | None] = mapped_column(Text, nullable=True)
    new_state: Mapped[str | None] = mapped_column(Text, nullable=True)
    correlation_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)


class PortalPasswordResetToken(Base):
    __tablename__ = "portal_password_reset_tokens"

    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[str] = mapped_column(String(160), nullable=False, index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    delivery_channel: Mapped[str | None] = mapped_column(String(20), nullable=True)
    delivery_target_masked: Mapped[str | None] = mapped_column(String(180), nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    used_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


@event.listens_for(AuditEvent, "before_update")
@event.listens_for(AuditEvent, "before_delete")
def _protect_audit_event(_mapper, _connection, _target) -> None:
    raise ValueError("Le journal d'audit est append-only")
