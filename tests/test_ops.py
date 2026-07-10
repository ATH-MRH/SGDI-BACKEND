"""Couverture COMPLÈTE du module OPS (backend) — vrais endpoints, vraie base, sans mock.

Palier 2 : OPS. Sites, postes, affectations, rotations, pointage journalier,
personnel en récupération (standby), événements, mouvements, situation générale.
"""
from datetime import date, timedelta

SOCIETY = "Iron Global Securite"


# ── Helpers ───────────────────────────────────────────────────────────────────

def _emp(client, h, code, society=SOCIETY, status="actif"):
    r = client.post("/api/drh/employees", headers=h, json={
        "code": code, "first_name": f"E{code}", "last_name": "Ops",
        "society": society, "status": status, "contract_type": "CDD",
    })
    assert r.status_code in (200, 201), r.text
    return r.json().get("id") or r.json().get("backendId")


def _site(client, h, name, rotation="24/48", staff=0, active=1, opening="2020-01-01"):
    plan = {"societe": SOCIETY}
    if opening:
        plan["dateOuverture"] = opening
    r = client.post("/api/ops/sites", headers=h, json={
        "name": name, "indicatif": name[:3].upper(), "rotation_system": rotation,
        "contractual_staff": staff, "active": active, "equipment_plan": plan,
    })
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


def _assign(client, h, emp_id, site_id, group="A", start="2026-01-01"):
    r = client.post("/api/ops/assignments", headers=h, json={
        "employee_id": int(emp_id), "site_id": int(site_id),
        "group_code": group, "start_date": start, "active": 1,
    })
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


# ═══════════════════════════════════════════════════════════════════════════
# Logique métier pure (appels directs au service)
# ═══════════════════════════════════════════════════════════════════════════

def test_compute_post_total():
    from app.modules.ops.service import compute_post_total
    # 1/1 : un seul agent par poste de jour, pas de relève
    assert compute_post_total(3, 2, "1/1") == 3
    # Tout autre système : jour + nuit, doublés (relève)
    assert compute_post_total(3, 2, "24/48") == 10
    assert compute_post_total(1, 0, None) == 2
    assert compute_post_total(0, 0, "3x8") == 0


def test_site_opening_date_accepts_all_key_variants():
    from app.modules.ops.models import Site
    from app.modules.ops.service import site_opening_date
    for key in ("dateOuverture", "date_ouverture", "openingDate", "opening_date"):
        site = Site(name="S", equipment_plan={key: "2025-06-01"})
        assert site_opening_date(site) == date(2025, 6, 1), f"clé {key} non reconnue"
    assert site_opening_date(Site(name="S", equipment_plan={})) is None
    assert site_opening_date(Site(name="S", equipment_plan=None)) is None
    assert site_opening_date(Site(name="S", equipment_plan={"dateOuverture": "pas-une-date"})) is None
    # Une date ISO complète est tronquée au jour
    assert site_opening_date(Site(name="S", equipment_plan={"dateOuverture": "2025-06-01T08:00:00"})) == date(2025, 6, 1)


def test_site_is_operational():
    from app.modules.ops.models import Site
    from app.modules.ops.service import site_is_operational
    today = date(2026, 6, 1)
    ouvert = Site(name="S", active=1, equipment_plan={"dateOuverture": "2025-01-01"})
    assert site_is_operational(ouvert, today) is True
    # Site inactif -> jamais opérationnel
    assert site_is_operational(Site(name="S", active=0, equipment_plan={"dateOuverture": "2025-01-01"}), today) is False
    # Ouverture future -> pas encore opérationnel
    assert site_is_operational(Site(name="S", active=1, equipment_plan={"dateOuverture": "2027-01-01"}), today) is False
    # Sans date d'ouverture -> pas opérationnel
    assert site_is_operational(Site(name="S", active=1, equipment_plan={}), today) is False


# ── Rotations : le cœur du pointage ──────────────────────────────────────────

