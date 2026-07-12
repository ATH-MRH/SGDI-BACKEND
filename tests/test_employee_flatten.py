"""Tests du helper d'aplatissement extra._legacy (cause du gonflement 65 Mo/table).

La pièce critique : elle fusionne l'emboîtement récursif SANS perdre aucun champ ni
aucun document. On teste des structures qui imitent la vraie base de production.
"""
from app.modules.irongs.sql_bridge import (
    flatten_employee_extra,
    _employee_doc_has_content,
    _merge_employee_documents,
    employee_to_item,
)
from app.modules.drh.models import Employee


# ── flatten_employee_extra ───────────────────────────────────────────────────

def test_flatten_no_legacy_is_identity_minus_key_order():
    extra = {"nom": "BENALI", "prenom": "Karim", "gestionEvents": [{"id": 1}]}
    out = flatten_employee_extra(extra)
    assert out == {"nom": "BENALI", "prenom": "Karim", "gestionEvents": [{"id": 1}]}
    assert "_legacy" not in out


def test_flatten_removes_nested_legacy():
    extra = {
        "nom": "A", "_legacy": {
            "nom": "A", "prenom": "K", "_legacy": {
                "nom": "A", "prenom": "K", "_legacy": {"nom": "A"}}}}
    out = flatten_employee_extra(extra)
    assert "_legacy" not in out
    assert out["nom"] == "A" and out["prenom"] == "K"


def test_flatten_recent_level_wins_for_scalars():
    # Le niveau le moins profond (le plus récent) doit gagner
    extra = {"poste": "CHEF", "_legacy": {"poste": "AGENT", "_legacy": {"poste": "STAGIAIRE"}}}
    assert flatten_employee_extra(extra)["poste"] == "CHEF"


def test_flatten_keeps_fields_present_only_in_deep_legacy():
    # Un champ qui n'existe QUE dans un niveau profond ne doit pas être perdu
    extra = {"nom": "A", "_legacy": {"nom": "A", "_legacy": {"nom": "A", "matriculeCnas": "X123"}}}
    assert flatten_employee_extra(extra)["matriculeCnas"] == "X123"


def test_flatten_is_idempotent():
    extra = {"poste": "CHEF", "documents": {"CV": {"url": "data:application/pdf;base64,AAA"}},
             "_legacy": {"poste": "AGENT", "documents": {"ActeNaissance": {"url": "data:image/jpeg;base64,BBB"}}}}
    once = flatten_employee_extra(extra)
    twice = flatten_employee_extra(once)
    assert once == twice, "flatten doit être idempotent (rejouer la migration ne change rien)"


def test_flatten_unions_documents_across_levels():
    extra = {
        "documents": {"CV": {"url": "data:application/pdf;base64,NEW"}},
        "_legacy": {
            "documents": {"ActeNaissance": {"url": "data:image/jpeg;base64,ACTE"}},
            "_legacy": {"documents": {"CasierJudiciaire": {"url": "data:application/pdf;base64,CAS"}}}}}
    docs = flatten_employee_extra(extra)["documents"]
    assert set(docs) == {"CV", "ActeNaissance", "CasierJudiciaire"}, "aucun document ne doit être perdu"
    assert docs["CV"]["url"].endswith("NEW")


def test_flatten_recent_document_wins_but_empty_is_replaced_by_content():
    # CV récent VIDE (url absente) doit être remplacé par la version ancienne qui a du contenu
    extra = {
        "documents": {"CV": {"name": "cv.pdf", "status": "reçu"}},  # pas d'url -> vide
        "_legacy": {"documents": {"CV": {"url": "data:application/pdf;base64,REAL", "name": "cv.pdf"}}}}
    docs = flatten_employee_extra(extra)["documents"]
    assert docs["CV"].get("url", "").endswith("REAL"), "un document vide ne doit pas masquer une version pleine"


def test_flatten_recent_document_with_content_wins():
    extra = {
        "documents": {"CV": {"url": "/uploads/docs/cv_new.pdf"}},   # récent, externalisé
        "_legacy": {"documents": {"CV": {"url": "data:application/pdf;base64,OLD"}}}}
    assert flatten_employee_extra(extra)["documents"]["CV"]["url"] == "/uploads/docs/cv_new.pdf"


def test_flatten_handles_non_dict_and_depth_guard():
    assert flatten_employee_extra(None) == {}
    assert flatten_employee_extra("pas un dict") == {}
    assert flatten_employee_extra({}) == {}
    # emboîtement pathologique très profond : ne boucle pas, ne plante pas
    node = {"n": 999}
    for i in range(200):
        node = {"n": i, "_legacy": node}
    out = flatten_employee_extra(node)
    assert "_legacy" not in out and "n" in out


