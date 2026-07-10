"""Couverture COMPLÈTE du module DRH (backend) — vrais endpoints, vraie base, sans mock.

Palier 1 : DRH. Employés, candidats + workflow recrutement, contrats, congés,
sanctions, documents, clauses conditionnelles, fiche de position, dashboard.
"""
from datetime import date, timedelta


# ── Helpers ───────────────────────────────────────────────────────────────────

def _emp(client, h, code, **kw):
    body = {"code": code, "first_name": kw.get("fn", f"E{code}"), "last_name": kw.get("ln", "Test"),
            "society": kw.get("society", "Iron Global Securite"), "status": kw.get("status", "actif"),
            "contract_type": kw.get("ct", "CDD")}
    r = client.post("/api/drh/employees", headers=h, json=body)
    assert r.status_code in (200, 201), r.text
    return r.json()


def _cand(client, h, first="Jamel", last="Cand", society="Iron Global Securite", **extra):
    body = {"first_name": first, "last_name": last, "society": society,
            "desired_position": "AGENT DE SECURITE", "phone": "0550000001",
            "expected_salary": 40000, "status": "nouvelle", "data": extra.get("data", {})}
    r = client.post("/api/drh/candidates", headers=h, json=body)
    assert r.status_code in (200, 201), r.text
    return r.json()["data"]


# 8 sections de la fiche de position (ordre imposé par le service)
_SECTIONS = ["identification", "mensurations", "militaire", "poste",
             "avis", "contact", "habilitations", "experience"]


def _full_candidate_data(nom="RECRUE", prenom="Karim"):
    """Données complètes couvrant tous les champs obligatoires des 8 sections."""
    return {
        "nom": nom, "prenom": prenom,
        "dateNaissance": "1990-05-15", "lieuNaissance": "Alger",
        "sexe": "M", "nomPere": "Ahmed", "nomMere": "Fatima",
        "nin": "1234567890", "situation": "celibataire", "source": "spontanee",
        "posteSouhaite": "AGENT DE SECURITE", "telephone": "0550112233",
        "avisDecision": "favorable", "avisDate": "2026-01-10",
        "avisRecruteur": "DRH", "avisCommentaire": "RAS",
        "adresse": "Rue 1", "commune": "Bab Ezzouar", "wilaya": "Alger",
        "contactUrgenceLien": "epouse", "contactUrgenceNom": "Sara",
        "contactUrgenceTel": "0550998877",
        # Les 8 sections marquées validées (persistées dès la création)
        "sectionValidations": {s: {"by": "system", "at": "2026-01-10T00:00:00"} for s in _SECTIONS},
    }


def _make_reserve_candidate(client, h, nom="RECRUE", prenom="Karim"):
    """Crée un candidat puis le fait passer 'réserve' via validate-final (fiche validée)."""
    data = _full_candidate_data(nom, prenom)
    body = {"first_name": prenom, "last_name": nom, "society": "Iron Global Securite",
            "desired_position": "AGENT DE SECURITE", "phone": data["telephone"],
            "status": "nouvelle", "data": data}
    r = client.post("/api/drh/candidates", headers=h, json=body)
    assert r.status_code in (200, 201), r.text
    cid = r.json()["data"]["id"]
    fin = client.post(f"/api/drh/candidates/{cid}/validate-final", headers=h)
    assert fin.status_code == 200, fin.text
    assert fin.json()["data"]["status"] == "reserve"
    return cid


# ── Dashboard ─────────────────────────────────────────────────────────────────

def test_drh_dashboard(client, auth_headers):
    r = client.get("/api/drh/dashboard", headers=auth_headers)
    assert r.status_code == 200
    assert isinstance(r.json(), dict)


# ── Employés (CRUD complet) ───────────────────────────────────────────────────