def test_rotation_1_1_only_group_a_on_weekdays():
    """1/1 : seul le groupe A travaille, et jamais le week-end (vendredi/samedi)."""
    from app.modules.ops.service import rotation_for_date
    lundi, vendredi, samedi = date(2026, 1, 5), date(2026, 1, 2), date(2026, 1, 3)

    a = rotation_for_date("1/1", "A", lundi)
    assert a == {"on": True, "period": "jour", "faction": "jour", "recovery": 0}
    for weekend in (vendredi, samedi):
        off = rotation_for_date("1/1", "A", weekend)
        assert off["on"] is False and off["period"] == "recuperation" and off["recovery"] == 1
    # Les autres groupes ne travaillent jamais en 1/1
    assert rotation_for_date("1/1", "B", lundi)["on"] is False


def test_rotation_1_3_group_a_day_others_night_cycle():
    """1/3 : A de jour (hors week-end), B/C/D en nuit sur un cycle de 3 jours."""
    from app.modules.ops.service import rotation_for_date
    base = date(2026, 1, 1)
    assert rotation_for_date("1/3", "A", date(2026, 1, 5), base)["period"] == "jour"
    # B/C/D : chacun sa nuit dans le cycle de 3
    assert rotation_for_date("1/3", "B", base, base) == {"on": True, "period": "nuit", "faction": "nuit", "recovery": 0}
    assert rotation_for_date("1/3", "C", base + timedelta(days=1), base)["on"] is True
    assert rotation_for_date("1/3", "D", base + timedelta(days=2), base)["on"] is True
    # B ne travaille pas le lendemain de sa nuit
    off = rotation_for_date("1/3", "B", base + timedelta(days=1), base)
    assert off["on"] is False and off["recovery"] == 1


def test_rotation_1_2_alternates_and_splits_day_night():
    """1/2 : alternance un jour sur deux ; A/B de jour, C/D de nuit."""
    from app.modules.ops.service import rotation_for_date
    base = date(2026, 1, 1)
    assert rotation_for_date("1/2", "A", base, base) == {"on": True, "period": "jour", "faction": "jour", "recovery": 0}
    assert rotation_for_date("1/2", "B", base, base)["on"] is False
    assert rotation_for_date("1/2", "B", base + timedelta(days=1), base) == {"on": True, "period": "jour", "faction": "jour", "recovery": 0}
    assert rotation_for_date("1/2", "C", base, base)["period"] == "nuit"
    assert rotation_for_date("1/2", "D", base + timedelta(days=1), base)["period"] == "nuit"


def test_rotation_3x8_cycles_matin_apresmidi_nuit_recup():
    from app.modules.ops.service import rotation_for_date
    base = date(2026, 1, 1)
    periods = [rotation_for_date("3x8", "A", base + timedelta(days=d), base)["period"] for d in range(4)]
    assert periods == ["matin", "apres_midi", "nuit", "recuperation"]
    # Le décalage de groupe décale le cycle
    assert rotation_for_date("3x8", "B", base, base)["period"] == "apres_midi"
    recup = rotation_for_date("3x8", "A", base + timedelta(days=3), base)
    assert recup["on"] is False and recup["faction"] == "repos" and recup["recovery"] == 1


def test_rotation_24_48_is_the_default():
    """24/48 (défaut) : jour, nuit, puis deux jours de récupération."""
    from app.modules.ops.service import rotation_for_date
    base = date(2026, 1, 1)
    periods = [rotation_for_date("24/48", "A", base + timedelta(days=d), base)["period"] for d in range(4)]
    assert periods == ["jour", "nuit", "recuperation", "recuperation"]
    # Un système inconnu ou absent retombe sur 24/48
    assert rotation_for_date(None, "A", base, base)["period"] == "jour"
    assert rotation_for_date("systeme_inconnu", "A", base, base)["period"] == "jour"
    # Le groupe décale le cycle
    assert rotation_for_date("24/48", "B", base, base)["period"] == "nuit"


def test_rotation_normalizes_group_code():
    from app.modules.ops.service import rotation_for_date
    base = date(2026, 1, 1)
    assert rotation_for_date("24/48", "a", base, base)["period"] == "jour"   # minuscule
    assert rotation_for_date("24/48", "ZZZ", base, base)["period"] == "jour"  # inconnu -> groupe A
    assert rotation_for_date("24/48", None, base, base)["period"] == "jour"
    # Une date antérieure à la base ne produit pas de diff négatif
    assert rotation_for_date("24/48", "A", base - timedelta(days=5), base)["period"] == "jour"


