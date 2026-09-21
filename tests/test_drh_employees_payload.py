"""HOTFIX PERFORMANCE — /api/drh/employees = 22,3 Mo GZIP en production (242 employés).

Cause mesurée en direct : Employee.extra contient un emboîtement _legacy._legacy._legacy...
jamais aplati par les lignes non reprises par POST /drh/employees/flatten-extra (migration
manuelle, jamais garantie d'avoir tourné en production) — chaque sauvegarde historique
ré-emballait l'état précédent, dupliquant photo/documents en base64 à chaque niveau.
flatten_employee_extra (déjà testée, idempotente, utilisée par la migration one-shot) est
maintenant appliquée à CHAQUE lecture de /drh/employees, sans perte de données.
"""
import base64

import orjson


def _fake_b64(n_bytes, marker=b"\xff\xd8\xff"):
    return "data:image/jpeg;base64," + base64.b64encode(marker + b"0" * n_bytes).decode()


def _create_deeply_nested_employee(db, code, levels=4, photo_bytes=80_000, doc_bytes=150_000):
    from app.modules.drh.models import Employee

    photo_b64 = _fake_b64(photo_bytes)
    doc_b64 = _fake_b64(doc_bytes)
    nested = {"photo": photo_b64, "documents": {"cin": {"url": doc_b64, "name": "cin.pdf"}}, "fonction": "Agent"}
    for _ in range(levels):
        nested = {"photo": photo_b64, "documents": {"cin": {"url": doc_b64, "name": "cin.pdf"}}, "_legacy": nested}
    emp = Employee(code=code, first_name="E", last_name="Test", society="Iron Global Securite",
                    status="actif", contract_type="CDD", extra={"fonction": "Agent", "_legacy": nested})
    db.add(emp)
    db.commit()
    db.refresh(emp)
    return emp


def test_flatten_dramatically_shrinks_a_historical_unmigrated_row(client, auth_headers, db):
    # Avant le correctif : mesuré en direct à ~1,53 Mo pour CETTE même ligne synthétique
    # (5 niveaux _legacy emboîtés, chacun dupliquant photo ~80 Ko + document ~150 Ko en
    # base64). Le mode complet (sans ?light=1) garde légitimement UNE copie du photo+document
    # les plus récents (~307 Ko mesuré après correctif, aucune perte de champ) — seule la
    # DUPLICATION des 4 niveaux fantômes est éliminée. Seuil : nettement en dessous de l'ancien
    # comportement, avec marge au-dessus du plancher légitime pour ne pas être fragile.
    _create_deeply_nested_employee(db, "BLOAT1")
    r = client.get("/api/drh/employees", headers=auth_headers)
    assert r.status_code == 200
    assert len(r.content) < 500_000, f"réponse encore gonflée (duplication non éliminée ?) : {len(r.content)} octets"
    assert len(r.content) > 200_000, f"le contenu légitime (photo+document restants) semble avoir disparu : {len(r.content)} octets"


def test_light_mode_drops_documents_and_strips_residual_base64(client, auth_headers, db):
    _create_deeply_nested_employee(db, "BLOAT2")
    r = client.get("/api/drh/employees?light=1", headers=auth_headers)
    assert r.status_code == 200
    payload = orjson.loads(r.content)
    row = next(e for e in payload if e["code"] == "BLOAT2")
    legacy = row["extra"]["_legacy"]
    assert "documents" not in legacy, "les documents ne doivent jamais voyager en mode léger"
    # photo n'a jamais été normalisée sur cette ligne synthétique (insertion directe, comme une
    # vraie ligne historique jamais reprise par la migration) : le filet _strip_embedded_base64
    # doit la vider plutôt que transporter le base64 brut.
    assert not str(legacy.get("photo") or "").startswith("data:"), "aucun base64 brut ne doit fuiter en mode léger"


def test_full_mode_keeps_documents_available_on_demand(client, auth_headers, db):
    _create_deeply_nested_employee(db, "BLOAT3")
    r = client.get("/api/drh/employees", headers=auth_headers)  # sans ?light=1 : contrat complet
    assert r.status_code == 200
    payload = orjson.loads(r.content)
    row = next(e for e in payload if e["code"] == "BLOAT3")
    legacy = row["extra"]["_legacy"]
    assert "documents" in legacy and legacy["documents"], "le mode complet ne doit rien retirer silencieusement"


