from typing import Any, Type

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.auth.models import AccessRule, User
from app.modules.commercial.models import CommercialDcSettings
from app.modules.commercial.schemas import DC_ACCESS_BASE_ROLES, DC_ACCESS_ROLE_LABELS


def list_rows(db: Session, model: Type, filters: dict[str, Any] | None = None):
    stmt = select(model)
    for key, value in (filters or {}).items():
        if value not in (None, "") and hasattr(model, key):
            stmt = stmt.where(getattr(model, key) == value)
    return db.execute(stmt.order_by(model.id.desc())).scalars().all()


def get_or_404(db: Session, model: Type, row_id: int):
    row = db.get(model, row_id)
    if not row:
        raise HTTPException(status_code=404, detail="Enregistrement introuvable")
    return row


def create_row(db: Session, model: Type, payload: Any):
    row = model(**payload.model_dump(exclude_unset=True))
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def update_row(db: Session, model: Type, row_id: int, payload: Any):
    row = get_or_404(db, model, row_id)
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(row, key, value)
    db.commit()
    db.refresh(row)
    return row


def delete_row(db: Session, model: Type, row_id: int):
    row = get_or_404(db, model, row_id)
    db.delete(row)
    db.commit()
    return {"deleted": True, "id": row_id}


# ── Module Commercial autonome (dc.irongs.com) : accès et réglages ────────────────────

DEFAULT_DC_SOCIETIES = ["IRON GLOBAL SÉCURITÉ", "IRON GLOBAL SOLUTION", "SWORD CORPORATION", "SWORD CONSTRUCTION"]
DC_MODULE_KEY = "COMMERCIAL_DC"
# Défaut volontairement simple et indépendant du tableau "Droits d'accès" legacy : Cadres
# et Directeurs ont accès par défaut, Agent/Maîtrise non — modifiable depuis la console.
_DC_DEFAULT_ALLOWED_ROLES = {"ops", "ADM"}


def dc_base_role(role: str | None) -> str:
    """Réduit un rôle utilisateur brut aux 4 catégories Agent/Maîtrise/Cadre/Directeur —
    même vocabulaire que le tableau Droits d'accès (agent/dispatch/ops/ADM), recalculé
    ici sans dépendre de sa logique pour rester simple à auditer."""
    value = (role or "").strip().upper()
    if value.startswith("AG"):
        return "agent"
    if value.startswith("SUP"):
        return "dispatch"
    if value.startswith("ADM") or value == "ADMIN":
        return "ADM"
    return "ops"


def dc_access_allowed(db: Session, user: User) -> bool:
    base = dc_base_role(user.role)
    if base == "ADM":
        return True
    rule = db.execute(
        select(AccessRule).where(AccessRule.module_key == DC_MODULE_KEY, AccessRule.role == base)
    ).scalar_one_or_none()
    if rule is not None:
        return rule.allowed
    return base in _DC_DEFAULT_ALLOWED_ROLES


def get_or_create_dc_settings(db: Session) -> CommercialDcSettings:
    settings = db.get(CommercialDcSettings, 1)
    if not settings:
        settings = CommercialDcSettings(id=1, active_societies=list(DEFAULT_DC_SOCIETIES))
        db.add(settings)
        db.commit()
        db.refresh(settings)
    return settings


def _dc_settings_dict(settings: CommercialDcSettings, my_access: bool) -> dict[str, Any]:
    return {
        "default_tva": settings.default_tva,
        "devis_prefix": settings.devis_prefix,
        "commande_prefix": settings.commande_prefix,
        "bl_prefix": settings.bl_prefix,
        "active_societies": settings.active_societies or list(DEFAULT_DC_SOCIETIES),
        "my_access": my_access,
    }


def dc_settings_out(db: Session, user: User) -> dict[str, Any]:
    settings = get_or_create_dc_settings(db)
    return _dc_settings_dict(settings, dc_access_allowed(db, user))


def update_dc_settings(db: Session, payload) -> dict[str, Any]:
    settings = get_or_create_dc_settings(db)
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(settings, key, value)
    db.commit()
    db.refresh(settings)
    return _dc_settings_dict(settings, True)


def list_dc_access_rules(db: Session) -> list[dict[str, Any]]:
    overrides = {
        rule.role: rule.allowed
        for rule in db.execute(select(AccessRule).where(AccessRule.module_key == DC_MODULE_KEY)).scalars().all()
    }
    return [
        {
            "role": role,
            "label": DC_ACCESS_ROLE_LABELS.get(role, role),
            "allowed": overrides.get(role, role in _DC_DEFAULT_ALLOWED_ROLES),
            "is_default": role not in overrides,
        }
        for role in DC_ACCESS_BASE_ROLES
    ]


def set_dc_access_rule(db: Session, payload) -> list[dict[str, Any]]:
    role = payload.role.strip()
    if role not in DC_ACCESS_BASE_ROLES:
        raise HTTPException(status_code=422, detail="Rôle invalide")
    rule = db.execute(
        select(AccessRule).where(AccessRule.module_key == DC_MODULE_KEY, AccessRule.role == role)
    ).scalar_one_or_none()
    default_allowed = role in _DC_DEFAULT_ALLOWED_ROLES
    if payload.allowed == default_allowed:
        if rule:
            db.delete(rule)
            db.commit()
    elif rule:
        rule.allowed = payload.allowed
        db.commit()
    else:
        db.add(AccessRule(module_key=DC_MODULE_KEY, role=role, allowed=payload.allowed))
        db.commit()
    return list_dc_access_rules(db)