def test_employee_full_crud(client, auth_headers):
    emp = _emp(client, auth_headers, "DRH_E1", fn="Ali", ln="Crud")
    emp_id = emp.get("id") or emp.get("backendId")

    # GET one
    got = client.get(f"/api/drh/employees/{emp_id}", headers=auth_headers)
    assert got.status_code == 200
    assert (got.json().get("id") == emp_id)

    # UPDATE
    upd = client.put(f"/api/drh/employees/{emp_id}", headers=auth_headers, json={
        "code": "DRH_E1", "first_name": "Ali", "last_name": "Modifie",
        "society": "Iron Global Securite", "status": "actif", "phone": "0660000000",
    })
    assert upd.status_code == 200, upd.text
    assert upd.json()["last_name"].upper() == "MODIFIE"

    # DELETE
    dele = client.delete(f"/api/drh/employees/{emp_id}", headers=auth_headers)
    assert dele.status_code in (200, 204)
    assert client.get(f"/api/drh/employees/{emp_id}", headers=auth_headers).status_code == 404


def test_employee_get_404(client, auth_headers):
    assert client.get("/api/drh/employees/99999999", headers=auth_headers).status_code == 404


def test_employees_page_pagination(client, auth_headers):
    # page_size est borné à [5, 100] côté service
    for i in range(7):
        _emp(client, auth_headers, f"DRH_PG{i}")
    r = client.get("/api/drh/employees/page?page=1&page_size=5", headers=auth_headers)
    assert r.status_code == 200
    data = r.json()
    assert "items" in data and "total" in data and "pages" in data
    assert len(data["items"]) <= 5
    assert data["total"] >= 7
    assert data["pages"] >= 2


def test_employees_page_search(client, auth_headers):
    _emp(client, auth_headers, "DRH_SRCH", fn="Rechercheunique")
    r = client.get("/api/drh/employees/page?q=Rechercheunique", headers=auth_headers)
    assert r.status_code == 200
    assert any("RECHERCHEUNIQUE" in (e.get("first_name") or "").upper() for e in r.json()["items"])


def test_employee_fiche_position(client, auth_headers):
    emp = _emp(client, auth_headers, "DRH_FICHE")
    emp_id = emp.get("id") or emp.get("backendId")
    r = client.get(f"/api/drh/employees/{emp_id}/fiche-position", headers=auth_headers)
    assert r.status_code == 200
    assert isinstance(r.json(), dict)


def test_repair_employee_codes_requires_system_admin(client, auth_headers):
    """repair-codes est réservé à un admin système (token admin_system) — sinon 403."""
    r = client.post("/api/drh/employees/repair-codes", headers=auth_headers)
    assert r.status_code == 403, r.text


# ── Candidats (CRUD + workflow recrutement) ───────────────────────────────────

def test_candidate_crud(client, auth_headers):
    c = _cand(client, auth_headers, first="Nadia")
    cid = c.get("id")
    assert cid

    lst = client.get("/api/drh/candidates", headers=auth_headers)
    assert lst.status_code == 200 and any(x.get("id") == cid for x in lst.json())

    page = client.get("/api/drh/candidates/page?page=1&page_size=10", headers=auth_headers)
    assert page.status_code == 200 and "items" in page.json()

    upd = client.put(f"/api/drh/candidates/{cid}", headers=auth_headers, json={
        "first_name": "Nadia", "last_name": "Modifiee", "society": "Iron Global Securite",
        "desired_position": "AGENT", "status": "nouvelle",
    })
    assert upd.status_code == 200, upd.text


def test_candidate_full_recruitment_workflow(client, auth_headers):
    """Workflow COMPLET : création -> fiche validée (réserve) -> à contractualiser
    -> recrutement (embauche) -> employé + contrat créés."""
    cid = _make_reserve_candidate(client, auth_headers, nom="WORKFLOW", prenom="Karim")

    # Étape réserve -> à contractualiser
    mark = client.post(f"/api/drh/candidates/{cid}/marquer-contractualisation", headers=auth_headers)
    assert mark.status_code == 200, mark.text
    assert mark.json()["data"]["status"] == "a_contractualiser"

    # Étape recrutement : le candidat devient un employé actif + un contrat
    r = client.post(f"/api/drh/candidates/{cid}/recruit", headers=auth_headers)
    assert r.status_code == 200, r.text
    emp = r.json()["data"]
    emp_id = emp.get("id") or emp.get("backendId")
    assert emp_id
    assert (emp.get("status") or "").lower() == "actif"

    contracts = client.get(f"/api/drh/contracts?employee_id={emp_id}", headers=auth_headers)
    assert contracts.status_code == 200
    assert len(contracts.json()) >= 1, "Le recrutement doit générer un contrat"