def test_flatten_is_lossless_for_a_normal_not_bloated_employee(client, auth_headers, db):
    from app.modules.drh.models import Employee

    emp = Employee(code="NORM1", first_name="Jean", last_name="Dupont", society="Iron Global Securite",
                    status="actif", contract_type="CDD",
                    extra={"fonction": "Chauffeur", "_legacy": {"nin": "123456789012", "nationalite": "Algérienne"}})
    db.add(emp)
    db.commit()
    r = client.get("/api/drh/employees", headers=auth_headers)
    assert r.status_code == 200
    payload = orjson.loads(r.content)
    row = next(e for e in payload if e["code"] == "NORM1")
    assert row["extra"]["_legacy"]["nin"] == "123456789012"
    assert row["extra"]["_legacy"]["nationalite"] == "Algérienne"
    assert row["extra"]["fonction"] == "Chauffeur"


def test_get_never_mutates_employee_extra_in_database(client, auth_headers, db):
    # CRITIQUE (revue) : un GET ne doit JAMAIS écrire en base. flatten_employee_extra opère
    # uniquement sur la représentation JSON déjà sérialisée (model_dump), jamais sur l'objet
    # ORM ni via une session — vérifié ici en relisant la ligne directement depuis la DB après
    # coup, avec une NOUVELLE session pour exclure tout effet de cache d'identité SQLAlchemy.
    from app.modules.drh.models import Employee
    from app.db.session import SessionLocal

    emp = _create_deeply_nested_employee(db, "NOMUTATE1")
    original_extra_json = orjson.dumps(emp.extra, option=orjson.OPT_SORT_KEYS)

    for suffix in ("", "?light=1"):  # les deux modes doivent être non-mutants
        r = client.get(f"/api/drh/employees{suffix}", headers=auth_headers)
        assert r.status_code == 200

    fresh_session = SessionLocal()
    try:
        reloaded = fresh_session.get(Employee, emp.id)
        reloaded_extra_json = orjson.dumps(reloaded.extra, option=orjson.OPT_SORT_KEYS)
        assert reloaded_extra_json == original_extra_json, (
            "Employee.extra a changé en base après un simple GET — un GET ne doit jamais muter la donnée persistée"
        )
        # Preuve directe que la ligne EN BASE reste non aplatie (le GET ne l'a pas "réparée"
        # silencieusement) : la migration persistante est une décision séparée (§10).
        assert isinstance(reloaded.extra.get("_legacy"), dict) and isinstance(reloaded.extra["_legacy"].get("_legacy"), dict), (
            "la ligne en base doit rester telle quelle : seule sa REPRÉSENTATION servie est aplatie"
        )
    finally:
        fresh_session.close()


def test_light_mode_keeps_bootstrap_identity_and_current_assignment_fields(client, auth_headers, db):
    # §3/§6 de la revue : le mode léger doit conserver tout ce qui est réellement nécessaire
    # au bootstrap (identité, statut, société, poste, jointure d'affectation typée) — retirer
    # UNIQUEMENT documents/base64 lourd.
    _create_deeply_nested_employee(db, "LIGHTKEEP1")
    r = client.get("/api/drh/employees?light=1", headers=auth_headers)
    assert r.status_code == 200
    payload = orjson.loads(r.content)
    row = next(e for e in payload if e["code"] == "LIGHTKEEP1")
    for field in ("code", "first_name", "last_name", "status", "society", "position",
                  "current_assignment_id", "current_site_id", "current_site_name",
                  "current_client_name", "current_group_code", "current_position"):
        assert field in row, f"champ bootstrap manquant en mode léger : {field}"
    assert row["status"] == "actif"
    assert row["society"] == "Iron Global Securite"


def test_current_assignment_still_merges_into_extra_legacy_affectation_courante(client, auth_headers, db):
    # Non-régression explicite : la jointure d'affectation active (déjà en place avant ce
    # correctif) doit survivre à l'aplatissement, léger ou complet.
    from app.modules.drh.models import Employee

    emp = Employee(code="AFF1", first_name="A", last_name="B", society="Iron Global Securite",
                    status="actif", contract_type="CDD",
                    extra={"fonction": "Agent", "_legacy": {"affectationCourante": {"siteName": "Ancien site"}}})
    db.add(emp)
    db.commit()
    for suffix in ("", "?light=1"):
        r = client.get(f"/api/drh/employees{suffix}", headers=auth_headers)
        assert r.status_code == 200
        payload = orjson.loads(r.content)
        row = next(e for e in payload if e["code"] == "AFF1")
        # Aucune affectation active réelle créée dans ce test -> vidée (comportement déjà en
        # place avant ce correctif, non modifié ici).
        assert row["extra"]["_legacy"].get("affectationCourante") == {}
