from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.modules.auth.dependencies import current_user
from app.modules.auth.models import User
from app.modules.regulatory import service
from app.modules.regulatory.models import RegulatoryChangeProposal, RegulatoryRule, RegulatorySource, RegulatoryVersion
from app.modules.regulatory.schemas import ProposalApprove, ProposalCreate, RuleCreate, SourceCreate, VersionCreate

router = APIRouter(dependencies=[Depends(current_user)])


def _require_admin(user: User) -> None:
    role = str(getattr(user, "role", "") or "").strip().lower()
    if role not in {"admin", "adm", "adm1", "adm2"}:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Réservé à l'administration (référentiel réglementaire transverse)")


def _allowed_societies(user: User) -> list[str]:
    values = user.authorized_societies if isinstance(user.authorized_societies, list) else []
    return [str(v).strip() for v in values if str(v).strip()]


# Revue finale bloquante V2, item 2 (audit de contrat API) — TROUVÉ PENDANT CETTE REVUE,
# préexistant : ce module n'appliquait AUCUN scope société sur ses lectures (list_rules/
# list_proposals/list_versions), alors que /api/regulatory est dans SOCIETY_SCOPED_PREFIXES —
# être "dans le périmètre société" (avoir un scope non-NONE) ne filtrait pas pour autant les
# RÉSULTATS. Un compte restreint à une société pouvait lire les règles/propositions/versions
# d'une AUTRE société (RegulatoryRule.society est nullable — national — ou une société
# précise). RegulatorySource reste volontairement non scopé : ce n'est qu'une référence
# documentaire (nom/texte de loi), jamais liée à une société.
def _rule_society_filter(stmt, allowed: list[str]):
    if not allowed:
        return stmt
    return stmt.where(or_(RegulatoryRule.society.is_(None), RegulatoryRule.society.in_(allowed)))


def _ensure_rule_society_allowed(user: User, rule: RegulatoryRule) -> None:
    allowed = _allowed_societies(user)
    if allowed and rule.society is not None and rule.society not in allowed:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Société non autorisée")


@router.get("/sources")
def list_sources(db: Session = Depends(get_db), user: User = Depends(current_user)):
    rows = db.scalars(select(RegulatorySource).order_by(RegulatorySource.id.desc())).all()
    return [{"id": r.id, "name": r.name, "reference": r.reference, "reliability": r.reliability} for r in rows]


@router.post("/sources")
def create_source(payload: SourceCreate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    _require_admin(user)
    src = service.create_source(db, name=payload.name, reference=payload.reference, reliability=payload.reliability, notes=payload.notes)
    db.commit()
    db.refresh(src)
    return {"id": src.id, "name": src.name, "reliability": src.reliability}


@router.get("/rules")
def list_rules(rule_type: str | None = None, db: Session = Depends(get_db), user: User = Depends(current_user)):
    stmt = select(RegulatoryRule)
    if rule_type:
        stmt = stmt.where(RegulatoryRule.rule_type == rule_type)
    stmt = _rule_society_filter(stmt, _allowed_societies(user))
    rows = db.scalars(stmt.order_by(RegulatoryRule.id.desc())).all()
    return [{"id": r.id, "rule_type": r.rule_type, "society": r.society, "label": r.label} for r in rows]


@router.post("/rules")
def create_rule(payload: RuleCreate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    _require_admin(user)
    rule = service.get_or_create_rule(db, rule_type=payload.rule_type, society=payload.society, label=payload.label)
    db.commit()
    db.refresh(rule)
    return {"id": rule.id, "rule_type": rule.rule_type, "society": rule.society, "label": rule.label}


@router.get("/rules/{rule_id}/versions")
def list_versions(rule_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    rule = db.get(RegulatoryRule, rule_id)
    if not rule:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Règle réglementaire introuvable")
    _ensure_rule_society_allowed(user, rule)
    rows = db.scalars(select(RegulatoryVersion).where(RegulatoryVersion.rule_id == rule_id).order_by(RegulatoryVersion.effective_from.desc())).all()
    return [
        {"id": v.id, "version_number": v.version_number, "parameters": v.parameters, "effective_from": str(v.effective_from),
         "effective_to": str(v.effective_to) if v.effective_to else None, "status": v.status, "source_id": v.source_id}
        for v in rows
    ]


@router.get("/applicable")
def get_applicable(rule_type: str, as_of_date: str, society: str | None = None, allow_unverified: bool = False, db: Session = Depends(get_db), user: User = Depends(current_user)):
    from datetime import date as date_
    try:
        version = service.get_applicable_version(
            db, rule_type=rule_type, society=society, as_of_date=date_.fromisoformat(as_of_date), allow_unverified=allow_unverified,
        )
    except service.NoApplicableRuleError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=str(exc))
    return {"id": version.id, "parameters": version.parameters, "status": version.status, "effective_from": str(version.effective_from)}


@router.post("/proposals")
def create_proposal(payload: ProposalCreate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    proposal = service.propose_change(
        db, rule_id=payload.rule_id, proposed_parameters=payload.proposed_parameters,
        proposed_effective_from=payload.proposed_effective_from, diff_summary=payload.diff_summary,
        source_id=payload.source_id, detected_from=payload.detected_from,
    )
    db.commit()
    db.refresh(proposal)
    return {"id": proposal.id, "status": proposal.status}


@router.get("/proposals")
def list_proposals(status_filter: str | None = None, db: Session = Depends(get_db), user: User = Depends(current_user)):
    stmt = select(RegulatoryChangeProposal)
    if status_filter:
        stmt = stmt.where(RegulatoryChangeProposal.status == status_filter)
    allowed = _allowed_societies(user)
    if allowed:
        # LEFT JOIN : une proposition pas encore liée à une règle (rule_id NULL) reste
        # visible — elle n'expose aucune donnée de société tant qu'elle n'est pas approuvée.
        stmt = stmt.outerjoin(RegulatoryRule, RegulatoryChangeProposal.rule_id == RegulatoryRule.id).where(
            or_(RegulatoryChangeProposal.rule_id.is_(None), RegulatoryRule.society.is_(None), RegulatoryRule.society.in_(allowed))
        )
    rows = db.scalars(stmt.order_by(RegulatoryChangeProposal.id.desc())).all()
    return [{"id": p.id, "rule_id": p.rule_id, "status": p.status, "diff_summary": p.diff_summary, "proposed_effective_from": str(p.proposed_effective_from), "source_id": p.source_id} for p in rows]


@router.post("/proposals/{proposal_id}/approve")
def approve_proposal(proposal_id: int, payload: ProposalApprove, db: Session = Depends(get_db), user: User = Depends(current_user)):
    _require_admin(user)
    proposal = service.approve_proposal(db, proposal_id, reviewed_by=user.username, mark_verified=payload.mark_verified)
    db.commit()
    db.refresh(proposal)
    return {"id": proposal.id, "status": proposal.status, "resulting_version_id": proposal.resulting_version_id}


@router.post("/proposals/{proposal_id}/reject")
def reject_proposal(proposal_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    _require_admin(user)
    proposal = service.reject_proposal(db, proposal_id, reviewed_by=user.username)
    db.commit()
    db.refresh(proposal)
    return {"id": proposal.id, "status": proposal.status}
