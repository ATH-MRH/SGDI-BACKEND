"""Régression du gonflement de employees.extra (cause des lenteurs de chargement).

Reproduit le VRAI bug de production — l'emboîtement récursif extra._legacy qui
grossissait à chaque sauvegarde — et prouve qu'il ne peut plus se produire. Vérifie
aussi que la migration one-shot réduit sans rien perdre, et qu'elle est idempotente.
"""
import base64
import importlib
import json

import pytest

from app.modules.irongs import sql_bridge
from app.modules.drh.models import Employee


@pytest.fixture()
def uploads(tmp_path, monkeypatch):
    """Répertoire d'upload isolé pour l'externalisation des documents."""
    monkeypatch.setenv("SGDI_UPLOADS_DIR", str(tmp_path))
    import app.core.photo_storage as ps
    importlib.reload(ps)
    # sql_bridge a importé les fonctions au chargement : on les repointe sur le module rechargé
    monkeypatch.setattr(sql_bridge, "externalize_employee_documents", ps.externalize_employee_documents)
    yield tmp_path
    importlib.reload(ps)


def _b64_pdf(tag):
    return "data:application/pdf;base64," + base64.b64encode(f"PDF-{tag}".encode()).decode()


def _size(row):
    return len(json.dumps(row.extra, ensure_ascii=False))


def _legacy_depth(extra):
    d, node = 0, extra
    while isinstance(node, dict) and isinstance(node.get("_legacy"), dict):
        d += 1
        node = node["_legacy"]
    return d


# ── Le cœur : un aller-retour de sauvegarde ne fait plus grossir extra ────────

def test_save_roundtrip_does_not_grow_extra(db, uploads):
    """Simule ce que fait le frontend : lire l'employé (employee_to_item) puis le
    re-sauvegarder (upsert_employee), en boucle. AVANT le correctif, extra doublait à
    chaque tour. APRÈS, il reste stable."""
    # Création initiale avec un document
    sql_bridge.upsert_employee(db, {
        "matricule": "BLOAT01", "nom": "Test", "prenom": "Bloat",
        "societe": "Iron Global Securite", "statut": "actif", "poste": "AGENT",
        "documents": {"CV": {"url": _b64_pdf("cv"), "name": "cv.pdf"}},
    })
    db.flush()
    row = db.execute(sql_bridge.select(Employee).where(Employee.code == "BLOAT01")).scalar_one()

    def un_aller_retour():
        item = sql_bridge.employee_to_item(row)   # lecture (ce que reçoit le frontend)
        sql_bridge.upsert_employee(db, item)       # sauvegarde (ce que renvoie le frontend)
        db.flush()
        return db.execute(sql_bridge.select(Employee).where(Employee.code == "BLOAT01")).scalar_one()

    # 1er aller-retour : l'objet atteint son plein jeu de champs (reconstruits par la lecture)
    row = un_aller_retour()
    taille_stable = _size(row)

    # 8 allers-retours de plus : la taille NE DOIT PLUS bouger (avant le correctif, elle doublait)
    for _ in range(8):
        row = un_aller_retour()

    assert _legacy_depth(row.extra) <= 1, f"emboîtement _legacy revenu : profondeur {_legacy_depth(row.extra)}"
    # tolérance minime pour d'éventuelles variations d'ordre de clés à la sérialisation
    assert _size(row) <= taille_stable + 20, \
        f"extra grossit encore à chaque sauvegarde : {taille_stable} -> {_size(row)} octets"

    # Le document est toujours là et affichable (url externalisée)
    final = sql_bridge.employee_to_item(row)
    assert final["documents"]["CV"]["url"].startswith("/uploads/docs/"), final["documents"]["CV"]
    assert (uploads / "docs").exists()


