"""EFFECTIF / Fiches de position BEO v2 — statut métier, filtres, tri, compteurs, lampes.

Société A : sites A1, A2 ; société C : site C1. Le compte BEO voit A1 et A2, jamais C1. Les gardes
sont vérifiées sur la RÉPONSE JSON brute : une donnée non autorisée (statut Blacklist, tri par une
date masquée, lampe disciplinaire) n'apparaît ni dans les lignes, ni dans les compteurs, ni comme
filtre — sinon elle servirait d'oracle.
"""
import json
import uuid
from datetime import date, timedelta

import pytest
from sqlalchemy import event

from app.core.security import hash_password
from app.modules.auth.models import User
from app.modules.drh.models import Contract, Employee, EmployeeBlacklistEntry, Leave, Sanction
from app.modules.ops.models import Assignment, DailyPresence, Incident, Site
from app.modules.site_workforce import position_file
from tests.module_cleanup import purge_rows_created_by_this_module  # noqa: F401 (fixture autouse)

TODAY = date.today()
STANDARD = sorted(position_file.STANDARD_PROFILE)


@pytest.fixture()
def world(client, db, auth_headers):
    t = uuid.uuid4().hex[:6]
    socs = {k: f"SocEF{k} {t}" for k in "AC"}
    sites = {key: Site(name=f"EF{key} {t}", active=1, equipment_plan={"societe": socs[key[0]]}) for key in ("A1", "A2", "C1")}
    db.add_all(sites.values()); db.flush()
    emps = {}

    def employee(key, site, group, status="actif", **extra):
        emp = Employee(code=f"EF{key}{t}", first_name=f"P{key}", last_name=f"N{t}{key}", society=socs[site[0]], status=status,
                       position="AGENT", recruit_date=extra.pop("recruit", date(2020, 1, 1)),
                       contract_end_date=extra.pop("end", TODAY + timedelta(days=100)), **extra)
        db.add(emp); db.flush()
        db.add(Assignment(employee_id=emp.id, site_id=sites[site].id, group_code=group, position="AGENT",
                          start_date=date(2025, 1, 1), active=1))
        emps[key] = emp
        return emp

    def presence(key, site, status, generated=0):
        db.add(DailyPresence(presence_date=TODAY, employee_id=emps[key].id, site_id=sites[site].id, status=status, generated=generated))

    def leave(key, kind):
        db.add(Leave(employee_id=emps[key].id, leave_type=kind, start_date=TODAY - timedelta(days=1), end_date=TODAY + timedelta(days=2), status="approuve"))

    employee("black", "A1", "A", recruit=date(2010, 1, 1))     # blacklist canonique + congé : la blacklist l'emporte
    employee("mirror", "A1", "A", status="blackliste")        # blacklist par la valeur miroir de Employee.status
    employee("susp", "A1", "B", status="suspendu")
    employee("conge", "A1", "B")
    employee("mal", "A1", "C")
    employee("abs", "A1", "C")
    employee("np", "A1", "D")
    employee("act", "A1", "A", extra={"photo": "data:image/png;base64," + "A" * 600})
    employee("planned", "A1", "A")                            # journée seulement générée : pas un pointage
    employee("a2", "A2", "D", recruit=date(2024, 6, 1), end=TODAY + timedelta(days=5))
    employee("sanction", "A2", "B")
    employee("incident", "A2", "")
    employee("outside", "C1", "A", status="blackliste")
    db.flush()
    db.add(EmployeeBlacklistEntry(employee_id=emps["black"].id, society=socs["A"], reason="test", status="active"))
    leave("black", "conge"); leave("conge", "conge"); leave("mal", "maladie")
    presence("susp", "A1", "present"); presence("abs", "A1", "absent"); presence("act", "A1", "present")
    presence("planned", "A1", "present", generated=1)
    presence("a2", "A2", "present"); presence("sanction", "A2", "present"); presence("incident", "A2", "present")
    db.add(Sanction(employee_id=emps["sanction"].id, infraction_date=TODAY - timedelta(days=30), fault="CONFIDENTIEL",
                    sanction_type="Avertissement", suspension_days=0))
    db.add(Sanction(employee_id=emps["a2"].id, infraction_date=TODAY - timedelta(days=800), fault="ANCIEN",
                    sanction_type="Avertissement", suspension_days=0))  # trop ancienne : rien à signaler
    db.add(Incident(site_id=sites["A2"].id, employee_id=emps["incident"].id, status="signale", subject="Incident"))
    db.add(Contract(employee_id=emps["a2"].id, contract_type="CDD", start_date=date(2024, 6, 1), end_date=TODAY + timedelta(days=50), status="actif"))
    db.commit()

    user = User(username=f"EFBEO_{t}".upper(), full_name="EF", role="charge_effectifs_site", access_level="H2",
                authorized_societies=[socs["A"]], authorized_structures=[], authorized_modules=["site_workforce"],
                authorized_sites=[sites["A1"].id, sites["A2"].id], authorized_actions=["read"],
                password_hash=hash_password("efpassword1"), is_active=True)
    db.add(user); db.commit()
    token = client.post("/api/auth/login", json={"username": user.username, "password": "efpassword1"}).json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    def grant(fields):
        r = client.put(f"/api/auth/users/{user.id}/site-workforce/position-fields", headers=auth_headers, json={"fields": list(fields)})
        assert r.status_code == 200, r.text

    def employees(**params):
        return client.get("/api/site-workforce/employees", headers=headers, params={"page_size": 100, **params})

    def positions(**params):
        return client.get("/api/site-workforce/positions", headers=headers, params={"page_size": 100, **params})

    code = {k: e.code for k, e in emps.items()}
    return {"t": t, "sites": {k: v.id for k, v in sites.items()}, "emps": {k: v.id for k, v in emps.items()}, "code": code,
            "grant": grant, "employees": employees, "positions": positions, "headers": headers}


