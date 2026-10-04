"""BEO multi-sociétés / multi-sites — périmètre explicite, zéro fuite, zéro héritage implicite.

Société A : sites A1, A2 ; société B : site B1 ; société C : site C1.
CE01 = sociétés A + B, sites A1 + A2 + B1. C1 (et son employé) ne doit jamais être visible ni
modifiable, par aucun domaine BEO, quel que soit le filtre ou l'identifiant forgé.
"""
import base64
import uuid
from datetime import date, timedelta

import pytest
from sqlalchemy import event, func, select

from app.core.security import hash_password
from app.modules.auth.models import User
from app.modules.drh.models import Document, Employee, Leave
from app.modules.ops.models import Assignment, DailyPresence, Incident, Site
from app.modules.site_workforce.models import Reclamation, SiteNotification, Transmission
from tests.module_cleanup import purge_rows_created_by_this_module  # noqa: F401 (fixture autouse)

PDF = "data:application/pdf;base64," + base64.b64encode(b"%PDF-1.4 test").decode()
ACTIONS = ["read", "create", "update", "validate"]


def _tag():
    return uuid.uuid4().hex[:6]


@pytest.fixture()
def world(client, db):
    t = _tag()
    socs = {k: f"Soc{k} {t}" for k in "ABC"}
    sites = {}
    for key, soc in (("A1", "A"), ("A2", "A"), ("B1", "B"), ("C1", "C")):
        sites[key] = Site(name=f"{key} {t}", active=1, equipment_plan={"societe": socs[soc]})
    db.add_all(sites.values()); db.flush()
    emps = {}
    for key, site in sites.items():
        emp = Employee(code=f"MS{key}{t}", first_name=key, last_name=f"Agent{t}", society=socs[key[0]], status="actif")
        db.add(emp); db.flush()
        db.add(Assignment(employee_id=emp.id, site_id=site.id, group_code="A", start_date=date.today() - timedelta(days=30), active=1))
        emps[key] = emp
    db.commit()

    def account(name, societies, site_keys):
        u = User(username=f"{name}_{t}".upper(), full_name=name, role="charge_effectifs_site", access_level="H2",
                 authorized_societies=[socs[s] for s in societies], authorized_structures=[], authorized_modules=["site_workforce"],
                 authorized_sites=[sites[k].id for k in site_keys], authorized_actions=ACTIONS,
                 password_hash=hash_password("ce01password"), is_active=True)
        db.add(u); db.commit()
        token = client.post("/api/auth/login", json={"username": u.username, "password": "ce01password"}).json()["access_token"]
        return {"Authorization": f"Bearer {token}"}

    # Données du site C1 (hors périmètre) créées par un compte C légitime, via l'API réelle.
    ce_c = account("cec", "C", ["C1"])
    today = str(date.today())
    c_presence = client.post("/api/site-workforce/attendance", headers=ce_c, json={"employee_id": emps["C1"].id, "presence_date": today, "status": "absent"}).json()["id"]
    c_leave = client.post("/api/site-workforce/leaves", headers=ce_c, json={"employee_id": emps["C1"].id, "leave_type": "maladie", "start_date": today, "end_date": today}).json()["id"]
    c_incident = client.post("/api/site-workforce/discipline", headers=ce_c, json={"employee_id": emps["C1"].id, "event_type": "retard", "subject": "C1 incident"}).json()["id"]
    c_reclamation = client.post("/api/site-workforce/reclamations", headers=ce_c, json={"employee_id": emps["C1"].id, "subject": "C1 réclamation", "description": "x"}).json()["id"]
    c_document = client.post("/api/site-workforce/documents", headers=ce_c, json={"owner_type": "leave", "owner_id": c_leave, "label": "C1 certificat", "data_url": PDF}).json()["id"]
    c_notification = db.execute(select(SiteNotification.id).where(SiteNotification.site_id == sites["C1"].id)).scalars().first()
    return {
        "t": t, "socs": socs, "sites": {k: v.id for k, v in sites.items()}, "emps": {k: v.id for k, v in emps.items()},
        "account": account,
        "c": {"presence": c_presence, "leave": c_leave, "incident": c_incident, "reclamation": c_reclamation,
              "document": c_document, "notification": c_notification},
    }


