import logging
from copy import deepcopy
from datetime import datetime
from typing import Any

from fastapi import HTTPException
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.modules.irongs.models import SgdiRecord
from app.modules.irongs import sql_bridge
from app.core.photo_storage import normalize_photo_fields

logger = logging.getLogger("sgdi.records")
OBJECT_ITEM_ID = "__object__"
ADMIN_ACTION_ROLES = {"admin", "rh", "dispatch", "ADM1", "adm1"}


def _invalid_item_id(value: Any) -> bool:
    return value in (None, "", "None", "none", "null", "undefined")


def _ensure_id(item: dict[str, Any], collection: str, fallback: str | None = None) -> dict[str, Any]:
    if not _invalid_item_id(item.get("id")):
        item["id"] = str(item["id"])
        return item
    prefix = "".join(part[0] for part in collection.split("_"))[:3] or "row"
    item["id"] = fallback or f"{prefix}_{abs(hash(str(item))) % 10_000_000}"
    return item


def _unique_item_id(base: str, used: set[str], position: int) -> str:
    candidate = base if not _invalid_item_id(base) else f"idx-{position:06d}"
    candidate = str(candidate)
    if candidate not in used:
        used.add(candidate)
        return candidate
    candidate = f"{candidate}-{position:06d}"
    while candidate in used:
        candidate = f"{candidate}-x"
    used.add(candidate)
    return candidate


def _row_item_id(collection: str, item: Any, position: int, used: set[str] | None = None) -> str:
    used = used if used is not None else set()
    if isinstance(item, dict):
        item = _ensure_id(dict(item), collection, f"idx-{position:06d}")
        return _unique_item_id(str(item["id"]), used, position)
    return _unique_item_id(f"idx-{position:06d}", used, position)


def _collection_rows(db: Session, name: str) -> list[SgdiRecord]:
    return db.execute(
        select(SgdiRecord)
        .where(SgdiRecord.collection == name)
        .order_by(SgdiRecord.position.asc(), SgdiRecord.id.asc())
    ).scalars().all()


def get_database(db: Session) -> dict[str, list[Any] | dict[str, Any]]:
    rows = db.execute(select(SgdiRecord).order_by(SgdiRecord.collection.asc(), SgdiRecord.position.asc(), SgdiRecord.id.asc())).scalars().all()
    grouped: dict[str, list[SgdiRecord]] = {}
    for row in rows:
        if row.collection in sql_bridge.SQL_COLLECTIONS:
            continue
        grouped.setdefault(row.collection, []).append(row)
    result: dict[str, list[Any] | dict[str, Any]] = {}
    for name, items in grouped.items():
        if len(items) == 1 and items[0].kind == "object" and items[0].item_id == OBJECT_ITEM_ID:
            result[name] = deepcopy(items[0].data) if isinstance(items[0].data, dict) else {}
        else:
            result[name] = [deepcopy(row.data) for row in items if row.kind == "item"]
    for name in sorted(sql_bridge.SQL_COLLECTIONS):
        result[name] = sql_bridge.list_collection(db, name)
    return result


def replace_database(db: Session, payload: dict[str, list[Any] | dict[str, Any]]) -> dict[str, list[Any] | dict[str, Any]]:
    _validate_legacy_database_payload(payload)
    db.execute(delete(SgdiRecord))
    logger.info("Remplacement base SGDI API-first: %s collection(s)", len(payload))
    for name, data in payload.items():
        if name in sql_bridge.SQL_COLLECTIONS:
            if isinstance(data, list) and (data or name not in sql_bridge.SQL_SKIP_EMPTY_ON_DB_REPLACE):
                sql_bridge.replace_collection(db, name, data)
            continue
        _replace_collection_no_commit(db, name, data)
    db.commit()
    logger.info("Base SGDI sauvegardée: tables SQL métier + sgdi_records résiduel")
    return get_database(db)