def _by_code(body):
    return {row["code"]: row for row in body["items"]}


# ── Statut métier ──────────────────────────────────────────────────────────────────────
def test_business_status_priority_with_status_field(world):
    world["grant"](STANDARD)
    body = world["employees"]().json()
    rows = _by_code(body)
    c = world["code"]
    expected = {"black": "blacklist", "mirror": "blacklist", "susp": "suspendu", "conge": "conge", "mal": "maladie",
                "abs": "absent", "np": "non_pointe", "act": "actif", "planned": "non_pointe", "a2": "actif"}
    assert {k: rows[c[k]]["status"] for k in expected} == expected
    assert rows[c["black"]]["status_label"] == "Blacklist"
    assert c["outside"] not in rows, "employé hors périmètre (C1)"
    statuses = {s["key"]: s["count"] for s in body["facets"]["statuses"]}
    assert statuses["blacklist"] == 2 and statuses["suspendu"] == 1 and statuses["non_pointe"] == 2
    assert sum(statuses.values()) == body["total"] == 12
    assert body["capabilities"]["lifecycle_status"] is True


def test_without_status_field_blacklist_and_suspension_never_leak(world):
    world["grant"](["identity.last_name"])
    r = world["employees"]()
    body = r.json()
    rows = _by_code(body)
    c = world["code"]
    assert rows[c["black"]]["status"] == "conge", "sans le champ Statut, la blacklist ne prime pas (elle est invisible)"
    assert rows[c["mirror"]]["status"] == "non_pointe"
    assert rows[c["susp"]]["status"] == "actif"
    assert "blacklist" not in r.text.lower() and "suspendu" not in r.text.lower()
    assert [s["key"] for s in body["facets"]["statuses"]] == ["conge", "maladie", "absent", "non_pointe", "actif"]
    assert body["capabilities"]["lifecycle_status"] is False
    assert world["employees"](status="blacklist").status_code == 403
    assert world["employees"](status="suspendu").status_code == 403


# ── Filtres, compteurs, périmètre ───────────────────────────────────────────────────────
def test_facets_and_combined_filters_stay_inside_scope(world):
    world["grant"](STANDARD)
    body = world["employees"]().json()
    groups = {g["key"]: g["count"] for g in body["facets"]["groups"]}
    assert groups == {"A": 4, "B": 3, "C": 2, "D": 2, "_none": 1}
    assert {s["site_id"]: s["count"] for s in body["facets"]["sites"]} == {world["sites"]["A1"]: 9, world["sites"]["A2"]: 3}
    a1, a2 = world["sites"]["A1"], world["sites"]["A2"]
    c = world["code"]
    only = lambda **p: set(_by_code(world["employees"](**p).json()))  # noqa: E731
    assert only(group="A") == {c["black"], c["mirror"], c["act"], c["planned"]}
    assert only(group="_none") == {c["incident"]}
    assert only(site=a2) == {c["a2"], c["sanction"], c["incident"]}
    assert only(site=a1, group="A", status="blacklist") == {c["black"], c["mirror"]}
    assert only(site=a2, group="D", status="actif", q="P") == {c["a2"]}
    assert only(presence="present") == {c["susp"], c["act"], c["a2"], c["sanction"], c["incident"]}
    assert only(presence="absent") == {c["abs"]}
    assert c["planned"] in only(presence="non_pointe")
    # Les compteurs ne bougent pas avec les filtres locaux (raccourcis stables).
    assert world["employees"](group="A").json()["facets"] == body["facets"]
    # Site hors de la sélection, ou d'une autre société : refus, jamais de fuite.
    assert world["employees"](site=world["sites"]["C1"]).status_code == 403
    assert world["employees"](site_id=a1, site=a2).status_code == 403
    assert world["employees"](presence="partout").status_code == 422