# ═══════════════════════════════════════════════════════════════════════════
# Sites (endpoints)
# ═══════════════════════════════════════════════════════════════════════════

def test_ops_dashboard(client, auth_headers):
    r = client.get("/api/ops/dashboard", headers=auth_headers)
    assert r.status_code == 200
    for key in ("active_sites", "active_assignments", "open_events", "daily_presence_rows_today"):
        assert isinstance(r.json()[key], int)


def test_site_full_crud(client, auth_headers):
    site_id = _site(client, auth_headers, "Site CRUD", staff=5)

    # GET renvoie la situation du site
    got = client.get(f"/api/ops/sites/{site_id}", headers=auth_headers)
    assert got.status_code == 200
    data = got.json()
    assert data["contractual_staff"] == 5
    assert data["realized_staff"] == 0
    assert data["missing_staff"] == 5
    assert data["operational_site"] is True
    assert set(data["by_group"]) >= {"A", "B", "C", "D"}

    upd = client.put(f"/api/ops/sites/{site_id}", headers=auth_headers, json={"contractual_staff": 8})
    assert upd.status_code == 200 and upd.json()["contractual_staff"] == 8

    assert client.delete(f"/api/ops/sites/{site_id}", headers=auth_headers).status_code == 200
    assert client.get(f"/api/ops/sites/{site_id}", headers=auth_headers).status_code == 404


def test_sites_page_and_filters(client, auth_headers):
    _site(client, auth_headers, "Site Pagine Unique")
    inactive = _site(client, auth_headers, "Site Inactif", active=0)

    page = client.get("/api/ops/sites/page?page=1&page_size=5", headers=auth_headers)
    assert page.status_code == 200
    assert "items" in page.json() and "total" in page.json()
    assert len(page.json()["items"]) <= 5

    # Filtre actif=0
    only_inactive = client.get("/api/ops/sites/page?active=0", headers=auth_headers).json()["items"]
    assert all(s["active"] == 0 for s in only_inactive)
    assert any(s["id"] == inactive for s in only_inactive)

    # Recherche texte
    found = client.get("/api/ops/sites/page?q=PAGINE UNIQUE", headers=auth_headers).json()["items"]
    assert any("PAGINE UNIQUE" in (s["name"] or "").upper() for s in found)

    # Liste simple, filtre actif=1
    actifs = client.get("/api/ops/sites?active=1", headers=auth_headers).json()
    assert all(s["active"] == 1 for s in actifs)


def test_site_situation_counts_surplus(client, auth_headers):
    """realized > contractual -> surplus, missing = 0."""
    site_id = _site(client, auth_headers, "Site Surplus", staff=1)
    for i in range(3):
        _assign(client, auth_headers, _emp(client, auth_headers, f"OPS_SUR{i}"), site_id, group="ABC"[i])

    data = client.get(f"/api/ops/sites/{site_id}", headers=auth_headers).json()
    assert data["realized_staff"] == 3
    assert data["surplus_staff"] == 2
    assert data["missing_staff"] == 0
    # Les agents sont ventilés par groupe
    assert len(data["by_group"]["A"]) == 1 and len(data["by_group"]["B"]) == 1


def test_general_situation_totals_are_coherent(client, auth_headers):
    site_id = _site(client, auth_headers, "Site Situation Gen", staff=4)
    _assign(client, auth_headers, _emp(client, auth_headers, "OPS_SG1"), site_id)

    data = client.get("/api/ops/sites/situation-generale", headers=auth_headers).json()
    rows = data["sites"]
    mine = next(r for r in rows if r["site"]["id"] == site_id)
    assert mine["contractual_staff"] == 4 and mine["realized_staff"] == 1 and mine["missing_staff"] == 3

    # Les totaux sont la somme des sites ACTIFS
    actifs = [r for r in rows if r["site"]["active"]]
    assert data["realized_staff"] == sum(r["realized_staff"] for r in actifs)
    assert data["missing_staff"] == sum(r["missing_staff"] for r in actifs)
    assert data["contractual_staff"] == sum(r["contractual_staff"] or 0 for r in actifs)
    assert data["active_sites"] == len(actifs)