def get_collection(db: Session, name: str) -> list[Any] | dict[str, Any]:
    if name in sql_bridge.SQL_COLLECTIONS:
        return sql_bridge.list_collection(db, name)
    rows = _collection_rows(db, name)
    if not rows:
        return []
    if len(rows) == 1 and rows[0].kind == "object" and rows[0].item_id == OBJECT_ITEM_ID:
        return deepcopy(rows[0].data) if isinstance(rows[0].data, dict) else {}
    return [deepcopy(row.data) for row in rows if row.kind == "item"]


def _validate_legacy_collection(name: str, data: list[Any] | dict[str, Any] | Any) -> None:
    if name == "prospects" and isinstance(data, list):
        allowed = {"nouveau", "contacte", "interesse", "rdv_planifie", "rdv_realise", "converti", "perdu"}
        for item in data:
            if isinstance(item, dict):
                _validate_status_value(item.get("statut", "nouveau"), allowed)
    if name == "opportunites" and isinstance(data, list):
        allowed = {"nouveau", "qualification", "proposition", "negociation", "gagnee", "perdue"}
        for item in data:
            if isinstance(item, dict):
                _validate_status_value(item.get("etape", "nouveau"), allowed, "Étape")
    if name == "avenants" and isinstance(data, list):
        allowed = {"brouillon", "signe", "annule"}
        for item in data:
            if isinstance(item, dict):
                _validate_status_value(item.get("statut", "brouillon"), allowed)
    if name == "pointages" and isinstance(data, list):
        for item in data:
            if not isinstance(item, dict) or not item.get("valide"):
                continue
            if not item.get("agentId") or not item.get("periode"):
                raise HTTPException(status_code=422, detail="Pointage validé incomplet")
            if item.get("days") is not None and not isinstance(item.get("days"), dict):
                raise HTTPException(status_code=422, detail="Jours de pointage invalides")
    if name == "feuillePresence" and isinstance(data, list):
        for item in data:
            if not isinstance(item, dict) or not item.get("valide"):
                continue
            if not item.get("date") or not item.get("agentId") or not item.get("siteId"):
                raise HTTPException(status_code=422, detail="Ligne de présence validée incomplète")
    if name == "feuillePresenceCloture" and isinstance(data, dict):
        for day, info in data.items():
            if not str(day or "").strip():
                raise HTTPException(status_code=422, detail="Date de clôture invalide")
            if not isinstance(info, dict) or not info.get("by") or not info.get("at"):
                raise HTTPException(status_code=422, detail="Clôture de présence invalide")


def _validate_legacy_database_payload(payload: dict[str, list[Any] | dict[str, Any]]) -> None:
    for name, data in payload.items():
        _validate_legacy_collection(name, data)


def _replace_collection_no_commit(db: Session, name: str, data: list[Any] | dict[str, Any] | Any) -> None:
    _validate_legacy_collection(name, data)
    db.execute(delete(SgdiRecord).where(SgdiRecord.collection == name))
    clean_data = normalize_photo_fields(data, fallback=name)
    if isinstance(clean_data, list):
        used_ids: set[str] = set()
        for idx, item in enumerate(clean_data):
            stored = deepcopy(item)
            if isinstance(stored, dict):
                stored = _ensure_id(stored, name, f"idx-{idx:06d}")
            item_id = _row_item_id(name, stored, idx, used_ids)
            if isinstance(stored, dict):
                stored["id"] = item_id
            db.add(SgdiRecord(collection=name, item_id=item_id, position=idx, kind="item", data=stored, label=str(stored.get("nom") or stored.get("name") or stored.get("code") or "") if isinstance(stored, dict) else str(stored)))
    else:
        db.add(SgdiRecord(collection=name, item_id=OBJECT_ITEM_ID, position=0, kind="object", data=clean_data, label=name))


def replace_collection(db: Session, name: str, data: list[Any] | dict[str, Any]) -> list[Any] | dict[str, Any]:
    if name in sql_bridge.SQL_COLLECTIONS:
        db.execute(delete(SgdiRecord).where(SgdiRecord.collection == name))
        out = sql_bridge.replace_collection(db, name, data)
        db.commit()
        return out
    _replace_collection_no_commit(db, name, data)
    db.commit()
    return get_collection(db, name)


def list_items(db: Session, name: str) -> list[Any]:
    data = get_collection(db, name)
    if isinstance(data, dict):
        raise HTTPException(status_code=400, detail="Cette collection est un objet, pas une liste")
    return data