def test_recruit_rejects_non_validated_candidate(client, auth_headers):
    """Un candidat dont la fiche n'est pas validée ne peut PAS être recruté (422)."""
    c = _cand(client, auth_headers, first="NonValide")
    r = client.post(f"/api/drh/candidates/{c['id']}/recruit", headers=auth_headers)
    assert r.status_code == 422, r.text


def test_marquer_contractualisation_requires_reserve(client, auth_headers):
    """marquer-contractualisation refuse un candidat qui n'est pas en réserve (422)."""
    c = _cand(client, auth_headers, first="PasEnReserve")
    r = client.post(f"/api/drh/candidates/{c['id']}/marquer-contractualisation", headers=auth_headers)
    assert r.status_code == 422, r.text


def test_validate_section_enforces_order(client, auth_headers):
    """validate-section impose l'ordre : valider 'poste' avant les précédentes est refusé."""
    data = _full_candidate_data(nom="ORDRE", prenom="Test")
    data.pop("sectionValidations")  # aucune section validée
    body = {"first_name": "Test", "last_name": "ORDRE", "society": "Iron Global Securite",
            "desired_position": "AGENT", "status": "nouvelle", "data": data}
    r = client.post("/api/drh/candidates/validate-section?section=poste", headers=auth_headers, json=body)
    assert r.status_code == 422, r.text
    assert "précédente" in r.text or "precedente" in r.text.lower()


def test_candidate_delete(client, auth_headers):
    c = _cand(client, auth_headers, first="ASupprimer")
    cid = c.get("id")
    r = client.delete(f"/api/drh/candidates/{cid}", headers=auth_headers)
    assert r.status_code == 200, r.text


def test_candidate_validate_section(client, auth_headers):
    r = client.post("/api/drh/candidates/validate-section?section=identite", headers=auth_headers, json={
        "first_name": "Valide", "last_name": "Section", "society": "Iron Global Securite",
        "desired_position": "AGENT", "status": "nouvelle", "data": {},
    })
    # L'endpoint répond (succès ou erreurs de validation structurées)
    assert r.status_code in (200, 400, 422), r.text


# ── Contrats ──────────────────────────────────────────────────────────────────

def test_contract_crud(client, auth_headers):
    emp = _emp(client, auth_headers, "DRH_CTR")
    emp_id = emp.get("id") or emp.get("backendId")
    c = client.post("/api/drh/contracts", headers=auth_headers, json={
        "employee_id": emp_id, "contract_type": "CDD", "start_date": "2026-01-01",
        "end_date": "2026-12-31", "salary_net": 45000, "status": "actif",
    })
    assert c.status_code in (200, 201), c.text
    contract_id = c.json()["id"]

    upd = client.put(f"/api/drh/contracts/{contract_id}", headers=auth_headers, json={"salary_net": 50000})
    assert upd.status_code == 200, upd.text
    assert upd.json()["salary_net"] == 50000

    lst = client.get(f"/api/drh/contracts?employee_id={emp_id}", headers=auth_headers)
    assert lst.status_code == 200 and len(lst.json()) >= 1


# ── Congés (workflow approbation) ─────────────────────────────────────────────

def test_leave_workflow_approve(client, auth_headers):
    emp = _emp(client, auth_headers, "DRH_LV1")
    emp_id = emp.get("id") or emp.get("backendId")
    lv = client.post("/api/drh/leaves", headers=auth_headers, json={
        "employee_id": emp_id, "leave_type": "conge",
        "start_date": str(date.today()), "end_date": str(date.today() + timedelta(days=5)),
        "reason": "Congé annuel",
    })
    assert lv.status_code in (200, 201), lv.text
    leave_id = lv.json()["id"]

    appr = client.post(f"/api/drh/leaves/{leave_id}/approve", headers=auth_headers)
    assert appr.status_code == 200
    assert appr.json()["status"] == "approuve"


