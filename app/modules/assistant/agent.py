"""Agent IA ATLAS — Phase 1 : lecture seule.

L'agent répond à des questions en langage naturel sur les données réelles de
l'ERP. Il utilise des « outils » LECTURE SEULE (aucune écriture) qui interrogent
la base en respectant toujours les sociétés autorisées de l'utilisateur connecté.
"""
from __future__ import annotations

import json
import logging
from datetime import date, timedelta
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.modules.auth.models import User
from app.modules.drh.models import Candidate, Employee
from app.modules.finance_models import Invoice, Payment
from app.modules.materiel.models import StockArticle
from app.modules.ops.models import Site

logger = logging.getLogger("sgdi.assistant.agent")

MAX_TOOL_ITERATIONS = 6
_LIST_LIMIT = 25

SYSTEM_PROMPT = """Tu es ATLAS, l'assistant IA du système ERP de gestion RH et de gardiennage.
Tu réponds en français, de manière concise et professionnelle, en t'appuyant UNIQUEMENT sur
les données réelles obtenues via tes outils. Tu es en mode LECTURE SEULE : tu ne peux pas
créer, modifier ni supprimer quoi que ce soit — si on te le demande, explique que tu ne fais
que consulter pour l'instant.

Règles :
- Utilise les outils pour obtenir des chiffres exacts ; ne devine jamais un nombre.
- Si un outil ne renvoie rien, dis clairement qu'il n'y a pas de donnée correspondante.
- Tu ne vois que les sociétés autorisées de l'utilisateur ; ne prétends pas connaître les autres.
- Cite les valeurs telles quelles (codes, noms, montants) sans les inventer.
- Reste dans le périmètre RH / gardiennage / matériel / finances de l'ERP."""


# --------------------------------------------------------------------------- #
# Périmètre société
# --------------------------------------------------------------------------- #
def _allowed_societies(user: User) -> list[str]:
    socs = getattr(user, "authorized_societies", None)
    return [s for s in socs if s] if isinstance(socs, list) else []


def _resolve_scope(user: User, society: str | None) -> list[str] | None:
    """Retourne la liste des sociétés à filtrer, ou None = aucune restriction.

    - societe demandée mais non autorisée -> ["__none__"] (ne matche rien).
    - societe demandée et autorisée (ou accès total) -> [societe].
    - pas de societe demandée -> sociétés autorisées (None si accès total)."""
    allowed = _allowed_societies(user)
    if society:
        society = society.strip()
        if allowed and society not in allowed:
            return ["__none__"]
        return [society]
    return allowed or None


def _apply_society(stmt, column, scope: list[str] | None):
    if scope is not None:
        stmt = stmt.where(column.in_(scope))
    return stmt


def _scoped_sites(db: Session, scope: list[str] | None) -> list[Site]:
    sites = db.execute(select(Site)).scalars().all()
    if scope is None:
        return sites
    kept = []
    for site in sites:
        plan = site.equipment_plan if isinstance(site.equipment_plan, dict) else {}
        soc = plan.get("societe") or plan.get("society")
        if not soc or soc in scope:
            kept.append(site)
    return kept


def _fmt_date(value: Any) -> str | None:
    if isinstance(value, date):
        return value.isoformat()
    return str(value) if value else None


# --------------------------------------------------------------------------- #
# Outils (lecture seule)
# --------------------------------------------------------------------------- #
def _tool_dashboard_counts(db: Session, user: User, society: str | None = None) -> dict:
    scope = _resolve_scope(user, society)
    employees = db.execute(_apply_society(select(func.count(Employee.id)), Employee.society, scope)).scalar() or 0
    candidates = db.execute(_apply_society(select(func.count(Candidate.id)), Candidate.society, scope)).scalar() or 0
    articles = db.execute(_apply_society(select(func.count(StockArticle.id)), StockArticle.society, scope)).scalar() or 0
    sites = len(_scoped_sites(db, scope))
    return {
        "employes_total": int(employees),
        "candidats_total": int(candidates),
        "sites_total": int(sites),
        "articles_stock_total": int(articles),
        "perimetre": scope or "toutes sociétés autorisées",
    }


def _tool_search_employees(
    db: Session, user: User, query: str | None = None, status: str | None = None,
    society: str | None = None, limit: int = _LIST_LIMIT,
) -> dict:
    scope = _resolve_scope(user, society)
    stmt = _apply_society(select(Employee), Employee.society, scope)
    if query:
        like = f"%{query.strip()}%"
        stmt = stmt.where(or_(Employee.first_name.ilike(like), Employee.last_name.ilike(like), Employee.code.ilike(like)))
    if status:
        stmt = stmt.where(Employee.status == status.strip())
    stmt = stmt.limit(min(int(limit or _LIST_LIMIT), 50))
    rows = db.execute(stmt).scalars().all()
    return {
        "count": len(rows),
        "employes": [
            {
                "code": e.code, "nom": e.last_name, "prenom": e.first_name,
                "societe": e.society, "statut": e.status, "poste": e.position,
                "fin_contrat": _fmt_date(getattr(e, "contract_end_date", None)),
            }
            for e in rows
        ],
    }