def create_item(db: Session, name: str, item: dict[str, Any]) -> dict[str, Any]:
    item = normalize_photo_fields(dict(item), fallback=name)
    if name in sql_bridge.SQL_COLLECTIONS:
        db.execute(delete(SgdiRecord).where(SgdiRecord.collection == name))
        out = sql_bridge.upsert_item(db, name, dict(item))
        db.commit()
        return out
    item = _ensure_id(dict(item), name)
    item_id = str(item["id"])
    exists = db.execute(select(SgdiRecord).where(SgdiRecord.collection == name, SgdiRecord.item_id == item_id)).scalar_one_or_none()
    if exists:
        raise HTTPException(status_code=409, detail="Identifiant déjà existant")
    position = len(_collection_rows(db, name))
    db.add(SgdiRecord(collection=name, item_id=item_id, position=position, kind="item", data=item, label=str(item.get("nom") or item.get("name") or item.get("code") or "")))
    db.commit()
    return item


def get_item(db: Session, name: str, item_id: str) -> dict[str, Any]:
    row = db.execute(select(SgdiRecord).where(SgdiRecord.collection == name, SgdiRecord.item_id == item_id)).scalar_one_or_none()
    if not row or not isinstance(row.data, dict):
        raise HTTPException(status_code=404, detail="Élément introuvable")
    return deepcopy(row.data)


def update_item(db: Session, name: str, item_id: str, patch: dict[str, Any], partial: bool = True) -> dict[str, Any]:
    patch = normalize_photo_fields(dict(patch), fallback=item_id)
    if name in sql_bridge.SQL_COLLECTIONS:
        db.execute(delete(SgdiRecord).where(SgdiRecord.collection == name))
        data = dict(patch)
        data.setdefault("id", item_id)
        out = sql_bridge.upsert_item(db, name, data)
        db.commit()
        return out
    row = db.execute(select(SgdiRecord).where(SgdiRecord.collection == name, SgdiRecord.item_id == item_id)).scalar_one_or_none()
    if not row or not isinstance(row.data, dict):
        raise HTTPException(status_code=404, detail="Élément introuvable")
    updated = {**row.data, **patch} if partial else dict(patch)
    updated["id"] = row.data.get("id", item_id)
    row.data = updated
    row.label = str(updated.get("nom") or updated.get("name") or updated.get("code") or "")
    db.commit()
    return deepcopy(updated)


def delete_item(db: Session, name: str, item_id: str) -> dict[str, str]:
    if name in sql_bridge.SQL_COLLECTIONS:
        return sql_bridge.delete_item(db, name, item_id)
    row = db.execute(select(SgdiRecord).where(SgdiRecord.collection == name, SgdiRecord.item_id == item_id)).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Élément introuvable")
    db.delete(row)
    db.commit()
    return {"deleted": item_id}


def _now_iso() -> str:
    return datetime.utcnow().isoformat()


def _actor_name(user: Any | None) -> str:
    return str(getattr(user, "username", "") or getattr(user, "full_name", "") or "system")


def _actor_role(user: Any | None) -> str:
    return str(getattr(user, "role", "") or "")


def _require_admin_action(user: Any | None) -> None:
    if _actor_role(user) not in ADMIN_ACTION_ROLES:
        raise HTTPException(status_code=403, detail="Action réservée RH/Admin/Dispatch")


def _collection_list(db: Session, name: str) -> list[dict[str, Any]]:
    data = get_collection(db, name)
    if not isinstance(data, list):
        raise HTTPException(status_code=400, detail="Collection liste attendue")
    return [dict(item) for item in data if isinstance(item, dict)]


def _collection_object(db: Session, name: str) -> dict[str, Any]:
    data = get_collection(db, name)
    return dict(data) if isinstance(data, dict) else {}


def _find_item(items: list[dict[str, Any]], item_id: str | None) -> dict[str, Any]:
    if _invalid_item_id(item_id):
        raise HTTPException(status_code=422, detail="Identifiant obligatoire")
    for item in items:
        if str(item.get("id")) == str(item_id):
            return item
    raise HTTPException(status_code=404, detail="Élément introuvable")


