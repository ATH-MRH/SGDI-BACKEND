"""Administration système › Bureau des Effectifs Ouest — champs de la Fiche de position.

Monté sous /api/auth, à côté de la gestion des utilisateurs dont il prolonge les droits : même
garde administrateur que PATCH /api/auth/users (require_admin), et jamais sous
/api/site-workforce, que le compte BEO lui-même peut appeler. Le Chargé des effectifs ne peut
donc ni lire ni modifier ses propres champs par ces routes.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.audit import append_audit
from app.core.granular_permissions import replace_field_permissions
from app.db.session import get_db
from app.modules.auth.dependencies import current_user
from app.modules.auth.models import User
from app.modules.site_workforce import position_file

router = APIRouter()


class PositionFieldsReplaceIn(BaseModel):
    fields: list[str] = Field(default_factory=list, max_length=200)


def _require_admin(user: User) -> None:
    from app.modules.auth.routes import require_admin
    require_admin(user)


def _has_site_workforce(user: User) -> bool:
    return "site_workforce" in {str(m or "").strip().lower() for m in (user.authorized_modules or [])}


def _response(db: Session, target: User) -> dict:
    fields = sorted(position_file.allowed_fields(db, target.id))
    profile = ("beo_standard" if set(fields) == position_file.STANDARD_PROFILE
               else "none" if not fields else "custom")
    return {"user_id": target.id, "username": target.username, "fields": fields, "count": len(fields),
            "total": len(position_file.FIELDS), "profile": profile, "has_site_workforce": _has_site_workforce(target)}


@router.get("/site-workforce/position-fields")
def position_field_catalog(user: User = Depends(current_user)):
    _require_admin(user)
    return position_file.catalog_payload()


@router.get("/users/{user_id}/site-workforce/position-fields")
def get_user_position_fields(user_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    _require_admin(user)
    target = db.get(User, user_id)
    if target is None:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")
    return _response(db, target)


@router.put("/users/{user_id}/site-workforce/position-fields")
def put_user_position_fields(user_id: int, payload: PositionFieldsReplaceIn, request: Request,
                             db: Session = Depends(get_db), user: User = Depends(current_user)):
    _require_admin(user)
    target = db.execute(select(User).where(User.id == user_id).with_for_update()).scalar_one_or_none()
    if target is None:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")

    def refuse(code: int, detail: str):
        append_audit(db, action="site_workforce.position_fields.replace", resource="user_field_permission",
                     resource_id=target.id, result="refused", user=user, request=request,
                     new_state={"target_user_id": target.id, "target_username": target.username, "reason": detail})
        db.commit()
        raise HTTPException(status_code=code, detail=detail)

    if target.id == user.id:
        refuse(403, "Vous ne pouvez pas modifier vos propres champs autorisés")
    if not _has_site_workforce(target):
        refuse(422, "Ce compte n'a pas le module site_workforce (Bureau des Effectifs Ouest)")
    unknown = position_file.unknown_fields(payload.fields)
    if unknown:
        refuse(422, "Champ(s) inconnu(s) : " + ", ".join(unknown))

    additions, removals = replace_field_permissions(
        db, user_id=target.id, created_by_user_id=user.id, module_key=position_file.MODULE_KEY,
        resource_key=position_file.RESOURCE_KEY, field_keys=set(payload.fields),
    )
    if additions or removals:
        append_audit(db, action="site_workforce.position_fields.replace", resource="user_field_permission",
                     resource_id=target.id, result="success", user=user, request=request,
                     old_state={"removed": list(removals)},
                     new_state={"target_user_id": target.id, "target_username": target.username,
                                "added": list(additions), "removed": list(removals)})
    db.commit()
    return _response(db, target)