def test_general_situation_excludes_former_employees(client, auth_headers, db):
    """Un agent sortant ne compte plus dans l'effectif réalisé d'un site."""
    from app.modules.ops.service import general_sites_situation
    site_id = _site(client, auth_headers, "Site Sortant", staff=2)
    emp = _emp(client, auth_headers, "OPS_SORT")
    _assign(client, auth_headers, emp, site_id)

    before = next(r for r in general_sites_situation(db)["sites"] if r["site"].id == site_id)
    assert before["realized_staff"] == 1

    upd = client.put(f"/api/drh/employees/{emp}", headers=auth_headers, json={
        "code": "OPS_SORT", "first_name": "EOPS_SORT", "last_name": "Ops",
        "society": SOCIETY, "status": "sortant",
    })
    assert upd.status_code == 200, upd.text

    after = next(r for r in general_sites_situation(db)["sites"] if r["site"].id == site_id)
    assert after["realized_staff"] == 0, "Un agent SORTANT est encore compté dans l'effectif du site"
    assert after["missing_staff"] == 2


# ═══════════════════════════════════════════════════════════════════════════
# Postes de site
# ═══════════════════════════════════════════════════════════════════════════

def test_site_post_total_count_is_computed(client, auth_headers):
    site_id = _site(client, auth_headers, "Site Postes")
    r = client.post("/api/ops/site-posts", headers=auth_headers, json={
        "site_id": site_id, "name": "Poste Entree", "day_count": 2, "night_count": 1, "rotation_system": "24/48",
    })
    assert r.status_code in (200, 201), r.text
    assert r.json()["total_count"] == 6, "(2 jour + 1 nuit) x 2 relèves"

    r2 = client.post("/api/ops/site-posts", headers=auth_headers, json={
        "site_id": site_id, "name": "Poste Jour", "day_count": 2, "night_count": 3, "rotation_system": "1/1",
    })
    assert r2.json()["total_count"] == 2, "1/1 : seuls les postes de jour comptent"

    lst = client.get(f"/api/ops/site-posts?site_id={site_id}", headers=auth_headers)
    assert lst.status_code == 200 and len(lst.json()) == 2


# ═══════════════════════════════════════════════════════════════════════════
# Affectations
# ═══════════════════════════════════════════════════════════════════════════

def test_new_assignment_deactivates_the_previous_one(client, auth_headers):
    """RÈGLE CLÉ : un agent n'a qu'UNE affectation active. La nouvelle clôture l'ancienne."""
    emp = _emp(client, auth_headers, "OPS_MOVE")
    site_a = _site(client, auth_headers, "Site Depart")
    site_b = _site(client, auth_headers, "Site Arrivee")

    first = _assign(client, auth_headers, emp, site_a)
    second = _assign(client, auth_headers, emp, site_b, start="2026-02-01")

    actives = client.get(f"/api/ops/assignments?employee_id={emp}&active=1", headers=auth_headers).json()
    assert len(actives) == 1, f"L'agent a {len(actives)} affectations actives"
    assert actives[0]["id"] == second and actives[0]["site_id"] == site_b

    # L'ancienne est clôturée avec une date de fin
    toutes = client.get(f"/api/ops/assignments?employee_id={emp}", headers=auth_headers).json()
    ancienne = next(a for a in toutes if a["id"] == first)
    assert ancienne["active"] == 0 and ancienne["end_date"]


def test_patch_assignment_closes_it_and_sets_end_date(client, auth_headers, db):
    from app.modules.ops.service import employee_has_active_assignment
    emp = _emp(client, auth_headers, "OPS_CLOSE")
    site_id = _site(client, auth_headers, "Site Cloture")
    a_id = _assign(client, auth_headers, emp, site_id)
    assert employee_has_active_assignment(db, int(emp)) is True

    r = client.patch(f"/api/ops/assignments/{a_id}", headers=auth_headers, json={"active": 0})
    assert r.status_code == 200, r.text
    assert r.json()["active"] == 0
    assert r.json()["end_date"], "Une affectation clôturée doit avoir une date de fin"
    assert employee_has_active_assignment(db, int(emp)) is False