def test_scope_endpoint_lists_only_explicit_societies_and_sites(client, world):
    ce01 = world["account"]("ce01", "AB", ["A1", "A2", "B1"])
    body = client.get("/api/site-workforce/scope", headers=ce01).json()
    assert sorted(body["societies"]) == sorted([world["socs"]["A"], world["socs"]["B"]])
    assert {s["id"] for s in body["sites"]} == {world["sites"][k] for k in ("A1", "A2", "B1")}


def test_no_implicit_inheritance_from_society(client, world):
    """Société A + site A1 seulement : A2 (même société) reste invisible."""
    ce = world["account"]("cea1", "A", ["A1"])
    assert {s["id"] for s in client.get("/api/site-workforce/scope", headers=ce).json()["sites"]} == {world["sites"]["A1"]}
    assert client.get("/api/site-workforce/dashboard", headers=ce, params={"site_id": world["sites"]["A2"]}).status_code == 403
    ids = {e["id"] for e in client.get("/api/site-workforce/employees", headers=ce, params={"page_size": 100}).json()["items"]}
    assert ids == {world["emps"]["A1"]}


def test_selectors_narrow_but_never_widen(client, world):
    ce01 = world["account"]("ce01", "AB", ["A1", "A2", "B1"])
    s, e = world["sites"], world["emps"]

    def emp_ids(params):
        r = client.get("/api/site-workforce/employees", headers=ce01, params={"page_size": 100, **params})
        assert r.status_code == 200, r.text
        return {row["id"] for row in r.json()["items"]}

    assert emp_ids({}) == {e["A1"], e["A2"], e["B1"]}
    assert emp_ids({"site_id": s["A1"]}) == {e["A1"]}
    assert emp_ids({"site_id": s["A2"]}) == {e["A2"]}
    assert emp_ids({"site_id": s["B1"]}) == {e["B1"]}
    assert emp_ids({"society": world["socs"]["A"]}) == {e["A1"], e["A2"]}
    # Forgés : société C, site C1, site d'une autre société que le filtre société.
    for params in ({"site_id": s["C1"]}, {"society": world["socs"]["C"]},
                   {"society": world["socs"]["A"], "site_id": s["B1"]}, {"site_id": 99999999}):
        for path in ("/dashboard", "/employees", "/absences", "/leaves", "/discipline", "/reclamations",
                     "/documents", "/notifications", "/transmissions", "/audit"):
            assert client.get(f"/api/site-workforce{path}", headers=ce01, params=params).status_code == 403, (path, params)
        assert client.get("/api/site-workforce/attendance", headers=ce01, params={"presence_date": str(date.today()), **params}).status_code == 403


