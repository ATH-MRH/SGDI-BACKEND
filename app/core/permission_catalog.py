"""Catalogue canonique du futur moteur de permissions granulaires.

Ce module ne branche aucune règle sur les endpoints existants. Il fournit
uniquement les identifiants stables acceptés par le stockage du lot 0.5-A.
"""

CANONICAL_MODULES: tuple[str, ...] = (
    "administration",
    "drh",
    "recruitment",
    "leaves",
    "ops",
    "attendance",
    "material",
    "commercial",
    "sales",
    "purchases",
    "accounting",
    "finance",
    "reporting",
    "loans",
    "secretariat",
    "cash",
    "employee_portal",
    "client_portal",
    "rounds",
    "assistant",
    "erp_cockpit",
    "legacy",
    "ui",
)

CANONICAL_ACTIONS: tuple[str, ...] = (
    "read",
    "create",
    "update",
    "validate",
    "delete",
    "export",
    "unlock",
    "admin",
    "sign",
    "pay",
    "recruit",
    "execute",
)

CANONICAL_MODULE_SET = frozenset(CANONICAL_MODULES)
CANONICAL_ACTION_SET = frozenset(CANONICAL_ACTIONS)


def is_canonical_module(value: str) -> bool:
    return value in CANONICAL_MODULE_SET


def is_canonical_action(value: str) -> bool:
    return value in CANONICAL_ACTION_SET