def test_no_base64_remains_in_stored_extra_after_save(db, uploads):
    sql_bridge.upsert_employee(db, {
        "matricule": "BLOAT02", "nom": "T", "prenom": "B",
        "societe": "Iron Global Securite", "statut": "actif",
        "documents": {"Acte": {"url": _b64_pdf("acte")}},
    })
    db.flush()
    row = db.execute(sql_bridge.select(Employee).where(Employee.code == "BLOAT02")).scalar_one()
    assert ";base64," not in json.dumps(row.extra), "du base64 est resté dans la ligne stockée"


# ── Migration one-shot ───────────────────────────────────────────────────────

def _make_bloated_row(db, code, levels=6):
    """Fabrique une ligne gonflée comme en prod : _legacy emboîté N fois, documents dupliqués."""
    node = {"nom": code, "poste": "AGENT",
            "documents": {"CV": {"url": _b64_pdf("cv"), "name": "cv.pdf"}},
            "champProfond": "valeur_unique"}
    for i in range(levels):
        node = {"nom": code, "poste": "AGENT",
                "documents": {"CV": {"url": _b64_pdf("cv"), "name": "cv.pdf"}},
                "_legacy": node}
    row = Employee(code=code, first_name="X", last_name=code,
                   society="Iron Global Securite", status="actif",
                   extra={"fonction": "AGENT", "_legacy": node})
    db.add(row)
    db.flush()
    return row


def test_migration_shrinks_without_losing_data(db, uploads):
    row = _make_bloated_row(db, "MIG01", levels=6)
    avant = _size(row)

    changed = sql_bridge.shrink_employee_extra(row)
    db.flush()

    assert changed is True
    assert _size(row) < avant, f"la ligne n'a pas rétréci : {avant} -> {_size(row)}"
    assert _legacy_depth(row.extra) <= 1

    # Rien perdu : le document ET le champ enfoui profondément survivent
    item = sql_bridge.employee_to_item(row)
    assert item["documents"]["CV"]["url"].startswith("/uploads/docs/")
    assert item["champProfond"] == "valeur_unique"
    # Le base64 a quitté la base
    assert ";base64," not in json.dumps(row.extra)


def test_migration_is_idempotent(db, uploads):
    row = _make_bloated_row(db, "MIG02", levels=5)
    assert sql_bridge.shrink_employee_extra(row) is True
    db.flush()
    apres_1 = json.dumps(row.extra, sort_keys=True)
    # 2e passage : aucune modification
    assert sql_bridge.shrink_employee_extra(row) is False
    assert json.dumps(row.extra, sort_keys=True) == apres_1


def test_migration_batch_counts(db, uploads):
    for i in range(3):
        _make_bloated_row(db, f"MIGB{i}", levels=4)
    # Un employé déjà propre ne doit pas compter comme modifié
    clean = Employee(code="MIGCLEAN", first_name="C", last_name="Lean",
                     society="Iron Global Securite", status="actif",
                     extra={"fonction": "AGENT", "_legacy": {"nom": "Lean", "poste": "AGENT"}})
    db.add(clean)
    db.flush()

    res = sql_bridge.migrate_flatten_employees(db)
    assert res["changed"] >= 3
    # Rejouer la migration ne change plus rien
    assert sql_bridge.migrate_flatten_employees(db)["changed"] == 0


def test_migration_preserves_document_only_in_deep_legacy(db, uploads):
    """Un document présent UNIQUEMENT dans un niveau profond doit survivre à la migration."""
    node = {"nom": "DEEP", "_legacy": {"nom": "DEEP", "_legacy": {
        "documents": {"Casier": {"url": _b64_pdf("casier")}}}}}
    row = Employee(code="MIGDEEP", first_name="D", last_name="Eep",
                   society="Iron Global Securite", status="actif",
                   extra={"fonction": "AGENT", "_legacy": node})
    db.add(row)
    db.flush()

    sql_bridge.shrink_employee_extra(row)
    db.flush()
    item = sql_bridge.employee_to_item(row)
    assert "Casier" in item["documents"], "document enfoui perdu par la migration"
    assert item["documents"]["Casier"]["url"].startswith("/uploads/docs/")
