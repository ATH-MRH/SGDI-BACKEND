"""API du cockpit alertes — toutes les routes sont authentifiées (Depends
current_user) et scoped (société, et site quand applicable) via les mêmes
primitives que le reste de l'application (app.core.scope_policy). Aucune
nouvelle logique d'autorisation concurrente n'est introduite : ce fichier ne
modifie ni User, ni app/modules/auth/dependencies.py, ni AccessRule.
"""
from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.scope_policy import ScopeKind, SocietyScopeError, effective_society_values, society_scope
from app.db.session import get_db
from app.modules.alerts import repository, service
from app.modules.alerts.lifecycle import InvalidTransitionError
from app.modules.alerts.models import Alert
from app.modules.alerts.schemas import (
    AlertAssignIn,
    AlertDeferIn,
    AlertDetailOut,
    AlertEvidenceOut,
    AlertHistoryOut,
    AlertIgnoreIn,
    AlertOut,
    AlertPage,
    AlertStatsOut,
)
from app.modules.alerts.scoring import score_contract_expiring, score_missing_checkout
from app.modules.alerts.rules import RULE_CONTRACT_EXPIRING, RULE_MISSING_CHECKOUT
from app.modules.auth.dependencies import current_user
from app.modules.auth.models import User

router = APIRouter()


def _can_view_alerts(user: User) -> bool:
    from app.modules.auth.routes import is_admin_role

    if is_admin_role(user.role):
        return True
    role = str(user.role or "").strip().lower()
    if role in {"rh", "drh", "dispatch"}:
        return True
    structures = {str(v or "").strip().lower() for v in (user.authorized_structures or [])}
    if structures & {"drh", "ops", "gestionnaire_rh"}:
        return True
    modules = {str(v or "").strip().lower() for v in (user.authorized_modules or [])}
    return bool(modules & {"drh", "ops"})


