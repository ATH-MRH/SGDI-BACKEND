"""Service central, non activé, des permissions granulaires du lot 0.5-A."""

from dataclasses import dataclass
from typing import Iterable, Protocol

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.permission_catalog import is_canonical_action, is_canonical_module
from app.modules.auth.models import User, UserModulePermission


GLOBAL_ADMIN_ROLES = frozenset({"ADMIN", "ADM", "ADM1", "ADM2"})


class PermissionGrant(Protocol):
    module_key: str
    action_key: str


@dataclass(frozen=True)
class PermissionScope:
    """Résultat des politiques de scope existantes fourni au futur moteur.

    Le lot 0.5-A ne recalcule et ne remplace aucun périmètre. ``None`` signifie
    que le contrôle requis n'a pas été fourni et conduit donc à un refus.
    """

    society_required: bool
    site_required: bool
    society_allowed: bool | None
    site_allowed: bool | None


@dataclass(frozen=True)
class PermissionDecision:
    allowed: bool
    reason: str


def is_global_administrator(user: User) -> bool:
    role = str(getattr(user, "role", "") or "").strip().upper()
    return role in GLOBAL_ADMIN_ROLES and getattr(user, "global_society_access", False) is True


def load_explicit_permissions(db: Session, user_id: int) -> tuple[UserModulePermission, ...]:
    """Charge seulement les droits matérialisés, sans aucun héritage legacy."""
    rows = db.execute(
        select(UserModulePermission)
        .where(UserModulePermission.user_id == user_id)
        .order_by(UserModulePermission.module_key, UserModulePermission.action_key)
    ).scalars()
    return tuple(rows)


def evaluate_permission(
    user: User,
    grants: Iterable[PermissionGrant],
    *,
    module_key: str,
    action_key: str,
    scope: PermissionScope,
) -> PermissionDecision:
    """Évalue un droit explicite sans consulter les champs legacy.

    Cette fonction n'est appelée par aucune dépendance ou route dans le lot
    0.5-A. Elle est prête à recevoir ultérieurement le résultat des politiques
    société et site existantes.
    """
    if not getattr(user, "is_active", False):
        return PermissionDecision(False, "inactive_user")
    if not is_canonical_module(module_key):
        return PermissionDecision(False, "unknown_module")
    if not is_canonical_action(action_key):
        return PermissionDecision(False, "unknown_action")
    if is_global_administrator(user):
        return PermissionDecision(True, "global_administrator")
    if scope.society_required and scope.society_allowed is not True:
        return PermissionDecision(False, "society_scope_required")
    if scope.site_required and scope.site_allowed is not True:
        return PermissionDecision(False, "site_scope_required")
    allowed = any(
        grant.module_key == module_key and grant.action_key == action_key
        for grant in grants
    )
    return PermissionDecision(allowed, "explicit_grant" if allowed else "missing_explicit_grant")