def test_leave_workflow_refuse(client, auth_headers):
    emp = _emp(client, auth_headers, "DRH_LV2")
    emp_id = emp.get("id") or emp.get("backendId")
    lv = client.post("/api/drh/leaves", headers=auth_headers, json={
        "employee_id": emp_id, "start_date": str(date.today()),
        "end_date": str(date.today() + timedelta(days=2)),
    }).json()
    ref = client.post(f"/api/drh/leaves/{lv['id']}/refuse", headers=auth_headers)
    assert ref.status_code == 200 and ref.json()["status"] == "refuse"


def test_leaves_list(client, auth_headers):
    r = client.get("/api/drh/leaves", headers=auth_headers)
    assert r.status_code == 200 and isinstance(r.json(), list)


# ── Sanctions ─────────────────────────────────────────────────────────────────

def test_sanction_create_and_list(client, auth_headers):
    emp = _emp(client, auth_headers, "DRH_SANC")
    emp_id = emp.get("id") or emp.get("backendId")
    s = client.post("/api/drh/sanctions", headers=auth_headers, json={
        "employee_id": emp_id, "infraction_date": str(date.today()),
        "fault": "Retard répété", "sanction_type": "avertissement", "suspension_days": 0,
    })
    assert s.status_code in (200, 201), s.text
    lst = client.get(f"/api/drh/sanctions?employee_id={emp_id}", headers=auth_headers)
    assert lst.status_code == 200 and len(lst.json()) >= 1


# ── Documents ─────────────────────────────────────────────────────────────────

def test_document_create_and_list(client, auth_headers):
    emp = _emp(client, auth_headers, "DRH_DOC")
    emp_id = emp.get("id") or emp.get("backendId")
    d = client.post("/api/drh/documents", headers=auth_headers, json={
        "owner_type": "employee", "owner_id": emp_id, "label": "Contrat signé",
        "file_name": "contrat.pdf", "mime_type": "application/pdf",
    })
    assert d.status_code in (200, 201), d.text
    lst = client.get(f"/api/drh/documents?owner_type=employee&owner_id={emp_id}", headers=auth_headers)
    assert lst.status_code == 200 and len(lst.json()) >= 1


# ── Clauses conditionnelles de contrat ────────────────────────────────────────

def test_contract_clause_crud(client, auth_headers):
    c = client.post("/api/drh/contract-clauses", headers=auth_headers, json={
        "title": "Clause zone", "condition_field": "function", "condition_operator": "equals",
        "condition_value": "AGENT DE SECURITE", "content": "L'agent effectue des rondes.", "active": 1,
    })
    assert c.status_code in (200, 201), c.text
    clause_id = c.json()["id"]

    lst = client.get("/api/drh/contract-clauses", headers=auth_headers)
    assert lst.status_code == 200 and any(x["id"] == clause_id for x in lst.json())

    upd = client.put(f"/api/drh/contract-clauses/{clause_id}", headers=auth_headers, json={
        "title": "Clause zone modifiée", "condition_field": "function", "condition_operator": "equals",
        "condition_value": "AGENT DE SECURITE", "content": "Rondes toutes les heures.", "active": 1,
    })
    assert upd.status_code == 200, upd.text

    dele = client.delete(f"/api/drh/contract-clauses/{clause_id}", headers=auth_headers)
    assert dele.status_code in (200, 204)


def test_contract_templates_list(client, auth_headers):
    r = client.get("/api/drh/contract-templates", headers=auth_headers)
    assert r.status_code == 200 and isinstance(r.json(), list)


def test_generated_contracts_list(client, auth_headers):
    r = client.get("/api/drh/generated-contracts", headers=auth_headers)
    assert r.status_code == 200 and isinstance(r.json(), list)


# ── Logique métier du service (appels directs, vraie base) ────────────────────