def _require_view_access(user: User) -> None:
    if not _can_view_alerts(user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Module alertes non autorisé pour ce compte")


def _allowed_societies(user: User) -> list[str] | None:
    """None = accès société global. Liste (potentiellement vide) = restriction stricte."""
    scope = society_scope(user)
    if scope.kind is ScopeKind.GLOBAL:
        return None
    if scope.kind is ScopeKind.NONE:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Aucun périmètre société explicite")
    from app.core.scope_policy import authorized_society_values

    return authorized_society_values(user)


def _allowed_site_ids(user: User) -> list[int] | None:
    """Même sémantique que app.modules.ops.routes._authorized_site_ids : None/pas
    de restriction par site si la société suffit déjà à scoper l'utilisateur."""
    if society_scope(user).kind is ScopeKind.GLOBAL:
        return None
    values = user.authorized_sites if isinstance(user.authorized_sites, list) else []
    ids = [int(v) for v in values if str(v).strip().lstrip("-").isdigit()]
    return ids or None


@router.get("", response_model=AlertPage)
def list_alerts(
    status_: str | None = Query(None, alias="status"),
    severity: str | None = None,
    module: str | None = Query(None, alias="module"),
    rule_key: str | None = None,
    society: str | None = None,
    site_id: int | None = None,
    assigned_user_id: int | None = None,
    since: datetime | None = None,
    until: datetime | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=5, le=100),
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> AlertPage:
    _require_view_access(user)
    allowed_societies = _allowed_societies(user)
    if society and allowed_societies is not None and society not in allowed_societies:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Société hors périmètre")
    rows, total = repository.list_alerts(
        db,
        allowed_societies=allowed_societies,
        allowed_site_ids=_allowed_site_ids(user),
        status=status_,
        severity=severity,
        module_key=module,
        rule_key=rule_key,
        society=society,
        site_id=site_id,
        assigned_user_id=assigned_user_id,
        since=since,
        until=until,
        limit=page_size,
        offset=(page - 1) * page_size,
    )
    pages = max((total + page_size - 1) // page_size, 1)
    return AlertPage(items=[AlertOut.model_validate(a) for a in rows], total=total, page=page, page_size=page_size, pages=pages)


@router.get("/stats", response_model=AlertStatsOut)
def alerts_stats(db: Session = Depends(get_db), user: User = Depends(current_user)) -> AlertStatsOut:
    _require_view_access(user)
    data = repository.stats(
        db, allowed_societies=_allowed_societies(user), allowed_site_ids=_allowed_site_ids(user), current_user_id=user.id
    )
    return AlertStatsOut(**data)


def _get_scoped_alert(db: Session, alert_id: int, user: User) -> Alert:
    alert = repository.get_alert(db, alert_id, allowed_societies=_allowed_societies(user), allowed_site_ids=_allowed_site_ids(user))
    if not alert:
        raise HTTPException(status_code=404, detail="Alerte introuvable")
    return alert


@router.get("/{alert_id}", response_model=AlertDetailOut)
def get_alert_detail(alert_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)) -> AlertDetailOut:
    _require_view_access(user)
    alert = _get_scoped_alert(db, alert_id, user)
    evidence = repository.list_evidence(db, alert_id)
    history = repository.list_history(db, alert_id)
    factors: list[dict] = []
    explanation = ""
    latest = evidence[0].evidence_value_json if evidence else None
    if isinstance(latest, dict):
        try:
            if alert.rule_key == RULE_CONTRACT_EXPIRING:
                result = score_contract_expiring(days_remaining=int(latest["days_remaining"]), employee_status=str(latest.get("status", "")))
            elif alert.rule_key == RULE_MISSING_CHECKOUT:
                result = score_missing_checkout(elapsed_minutes=int(latest["elapsed_minutes"]), threshold_minutes=int(latest.get("threshold_minutes", 0)) or 1)
            else:
                result = None
            if result is not None:
                factors = [f.__dict__ for f in result.factors]
                explanation = result.explanation
        except (KeyError, ValueError, TypeError):
            factors, explanation = [], ""
    return AlertDetailOut(
        **AlertOut.model_validate(alert).model_dump(),
        evidence=[AlertEvidenceOut.model_validate(e) for e in evidence],
        history=[AlertHistoryOut.model_validate(h) for h in history],
        score_factors=factors,
        explanation=explanation,
    )


@router.post("/{alert_id}/acknowledge", response_model=AlertOut)
def acknowledge_alert(alert_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)) -> AlertOut:
    _require_view_access(user)
    alert = _get_scoped_alert(db, alert_id, user)
    return _apply_action(alert, db, user, action="acknowledge")


@router.post("/{alert_id}/assign", response_model=AlertOut)
def assign_alert(alert_id: int, payload: AlertAssignIn, db: Session = Depends(get_db), user: User = Depends(current_user)) -> AlertOut:
    _require_view_access(user)
    alert = _get_scoped_alert(db, alert_id, user)
    return _apply_action(alert, db, user, action="assign", assigned_user_id=payload.user_id)


@router.post("/{alert_id}/defer", response_model=AlertOut)
def defer_alert(alert_id: int, payload: AlertDeferIn, db: Session = Depends(get_db), user: User = Depends(current_user)) -> AlertOut:
    _require_view_access(user)
    alert = _get_scoped_alert(db, alert_id, user)
    return _apply_action(alert, db, user, action="defer", deferred_until=payload.deferred_until)


@router.post("/{alert_id}/ignore", response_model=AlertOut)
def ignore_alert(alert_id: int, payload: AlertIgnoreIn, db: Session = Depends(get_db), user: User = Depends(current_user)) -> AlertOut:
    _require_view_access(user)
    alert = _get_scoped_alert(db, alert_id, user)
    return _apply_action(alert, db, user, action="ignore", reason=payload.reason)


@router.post("/{alert_id}/treated", response_model=AlertOut)
def treat_alert(alert_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)) -> AlertOut:
    _require_view_access(user)
    alert = _get_scoped_alert(db, alert_id, user)
    return _apply_action(alert, db, user, action="treated")


def _apply_action(alert: Alert, db: Session, user: User, *, action: str, **kwargs) -> AlertOut:
    try:
        updated = service.apply_lifecycle_action(db, alert, action=action, actor_user_id=user.id, **kwargs)
    except InvalidTransitionError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    return AlertOut.model_validate(updated)