def _tool_employee_detail(db: Session, user: User, reference: str) -> dict:
    scope = _resolve_scope(user, None)
    ref = (reference or "").strip()
    stmt = select(Employee).where(or_(Employee.code == ref, Employee.code.ilike(ref)))
    emp = db.execute(stmt).scalars().first()
    if emp is None and ref.isdigit():
        emp = db.get(Employee, int(ref))
    if emp is None:
        return {"trouve": False, "message": f"Aucun employé pour la référence '{ref}'."}
    if scope is not None and emp.society not in scope:
        return {"trouve": False, "message": "Employé hors de vos sociétés autorisées."}
    return {
        "trouve": True,
        "code": emp.code, "nom": emp.last_name, "prenom": emp.first_name,
        "societe": emp.society, "statut": emp.status, "poste": emp.position,
        "telephone": getattr(emp, "phone", None), "email": getattr(emp, "email", None),
        "commune": getattr(emp, "commune", None), "wilaya": getattr(emp, "wilaya", None),
        "type_contrat": getattr(emp, "contract_type", None),
        "date_recrutement": _fmt_date(getattr(emp, "recruit_date", None)),
        "fin_contrat": _fmt_date(getattr(emp, "contract_end_date", None)),
    }


def _tool_contracts_ending(db: Session, user: User, days: int = 30, society: str | None = None) -> dict:
    scope = _resolve_scope(user, society)
    today = date.today()
    horizon = today + timedelta(days=max(1, min(int(days or 30), 365)))
    stmt = _apply_society(
        select(Employee).where(
            Employee.contract_end_date.isnot(None),
            Employee.contract_end_date >= today,
            Employee.contract_end_date <= horizon,
            Employee.status != "archive",
        ),
        Employee.society, scope,
    ).order_by(Employee.contract_end_date.asc()).limit(50)
    rows = db.execute(stmt).scalars().all()
    return {
        "fenetre_jours": int(days or 30),
        "count": len(rows),
        "contrats": [
            {
                "code": e.code, "nom": e.last_name, "prenom": e.first_name,
                "societe": e.society, "fin_contrat": _fmt_date(e.contract_end_date),
                "jours_restants": (e.contract_end_date - today).days,
            }
            for e in rows
        ],
    }


def _tool_list_sites(db: Session, user: User, society: str | None = None) -> dict:
    scope = _resolve_scope(user, society)
    sites = _scoped_sites(db, scope)[:50]
    return {
        "count": len(sites),
        "sites": [
            {
                "nom": s.name, "indicatif": s.indicatif, "client": s.client_name,
                "commune": s.commune, "wilaya": s.wilaya,
                "effectif_contractuel": s.contractual_staff,
                "actif": bool(s.active),
            }
            for s in sites
        ],
    }


def _tool_stock_summary(db: Session, user: User, society: str | None = None, only_low: bool = False) -> dict:
    scope = _resolve_scope(user, society)
    stmt = _apply_society(select(StockArticle), StockArticle.society, scope)
    articles = db.execute(stmt).scalars().all()
    low = [a for a in articles if (a.min_quantity or 0) > 0 and (a.quantity or 0) <= (a.min_quantity or 0)]
    selected = low if only_low else articles
    selected = sorted(selected, key=lambda a: (a.quantity or 0))[:_LIST_LIMIT]
    return {
        "articles_total": len(articles),
        "articles_sous_seuil": len(low),
        "articles": [
            {
                "code": a.code, "designation": a.designation, "categorie": a.category,
                "societe": a.society, "quantite": a.quantity, "seuil_alerte": a.min_quantity,
                "unite": a.unit,
            }
            for a in selected
        ],
    }


def _tool_finance_summary(db: Session, user: User, society: str | None = None) -> dict:
    scope = _resolve_scope(user, society)
    inv_count = db.execute(_apply_society(select(func.count(Invoice.id)), Invoice.society, scope)).scalar() or 0
    inv_ttc = db.execute(_apply_society(select(func.coalesce(func.sum(Invoice.total_ttc), 0.0)), Invoice.society, scope)).scalar() or 0.0
    paid = db.execute(_apply_society(select(func.coalesce(func.sum(Payment.amount), 0.0)), Payment.society, scope)).scalar() or 0.0
    return {
        "factures_count": int(inv_count),
        "total_facture_ttc": round(float(inv_ttc), 2),
        "total_encaisse": round(float(paid), 2),
        "reste_a_payer_estime": round(float(inv_ttc) - float(paid), 2),
        "perimetre": scope or "toutes sociétés autorisées",
    }


