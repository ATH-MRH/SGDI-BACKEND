"""Service central, non activé, des permissions granulaires du lot 0.5-A."""

from dataclasses import dataclass
from typing import Iterable, Protocol

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.permission_catalog import applicable_actions, is_canonical_action, is_canonical_feature, is_canonical_module
from app.modules.auth.models import User, UserFeaturePermission, UserModulePermission


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


def validate_permission_pairs(
    permissions: Iterable[PermissionGrant],
) -> tuple[tuple[str, str], ...]:
    """Valide une charge explicite sans normaliser ni dériver d'alias legacy."""
    pairs: list[tuple[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for permission in permissions:
        pair = (permission.module_key, permission.action_key)
        if not is_canonical_module(pair[0]):
            raise ValueError(f"Module granulaire inconnu : {pair[0]}")
        if not is_canonical_action(pair[1]):
            raise ValueError(f"Action granulaire inconnue : {pair[1]}")
        if pair in seen:
            raise ValueError(f"Permission granulaire dupliquée : {pair[0]}/{pair[1]}")
        seen.add(pair)
        pairs.append(pair)
    return tuple(sorted(pairs))


def replace_explicit_permissions(
    db: Session,
    *,
    user_id: int,
    created_by_user_id: int,
    permissions: Iterable[PermissionGrant],
) -> tuple[tuple[tuple[str, str], ...], tuple[tuple[str, str], ...]]:
    """Prépare atomiquement les ajouts/retraits; le routeur garde le commit."""
    requested = set(validate_permission_pairs(permissions))
    existing_rows = tuple(
        db.execute(
            select(UserModulePermission)
            .where(UserModulePermission.user_id == user_id)
            .with_for_update()
        ).scalars()
    )
    existing = {(row.module_key, row.action_key): row for row in existing_rows}
    additions = tuple(sorted(requested - set(existing)))
    removals = tuple(sorted(set(existing) - requested))
    for pair in removals:
        db.delete(existing[pair])
    for module_key, action_key in additions:
        db.add(UserModulePermission(
            user_id=user_id,
            module_key=module_key,
            action_key=action_key,
            created_by_user_id=created_by_user_id,
        ))
    db.flush()
    return additions, removals


class FeaturePermissionGrant(Protocol):
    module_key: str
    feature_key: str
    action_key: str


def load_feature_permissions(db: Session, user_id: int) -> tuple[UserFeaturePermission, ...]:
    rows = db.execute(
        select(UserFeaturePermission)
        .where(UserFeaturePermission.user_id == user_id)
        .order_by(
            UserFeaturePermission.module_key,
            UserFeaturePermission.feature_key,
            UserFeaturePermission.action_key,
        )
    ).scalars()
    return tuple(rows)


def validate_feature_permissions(
    permissions: Iterable[FeaturePermissionGrant],
) -> tuple[tuple[str, str, str], ...]:
    triples: list[tuple[str, str, str]] = []
    seen: set[tuple[str, str, str]] = set()
    for permission in permissions:
        triple = (permission.module_key, permission.feature_key, permission.action_key)
        if not is_canonical_module(triple[0]):
            raise ValueError(f"Module granulaire inconnu : {triple[0]}")
        if not is_canonical_feature(triple[0], triple[1]):
            raise ValueError(f"Fonctionnalité granulaire inconnue : {triple[0]}/{triple[1]}")
        if not is_canonical_action(triple[2]):
            raise ValueError(f"Action granulaire inconnue : {triple[2]}")
        if triple[2] not in applicable_actions(triple[0], triple[1]):
            raise ValueError(
                f"Action non applicable : {triple[0]}/{triple[1]}/{triple[2]}"
            )
        if triple in seen:
            raise ValueError(
                f"Permission granulaire dupliquée : {triple[0]}/{triple[1]}/{triple[2]}"
            )
        seen.add(triple)
        triples.append(triple)
    return tuple(sorted(triples))


def replace_feature_permissions(
    db: Session,
    *,
    user_id: int,
    created_by_user_id: int,
    permissions: Iterable[FeaturePermissionGrant],
) -> tuple[tuple[tuple[str, str, str], ...], tuple[tuple[str, str, str], ...]]:
    requested = set(validate_feature_permissions(permissions))
    existing_rows = tuple(
        db.execute(
            select(UserFeaturePermission)
            .where(UserFeaturePermission.user_id == user_id)
            .with_for_update()
        ).scalars()
    )
    existing = {
        (row.module_key, row.feature_key, row.action_key): row
        for row in existing_rows
    }
    additions = tuple(sorted(requested - set(existing)))
    removals = tuple(sorted(set(existing) - requested))
    for triple in removals:
        db.delete(existing[triple])
    for module_key, feature_key, action_key in additions:
        db.add(UserFeaturePermission(
            user_id=user_id,
            module_key=module_key,
            feature_key=feature_key,
            action_key=action_key,
            created_by_user_id=created_by_user_id,
        ))
    db.flush()
    return additions, removals


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
