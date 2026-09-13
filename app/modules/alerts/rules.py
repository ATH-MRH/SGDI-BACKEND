"""Catalogue canonique des règles 0.6-A. Constantes de code — la table
AlertRule est la représentation persistée, seedée (idempotent) à partir de
ces mêmes valeurs par ``ensure_rule_catalog`` (voir repository.py), jamais
par la migration elle-même (voir migrations/versions/20260913_0035_*)."""
from __future__ import annotations

RULE_CONTRACT_EXPIRING = "drh.employee_contract.expiring"
RULE_MISSING_CHECKOUT = "attendance.presence.missing_checkout"

# Seuils v1 figés — voir scoring.py pour leur usage dans le calcul du score.
CONTRACT_EXPIRING_THRESHOLDS_DAYS: tuple[int, ...] = (30, 15, 7, 0)
MISSING_CHECKOUT_THRESHOLD_MINUTES = 12 * 60  # 12h après l'arrivée sans départ ni clôture.

# Statuts employé considérés "pertinents" pour la règle contrat — un employé déjà
# sorti n'a plus de contrat opérationnel à surveiller (même style de filtre que
# app/modules/drh/service.py, ex. ligne 178 : Employee.status.in_(["actif","active"])).
CONTRACT_RELEVANT_EMPLOYEE_STATUSES: frozenset[str] = frozenset({"actif", "active"})

RULE_CATALOG: tuple[dict, ...] = (
    {
        "rule_key": RULE_CONTRACT_EXPIRING,
        "rule_version": 1,
        "label": "Contrat employé arrivant à échéance",
        "description": (
            "Détecte les contrats d'employés actifs dont la date de fin approche ou est "
            "dépassée. Source unique : Employee.contract_end_date (la table Contract reste "
            "historique et ne pilote pas cette règle)."
        ),
        "module_key": "drh",
        "feature_key": None,
        "enabled": True,
        "severity_base": "warning",
        "configuration_json": {
            "thresholds_days": list(CONTRACT_EXPIRING_THRESHOLDS_DAYS),
            "relevant_statuses": sorted(CONTRACT_RELEVANT_EMPLOYEE_STATUSES),
        },
    },
    {
        "rule_key": RULE_MISSING_CHECKOUT,
        "rule_version": 1,
        "label": "Présence sans sortie enregistrée",
        "description": (
            "Détecte les présences avec une arrivée enregistrée mais sans heure de départ "
            "ni clôture, au-delà du seuil configuré."
        ),
        "module_key": "ops",
        "feature_key": None,
        "enabled": True,
        "severity_base": "warning",
        "configuration_json": {
            "threshold_minutes": MISSING_CHECKOUT_THRESHOLD_MINUTES,
        },
    },
)
