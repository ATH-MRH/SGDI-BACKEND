import json
from contextlib import contextmanager
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.modules.auth.dependencies import current_user, request_action
from app.modules.irongs.schemas import CollectionOut, CollectionReplace, DbReplace, ItemPayload, LegacyActionPayload
from app.modules.irongs import service
from app.modules.irongs.constants import CATEGORIES_PREST, POSTES, SOCIETES
from app.modules.irongs.models import Position
from app.modules.auth.routes import is_admin_role
from app.core.audit import append_audit
from app.core.scope_policy import ScopeKind, society_scope
from app.modules.irongs.legacy_policy import LegacyAccess, collection_policy, user_legacy_modules


router = APIRouter(dependencies=[Depends(current_user)])


def _legacy_capabilities(user) -> set[str]:
    return set(user_legacy_modules(user))


def _legacy_gate(db: Session, request: Request, user, name: str, write: bool = False) -> None:
    policy = collection_policy(name)
    access = policy.write if write else policy.read
    allowed = access in {LegacyAccess.WRITE_ALLOWED if write else LegacyAccess.READ_ALLOWED}
    allowed = allowed or (access is LegacyAccess.ADMIN_ONLY and is_admin_role(user.role))
    allowed = allowed and society_scope(user).kind is not ScopeKind.NONE
    allowed = allowed and (is_admin_role(user.role) or bool(policy.modules & _legacy_capabilities(user)))
    actions = {str(value or "").strip().lower() for value in (user.authorized_actions or [])}
    allowed = allowed and (not actions or request_action(request) in actions or "admin" in actions)
    if not allowed:
        append_audit(db, action=f"legacy.{'write' if write else 'read'}", resource="collection",
                     resource_id=name, result="refused", user=user, request=request,
                     new_state={"required_modules": sorted(policy.modules), "request_action": request_action(request)})
        db.commit()
        raise HTTPException(status_code=403, detail="Collection legacy non autorisée")


def _legacy_success(db: Session, request: Request, user, name: str, *, write: bool = False,
                    resource_id: Any = None, old_state: Any = None, new_state: Any = None) -> None:
    append_audit(db, action=f"legacy.{'write' if write else 'read'}", resource="collection",
                 resource_id=resource_id if resource_id is not None else name, result="success",
                 user=user, request=request, old_state=old_state, new_state=new_state)
    db.commit()


@contextmanager
def _legacy_operation(db: Session, request: Request, user, name: str, *, write: bool = False,
                      resource_id: Any = None):
    try:
        yield
    except Exception as exc:
        db.rollback()
        append_audit(db, action=f"legacy.{'write' if write else 'read'}", resource="collection",
                     resource_id=resource_id if resource_id is not None else name, result="failure",
                     user=user, request=request, new_state={"error_type": type(exc).__name__})
        db.commit()
        raise


def _get_postes(db: Session) -> list[str]:
    rows = db.query(Position).order_by(Position.name).all()
    if not rows:
        for name in POSTES:
            db.add(Position(name=name, society=None))
        db.commit()
        rows = db.query(Position).order_by(Position.name).all()
    return [r.name for r in rows]


