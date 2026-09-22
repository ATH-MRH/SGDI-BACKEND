from __future__ import annotations

from datetime import date, datetime
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.regulatory.models import (
    RegulatoryChangeProposal,
    RegulatoryRule,
    RegulatorySource,
    RegulatoryVersion,
)


class NoApplicableRuleError(Exception):
    """Aucune version de la règle ne couvre la date demandée — le moteur de paie/fiscalité
    doit REFUSER de calculer plutôt que de deviner (jamais 'la règle actuelle' par défaut
    pour une période passée)."""


def create_source(db: Session, *, name: str, reference: str | None, reliability: str = "unverified", notes: str | None = None) -> RegulatorySource:
    src = RegulatorySource(name=name, reference=reference, reliability=reliability, notes=notes)
    db.add(src)
    db.flush()
    return src


def get_or_create_rule(db: Session, *, rule_type: str, society: str | None, label: str) -> RegulatoryRule:
    existing = db.scalar(select(RegulatoryRule).where(RegulatoryRule.rule_type == rule_type, RegulatoryRule.society == society))
    if existing:
        return existing
    rule = RegulatoryRule(rule_type=rule_type, society=society, label=label)
    db.add(rule)
    db.flush()
    return rule


def add_version(
    db: Session, *, rule_id: int, parameters: dict, effective_from: date, effective_to: date | None,
    source_id: int | None, status_: str = "unverified",
) -> RegulatoryVersion:
    """Ajoute une version. Ne ferme PAS automatiquement la version précédente qui
    chevaucherait — get_applicable_version() prend la version avec la effective_from la plus
    récente parmi celles qui couvrent la date, donc une nouvelle version à effective_from
    postérieure prend le dessus naturellement sans qu'il faille éditer l'ancienne.

    GARDE P0 (revue d'intégrité) — TROUVÉ PENDANT L'AUDIT : rien n'empêchait auparavant de
    marquer une version "active" (vérifiée) sans RegulatorySource lié — une règle qui produit
    réellement une obligation financière doit être traçable jusqu'à une source identifiable.
    Contrainte également posée au niveau base de données (voir migration 20260922_0044,
    CHECK constraint) — ce garde applicatif est la première ligne de défense, la contrainte
    SQL la seconde (défense en profondeur, en cas d'écriture hors de ce chemin)."""
    if status_ == "active" and source_id is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Une version 'active' (vérifiée) doit être liée à une RegulatorySource identifiable — aucune source fournie",
        )
    rule = db.get(RegulatoryRule, rule_id)
    if not rule:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Règle réglementaire introuvable")
    last = db.scalar(
        select(RegulatoryVersion).where(RegulatoryVersion.rule_id == rule_id).order_by(RegulatoryVersion.version_number.desc())
    )
    version_number = (last.version_number + 1) if last else 1
    version = RegulatoryVersion(
        rule_id=rule_id, version_number=version_number, parameters=parameters,
        effective_from=effective_from, effective_to=effective_to, source_id=source_id, status=status_,
    )
    db.add(version)
    db.flush()
    return version


def get_applicable_version(
    db: Session, *, rule_type: str, society: str | None, as_of_date: date, allow_unverified: bool = False,
) -> RegulatoryVersion:
    """LA fonction que payroll/fiscalité doivent appeler — jamais un accès direct à
    RegulatoryVersion. Cherche société-spécifique d'abord, sinon règle nationale
    (society=None). Refuse (NoApplicableRuleError) si rien ne couvre la date, ou si la seule
    version trouvée est "unverified" et que allow_unverified=False (défaut) — un calcul réel
    ne doit JAMAIS s'appuyer silencieusement sur une donnée non vérifiée."""
    for soc in (society, None) if society else (None,):
        stmt = select(RegulatoryVersion).join(RegulatoryRule).where(
            RegulatoryRule.rule_type == rule_type, RegulatoryRule.society == soc,
            RegulatoryVersion.effective_from <= as_of_date,
        ).where(
            (RegulatoryVersion.effective_to.is_(None)) | (RegulatoryVersion.effective_to > as_of_date)
        ).order_by(RegulatoryVersion.effective_from.desc())
        version = db.scalar(stmt)
        if version:
            if version.status == "unverified" and not allow_unverified:
                raise NoApplicableRuleError(
                    f"Règle '{rule_type}' pour {as_of_date} n'a qu'une version NON VÉRIFIÉE "
                    f"(RegulatoryVersion #{version.id}) — passez allow_unverified=True en connaissance de "
                    f"cause, ou validez la règle avec une source vérifiée avant de calculer une paie réelle."
                )
            return version
    raise NoApplicableRuleError(f"Aucune règle réglementaire '{rule_type}' ne couvre {as_of_date} (société={society})")


# ── Propositions (jamais de modification directe) ──────────────────────────────────────

def propose_change(
    db: Session, *, rule_id: int | None, proposed_parameters: dict, proposed_effective_from: date,
    diff_summary: str | None, source_id: int | None, detected_from: str = "manual",
) -> RegulatoryChangeProposal:
    proposal = RegulatoryChangeProposal(
        rule_id=rule_id, proposed_parameters=proposed_parameters, proposed_effective_from=proposed_effective_from,
        diff_summary=diff_summary, source_id=source_id, detected_from=detected_from, status="proposed",
    )
    db.add(proposal)
    db.flush()
    return proposal


def approve_proposal(db: Session, proposal_id: int, *, reviewed_by: str, mark_verified: bool = False) -> RegulatoryChangeProposal:
    """SEUL chemin qui crée une RegulatoryVersion à partir d'une proposition — Internet ou
    toute veille externe ne PEUT JAMAIS modifier un calcul directement (interdiction
    explicite de la mission)."""
    proposal = db.get(RegulatoryChangeProposal, proposal_id)
    if not proposal:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Proposition introuvable")
    if proposal.status != "proposed":
        raise HTTPException(status.HTTP_409_CONFLICT, detail=f"Proposition déjà {proposal.status}")
    if not proposal.rule_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Proposition sans règle cible — créer la règle d'abord")
    if mark_verified and not proposal.source_id:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Impossible de marquer vérifié sans source réglementaire — renseignez source_id sur la proposition avant d'approuver avec mark_verified=True",
        )
    version = add_version(
        db, rule_id=proposal.rule_id, parameters=proposal.proposed_parameters,
        effective_from=proposal.proposed_effective_from, effective_to=None,
        source_id=proposal.source_id, status_="active" if mark_verified else "unverified",
    )
    proposal.status = "approved"
    proposal.reviewed_by = reviewed_by
    proposal.reviewed_at = datetime.utcnow()
    proposal.resulting_version_id = version.id
    db.flush()
    return proposal


def reject_proposal(db: Session, proposal_id: int, *, reviewed_by: str) -> RegulatoryChangeProposal:
    proposal = db.get(RegulatoryChangeProposal, proposal_id)
    if not proposal:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Proposition introuvable")
    if proposal.status != "proposed":
        raise HTTPException(status.HTTP_409_CONFLICT, detail=f"Proposition déjà {proposal.status}")
    proposal.status = "rejected"
    proposal.reviewed_by = reviewed_by
    proposal.reviewed_at = datetime.utcnow()
    db.flush()
    return proposal