def _validate_status_value(value: Any, allowed: set[str], label: str = "Statut") -> str:
    clean = str(value or "").strip()
    if clean not in allowed:
        raise HTTPException(status_code=422, detail=f"{label} non autorisé")
    return clean


def _replace_and_success(db: Session, name: str, data: list[Any] | dict[str, Any], payload: dict[str, Any] | None = None) -> dict[str, Any]:
    saved = replace_collection(db, name, data)
    return {"status": "success", "data": payload if payload is not None else saved}


def _validate_pointage_sheet(db: Session, agent_id: str, periode: str, user: Any) -> dict[str, Any]:
    if not agent_id or not periode:
        raise HTTPException(status_code=422, detail="Agent et période obligatoires")
    sheets = _collection_list(db, "pointages")
    sheet = next((row for row in sheets if str(row.get("agentId")) == str(agent_id) and row.get("periode") == periode), None)
    if not sheet:
        sheet = {"id": f"pt_{agent_id}_{periode}", "agentId": agent_id, "periode": periode, "days": {}, "createdAt": _now_iso()}
        sheets.append(sheet)
    sheet["valide"] = True
    sheet["valideBy"] = _actor_name(user)
    sheet["valideAt"] = _now_iso()
    sheet["updatedAt"] = sheet["valideAt"]
    return _replace_and_success(db, "pointages", sheets, {"item": sheet})


def _unlock_pointage_sheet(db: Session, agent_id: str, periode: str, user: Any) -> dict[str, Any]:
    _require_admin_action(user)
    sheets = _collection_list(db, "pointages")
    sheet = next((row for row in sheets if str(row.get("agentId")) == str(agent_id) and row.get("periode") == periode), None)
    if not sheet:
        raise HTTPException(status_code=404, detail="Pointage introuvable")
    sheet["valide"] = False
    sheet["valideBy"] = None
    sheet["valideAt"] = None
    sheet["updatedAt"] = _now_iso()
    return _replace_and_success(db, "pointages", sheets, {"item": sheet})


def _bulk_pointage(db: Session, periode: str, society: str | None, validate: bool, user: Any) -> dict[str, Any]:
    if not periode:
        raise HTTPException(status_code=422, detail="Période obligatoire")
    if not validate:
        _require_admin_action(user)
    agents = [
        row for row in _collection_list(db, "agents")
        if row.get("statut") not in {"sortant", "demissionne", "licencie", "archive"}
        and (not society or row.get("societe") == society)
    ]
    sheets = _collection_list(db, "pointages")
    count = 0
    for agent in agents:
        sheet = next((row for row in sheets if str(row.get("agentId")) == str(agent.get("id")) and row.get("periode") == periode), None)
        if validate and not sheet:
            sheet = {"id": f"pt_{agent.get('id')}_{periode}", "agentId": agent.get("id"), "periode": periode, "societe": agent.get("societe"), "days": {}, "createdAt": _now_iso()}
            sheets.append(sheet)
        if not sheet:
            continue
        if validate and not sheet.get("valide"):
            sheet["valide"] = True
            sheet["valideBy"] = _actor_name(user)
            sheet["valideAt"] = _now_iso()
            sheet["updatedAt"] = sheet["valideAt"]
            count += 1
        elif not validate and sheet.get("valide"):
            sheet["valide"] = False
            sheet["valideBy"] = None
            sheet["valideAt"] = None
            sheet["updatedAt"] = _now_iso()
            count += 1
    return _replace_and_success(db, "pointages", sheets, {"count": count})


def _presence_code(value: Any) -> str:
    clean = str(value or "").strip().upper()
    return clean if clean in {"P", "A", "AB", "M", "S", "C", "R", "CP", "CM", "REC"} else "P"