# Schémas d'outils exposés à Claude (lecture seule uniquement)
TOOLS: list[dict[str, Any]] = [
    {
        "name": "dashboard_counts",
        "description": "Compteurs globaux (nombre d'employés, candidats, sites, articles en stock). "
                       "Utilise-le pour les questions de type 'combien de …'.",
        "input_schema": {
            "type": "object",
            "properties": {"society": {"type": "string", "description": "Filtrer sur une société précise (optionnel)"}},
        },
    },
    {
        "name": "search_employees",
        "description": "Recherche d'employés par nom, prénom ou code. Utilise-le pour 'trouve l'agent X', "
                       "'les agents actifs', etc.",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Nom, prénom ou code à rechercher"},
                "status": {"type": "string", "description": "Filtrer par statut (ex. actif)"},
                "society": {"type": "string"},
                "limit": {"type": "integer"},
            },
        },
    },
    {
        "name": "employee_detail",
        "description": "Fiche détaillée d'un employé identifié par son code (ou son id). "
                       "Utilise-le pour 'donne-moi la fiche de …'.",
        "input_schema": {
            "type": "object",
            "properties": {"reference": {"type": "string", "description": "Code employé ou identifiant"}},
            "required": ["reference"],
        },
    },
    {
        "name": "contracts_ending",
        "description": "Contrats employés arrivant à échéance dans les N prochains jours. "
                       "Utilise-le pour 'quels contrats finissent bientôt / ce mois'.",
        "input_schema": {
            "type": "object",
            "properties": {
                "days": {"type": "integer", "description": "Nombre de jours (défaut 30)"},
                "society": {"type": "string"},
            },
        },
    },
    {
        "name": "list_sites",
        "description": "Liste des sites de gardiennage et leur effectif. Utilise-le pour 'liste des sites', "
                       "'sites de la société X'.",
        "input_schema": {
            "type": "object",
            "properties": {"society": {"type": "string"}},
        },
    },
    {
        "name": "stock_summary",
        "description": "État du stock matériel ; option only_low pour ne montrer que les articles sous le seuil "
                       "d'alerte (ruptures). Utilise-le pour 'stock', 'ruptures', 'articles en alerte'.",
        "input_schema": {
            "type": "object",
            "properties": {
                "society": {"type": "string"},
                "only_low": {"type": "boolean", "description": "true = uniquement les articles sous le seuil"},
            },
        },
    },
    {
        "name": "finance_summary",
        "description": "Synthèse financière : total facturé TTC, total encaissé, reste à payer estimé. "
                       "Utilise-le pour 'chiffre d'affaires', 'restes à payer', 'total facturé'.",
        "input_schema": {
            "type": "object",
            "properties": {"society": {"type": "string"}},
        },
    },
]

_DISPATCH = {
    "dashboard_counts": _tool_dashboard_counts,
    "search_employees": _tool_search_employees,
    "employee_detail": _tool_employee_detail,
    "contracts_ending": _tool_contracts_ending,
    "list_sites": _tool_list_sites,
    "stock_summary": _tool_stock_summary,
    "finance_summary": _tool_finance_summary,
}


def _dispatch(name: str, tool_input: dict[str, Any], db: Session, user: User) -> str:
    handler = _DISPATCH.get(name)
    if handler is None:
        return json.dumps({"error": f"Outil inconnu: {name}"}, ensure_ascii=False)
    try:
        result = handler(db, user, **(tool_input or {}))
    except TypeError as exc:
        return json.dumps({"error": f"Paramètres invalides pour {name}: {exc}"}, ensure_ascii=False)
    except Exception as exc:  # pragma: no cover - garde-fou
        logger.warning("Outil %s en échec: %s", name, exc)
        return json.dumps({"error": f"Échec de l'outil {name}."}, ensure_ascii=False)
    return json.dumps(result, ensure_ascii=False, default=str)


# --------------------------------------------------------------------------- #
# Boucle agentique
# --------------------------------------------------------------------------- #
def run_agent(db: Session, user: User, message: str, history: list[dict[str, Any]] | None = None) -> str:
    """Exécute une requête via l'agent Claude en mode lecture seule. Lève en cas d'erreur API."""
    import anthropic

    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    messages: list[dict[str, Any]] = list(history or [])[-10:]
    messages.append({"role": "user", "content": message})

    used_tools: list[str] = []
    response = None
    for _ in range(MAX_TOOL_ITERATIONS):
        response = client.messages.create(
            model=settings.assistant_agent_model,
            max_tokens=2048,
            system=SYSTEM_PROMPT,
            tools=TOOLS,
            messages=messages,
        )
        if response.stop_reason != "tool_use":
            break
        messages.append({"role": "assistant", "content": response.content})
        tool_results = []
        for block in response.content:
            if getattr(block, "type", None) == "tool_use":
                used_tools.append(block.name)
                output = _dispatch(block.name, block.input, db, user)
                tool_results.append({"type": "tool_result", "tool_use_id": block.id, "content": output})
        messages.append({"role": "user", "content": tool_results})

    logger.info(
        "Agent ATLAS user=%s question=%r outils=%s",
        getattr(user, "username", "?"), (message or "")[:160], used_tools,
    )

    if response is None:
        return "Je n'ai pas pu traiter la demande."
    text = "".join(b.text for b in response.content if getattr(b, "type", None) == "text").strip()
    return text or "Je n'ai pas trouvé de réponse à cette question."