def test_deactivate_assignment_service(client, auth_headers, db):
    from app.modules.ops.service import deactivate_assignment
    emp = _emp(client, auth_headers, "OPS_DEACT")
    site_id = _site(client, auth_headers, "Site Deact")
    a_id = _assign(client, auth_headers, emp, site_id)

    row = deactivate_assignment(db, a_id, end_date=date(2026, 3, 31), change_reason="Fin de mission")
    assert row.active == 0
    assert row.end_date == date(2026, 3, 31)
    assert row.change_reason == "Fin de mission"


def test_assignment_rejects_society_mismatch(client, auth_headers):
    """Un agent ne peut pas être affecté à un site d'une autre société."""
    emp = _emp(client, auth_headers, "OPS_OTHER", society="Sword Corporation")
    site_id = _site(client, auth_headers, "Site IGS Only")  # equipment_plan.societe = Iron Global Securite
    r = client.post("/api/ops/assignments", headers=auth_headers, json={
        "employee_id": int(emp), "site_id": int(site_id), "group_code": "A", "start_date": "2026-01-01",
    })
    assert r.status_code == 403, r.text


def test_assignments_page_filters(client, auth_headers):
    site_id = _site(client, auth_headers, "Site Page Aff")
    emp = _emp(client, auth_headers, "OPS_PGA")
    _assign(client, auth_headers, emp, site_id)

    page = client.get(f"/api/ops/assignments/page?site_id={site_id}&active=1", headers=auth_headers)
    assert page.status_code == 200
    body = page.json()
    assert "items" in body and body["total"] >= 1
    assert all(a["site_id"] == site_id for a in body["items"])


# ═══════════════════════════════════════════════════════════════════════════
# Pointage journalier
# ═══════════════════════════════════════════════════════════════════════════

def test_generate_daily_presence_is_idempotent(client, auth_headers):
    day = "2027-05-11"
    site_id = _site(client, auth_headers, "Site Pointage")
    _assign(client, auth_headers, _emp(client, auth_headers, "OPS_PT1"), site_id)

    first = client.post(f"/api/ops/pointage/daily/generate?presence_date={day}", headers=auth_headers)
    assert first.status_code == 200, first.text
    assert first.json()["generated"] >= 1

    second = client.post(f"/api/ops/pointage/daily/generate?presence_date={day}", headers=auth_headers)
    assert second.json()["generated"] == 0, "Regénérer ne doit pas créer de doublon de pointage"


def test_close_daily_presence(client, auth_headers):
    day = "2027-05-12"
    site_id = _site(client, auth_headers, "Site Cloture Pointage")
    _assign(client, auth_headers, _emp(client, auth_headers, "OPS_PT2"), site_id)
    client.post(f"/api/ops/pointage/daily/generate?presence_date={day}", headers=auth_headers)

    closed = client.post(f"/api/ops/pointage/daily/close?presence_date={day}", headers=auth_headers)
    assert closed.status_code == 200
    assert closed.json()["closed"] >= 1

    rows = client.get(f"/api/ops/pointage/daily?presence_date={day}", headers=auth_headers).json()
    assert rows and all(r["closed_at"] for r in rows)


def test_daily_presence_crud_and_page(client, auth_headers):
    day = "2027-05-13"
    site_id = _site(client, auth_headers, "Site Pointage Manuel")
    emp = _emp(client, auth_headers, "OPS_PT3")

    created = client.post("/api/ops/pointage/daily", headers=auth_headers, json={
        "presence_date": day, "employee_id": int(emp), "site_id": int(site_id),
        "group_code": "A", "status": "present", "arrival_time": "08:00",
    })
    assert created.status_code in (200, 201), created.text
    pid = created.json()["id"]

    upd = client.patch(f"/api/ops/pointage/daily/{pid}", headers=auth_headers, json={
        "status": "absent", "notes": "Absence non justifiee",
    })
    assert upd.status_code == 200 and upd.json()["status"] == "absent"

    page = client.get(f"/api/ops/pointage/daily/page?presence_date={day}&site_id={site_id}", headers=auth_headers)
    assert page.status_code == 200 and page.json()["total"] >= 1