def _sync_presence_line_to_pointage(db: Session, line: dict[str, Any], validate: bool) -> None:
    date_value = str(line.get("date") or "")
    agent_id = str(line.get("agentId") or "")
    line_id = str(line.get("id") or "")
    if len(date_value) < 10 or not agent_id:
        return
    periode = date_value[:7]
    day = date_value[8:10]
    sheets = _collection_list(db, "pointages")
    sheet = next((row for row in sheets if str(row.get("agentId")) == agent_id and row.get("periode") == periode), None)
    if not sheet:
        sheet = {"id": f"pt_{agent_id}_{periode}", "agentId": agent_id, "periode": periode, "days": {}, "fpqSync": {}, "createdAt": _now_iso()}
        sheets.append(sheet)
    if sheet.get("valide"):
        raise HTTPException(status_code=422, detail="Pointage mensuel déjà validé")
    days = dict(sheet.get("days") or {})
    sync = dict(sheet.get("fpqSync") or {})
    if validate:
        days[day] = _presence_code(line.get("heureArrivee"))
        sync[day] = line_id or True
    elif sync.get(day) == line_id:
        days.pop(day, None)
        sync.pop(day, None)
    sheet["days"] = days
    sheet["fpqSync"] = sync
    sheet["updatedAt"] = _now_iso()
    replace_collection(db, "pointages", sheets)


def _presence_line_action(db: Session, line_id: str, validate: bool, user: Any) -> dict[str, Any]:
    if not validate:
        _require_admin_action(user)
    lines = _collection_list(db, "feuillePresence")
    line = _find_item(lines, line_id)
    closures = _collection_object(db, "feuillePresenceCloture")
    if closures.get(str(line.get("date"))):
        raise HTTPException(status_code=422, detail="Feuille clôturée")
    if validate and not line.get("siteId"):
        raise HTTPException(status_code=422, detail="Site obligatoire avant validation")
    line["valide"] = bool(validate)
    line["valideBy"] = _actor_name(user) if validate else None
    line["valideAt"] = _now_iso() if validate else None
    line["updatedAt"] = _now_iso()
    _sync_presence_line_to_pointage(db, line, validate)
    return _replace_and_success(db, "feuillePresence", lines, {"item": line})


def _presence_line_upsert(db: Session, data: dict[str, Any]) -> dict[str, Any]:
    date_value = str(data.get("date") or "").strip()
    agent_id = str(data.get("agentId") or "").strip()
    if not date_value or not agent_id:
        raise HTTPException(status_code=422, detail="Date et agent obligatoires")
    closures = _collection_object(db, "feuillePresenceCloture")
    if closures.get(date_value):
        raise HTTPException(status_code=422, detail="Feuille clôturée")
    lines = _collection_list(db, "feuillePresence")
    line = next((row for row in lines if str(row.get("date")) == date_value and str(row.get("agentId")) == agent_id), None)
    if line and line.get("valide"):
        raise HTTPException(status_code=422, detail="Ligne validée")
    if not line:
        line = {"id": data.get("id") or f"fpq_{date_value}_{agent_id}", "date": date_value, "agentId": agent_id, "createdAt": _now_iso()}
        lines.append(line)
    patch = dict(data.get("patch") or {})
    patch.pop("valide", None)
    patch.pop("valideBy", None)
    patch.pop("valideAt", None)
    target_agent_id = str(patch.get("agentId") or agent_id)
    if target_agent_id != agent_id and any(str(row.get("date")) == date_value and str(row.get("agentId")) == target_agent_id and str(row.get("id")) != str(line.get("id")) for row in lines):
        raise HTTPException(status_code=409, detail="Cet agent figure déjà sur la feuille")
    line.update(patch)
    line["date"] = date_value
    line["agentId"] = target_agent_id
    line["updatedAt"] = _now_iso()
    return _replace_and_success(db, "feuillePresence", lines, {"item": line})


def _presence_line_delete(db: Session, line_id: str | None, data: dict[str, Any]) -> dict[str, Any]:
    lines = _collection_list(db, "feuillePresence")
    if line_id:
        line = _find_item(lines, line_id)
    else:
        line = next((row for row in lines if str(row.get("date")) == str(data.get("date")) and str(row.get("agentId")) == str(data.get("agentId"))), None)
        if not line:
            raise HTTPException(status_code=404, detail="Ligne introuvable")
    closures = _collection_object(db, "feuillePresenceCloture")
    if closures.get(str(line.get("date"))):
        raise HTTPException(status_code=422, detail="Feuille clôturée")
    if line.get("valide"):
        raise HTTPException(status_code=422, detail="Ligne validée")
    _sync_presence_line_to_pointage(db, line, False)
    lines = [row for row in lines if str(row.get("id")) != str(line.get("id"))]
    return _replace_and_success(db, "feuillePresence", lines, {"deleted": True, "id": line.get("id")})