def test_every_domain_hides_and_refuses_c1(client, db, world):
    ce01 = world["account"]("ce01", "AB", ["A1", "A2", "B1"])
    c, e, s = world["c"], world["emps"], world["sites"]
    today = str(date.today())
    c1 = s["C1"]

    # Lectures agrégées : aucune ligne de C1, aucun employé de C1.
    dash = client.get("/api/site-workforce/dashboard", headers=ce01).json()
    assert c1 not in {row["site_id"] for row in dash["by_site"]} and dash["kpi"]["effectif_total"] == 3
    for path, key in (("/absences", "id"), ("/leaves", "id"), ("/discipline", "id"), ("/reclamations", "id"),
                      ("/documents", "id"), ("/notifications", "id"), ("/transmissions", "id")):
        rows = client.get(f"/api/site-workforce{path}", headers=ce01).json()
        assert all(r.get("site_id") != c1 for r in rows), path
        assert all(r.get("employee_id") != e["C1"] for r in rows), path
    att = client.get("/api/site-workforce/attendance", headers=ce01, params={"presence_date": today}).json()
    assert e["C1"] not in {x["employee_id"] for x in att["entries"]}
    audit = client.get("/api/site-workforce/audit", headers=ce01).json()
    assert not any(str(r["resource_id"]).startswith(f"{c1}:") for r in audit)

    # Mutations sur ressources de C1 (identifiants forgés) : toutes refusées.
    refused = [
        client.post("/api/site-workforce/attendance", headers=ce01, json={"employee_id": e["C1"], "presence_date": today, "status": "present"}),
        client.post("/api/site-workforce/attendance", headers=ce01, json={"employee_id": e["A1"], "presence_date": today, "status": "present", "site_id": c1}),
        client.post(f"/api/site-workforce/attendance/{c['presence']}/correct", headers=ce01, json={"status": "present", "reason": "x"}),
        client.post(f"/api/site-workforce/absences/{c['presence']}/decision", headers=ce01, json={"decision": "justifiee"}),
        client.post("/api/site-workforce/documents", headers=ce01, json={"owner_type": "leave", "owner_id": c["leave"], "label": "x", "data_url": PDF}),
        client.post("/api/site-workforce/documents", headers=ce01, json={"owner_type": "attendance", "owner_id": c["presence"], "label": "x", "data_url": PDF}),
        client.post(f"/api/site-workforce/documents/{c['document']}/verify", headers=ce01, json={"validity_status": "conforme"}),
        client.post("/api/site-workforce/leaves", headers=ce01, json={"employee_id": e["C1"], "leave_type": "conge", "start_date": today, "end_date": today}),
        client.post("/api/site-workforce/leaves", headers=ce01, json={"employee_id": e["C1"], "leave_type": "maladie", "start_date": today, "end_date": today}),
        client.post("/api/site-workforce/discipline", headers=ce01, json={"employee_id": e["C1"], "event_type": "retard", "subject": "x"}),
        client.post("/api/site-workforce/discipline", headers=ce01, json={"site_id": c1, "event_type": "retard", "subject": "x"}),
        client.post(f"/api/site-workforce/discipline/{c['incident']}/signaler", headers=ce01),
        client.post("/api/site-workforce/reclamations", headers=ce01, json={"employee_id": e["C1"], "subject": "x", "description": "x"}),
        client.post(f"/api/site-workforce/reclamations/{c['reclamation']}/respond", headers=ce01, json={"response": "x"}),
        client.post("/api/site-workforce/transmissions", headers=ce01, json={"resource_type": "incident", "resource_id": c["incident"], "destinataire": "drh", "objet": "x"}),
        client.post("/api/site-workforce/transmissions", headers=ce01, json={"resource_type": "reclamation", "resource_id": c["reclamation"], "destinataire": "drh", "objet": "x"}),
        client.post(f"/api/site-workforce/notifications/{c['notification']}/read", headers=ce01),
    ]
    assert [r.status_code for r in refused] == [403, 403, 404, 404, 403, 403, 404, 403, 403, 403, 403, 404, 403, 404, 404, 404, 404], [r.text for r in refused]
    # Fichier de justificatif de C1 : jamais servi à CE01.
    doc = db.get(Document, c["document"])
    assert client.get(doc.file_path, headers=ce01).status_code in (403, 404)

    # Rien n'a bougé côté C1.
    db.expire_all()
    assert db.get(DailyPresence, c["presence"]).status == "absent"
    assert db.get(Incident, c["incident"]).status == "brouillon"
    assert db.get(Reclamation, c["reclamation"]).status == "nouvelle"
    assert db.get(Document, c["document"]).validity_status == "en_attente"
    assert db.get(SiteNotification, c["notification"]).status == "nouvelle"
    assert db.scalar(select(func.count(Transmission.id)).where(Transmission.site_id == c1)) == 0
    assert db.scalar(select(func.count(Leave.id)).where(Leave.employee_id == e["C1"])) == 1


