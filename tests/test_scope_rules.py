"""Garde-fou sur les règles de cloisonnement (irongs).

Le filtrage de périmètre s'applique à TOUTES les collections d'un coup : une
modification faite pour un module peut silencieusement changer le comportement
d'un autre. Ces tests figent les invariants :
  - l'administrateur voit toujours tout, sans filtrage ;
  - la règle « garder les lignes sans société » n'a changé QUE pour la paie ;
  - les lignes globales (sans société) restent visibles là où le métier en dépend.
"""
import re

from app.modules.irongs.service import (
    GLOBAL_ROW_COLLECTIONS,
    SENSITIVE_SOCIETY_COLLECTIONS,
    _keep_unscoped_rows,
)

# Liste des collections sensibles telle qu'elle était AVANT l'ajout de la paie.
# Toute collection hors de cette liste gardait ses lignes non rattachées.
_SENSITIVE_BEFORE_PAIE = {
    "agents", "employees", "sites", "candidats", "candidatsReserve", "candidatsArchives",
    "contrats", "contratsPersonnel", "avenants", "conges", "incidents", "materiel",
    "demandesPersonnel", "demandesStructure", "pointages", "pointageMensuel",
    "feuillePresence", "missions", "siteInspections", "clients", "prospects",
    "opportunites", "visites", "devis", "factures", "paiements", "avances", "avoirs",
    "caisse", "stockArticles", "stockMouvements", "magasins", "fournisseurs",
    "echanges",
}

_PAIE_COLLECTIONS = {"paieBulletins", "paieElements", "paieClotures", "paieGrilles"}

# Témoins non sensibles, représentatifs du reste de l'ERP
_TEMOINS_LIBRES = {
    "notifications", "activityLog", "workflowTasks", "societesConfig",
    "paieConfig", "catalogue", "notes", "courriers",
}


def test_sensitive_list_only_gained_the_paie_collections():
    """Aucune collection existante n'a été retirée ni ajoutée hors paie."""
    assert SENSITIVE_SOCIETY_COLLECTIONS - _SENSITIVE_BEFORE_PAIE == _PAIE_COLLECTIONS
    assert _SENSITIVE_BEFORE_PAIE - SENSITIVE_SOCIETY_COLLECTIONS == set(), \
        "Une collection sensible a été retirée : régression de confidentialité"


def test_global_row_collections_only_cover_paie():
    """GLOBAL_ROW_COLLECTIONS ne peut pas relâcher le filtrage d'un autre module."""
    assert GLOBAL_ROW_COLLECTIONS <= _PAIE_COLLECTIONS


def test_keep_unscoped_rule_unchanged_for_every_non_paie_collection():
    """La règle 'garder les lignes sans société' est identique à l'ancienne partout,
    sauf pour paieBulletins et paieElements (durcissement voulu)."""
    toutes = _SENSITIVE_BEFORE_PAIE | _TEMOINS_LIBRES | _PAIE_COLLECTIONS
    divergences = {
        name for name in toutes
        if (name not in _SENSITIVE_BEFORE_PAIE) != _keep_unscoped_rows(name)
    }
    assert divergences == {"paieBulletins", "paieElements"}, \
        f"Le comportement a changé pour des collections inattendues : {sorted(divergences)}"


def test_keep_unscoped_precise_values():
    # Durci : les lignes de paie non rattachées ne fuitent plus
    assert _keep_unscoped_rows("paieBulletins") is False
    assert _keep_unscoped_rows("paieElements") is False
    # Préservé : les références globales du métier restent visibles
    assert _keep_unscoped_rows("paieGrilles") is True
    assert _keep_unscoped_rows("paieClotures") is True
    # Inchangé : le reste de l'ERP
    assert _keep_unscoped_rows("conges") is False
    assert _keep_unscoped_rows("factures") is False
    assert _keep_unscoped_rows("notifications") is True
    assert _keep_unscoped_rows("activityLog") is True


def test_admin_snapshot_is_never_filtered(client, auth_headers):
    """L'administrateur (périmètre illimité) voit toutes les sociétés, paie comprise."""
    payload = {
        "paieBulletins": [
            {"id": "adm_b_igs", "ym": "2026-03", "societe": "Iron Global Securite"},
            {"id": "adm_b_swd", "ym": "2026-03", "societe": "Sword Corporation"},
        ],
        "paieGrilles": [{"id": "adm_g_global", "fonction": "AGENT"}],
        "paieClotures": [{"id": "adm_c_global", "ym": "2026-03", "societe": ""}],
    }
    assert client.put("/api/irongs/db", headers=auth_headers, json={"data": payload}).status_code == 200

    snap = client.get("/api/irongs/db", headers=auth_headers).json()
    bulletins = {b["id"] for b in (snap.get("paieBulletins") or [])}
    assert {"adm_b_igs", "adm_b_swd"} <= bulletins, "L'admin ne voit plus toutes les sociétés"
    assert any(g["id"] == "adm_g_global" for g in (snap.get("paieGrilles") or []))
    assert any(c["id"] == "adm_c_global" for c in (snap.get("paieClotures") or []))

    # Et sur l'endpoint mono-collection
    coll = client.get("/api/irongs/collections/paieBulletins", headers=auth_headers).json()["data"]
    assert {"adm_b_igs", "adm_b_swd"} <= {b["id"] for b in coll}


def test_admin_can_still_replace_any_collection(client, auth_headers):
    """Le durcissement ne bloque pas l'administrateur."""
    r = client.put("/api/irongs/collections/paieGrilles", headers=auth_headers,
                   json={"data": [{"id": "adm_g_repl", "fonction": "AGENT", "min": 30000}]})
    assert r.status_code == 200, r.text


def test_non_paie_collections_unaffected_for_restricted_user(client, auth_headers, restricted_headers):
    """Témoin : une collection libre (notifications) garde ses lignes sans société."""
    assert client.put("/api/irongs/db", headers=auth_headers, json={"data": {
        "notifications": [{"id": "sc_n1", "message": "sans societe"}],
    }}).status_code == 200

    snap = client.get("/api/irongs/db", headers=restricted_headers).json()
    ids = {n["id"] for n in (snap.get("notifications") or [])}
    assert "sc_n1" in ids, "Une notification sans société a disparu : le filtrage a débordé"
