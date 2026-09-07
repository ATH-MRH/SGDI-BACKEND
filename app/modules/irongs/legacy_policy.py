from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class LegacyAccess(str, Enum):
    READ_ALLOWED = "READ_ALLOWED"
    WRITE_ALLOWED = "WRITE_ALLOWED"
    ADMIN_ONLY = "ADMIN_ONLY"
    DISABLED = "DISABLED"


@dataclass(frozen=True)
class LegacyCollectionPolicy:
    read: LegacyAccess
    write: LegacyAccess
    modules: frozenset[str]


_SQL = {
    "candidats", "agents", "employees", "sites", "assignments", "affectations", "feuillePresence",
    "clients", "magasins", "fournisseurs", "stockArticles", "stockMouvements", "factures", "paiements",
    "avances", "avoirs", "caisse", "opsMouvements", "incidents", "contrats",
}
_LEGACY = {
    "agendaEvents", "alertes", "avenants", "calTaches", "catalogue", "categoriesPrest", "conges",
    "contratsPersonnel", "customFields", "customModules", "customRecords", "demandesPersonnel",
    "demandesStructure", "devis", "dialogue", "documentTemplates", "echanges", "feuillePresenceArchive",
    "feuillePresenceCloture", "joursFeries", "magasinArticles", "materiel", "messages", "missionBillables",
    "missionExpenseRequests", "missions", "niveauxAcces", "notificationLog", "opportunites", "paieBulletins",
    "paieClotures", "paieConfig", "paieElements", "paieGrilles", "paieRubriques", "parametres", "pointages",
    "pointageMensuel", "priorites", "prospects", "secretariatArchives", "secretariatCourriers",
    "secretariatDecisions", "secretariatNotes", "secretariatReunions", "settings", "siteInspections",
    "societesConfig", "stockMotifsEntree", "stockMotifsSortie", "structures", "supervisorScopes", "themes",
    "visites", "workflowTasks", "notifications",
}
_ADMIN = {"droitsAcces", "users", "deletedDocumentTemplateCodes", "activityLog", "portalAccounts"}

_RH = {
    "candidats", "agents", "employees", "contrats", "contratsPersonnel", "avenants", "conges",
    "demandesPersonnel", "demandesStructure",
}
_OPS = {
    "sites", "assignments", "affectations", "feuillePresence", "feuillePresenceArchive",
    "feuillePresenceCloture", "incidents", "opsMouvements", "pointages", "pointageMensuel",
    "missions", "siteInspections", "supervisorScopes",
}
_FINANCE = {
    "factures", "paiements", "avances", "avoirs", "caisse", "missionBillables",
    "missionExpenseRequests", "paieBulletins", "paieClotures", "paieConfig", "paieElements",
    "paieGrilles", "paieRubriques",
}
_COMMERCIAL = {"clients", "prospects", "opportunites", "visites", "devis", "catalogue", "categoriesPrest"}
_MATERIEL = {
    "magasins", "fournisseurs", "stockArticles", "stockMouvements", "magasinArticles", "materiel",
    "stockMotifsEntree", "stockMotifsSortie",
}
_SECRETARIAT = {
    "agendaEvents", "calTaches", "messages", "notifications", "notificationLog", "dialogue", "echanges",
    "secretariatArchives", "secretariatCourriers", "secretariatDecisions", "secretariatNotes",
    "secretariatReunions", "joursFeries", "workflowTasks", "alertes",
}


def _collection_modules(name: str) -> frozenset[str]:
    if name in {"alertes", "dialogue", "echanges", "messages", "notificationLog", "notifications"}:
        return frozenset({"rh", "ops", "finance", "commercial", "materiel", "secretariat"})
    modules: set[str] = set()
    for module, names in (
        ("rh", _RH), ("ops", _OPS), ("finance", _FINANCE), ("commercial", _COMMERCIAL),
        ("materiel", _MATERIEL), ("secretariat", _SECRETARIAT),
    ):
        if name in names:
            modules.add(module)
    # Référentiels et paramétrages non rattachés : administration uniquement.
    return frozenset(modules or {"admin"})


def collection_policy(name: str) -> LegacyCollectionPolicy:
    if name in _SQL or name in _LEGACY:
        return LegacyCollectionPolicy(LegacyAccess.READ_ALLOWED, LegacyAccess.WRITE_ALLOWED, _collection_modules(name))
    if name in _ADMIN:
        return LegacyCollectionPolicy(LegacyAccess.ADMIN_ONLY, LegacyAccess.ADMIN_ONLY, frozenset({"admin"}))
    return LegacyCollectionPolicy(LegacyAccess.DISABLED, LegacyAccess.DISABLED, frozenset())


def user_legacy_modules(user) -> frozenset[str]:
    values = {
        str(value or "").strip().lower()
        for source in (getattr(user, "authorized_modules", None), getattr(user, "authorized_structures", None))
        for value in (source or []) if str(value or "").strip()
    }
    role = str(getattr(user, "role", "") or "").strip().lower()
    aliases = {
        "drh": "rh", "recruteur": "rh", "gestionnaire_rh": "rh",
        "dispatch": "ops", "superviseur": "ops", "supervisor": "ops", "pointeur": "ops",
        "fac": "finance", "facturation": "finance", "finances": "finance", "compta": "finance",
        "dc": "commercial", "achats": "materiel", "stock": "materiel",
        "sg": "secretariat", "secretariat_general": "secretariat",
    }
    values.add(aliases.get(role, role))
    values.update(aliases.get(value, value) for value in tuple(values))
    if role in {"admin", "adm", "adm1", "adm2"}:
        values.add("admin")
    return frozenset(values)


def user_can_read_collection(user, name: str) -> bool:
    policy = collection_policy(name)
    role = str(getattr(user, "role", "") or "").strip().lower()
    admin = role in {"admin", "adm", "adm1", "adm2"}
    if policy.read is LegacyAccess.DISABLED:
        return False
    if policy.read is LegacyAccess.ADMIN_ONLY:
        return admin
    return admin or bool(policy.modules & user_legacy_modules(user))