def test_actions_keep_the_real_site_and_society_context(client, db, world):
    """Création depuis « Tous mes sites » : le site retenu est l'affectation réelle ; une
    transmission garde le site du dossier source ; les notifications affichent société/site."""
    ce01 = world["account"]("ce01", "AB", ["A1", "A2", "B1"])
    e, s = world["emps"], world["sites"]
    today = str(date.today())
    r = client.post("/api/site-workforce/attendance", headers=ce01, json={"employee_id": e["B1"], "presence_date": today, "status": "absent"})
    assert r.status_code == 200 and r.json()["site_id"] == s["B1"]
    assert db.get(DailyPresence, r.json()["id"]).site_id == s["B1"]
    rec = client.post("/api/site-workforce/reclamations", headers=ce01, json={"employee_id": e["A2"], "subject": "A2 réclamation", "description": "x"}).json()
    assert rec["site_id"] == s["A2"]
    tr = client.post("/api/site-workforce/transmissions", headers=ce01, json={"resource_type": "reclamation", "resource_id": rec["id"], "destinataire": "drh", "objet": "A2"}).json()
    row = db.get(Transmission, tr["id"])
    assert row.site_id == s["A2"] and row.source == "site_workforce" and row.created_by and row.resource_id == rec["id"]
    listed = client.get("/api/site-workforce/transmissions", headers=ce01).json()
    assert {"site_name", "society", "created_by"} <= set(listed[0])
    notes = client.get("/api/site-workforce/notifications", headers=ce01).json()
    by_site = {n["site_id"]: n for n in notes}
    assert by_site[s["B1"]]["society"] == world["socs"]["B"] and by_site[s["A2"]]["site_name"].startswith("A2")
    # Incident sans employé depuis « Tous mes sites » : site obligatoire ; avec un site du périmètre : OK.
    assert client.post("/api/site-workforce/discipline", headers=ce01, json={"event_type": "retard", "subject": "x"}).status_code == 422
    ok = client.post("/api/site-workforce/discipline", headers=ce01, json={"site_id": s["A1"], "event_type": "retard", "subject": "x"})
    assert ok.status_code == 200 and ok.json()["site_id"] == s["A1"]
    # Une notification d'un site autorisé se lit même quand la vue est filtrée sur un autre site.
    nid = by_site[s["B1"]]["id"]
    assert client.post(f"/api/site-workforce/notifications/{nid}/read", headers=ce01, params={"site_id": s["A1"]}).status_code == 200


def test_close_is_limited_to_the_consulted_scope(client, db, world):
    ce01 = world["account"]("ce01", "AB", ["A1", "A2", "B1"])
    e, s = world["emps"], world["sites"]
    today = str(date.today())
    ids = {k: client.post("/api/site-workforce/attendance", headers=ce01, json={"employee_id": e[k], "presence_date": today, "status": "present"}).json()["id"]
           for k in ("A1", "A2", "B1")}
    r = client.post("/api/site-workforce/attendance/close", headers=ce01, params={"presence_date": today, "site_id": s["A1"]})
    assert r.status_code == 200 and r.json()["sites"] == 1
    db.expire_all()
    assert db.get(DailyPresence, ids["A1"]).closed_at is not None
    assert db.get(DailyPresence, ids["A2"]).closed_at is None and db.get(DailyPresence, ids["B1"]).closed_at is None
    assert db.get(DailyPresence, world["c"]["presence"]).closed_at is None
    assert client.post("/api/site-workforce/attendance/close", headers=ce01, params={"presence_date": today, "site_id": s["C1"]}).status_code == 403


def test_single_site_account_works_as_before(client, world):
    """Compatibilité : 1 société + 1 site — dashboard « site » renseigné, mêmes données."""
    ce = world["account"]("ceb", "B", ["B1"])
    dash = client.get("/api/site-workforce/dashboard", headers=ce).json()
    assert dash["site"]["id"] == world["sites"]["B1"] and dash["kpi"]["effectif_total"] == 1
    r = client.post("/api/site-workforce/attendance", headers=ce, json={"employee_id": world["emps"]["B1"], "presence_date": str(date.today()), "status": "present"})
    assert r.status_code == 200