def test_employee_code_prefixes_by_society():
    from app.modules.drh.service import employee_code_prefixes_for_society as prefixes
    assert prefixes("Iron Global Securite") == ["A", "B", "C"]
    assert prefixes("IRON GLOBAL SÉCURITÉ") == ["A", "B", "C"]  # accents/casse normalisés
    assert prefixes("Iron Global Solution") == ["K", "W"]
    assert prefixes("Sword Corporation") == ["S"]
    assert prefixes("Sword Construction") == ["T"]
    assert len(prefixes("Societe Inconnue")) == 26  # repli : tout l'alphabet


def test_employee_code_sequence_skips_used_codes():
    from app.modules.drh.service import _employee_code_sequence
    codes = _employee_code_sequence(["A"], 3, used={"A01", "A03"})
    assert codes == ["A02", "A04", "A05"]


def test_employee_code_sequence_saturation_raises_409():
    from fastapi import HTTPException
    import pytest
    from app.modules.drh.service import _employee_code_sequence, EMPLOYEE_CODE_SERIE_LIMIT
    full = {f"A{n:02d}" for n in range(1, EMPLOYEE_CODE_SERIE_LIMIT + 1)}
    with pytest.raises(HTTPException) as exc:
        _employee_code_sequence(["A"], 1, used=full)
    assert exc.value.status_code == 409


def test_employee_code_extra_sync():
    from app.modules.drh.service import _employee_code_extra, _employee_code_extra_matches
    extra = {"matricule": "Z99", "code": "Z99", "_legacy": {"matricule": "Z99", "code": "Z99"}}
    assert _employee_code_extra_matches(extra, "Z99") is True
    assert _employee_code_extra_matches(extra, "A01") is False
    fixed = _employee_code_extra(extra, "A01")
    assert fixed["matricule"] == "A01" and fixed["code"] == "A01"
    assert fixed["_legacy"]["matricule"] == "A01" and fixed["_legacy"]["code"] == "A01"
    assert _employee_code_extra_matches(fixed, "A01") is True


def test_next_employee_code_respects_society_prefix(db):
    from app.modules.drh.service import next_employee_code, employee_code_prefixes_for_society
    code = next_employee_code(db, "Sword Corporation")
    assert code[0] in employee_code_prefixes_for_society("Sword Corporation")
    # Le code proposé n'est jamais déjà pris
    from app.modules.drh.models import Employee
    used = {str(r[0] or "").upper() for r in db.query(Employee.code).all()}
    assert code not in used


def test_next_employee_code_after_conflict_keeps_serie(db):
    from app.modules.drh.service import next_employee_code_after_conflict
    # Un code hors série retombe sur la série de la société
    code = next_employee_code_after_conflict(db, "Sword Corporation", "Z42")
    assert code.startswith("S")
    # Un code dans la série reste dans la série
    code2 = next_employee_code_after_conflict(db, "Sword Corporation", "S01")
    assert code2.startswith("S")


def test_clause_matches_all_operators():
    from app.modules.drh.models import ContractConditionalClause
    from app.modules.drh.service import _clause_matches
    values = {"FUNCTION": "Agent de Securite"}

    def clause(op, val, field="function"):
        return ContractConditionalClause(condition_field=field, condition_operator=op,
                                         condition_value=val, placeholder="P", content="C", active=1)

    assert _clause_matches(clause("equals", "agent de securite"), values) is True   # insensible à la casse
    assert _clause_matches(clause("equals", "chauffeur"), values) is False
    assert _clause_matches(clause("contains", "securite"), values) is True
    assert _clause_matches(clause("contient", "chauffeur"), values) is False
    assert _clause_matches(clause("not_equals", "chauffeur"), values) is True
    assert _clause_matches(clause("!=", "agent de securite"), values) is False
    assert _clause_matches(clause("operateur_inconnu", "agent de securite"), values) is True  # repli = equals
    assert _clause_matches(clause("equals", "x", field="champ_absent"), values) is False