def _create_legacy_item(db: Session, collection: str | None, data: dict[str, Any], user: Any) -> dict[str, Any]:
    if collection not in {"prospects", "opportunites"}:
        raise HTTPException(status_code=422, detail="Création non autorisée pour cette collection")
    items = _collection_list(db, collection)
    item = dict(data)
    item["id"] = str(item.get("id") or f"{collection[:2]}_{int(datetime.utcnow().timestamp() * 1000)}")
    if any(str(row.get("id")) == item["id"] for row in items):
        raise HTTPException(status_code=409, detail="Identifiant déjà existant")
    item["createdBy"] = item.get("createdBy") or _actor_name(user)
    item["createdAt"] = item.get("createdAt") or _now_iso()
    if collection == "prospects":
        item["statut"] = _validate_status_value(item.get("statut", "nouveau"), {"nouveau", "contacte", "interesse", "rdv_planifie", "rdv_realise", "converti", "perdu"})
        if not str(item.get("nom") or "").strip():
            raise HTTPException(status_code=422, detail="Nom prospect obligatoire")
    if collection == "opportunites":
        item["etape"] = _validate_status_value(item.get("etape", "nouveau"), {"nouveau", "qualification", "proposition", "negociation", "gagnee", "perdue"}, "Étape")
        if not str(item.get("intitule") or "").strip():
            raise HTTPException(status_code=422, detail="Intitulé opportunité obligatoire")
    items.append(item)
    return _replace_and_success(db, collection, items, {"item": item})


def _presence_day_close(db: Session, day: str, close: bool, user: Any, motif: str | None = None) -> dict[str, Any]:
    if not day:
        raise HTTPException(status_code=422, detail="Date obligatoire")
    closures = _collection_object(db, "feuillePresenceCloture")
    if close:
        if closures.get(day):
            raise HTTPException(status_code=422, detail="Feuille déjà clôturée")
        lines = [row for row in _collection_list(db, "feuillePresence") if row.get("date") == day]
        closures[day] = {"by": _actor_name(user), "at": _now_iso(), "count": len(lines)}
    else:
        _require_admin_action(user)
        if not closures.get(day):
            raise HTTPException(status_code=422, detail="Feuille non clôturée")
        if not str(motif or "").strip():
            raise HTTPException(status_code=422, detail="Motif obligatoire")
        previous = closures.pop(day)
        logs = _collection_list(db, "feuillePresenceClotureLog")
        logs.append({"id": f"decloture_{day}_{int(datetime.utcnow().timestamp())}", "date": day, "action": "decloture", "by": _actor_name(user), "at": _now_iso(), "motif": str(motif).strip(), "previous": previous})
        replace_collection(db, "feuillePresenceClotureLog", logs)
    return _replace_and_success(db, "feuillePresenceCloture", closures, {"date": day, "closed": close})