def test_dashboard_and_personnel_query_count_does_not_grow_with_sites(client, db):
    """Performance : même nombre de requêtes SQL pour 2 ou 30 sites (agrégats groupés)."""
    from app.db.session import engine
    t = _tag()
    soc = f"Perf {t}"
    sites = [Site(name=f"P{i} {t}", active=1, equipment_plan={"societe": soc}) for i in range(30)]
    db.add_all(sites); db.flush()
    for i, site in enumerate(sites):
        for j in range(5):
            emp = Employee(code=f"PF{t}{i}-{j}", first_name="P", last_name=f"F{i}{j}", society=soc, status="actif")
            db.add(emp); db.flush()
            db.add(Assignment(employee_id=emp.id, site_id=site.id, group_code="A", start_date=date.today() - timedelta(days=5), active=1))
    db.commit()

    def headers(n):
        u = User(username=f"PERF{n}_{t}".upper(), full_name="p", role="charge_effectifs_site", access_level="H2",
                 authorized_societies=[soc], authorized_structures=[], authorized_modules=["site_workforce"],
                 authorized_sites=[x.id for x in sites[:n]], authorized_actions=ACTIONS,
                 password_hash=hash_password("ce01password"), is_active=True)
        db.add(u); db.commit()
        tok = client.post("/api/auth/login", json={"username": u.username, "password": "ce01password"}).json()["access_token"]
        return {"Authorization": f"Bearer {tok}"}

    counter = {"n": 0}

    def count(*_a, **_k):
        counter["n"] += 1

    def queries(h, path):
        counter["n"] = 0
        event.listen(engine, "before_cursor_execute", count)
        try:
            r = client.get(path, headers=h)
        finally:
            event.remove(engine, "before_cursor_execute", count)
        assert r.status_code == 200, r.text
        return counter["n"], r.json()

    small, big = headers(2), headers(30)
    for path in ("/api/site-workforce/dashboard", "/api/site-workforce/employees?page_size=25"):
        n_small, _ = queries(small, path)
        n_big, body = queries(big, path)
        assert n_big == n_small, (path, n_small, n_big)
    assert body["total"] == 150 and len(body["items"]) == 25


WORKSPACE = "/api/site-workforce/attendance/workspace"


def test_monthly_workspace_requires_month_and_enforces_site_scope(client, world):
    """Workspace mensuel BEO : `month` (AAAA-MM) est obligatoire par contrat, et un mois valide
    n'ouvre rien de plus que le périmètre du compte — site autorisé 200, site/société hors
    périmètre 403, exactement comme les autres routes du module."""
    ce01 = world["account"]("ce01", "AB", ["A1", "A2", "B1"])
    month = date.today().strftime("%Y-%m")

    def get(**params):
        return client.get(WORKSPACE, headers=ce01, params=params)

    assert get().status_code == 422
    assert get(month=str(date.today())).status_code == 422  # un jour n'est pas un mois
    r = get(month=month)
    assert r.status_code == 200, r.text
    assert r.json()["month"] == month
    for key in ("A1", "A2", "B1"):
        assert get(month=month, site_id=world["sites"][key]).status_code == 200, key
    assert get(month=month, site_id=world["sites"]["C1"]).status_code == 403
    assert get(month=month, society=world["socs"]["C"]).status_code == 403


def test_production_ce01_multi_site_account_reaches_every_endpoint(client, world):
    """Bug production : CE01 multi-sites était bloqué par « exactement un site ». Toutes les
    routes GET du module (énumérées depuis l'application, jamais une liste figée) répondent
    200 sur le périmètre agrégé, 200 sur chaque site autorisé, 403 sur un site forgé."""
    from app.main import app
    ce01 = world["account"]("ce01", "AB", ["A1", "A2", "B1"])
    # Paramètres de requête OBLIGATOIRES par contrat (jamais un contournement du périmètre) :
    # le pointage journalier exige son jour, le workspace mensuel son mois au format AAAA-MM.
    extra = {"/api/site-workforce/attendance": {"presence_date": str(date.today())},
             WORKSPACE: {"month": date.today().strftime("%Y-%m")}}
    paths = sorted({r.path for r in app.routes if getattr(r, "path", "").startswith("/api/site-workforce")
                    and "GET" in getattr(r, "methods", set()) and "{" not in r.path})
    assert len(paths) >= 12, paths
    assert WORKSPACE in paths, paths
    for path in paths:
        params = extra.get(path, {})
        r = client.get(path, headers=ce01, params=params)
        assert r.status_code == 200, (path, r.status_code, r.text)
        assert "exactement un site" not in r.text
        for key in ("A1", "A2", "B1"):
            assert client.get(path, headers=ce01, params={**params, "site_id": world["sites"][key]}).status_code == 200, (path, key)
        if path != "/api/site-workforce/scope":
            assert client.get(path, headers=ce01, params={**params, "site_id": world["sites"]["C1"]}).status_code == 403, path
            assert client.get(path, headers=ce01, params={**params, "society": world["socs"]["C"]}).status_code == 403, path