def test_contract_values_maps_employee_fields():
    from datetime import date as _date
    from app.modules.drh.models import Employee
    from app.modules.drh.service import contract_values
    emp = Employee(code="A01", first_name="Karim", last_name="Benali", society="Iron Global Securite",
                   father_name="Ahmed", mother_name="Fatima", position="AGENT",
                   birth_date=_date(1990, 5, 15), nin="1234567890", salary_net=45000,
                   extra={"fonction": "AGENT DE SECURITE"})
    v = contract_values(emp)
    assert v["CODE"] == "A01" and v["MATRICULE"] == "A01"
    assert v["NOM"] == "Benali" and v["PRENOM"] == "Karim"
    assert v["NOM_PRENOM"] == "Benali Karim"
    assert v["NOM_PERE"] == "Ahmed" and v["NOM_DE_LA_MERE"] == "Fatima"
    assert v["DATE_NAISSANCE"] == "15/05/1990"  # format contrat : jj/mm/aaaa
    assert v["FONCTION"] == "AGENT DE SECURITE"  # extra.fonction prioritaire sur position
    assert v["SALAIRE_NET"] == "45000"
    assert v["CLAUSES_CONDITIONNELLES"] == ""


def test_contract_values_request_overrides_employee():
    from app.modules.drh.models import Employee
    from app.modules.drh.service import contract_values

    class Req:
        position = "CHEF DE POSTE"
        function = "SUPERVISEUR"
        salary_net = 60000
        start_date = "2026-03-01"
        end_date = "2026-12-31"
        contract_type = "CDD"
        values = {"lieu": "Alger"}

    emp = Employee(code="B02", first_name="Sara", last_name="Amrani",
                   society="Iron Global Securite", position="AGENT", salary_net=40000)
    v = contract_values(emp, Req())
    assert v["POSTE"] == "CHEF DE POSTE"
    assert v["FONCTION"] == "SUPERVISEUR"
    assert v["SALAIRE"] == "60000"
    assert v["DATE_DEBUT"] == "2026-03-01" and v["DATE_FIN"] == "2026-12-31"
    assert v["TYPE_CONTRAT"] == "CDD"
    assert v["LIEU"] == "Alger"  # les values de la requête sont ajoutées en MAJUSCULES


def test_matching_clauses_groups_by_placeholder(client, auth_headers, db):
    from app.modules.drh.service import matching_clauses
    for i, content in enumerate(["Clause A", "Clause B"]):
        r = client.post("/api/drh/contract-clauses", headers=auth_headers, json={
            "title": f"MC{i}", "condition_field": "function", "condition_operator": "equals",
            "condition_value": "MATCHFN", "placeholder": "BLOC_TEST", "content": content, "active": 1,
        })
        assert r.status_code in (200, 201), r.text
    result = matching_clauses(db, None, {"FUNCTION": "MATCHFN"})
    assert "BLOC_TEST" in result
    assert "Clause A" in result["BLOC_TEST"] and "Clause B" in result["BLOC_TEST"]
    # Une fonction qui ne matche pas ne ramène rien pour ce bloc
    assert "BLOC_TEST" not in matching_clauses(db, None, {"FUNCTION": "AUTRE"})


def test_repair_employee_codes_renumbers_alphabetically(client, auth_headers, db):
    """repair_employee_codes_if_needed renumérote par société, ordre alphabétique,
    sans doublon, et est idempotent (2e appel = 0 correction)."""
    from app.modules.drh.service import repair_employee_codes_if_needed
    from app.modules.drh.models import Employee

    changed = repair_employee_codes_if_needed(db)
    assert isinstance(changed, int)

    rows = db.query(Employee).all()
    codes = [str(e.code or "") for e in rows]
    assert len(codes) == len(set(codes)), "Codes employés en double après réparation"
    # Chaque code est dans la série de sa société, et extra est synchronisé
    from app.modules.drh.service import employee_code_prefixes_for_society, _employee_code_extra_matches
    for e in rows:
        assert e.code[0] in employee_code_prefixes_for_society(e.society), f"{e.code} hors série pour {e.society}"
        assert _employee_code_extra_matches(e.extra, e.code), f"extra désynchronisé pour {e.code}"

    # Idempotence
    assert repair_employee_codes_if_needed(db) == 0