@router.get("/bootstrap")
def bootstrap(request: Request, db: Session = Depends(get_db), user=Depends(current_user)) -> Response:
    # L'en-tête (user + constants) est petit ; le "db" (jusqu'à ~26 Mo) est pré-encodé
    # et mis en cache par get_database_json. On assemble les octets sans ré-encoder le db.
    head = json.dumps(
        {
            "user": {
                "id": user.id,
                "username": user.username,
                "email": user.email,
                "full_name": user.full_name,
                "role": user.role,
                "is_active": user.is_active,
            },
            "constants": {
                "societes": SOCIETES,
                "postes": _get_postes(db),
                "categories_prestations": CATEGORIES_PREST,
            },
        },
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")
    db_bytes = service.get_database_json(db, user)
    body = head[:-1] + b',"db":' + db_bytes + b"}"
    append_audit(db, action="legacy.bootstrap.read", resource="database_snapshot", result="success", user=user, request=request)
    db.commit()
    return Response(content=body, media_type="application/json")


class PositionCreate(BaseModel):
    name: str
    society: str | None = None


@router.get("/positions")
def list_positions(society: str | None = None, db: Session = Depends(get_db)) -> list[dict]:
    _get_postes(db)  # seed if empty
    q = db.query(Position).order_by(Position.society.nulls_first(), Position.name)
    if society:
        q = q.filter((Position.society == society) | (Position.society.is_(None)))
    return [{"id": r.id, "name": r.name, "society": r.society} for r in q.all()]


@router.post("/positions", status_code=201)
def create_position(payload: PositionCreate, db: Session = Depends(get_db), user=Depends(current_user)) -> dict:
    role = str(user.role or "").strip().lower()
    structures = {str(value or "").strip().lower() for value in (user.authorized_structures or [])}
    if not (is_admin_role(user.role) or role in {"rh", "drh", "recruteur"} or structures & {"drh", "recrutement", "recruteur", "gestionnaire_rh"}):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Réservé administrateur ou recrutement / DRH")
    name = payload.name.strip()
    society = payload.society.strip() if payload.society else None
    allowed_societies = [str(value).strip() for value in (user.authorized_societies or []) if str(value).strip()]
    if society and allowed_societies and society.casefold() not in {value.casefold() for value in allowed_societies}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Société non autorisée")
    if not name:
        raise HTTPException(status_code=400, detail="Nom requis")
    if db.query(Position).filter(Position.name == name, Position.society == society).first():
        raise HTTPException(status_code=409, detail="Poste déjà existant pour cette société")
    pos = Position(name=name, society=society)
    db.add(pos)
    db.commit()
    db.refresh(pos)
    return {"id": pos.id, "name": pos.name, "society": pos.society}


@router.delete("/positions/{position_id}", status_code=200)
def delete_position(position_id: int, db: Session = Depends(get_db), user=Depends(current_user)) -> dict:
    if not is_admin_role(user.role):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Réservé administrateur")
    pos = db.get(Position, position_id)
    if not pos:
        raise HTTPException(status_code=404, detail="Poste introuvable")
    db.delete(pos)
    db.commit()
    return {"ok": True}


@router.get("/db")
def get_db_snapshot(
    request: Request,
    light: bool = Query(False, description="Retourne le snapshot legacy sans reconstruire les collections SQL lourdes"),
    db: Session = Depends(get_db),
    user=Depends(current_user),
) -> Response:
    body = service.get_database_json(db, user, include_sql=not light)
    append_audit(db, action="legacy.snapshot.read", resource="database_snapshot", result="success", user=user, request=request)
    db.commit()
    return Response(content=body, media_type="application/json")


@router.put("/db")
def replace_db_snapshot(payload: DbReplace, request: Request, db: Session = Depends(get_db), user=Depends(current_user)) -> dict[str, Any]:
    allowed = is_admin_role(user.role) and bool(getattr(user, "global_society_access", False))
    if not allowed:
        append_audit(db, action="legacy.snapshot.write", resource="database_snapshot",
                     result="refused", user=user, request=request)
        db.commit()
        raise HTTPException(status_code=403, detail="Remplacement global réservé à un administrateur global explicite")
    result = service.replace_database(db, payload.data, user)
    append_audit(db, action="legacy.snapshot.write", resource="database_snapshot",
                 result="success", user=user, request=request,
                 new_state={"collections": sorted(payload.data)})
    db.commit()
    return result


@router.post("/db")
def post_db_snapshot(payload: dict[str, Any], request: Request, db: Session = Depends(get_db), user=Depends(current_user)) -> dict[str, Any]:
    allowed = is_admin_role(user.role) and bool(getattr(user, "global_society_access", False))
    if not allowed:
        append_audit(db, action="legacy.snapshot.write", resource="database_snapshot",
                     result="refused", user=user, request=request)
        db.commit()
        raise HTTPException(status_code=403, detail="Remplacement global réservé à un administrateur global explicite")
    data = payload.get("data") if isinstance(payload.get("data"), dict) else payload
    result = service.replace_database(db, data, user)
    append_audit(db, action="legacy.snapshot.write", resource="database_snapshot",
                 result="success", user=user, request=request,
                 new_state={"collections": sorted(data)})
    db.commit()
    return result


@router.get("/collections/{name}", response_model=CollectionOut)
def get_collection(name: str, request: Request, db: Session = Depends(get_db), user=Depends(current_user)):
    _legacy_gate(db, request, user, name)
    with _legacy_operation(db, request, user, name):
        data = service.get_collection(db, name)
        result = {"name": name, "data": service.scope_collection_for_user(name, data, user)}
    _legacy_success(db, request, user, name)
    return result


@router.put("/collections/{name}", response_model=CollectionOut)
def replace_collection(name: str, payload: CollectionReplace, request: Request, db: Session = Depends(get_db), user=Depends(current_user)):
    _legacy_gate(db, request, user, name, write=True)
    if not service.can_replace_collection_for_user(name, user):
        append_audit(db, action="legacy.write", resource="collection", resource_id=name,
                     result="refused", user=user, request=request)
        db.commit()
        raise HTTPException(status_code=403, detail="Remplacement collection réservé administrateur")
    with _legacy_operation(db, request, user, name, write=True):
        old = service.get_collection(db, name)
        result = {"name": name, "data": service.replace_collection(db, name, payload.data, user)}
    _legacy_success(db, request, user, name, write=True, old_state=old, new_state=result["data"])
    return result


@router.get("/collections/{name}/items")
def list_items(name: str, request: Request, db: Session = Depends(get_db), user=Depends(current_user)) -> list[Any]:
    _legacy_gate(db, request, user, name)
    with _legacy_operation(db, request, user, name):
        data = service.list_items(db, name)
        value = service.scope_collection_for_user(name, data, user)
        result = value if isinstance(value, list) else []
    _legacy_success(db, request, user, name)
    return result


@router.post("/collections/{name}/items")
def create_item(name: str, payload: ItemPayload, request: Request, db: Session = Depends(get_db), user=Depends(current_user)) -> dict[str, Any]:
    _legacy_gate(db, request, user, name, write=True)
    with _legacy_operation(db, request, user, name, write=True):
        data = dict(payload.data)
        if name == "echanges" and data.get("type") == "message":
            data["from"] = user.username
        service.ensure_item_allowed_for_user(data, user, name)
        result = service.create_item(db, name, data)
    _legacy_success(db, request, user, name, write=True, resource_id=result.get("id"), new_state=result)
    return result


@router.get("/collections/{name}/items/{item_id}")
def get_item(name: str, item_id: str, request: Request, db: Session = Depends(get_db), user=Depends(current_user)) -> dict[str, Any]:
    _legacy_gate(db, request, user, name)
    with _legacy_operation(db, request, user, name, resource_id=item_id):
        item = service.get_item(db, name, item_id)
        rows = service.scope_collection_for_user(name, service.list_items(db, name), user)
        if not isinstance(rows, list) or not any(isinstance(row, dict) and str(row.get("id")) == str(item.get("id")) for row in rows):
            raise HTTPException(status_code=404, detail="Élément introuvable")
    _legacy_success(db, request, user, name, resource_id=item_id)
    return item


@router.put("/collections/{name}/items/{item_id}")
def replace_item(name: str, item_id: str, payload: ItemPayload, request: Request, db: Session = Depends(get_db), user=Depends(current_user)) -> dict[str, Any]:
    _legacy_gate(db, request, user, name, write=True)
    with _legacy_operation(db, request, user, name, write=True, resource_id=item_id):
        existing = service.get_item(db, name, item_id)
        service.ensure_item_allowed_for_user(existing, user, name)
        service.ensure_item_allowed_for_user(payload.data, user, name)
        result = service.update_item(db, name, item_id, payload.data, partial=False)
    _legacy_success(db, request, user, name, write=True, resource_id=item_id, old_state=existing, new_state=result)
    return result


@router.patch("/collections/{name}/items/{item_id}")
def patch_item(name: str, item_id: str, payload: ItemPayload, request: Request, db: Session = Depends(get_db), user=Depends(current_user)) -> dict[str, Any]:
    _legacy_gate(db, request, user, name, write=True)
    with _legacy_operation(db, request, user, name, write=True, resource_id=item_id):
        existing = service.get_item(db, name, item_id)
        service.ensure_item_allowed_for_user(existing, user, name)
        merged = {**existing, **payload.data}
        service.ensure_item_allowed_for_user(merged, user, name)
        result = service.update_item(db, name, item_id, payload.data, partial=True)
    _legacy_success(db, request, user, name, write=True, resource_id=item_id, old_state=existing, new_state=result)
    return result


@router.delete("/collections/{name}/items/{item_id}")
def delete_item(name: str, item_id: str, request: Request, db: Session = Depends(get_db), user=Depends(current_user)) -> dict[str, str]:
    _legacy_gate(db, request, user, name, write=True)
    with _legacy_operation(db, request, user, name, write=True, resource_id=item_id):
        existing = service.get_item(db, name, item_id)
        service.ensure_item_allowed_for_user(existing, user, name)
        result = service.delete_item(db, name, item_id)
    _legacy_success(db, request, user, name, write=True, resource_id=item_id, old_state=existing)
    return result


@router.post("/factures/{item_id}/valider")
def valider_facture(item_id: str, db: Session = Depends(get_db), user=Depends(current_user)) -> dict[str, Any]:
    return service.valider_facture(db, item_id, user)


@router.post("/actions/{action}")
def legacy_action(
    action: str,
    payload: LegacyActionPayload,
    db: Session = Depends(get_db),
    user=Depends(current_user),
) -> dict[str, Any]:
    return service.run_legacy_action(db, action, payload, user)