def test_generate_rotation_assigns_faction_and_lists_standby(client, auth_headers):
    """Génération par rotation 24/48 : A=jour, B=nuit, C/D en récupération (standby)."""
    day = "2027-06-01"
    site_id = _site(client, auth_headers, "Site Rotation", rotation="24/48")
    for group in ("A", "B", "C"):
        _assign(client, auth_headers, _emp(client, auth_headers, f"OPS_ROT{group}"), site_id, group=group, start=day)

    r = client.post("/api/ops/pointage/daily/generate-rotation", headers=auth_headers, json={
        "presence_date": day, "site_id": site_id, "overwrite_generated": True,
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["created"] == 2, "A (jour) et B (nuit) travaillent, pas C"
    assert body["sites"] == 1
    # C est en récupération -> standby
    assert len(body["standby"]) == 1
    assert body["standby"][0]["group_code"] == "C"
    assert body["standby"][0]["reason"]

    rows = client.get(f"/api/ops/pointage/daily?presence_date={day}&site_id={site_id}", headers=auth_headers).json()
    factions = {r["rotation_group"]: r["faction"] for r in rows}
    assert factions == {"A": "jour", "B": "nuit"}

    # Relancer met à jour au lieu de dupliquer
    again = client.post("/api/ops/pointage/daily/generate-rotation", headers=auth_headers, json={
        "presence_date": day, "site_id": site_id, "overwrite_generated": True,
    }).json()
    assert again["created"] == 0 and again["updated"] == 2


def test_generate_rotation_skips_generated_rows_without_overwrite(client, auth_headers):
    day = "2027-06-02"
    site_id = _site(client, auth_headers, "Site Rotation NoOverwrite", rotation="24/48")
    _assign(client, auth_headers, _emp(client, auth_headers, "OPS_ROTN"), site_id, group="A", start=day)

    first = client.post("/api/ops/pointage/daily/generate-rotation", headers=auth_headers, json={
        "presence_date": day, "site_id": site_id, "overwrite_generated": True,
    }).json()
    assert first["created"] == 1

    second = client.post("/api/ops/pointage/daily/generate-rotation", headers=auth_headers, json={
        "presence_date": day, "site_id": site_id, "overwrite_generated": False,
    }).json()
    assert second["created"] == 0 and second["updated"] == 0 and second["skipped"] == 1


def test_standby_personnel_lists_agents_in_recovery(client, auth_headers):
    """Le personnel en récupération (rotation off, pas encore pointé) est listé."""
    day = "2027-06-10"
    site_id = _site(client, auth_headers, "Site Standby", rotation="1/1")
    # En 1/1 seul le groupe A travaille : B est donc en récupération
    _assign(client, auth_headers, _emp(client, auth_headers, "OPS_SBB"), site_id, group="B", start=day)

    r = client.get(f"/api/ops/pointage/standby?presence_date={day}&site_id={site_id}", headers=auth_headers)
    assert r.status_code == 200, r.text
    rows = r.json()
    assert len(rows) == 1
    assert rows[0]["group_code"] == "B"
    assert rows[0]["rotation_system"] == "1/1"
    assert rows[0]["site_id"] == site_id
    assert rows[0]["period"] == "recuperation"


def test_standby_excludes_already_pointed_agents(client, auth_headers):
    day = "2027-06-11"
    site_id = _site(client, auth_headers, "Site Standby Pointe", rotation="1/1")
    emp = _emp(client, auth_headers, "OPS_SBP")
    _assign(client, auth_headers, emp, site_id, group="B", start=day)

    assert len(client.get(f"/api/ops/pointage/standby?presence_date={day}&site_id={site_id}", headers=auth_headers).json()) == 1

    # Une fois pointé, l'agent sort du standby
    client.post("/api/ops/pointage/daily", headers=auth_headers, json={
        "presence_date": day, "employee_id": int(emp), "site_id": int(site_id), "status": "present",
    })
    assert client.get(f"/api/ops/pointage/standby?presence_date={day}&site_id={site_id}", headers=auth_headers).json() == []


def test_generate_rotation_skips_inactive_sites(client, auth_headers):
    day = "2027-06-12"
    site_id = _site(client, auth_headers, "Site Rotation Inactif", rotation="24/48", active=0)
    _assign(client, auth_headers, _emp(client, auth_headers, "OPS_ROTI"), site_id, group="A", start=day)

    r = client.post("/api/ops/pointage/daily/generate-rotation", headers=auth_headers, json={
        "presence_date": day, "site_id": site_id,
    }).json()
    assert r["created"] == 0 and r["skipped"] == 1 and r["sites"] == 0


# ═══════════════════════════════════════════════════════════════════════════
# Événements
# ═══════════════════════════════════════════════════════════════════════════

def test_event_lifecycle(client, auth_headers):
    site_id = _site(client, auth_headers, "Site Evenement")
    created = client.post("/api/ops/events", headers=auth_headers, json={
        "event_type": "incident", "level": "critique", "title": "Intrusion",
        "message": "Tentative d'intrusion perimetre nord", "site_id": site_id,
    })
    assert created.status_code in (200, 201), created.text
    ev = created.json()
    assert ev["status"] == "ouvert" and ev["closed_at"] is None

    ouverts = client.get("/api/ops/events?status=ouvert", headers=auth_headers).json()
    assert any(e["id"] == ev["id"] for e in ouverts)

    closed = client.post(f"/api/ops/events/{ev['id']}/close?action_taken=Ronde renforcee", headers=auth_headers)
    assert closed.status_code == 200
    assert closed.json()["status"] == "clos"
    assert closed.json()["closed_at"]
    assert closed.json()["action_taken"] == "Ronde renforcee"


def test_events_page_filters(client, auth_headers):
    client.post("/api/ops/events", headers=auth_headers, json={
        "level": "critique", "title": "EventFiltreUnique", "message": "msg",
    })
    page = client.get("/api/ops/events/page?level=critique&page=1&page_size=10", headers=auth_headers)
    assert page.status_code == 200
    body = page.json()
    assert "items" in body and body["total"] >= 1
    assert all(e["level"] == "critique" for e in body["items"])

    found = client.get("/api/ops/events/page?q=EventFiltreUnique", headers=auth_headers).json()["items"]
    assert any("EventFiltreUnique" in (e["title"] or "") for e in found)


def test_close_event_404(client, auth_headers):
    assert client.post("/api/ops/events/99999999/close", headers=auth_headers).status_code == 404


# ═══════════════════════════════════════════════════════════════════════════
# Mouvements
# ═══════════════════════════════════════════════════════════════════════════

def test_movement_upsert_is_deduplicated_by_external_id(client, auth_headers):
    payload = {
        "external_id": "MVT_EXT_1", "movement_number": "OM-2026-001",
        "movement_date": "2026-04-01", "movement_type": "affectation",
        "movement_reason": "Renfort", "society": SOCIETY,
    }
    first = client.post("/api/ops/movements", headers=auth_headers, json=payload)
    assert first.status_code in (200, 201), first.text
    assert first.json()["external_id"] == "MVT_EXT_1"

    # Même external_id -> mise à jour, pas de doublon
    second = client.post("/api/ops/movements", headers=auth_headers, json={**payload, "movement_reason": "Remplacement"})
    assert second.status_code in (200, 201), second.text
    assert second.json()["id"] == first.json()["id"], "Un même external_id doit être dédupliqué"

    listing = client.get(f"/api/ops/movements?society={SOCIETY}", headers=auth_headers)
    assert listing.status_code == 200
    assert listing.headers.get("X-Total-Count") is not None
    assert sum(1 for m in listing.json() if m["external_id"] == "MVT_EXT_1") == 1


def test_movement_with_date_is_json_serializable(client, auth_headers):
    """Non-régression : une movement_date doit être stockée en ISO dans data['_legacy'].
    Sinon l'objet date Python fait planter la sérialisation de la colonne JSON (500)."""
    r = client.post("/api/ops/movements", headers=auth_headers, json={
        "external_id": "MVT_DATE_1", "movement_date": "2026-04-15",
        "movement_type": "mutation", "society": SOCIETY,
    })
    assert r.status_code in (200, 201), r.text
    assert r.json()["movement_date"] == "2026-04-15"


def test_movements_count_matches_header(client, auth_headers, db):
    from app.modules.ops.service import count_movements
    r = client.get(f"/api/ops/movements?society={SOCIETY}", headers=auth_headers)
    assert int(r.headers["X-Total-Count"]) == count_movements(db, society=SOCIETY)


# ═══════════════════════════════════════════════════════════════════════════
# Cloisonnement par société (sécurité) — utilisateur limité à Iron Global Securite
# ═══════════════════════════════════════════════════════════════════════════

def _foreign_site(client, auth_headers, name="Site Etranger"):
    """Site rattaché à une société que l'utilisateur restreint n'a PAS le droit de voir."""
    r = client.post("/api/ops/sites", headers=auth_headers, json={
        "name": name, "indicatif": "ETR", "active": 1,
        "equipment_plan": {"societe": "Sword Corporation", "dateOuverture": "2020-01-01"},
    })
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


def test_restricted_user_only_sees_his_society_sites(client, auth_headers, restricted_headers):
    mine = _site(client, auth_headers, "Site Visible IGS")
    foreign = _foreign_site(client, auth_headers, "Site Invisible Sword")

    ids = {s["id"] for s in client.get("/api/ops/sites", headers=restricted_headers).json()}
    assert mine in ids
    assert foreign not in ids, "Un site d'une autre société est visible !"

    page_ids = {s["id"] for s in client.get("/api/ops/sites/page?page_size=100", headers=restricted_headers).json()["items"]}
    assert foreign not in page_ids


def test_restricted_user_cannot_open_foreign_site(client, auth_headers, restricted_headers):
    foreign = _foreign_site(client, auth_headers, "Site Sword Prive")
    assert client.get(f"/api/ops/sites/{foreign}", headers=restricted_headers).status_code == 403
    assert client.put(f"/api/ops/sites/{foreign}", headers=restricted_headers, json={"contractual_staff": 1}).status_code == 403
    assert client.delete(f"/api/ops/sites/{foreign}", headers=restricted_headers).status_code == 403


def test_restricted_user_cannot_create_site_for_foreign_society(client, restricted_headers):
    r = client.post("/api/ops/sites", headers=restricted_headers, json={
        "name": "Tentative Sword", "active": 1, "equipment_plan": {"societe": "Sword Corporation"},
    })
    assert r.status_code == 403


def test_restricted_user_cannot_assign_foreign_employee(client, auth_headers, restricted_headers):
    foreign_emp = _emp(client, auth_headers, "OPS_FEMP", society="Sword Corporation")
    mine = _site(client, auth_headers, "Site Aff Restreint")
    r = client.post("/api/ops/assignments", headers=restricted_headers, json={
        "employee_id": int(foreign_emp), "site_id": int(mine), "group_code": "A", "start_date": "2026-01-01",
    })
    assert r.status_code == 403


def test_restricted_user_situation_generale_is_scoped(client, auth_headers, restricted_headers):
    _foreign_site(client, auth_headers, "Site Sword Situation")
    data = client.get("/api/ops/sites/situation-generale", headers=restricted_headers).json()
    societies = {(r["site"].get("equipment_plan") or {}).get("societe") for r in data["sites"]}
    assert "Sword Corporation" not in societies
    # Les totaux sont recalculés sur le périmètre autorisé uniquement
    assert data["active_sites"] == sum(1 for r in data["sites"] if r["site"]["active"])


def test_restricted_user_cannot_list_foreign_movements(client, auth_headers, restricted_headers):
    assert client.get("/api/ops/movements?society=Sword Corporation", headers=restricted_headers).status_code == 403
    # Sa propre société passe
    assert client.get(f"/api/ops/movements?society={SOCIETY}", headers=restricted_headers).status_code == 200


def test_site_and_employee_404_before_403(client, restricted_headers):
    """Une cible inexistante renvoie 404, pas 403 (pas de fuite d'information inversée)."""
    assert client.get("/api/ops/sites/99999999", headers=restricted_headers).status_code == 404
    r = client.post("/api/ops/assignments", headers=restricted_headers, json={
        "employee_id": 99999999, "site_id": 99999999, "group_code": "A", "start_date": "2026-01-01",
    })
    assert r.status_code == 404
