"""Couche d'autorisation serveur — axe RÔLE × NIVEAU (H1-H5).

Complète le cloisonnement SOCIÉTÉ déjà présent par module (`_ensure_society_allowed`).
Jusqu'ici le niveau `access_level` (H1-H4) n'avait AUCUN effet côté serveur : seul H5
comptait (illimité). Résultat : un utilisateur H1 « Consultation » pouvait créer /
modifier / supprimer partout où il passait le filtre société. Ce module ferme ce trou.

Aucune migration de schéma : rôle, `access_level`, `authorized_societies/sites` existent
déjà sur `User`. On introduit ici la HIÉRARCHIE des niveaux (poids) et une dépendance
FastAPI `require_level(action)` qui s'empile sans changer la signature des handlers.
"""
from __future__ import annotations

from fastapi import Depends, HTTPException, status

from app.modules.auth.dependencies import current_user
from app.modules.auth.models import User

# Hiérarchie des niveaux — reprise fidèle de `defaultNiveauxAcces()` côté client
# (sgdi-app.js) : poids croissant, H5 = administration système.
LEVEL_WEIGHTS: dict[str, int] = {
    "H1": 1,            # Consultation (lecture seule)
    "H2": 3,            # Saisie (écriture courante)
    "H3": 6,            # Validation
    "H4": 8,            # Supervision
    "CADRE_CAT_01": 9,  # Cadre catégorie 1 (bascule inter-sociétés)
    "H5": 10,           # Administration système (illimité)
}

# Rôles considérés comme administrateurs (variantes historiques).
ADMIN_ROLES = {"ADMIN", "ADM", "ADM1", "ADM2"}

# Action métier -> niveau minimum requis.
ACTION_MIN_LEVEL: dict[str, str] = {
    "read": "H1",       # lecture
    "write": "H2",      # création / modification courante
    "validate": "H3",   # validation / clôture
    "generate": "H3",   # génération de masse (rotations, feuilles)
    "delete": "H4",     # suppression (supervision)
}


def _norm(value) -> str:
    return str(value or "").strip().upper()


def is_admin_role(role) -> bool:
    """Rôle administrateur (ADMIN/ADM/ADM1/ADM2), insensible casse/espaces."""
    return _norm(role) in ADMIN_ROLES


def is_unrestricted(user: User) -> bool:
    """Super-privilège = rôle admin OU niveau H5. Bypass total des gardes de niveau.

    Consolide les définitions divergentes trouvées dans le code
    (`erp.unrestricted_scope`, `irongs._snapshot_unrestricted`, `assistant._is_super_admin`).
    """
    return is_admin_role(getattr(user, "role", None)) or _norm(getattr(user, "access_level", None)) == "H5"


def level_weight(user: User) -> int:
    """Poids du niveau de l'utilisateur (0 si niveau inconnu / absent)."""
    return LEVEL_WEIGHTS.get(_norm(getattr(user, "access_level", None)), 0)


def assert_can(user: User, action: str) -> None:
    """Lève 403 si l'utilisateur n'a pas le niveau minimum requis pour l'action.

    Un utilisateur non-restreint (admin ou H5) passe toujours. La société reste
    contrôlée séparément par les gardes de périmètre du module.
    """
    if is_unrestricted(user):
        return
    required = ACTION_MIN_LEVEL.get(action)
    if required is None:  # action inconnue : on exige le maximum par sécurité
        required = "H5"
    if level_weight(user) < LEVEL_WEIGHTS[required]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                f"Niveau insuffisant pour l'action « {action} » : "
                f"niveau requis {required}, niveau actuel {getattr(user, 'access_level', None) or 'aucun'}."
            ),
        )


def require_level(action: str):
    """Fabrique une dépendance FastAPI qui garde une route par niveau minimum.

    Usage : `@router.post(..., dependencies=[Depends(require_level("write"))])`.
    Ne modifie pas la signature du handler ; se combine avec les gardes société.
    """
    def dependency(user: User = Depends(current_user)) -> User:
        assert_can(user, action)
        return user

    return dependency