def test_sorts_follow_field_permissions(world):
    world["grant"](STANDARD)
    codes = [r["code"] for r in world["employees"](sort="code").json()["items"]]
    assert codes == sorted(codes)
    caps = world["employees"]().json()["capabilities"]["sorts"]
    assert "recruit_date" not in caps and "contract_end" in caps
    assert world["employees"](sort="recruit_date").status_code == 403, "tri sur une date masquée = oracle"
    assert world["employees"](sort="inconnu").status_code == 403
    world["grant"]([*STANDARD, "contract.recruit_date"])
    rows = world["employees"](sort="recruit_date").json()["items"]
    assert rows[0]["code"] == world["code"]["black"]  # recrutement 2010
    ends = [r["code"] for r in world["employees"](sort="contract_end").json()["items"]]
    assert ends[0] == world["code"]["a2"]  # fin la plus proche (max employé / dernier contrat)
    statuses = [r["status"] for r in world["employees"](sort="status").json()["items"]]
    assert statuses[:2] == ["blacklist", "blacklist"] and statuses[-1] == "actif"


def test_photo_url_only_with_photo_field(world):
    world["grant"](["identity.last_name"])
    assert not any("photo_url" in r for r in world["employees"]().json()["items"])
    world["grant"](["identity.last_name", "identity.photo"])
    rows = _by_code(world["employees"]().json())
    assert rows[world["code"]["act"]]["photo_url"].startswith(f"/api/site-workforce/positions/{world['emps']['act']}/photo")
    assert "photo_url" not in rows[world["code"]["np"]]


# ── Fiches de position : lampes, filtres, absence de N+1 ───────────────────────────────
def _indicators(body):
    return {item["employee_id"]: item["indicator"]["level"] for item in body["items"]}


def test_lamps_red_orange_green_with_all_fields(world):
    world["grant"]([*STANDARD, "identity.discipline_flag"])
    lamps = _indicators(world["positions"]().json())
    e = world["emps"]
    assert lamps[e["black"]] == "red" and lamps[e["mirror"]] == "red"
    assert lamps[e["sanction"]] == "orange" and lamps[e["incident"]] == "orange"
    assert lamps[e["a2"]] == "green", "sanction de plus de 365 jours : rien à signaler"
    assert lamps[e["act"]] == "green"
    assert e["outside"] not in lamps


def test_lamps_never_green_without_discipline_flag(world):
    world["grant"](STANDARD)
    r = world["positions"]()
    lamps = _indicators(r.json())
    e = world["emps"]
    assert lamps[e["black"]] == "red"
    assert lamps[e["sanction"]] == "unknown" and lamps[e["act"]] == "unknown", "jamais un faux vert"
    world["grant"](["identity.last_name"])
    lamps = _indicators(world["positions"]().json())
    assert set(lamps.values()) == {"unknown"}, "ni blacklist ni discipline sans les champs"


def test_discipline_flag_in_detail_is_a_label_without_detail(client, world):
    world["grant"](["identity.discipline_flag"])
    r = client.get(f"/api/site-workforce/positions/{world['emps']['sanction']}", headers=world["headers"])
    assert r.status_code == 200
    field = r.json()["sections"][0]["fields"][0]
    assert field["key"] == "identity.discipline_flag" and field["value"]["tone"] == "warn"
    assert "CONFIDENTIEL" not in r.text and "Avertissement" not in r.text
    world["grant"](STANDARD)
    assert "identity.discipline_flag" not in client.get(f"/api/site-workforce/positions/{world['emps']['sanction']}", headers=world["headers"]).text


def test_position_list_group_site_filters_and_card_fields(world):
    world["grant"](["identity.last_name", "identity.employee_code"])
    assert world["positions"](group="A").status_code == 403
    assert world["positions"](site=world["sites"]["A2"]).status_code == 403
    world["grant"]([*STANDARD, "contract.recruit_date"])
    body = world["positions"](group="d", site=world["sites"]["A2"]).json()
    assert [i["employee_id"] for i in body["items"]] == [world["emps"]["a2"]]
    fields = body["items"][0]["fields"]
    assert fields["assignment.group"] == "D" and fields["contract.recruit_date"] == "2024-06-01"
    assert fields["contract.end_date"] == (TODAY + timedelta(days=50)).isoformat()
    assert {g["key"] for g in body["filters"]["groups"]} == {"A", "B", "C", "D"}
    assert {s["site_id"] for s in body["filters"]["sites"]} == {world["sites"]["A1"], world["sites"]["A2"]}
    assert world["positions"](site=world["sites"]["C1"]).status_code == 403


def test_list_endpoints_have_a_fixed_number_of_queries(client, db, world):
    world["grant"]([*STANDARD, "identity.discipline_flag", "contract.recruit_date"])
    engine = db.get_bind()
    counts = []

    def run(path, size):
        statements = []
        listener = lambda *args, **kwargs: statements.append(1)  # noqa: E731
        event.listen(engine, "before_cursor_execute", listener)
        try:
            r = client.get(path, headers=world["headers"], params={"page_size": size})
        finally:
            event.remove(engine, "before_cursor_execute", listener)
        assert r.status_code == 200, r.text
        return len(statements)

    for path in ("/api/site-workforce/positions", "/api/site-workforce/employees"):
        small, large = run(path, 5), run(path, 12)
        counts.append((path, small, large))
        assert small == large, f"{path} : {small} requêtes pour 5 lignes, {large} pour 12 (N+1)"
    json.dumps(counts)