def run_legacy_action(db: Session, action: str, payload: Any, user: Any | None = None) -> dict[str, Any]:
    data = dict(getattr(payload, "data", {}) or {})
    collection = getattr(payload, "collection", None)
    item_id = getattr(payload, "item_id", None)

    if action == "set-status":
        allowed_by_collection = {
            "prospects": {"nouveau", "contacte", "interesse", "rdv_planifie", "rdv_realise", "converti", "perdu"},
            "opportunites": {"nouveau", "qualification", "proposition", "negociation", "gagnee", "perdue"},
            "avenants": {"brouillon", "signe", "annule"},
            "clients": {"actif", "prospect", "inactif"},
        }
        if collection not in allowed_by_collection:
            raise HTTPException(status_code=422, detail="Collection non autorisée pour changement de statut")
        items = _collection_list(db, collection)
        item = _find_item(items, item_id)
        target = _validate_status_value(data.get("status") or data.get("statut") or data.get("etape"), allowed_by_collection[collection])
        field = "etape" if collection == "opportunites" else "statut"
        item[field] = target
        item["updatedAt"] = _now_iso()
        return _replace_and_success(db, collection, items, {"item": item})

    if action == "delete-item":
        if collection not in {"prospects", "opportunites", "avenants"}:
            raise HTTPException(status_code=422, detail="Suppression non autorisée pour cette collection")
        items = _collection_list(db, collection)
        _find_item(items, item_id)
        items = [row for row in items if str(row.get("id")) != str(item_id)]
        return _replace_and_success(db, collection, items, {"deleted": True, "id": item_id})

    if action == "convert-prospect":
        prospects = _collection_list(db, "prospects")
        clients = _collection_list(db, "clients")
        prospect = _find_item(prospects, item_id)
        if prospect.get("statut") == "converti":
            raise HTTPException(status_code=422, detail="Prospect déjà converti")
        client = {
            "id": data.get("clientId") or f"cl_{item_id}",
            "nom": prospect.get("nom"),
            "raisonSociale": prospect.get("nom"),
            "nif": "",
            "rc": "",
            "contact": prospect.get("contact", ""),
            "fonction": prospect.get("fonction", ""),
            "tel": prospect.get("tel", ""),
            "email": prospect.get("email", ""),
            "adresse": prospect.get("adresse", ""),
            "societe": prospect.get("societe"),
            "structure": "",
            "statut": "actif",
            "notes": prospect.get("notes", ""),
            "prospectId": prospect.get("id"),
            "createdAt": _now_iso(),
            "createdBy": _actor_name(user),
        }
        clients.append(client)
        prospect["statut"] = "converti"
        prospect["updatedAt"] = _now_iso()
        replace_collection(db, "clients", clients)
        replace_collection(db, "prospects", prospects)
        return {"status": "success", "data": {"client": client, "prospect": prospect}}

    if action == "create-item":
        return _create_legacy_item(db, collection, data, user)

    if action == "validate-pointage":
        return _validate_pointage_sheet(db, str(data.get("agentId") or ""), str(data.get("periode") or ""), user)
    if action == "unlock-pointage":
        return _unlock_pointage_sheet(db, str(data.get("agentId") or ""), str(data.get("periode") or ""), user)
    if action == "validate-pointage-all":
        return _bulk_pointage(db, str(data.get("periode") or ""), data.get("societe") or None, True, user)
    if action == "unlock-pointage-all":
        return _bulk_pointage(db, str(data.get("periode") or ""), data.get("societe") or None, False, user)
    if action == "validate-presence-line":
        return _presence_line_action(db, str(item_id or data.get("id") or ""), True, user)
    if action == "unlock-presence-line":
        return _presence_line_action(db, str(item_id or data.get("id") or ""), False, user)
    if action == "close-presence-day":
        return _presence_day_close(db, str(data.get("date") or ""), True, user)
    if action == "reopen-presence-day":
        return _presence_day_close(db, str(data.get("date") or ""), False, user, data.get("motif"))
    if action == "upsert-presence-line":
        return _presence_line_upsert(db, data)
    if action == "delete-presence-line":
        return _presence_line_delete(db, item_id, data)
    if action == "save-presence-movement":
        return _presence_line_upsert(db, data)
    if action == "add-presence-agent":
        return _presence_line_upsert(db, {"date": data.get("date"), "agentId": data.get("agentId"), "patch": data.get("patch") or {}})
    if action == "assign-vacant-agent":
        return _presence_line_upsert(db, data)

    raise HTTPException(status_code=422, detail="Action métier inconnue")


def cleanup_base64_photos(db: Session) -> int:
    changed = 0
    rows = db.execute(select(SgdiRecord)).scalars().all()
    for row in rows:
        cleaned = normalize_photo_fields(row.data, fallback=f"{row.collection}_{row.item_id}")
        if cleaned != row.data:
            row.data = cleaned
            changed += 1
    if changed:
        db.commit()
        logger.info("Photos Base64 nettoyees dans sgdi_records: %s ligne(s)", changed)
    return changed