def test_flatten_does_not_mutate_input():
    extra = {"poste": "CHEF", "_legacy": {"poste": "AGENT"}}
    avant = {"poste": "CHEF", "_legacy": {"poste": "AGENT"}}
    flatten_employee_extra(extra)
    assert extra == avant, "flatten ne doit pas modifier l'objet d'entrée"


# ── Fusion des documents ─────────────────────────────────────────────────────

def test_doc_has_content():
    assert _employee_doc_has_content({"url": "data:image/jpeg;base64,X"}) is True
    assert _employee_doc_has_content({"url": "/uploads/docs/x.pdf"}) is True
    assert _employee_doc_has_content({"html": "<p>x</p>"}) is True
    assert _employee_doc_has_content({"name": "cv.pdf", "status": "reçu"}) is False
    assert _employee_doc_has_content({}) is False
    assert _employee_doc_has_content(None) is False


def test_merge_documents_prefers_recent_then_fills_gaps():
    levels = [
        {"documents": {"CV": {"url": "/uploads/docs/cv.pdf"}}},       # récent
        {"documents": {"CV": {"url": "data:...OLD"}, "Acte": {"url": "data:...ACTE"}}},  # ancien
    ]
    out = _merge_employee_documents(levels)
    assert out["CV"]["url"] == "/uploads/docs/cv.pdf"   # récent gagne
    assert out["Acte"]["url"].endswith("ACTE")           # comblé depuis l'ancien


# ── employee_to_item : lecture après aplatissement ───────────────────────────

def test_employee_to_item_flattens_and_keeps_documents():
    row = Employee(
        id=1, code="A01", first_name="Karim", last_name="Benali",
        society="Iron Global Securite", position="AGENT", status="actif",
        extra={
            "fonction": "AGENT",
            "_legacy": {
                "poste": "AGENT",
                "documents": {"CV": {"url": "data:application/pdf;base64,REALCV", "name": "cv.pdf"}},
                "_legacy": {
                    "poste": "STAGIAIRE",
                    "documents": {"ActeNaissance": {"url": "data:image/jpeg;base64,ACTE"}},
                    "_legacy": {"vieuxChamp": "conserve"}}}})
    item = employee_to_item(row)

    # Plus aucune trace d'emboîtement dans le payload
    assert "_legacy" not in item
    # Les documents des différents niveaux sont tous présents et affichables (.url)
    assert item["documents"]["CV"]["url"].endswith("REALCV")
    assert item["documents"]["ActeNaissance"]["url"].endswith("ACTE")
    # Un champ enfoui trois niveaux plus bas survit
    assert item["vieuxChamp"] == "conserve"
    # Les colonnes SQL restent la source de vérité
    assert item["matricule"] == "A01" and item["nom"] == "Benali" and item["statut"] == "actif"


def test_employee_to_item_documents_only_in_deep_legacy_still_display():
    """Régression clé : un employé dont les documents ne sont QUE dans un _legacy profond
    doit quand même recevoir ses documents avec leur .url (sinon affichage cassé)."""
    row = Employee(
        id=2, code="K01", first_name="Sara", last_name="Amrani",
        society="Iron Global Securite", status="actif",
        extra={"fonction": "AGENT", "_legacy": {"_legacy": {"_legacy": {
            "documents": {"CasierJudiciaire": {"url": "data:application/pdf;base64,CASIER"}}}}}})
    item = employee_to_item(row)
    assert item["documents"]["CasierJudiciaire"]["url"].endswith("CASIER"), \
        "Document enfoui perdu : l'affichage serait cassé"


def test_employee_to_item_strips_non_document_base64():
    """Le base64 hors documents (ex. un vieux blob dans un champ quelconque) est bien retiré."""
    gros_blob = "data:image/png;base64," + "A" * 1000
    row = Employee(id=3, code="A02", first_name="X", last_name="Y",
                   society="Iron Global Securite", status="actif",
                   extra={"_legacy": {"scanBrut": gros_blob,
                                      "documents": {"CV": {"url": "data:application/pdf;base64,KEEP"}}}})
    item = employee_to_item(row)
    assert item["scanBrut"] == "", "le base64 hors documents doit être retiré du payload"
    assert item["documents"]["CV"]["url"].endswith("KEEP"), "les documents restent intacts"
