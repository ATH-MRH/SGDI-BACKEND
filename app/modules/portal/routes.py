import re
import unicodedata
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.modules.irongs import service


router = APIRouter()


def _clean_text(value: Any) -> str:
    return str(value or "").strip()


def _norm_text(value: Any) -> str:
    raw = unicodedata.normalize("NFKD", _clean_text(value))
    raw = "".join(ch for ch in raw if not unicodedata.combining(ch))
    return re.sub(r"\s+", " ", raw).casefold().strip()


def _norm_date(value: Any) -> str:
    raw = _clean_text(value)
    if not raw:
        return ""
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(raw[:10], fmt).date().isoformat()
        except ValueError:
            pass
    return raw[:10]


def _agent_field(agent: dict[str, Any], *keys: str) -> str:
    for key in keys:
        value = agent.get(key)
        if value not in (None, ""):
            return _clean_text(value)
    return ""


def _agent_site(agent: dict[str, Any]) -> str:
    affectation = agent.get("affectationCourante")
    if isinstance(affectation, dict):
        return _agent_field(affectation, "siteName", "site", "nom")
    return _agent_field(agent, "site", "siteName", "affectation")


def _agent_matches_signup(agent: dict[str, Any], payload: dict[str, Any]) -> bool:
    return all(
        (
            _norm_text(_agent_field(agent, "nom")) == _norm_text(payload.get("nom")),
            _norm_text(_agent_field(agent, "prenom", "prénom")) == _norm_text(payload.get("prenom")),
            _norm_text(_agent_field(agent, "matricule", "code")) == _norm_text(payload.get("code")),
            _norm_date(_agent_field(agent, "dateNaissance", "birth_date", "birthDate")) == _norm_date(payload.get("dateNaissance")),
        )
    )


def _to_demande(payload: dict[str, Any]) -> dict[str, Any]:
    ref = _clean_text(payload.get("ref"))
    employee = payload.get("employee") if isinstance(payload.get("employee"), dict) else {}
    details = payload.get("details") if isinstance(payload.get("details"), dict) else {}
    type_label = _clean_text(payload.get("typeLabel") or payload.get("type") or "Demande")
    message = "\n".join(f"{k}: {v}" for k, v in details.items() if v)
    full_name = " ".join(
        part for part in [_clean_text(employee.get("nom")), _clean_text(employee.get("prenom"))] if part
    ).strip()
    return {
        "id": ref or None,
        "ref": ref,
        "date": _clean_text(payload.get("createdAt"))[:10],
        "createdAt": _clean_text(payload.get("createdAt")),
        "createdBy": "portail-rh",
        "agentId": "",
        "agentName": full_name,
        "matricule": _clean_text(employee.get("matricule")),
        "societe": _clean_text(employee.get("societe")),
        "site": _clean_text(employee.get("site")),
        "type": type_label,
        "categorie": type_label,
        "urgence": "normale",
        "objet": type_label,
        "message": message or _clean_text(payload.get("message")),
        "statut": "nouveau",
        "pieces": [],
        "documentsDemandes": [],
        "source": "portail-rh-bilingue",
        "historique": [
            {
                "date": _clean_text(payload.get("createdAt")),
                "user": "portail-rh",
                "action": "Création",
                "note": "Demande envoyée depuis le portail RH mobile",
            }
        ],
        "payloadOriginal": payload,
    }


def _to_pointage(payload: dict[str, Any]) -> dict[str, Any]:
    employee = payload.get("employee") if isinstance(payload.get("employee"), dict) else {}
    ref = _clean_text(payload.get("ref"))
    action = _clean_text(payload.get("action") or "arrivee")
    full_name = " ".join(
        part for part in [_clean_text(employee.get("nom")), _clean_text(employee.get("prenom"))] if part
    ).strip()
    return {
        "id": ref or None,
        "ref": ref,
        "date": _clean_text(payload.get("date")) or _clean_text(payload.get("createdAt"))[:10],
        "heure": _clean_text(payload.get("heure")),
        "createdAt": _clean_text(payload.get("createdAt")),
        "createdBy": "portail-rh",
        "action": action,
        "agentName": full_name,
        "matricule": _clean_text(employee.get("matricule") or employee.get("code")),
        "societe": _clean_text(employee.get("societe")),
        "site": _clean_text(employee.get("site")),
        "statut": "valide",
        "source": "portail-rh-bilingue",
        "position": payload.get("position") if isinstance(payload.get("position"), dict) else {},
        "note": _clean_text(payload.get("note")),
        "payloadOriginal": payload,
    }


@router.post("/validate-employee")
def validate_employee(payload: dict[str, Any], db: Session = Depends(get_db)) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Payload invalide")

    required = ("nom", "prenom", "code", "dateNaissance")
    if any(not _clean_text(payload.get(key)) for key in required):
        raise HTTPException(status_code=400, detail="Nom, prénom, code et date de naissance obligatoires")

    agents = service.list_items(db, "agents")
    for agent in agents:
        if not isinstance(agent, dict) or not _agent_matches_signup(agent, payload):
            continue
        return {
            "verified": True,
            "employee": {
                "id": _agent_field(agent, "id"),
                "nom": _agent_field(agent, "nom"),
                "prenom": _agent_field(agent, "prenom", "prénom"),
                "code": _agent_field(agent, "matricule", "code"),
                "matricule": _agent_field(agent, "matricule", "code"),
                "telephone": _agent_field(agent, "telephone", "tel", "phone"),
                "dateNaissance": _agent_field(agent, "dateNaissance", "birth_date", "birthDate"),
                "photo": _agent_field(agent, "photo", "photoUrl", "avatar"),
                "statut": _agent_field(agent, "statut", "status"),
                "email": _agent_field(agent, "email", "mail"),
                "societe": _agent_field(agent, "societe"),
                "site": _agent_site(agent),
                "poste": _agent_field(agent, "fonction", "poste"),
                "departement": _agent_field(agent, "departement", "service"),
            },
        }

    raise HTTPException(
        status_code=403,
        detail="Aucun employé ne correspond exactement au nom, prénom, code et date de naissance saisis",
    )


@router.post("/demandes", status_code=status.HTTP_201_CREATED)
def create_demande(payload: dict[str, Any], db: Session = Depends(get_db)) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Payload invalide")
    demande = _to_demande(payload)
    if not demande.get("id"):
        demande.pop("id", None)
    return service.create_item(db, "demandesPersonnel", demande)


@router.post("/pointages", status_code=status.HTTP_201_CREATED)
def create_pointage(payload: dict[str, Any], db: Session = Depends(get_db)) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Payload invalide")
    pointage = _to_pointage(payload)
    if not pointage.get("matricule"):
        raise HTTPException(status_code=400, detail="Code employé obligatoire")
    position = pointage.get("position") if isinstance(pointage.get("position"), dict) else {}
    if position.get("lat") in (None, "") or position.get("lng") in (None, ""):
        raise HTTPException(status_code=400, detail="Position GPS obligatoire")
    if not pointage.get("id"):
        pointage.pop("id", None)
    return service.create_item(db, "pointagesPortail", pointage)


@router.get("/pointages/{matricule}")
def list_pointages_personnel(matricule: str, db: Session = Depends(get_db)) -> dict[str, Any]:
    key = _clean_text(matricule).lower()
    if not key:
        raise HTTPException(status_code=400, detail="Code employé obligatoire")
    pointages = service.list_items(db, "pointagesPortail")
    rows = [
        p
        for p in pointages
        if isinstance(p, dict) and _clean_text(p.get("matricule")).lower() == key
    ]
    rows.sort(key=lambda p: _clean_text(p.get("createdAt") or p.get("date")), reverse=True)
    return {"matricule": matricule, "data": rows}


@router.get("/demandes/{matricule}")
def list_demandes_personnel(matricule: str, db: Session = Depends(get_db)) -> dict[str, Any]:
    key = _clean_text(matricule).lower()
    if not key:
        raise HTTPException(status_code=400, detail="Matricule obligatoire")
    demandes = service.list_items(db, "demandesPersonnel")
    rows = [
        d
        for d in demandes
        if isinstance(d, dict) and _clean_text(d.get("matricule")).lower() == key
    ]
    rows.sort(key=lambda d: _clean_text(d.get("updatedAt") or d.get("createdAt") or d.get("date")), reverse=True)
    return {"matricule": matricule, "data": rows}
