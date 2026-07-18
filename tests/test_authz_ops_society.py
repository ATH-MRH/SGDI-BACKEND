"""Durcissement de l'axe SOCIÉTÉ sur OPS (findings de la revue adversariale).

Ferme les contournements par OMISSION de champ (create_daily_presence, movements),
ajoute le scope manquant sur update_daily_presence, scope les évènements, et réserve
les opérations globales (generate/close) aux non-restreints.
"""
SOC = "Iron Global Securite"
FOREIGN = "Sword Corporation"


def _emp(client, h, code, society=SOC):
    r = client.post("/api/drh/employees", headers=h, json={
        "code": code, "first_name": f"E{code}", "last_name": "Ops",
        "society": society, "status": "actif", "contract_type": "CDD",
    })
    assert r.status_code in (200, 201), r.text
    return r.json().get("id") or r.json().get("backendId")


def _site(client, h, name, society=SOC):
    r = client.post("/api/ops/sites", headers=h, json={
        "name": name, "indicatif": name[:3].upper(), "rotation_system": "24/48",
        "contractual_staff": 3, "active": 1, "equipment_plan": {"societe": society},
    })
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


# ── update_daily_presence : scope ajouté (avant : AUCUN) ─────────────────────

def test_restreint_ne_peut_pas_modifier_une_presence_etrangere(client, auth_headers, restricted_headers):
    emp = _emp(client, auth_headers, "OPSSOC_FP", society=FOREIGN)
    site = _site(client, auth_headers, "Site Presence Etr", society=FOREIGN)
    created = client.post("/api/ops/pointage/daily", headers=auth_headers, json={
        "presence_date": "2026-03-01", "employee_id": int(emp), "site_id": int(site), "status": "present",
    })
    assert created.status_code in (200, 201), created.text
    pid = created.json()["id"]
    r = client.patch(f"/api/ops/pointage/daily/{pid}", headers=restricted_headers, json={"status": "absent"})
    assert r.status_code == 403, r.text


# ── create_daily_presence : bypass par omission de site fermé (scope via employé) ──

def test_restreint_ne_peut_pas_pointer_un_employe_etranger(client, auth_headers, restricted_headers):
    emp = _emp(client, auth_headers, "OPSSOC_FP2", society=FOREIGN)
    r = client.post("/api/ops/pointage/daily", headers=restricted_headers, json={
        "presence_date": "2026-03-01", "employee_id": int(emp), "status": "present",  # PAS de site_id
    })
    assert r.status_code == 403, r.text


# ── movements : périmètre requis (fin du bypass par omission) ─────────────────

def test_restreint_mouvement_sans_perimetre_est_refuse(client, restricted_headers):
    r = client.post("/api/ops/movements", headers=restricted_headers, json={
        "movement_type": "affectation", "movement_date": "2026-03-01",  # ni employé, ni site, ni société
    })
    assert r.status_code == 403, r.text


def test_restreint_mouvement_dans_sa_societe_passe(client, restricted_headers):
    r = client.post("/api/ops/movements", headers=restricted_headers, json={
        "movement_type": "affectation", "movement_date": "2026-03-01", "society": SOC,
    })
    assert r.status_code in (200, 201), r.text


def test_restreint_mouvement_societe_etrangere_refuse(client, restricted_headers):
    r = client.post("/api/ops/movements", headers=restricted_headers, json={
        "movement_type": "affectation", "movement_date": "2026-03-01", "society": FOREIGN,
    })
    assert r.status_code == 403, r.text


# ── opérations globales réservées aux non-restreints ─────────────────────────

def test_restreint_ne_peut_pas_generer_ni_cloturer_globalement(client, restricted_headers):
    assert client.post("/api/ops/pointage/daily/generate", headers=restricted_headers).status_code == 403
    assert client.post("/api/ops/pointage/daily/close", headers=restricted_headers).status_code == 403


def test_admin_peut_generer_et_cloturer(client, auth_headers):
    assert client.post("/api/ops/pointage/daily/generate", headers=auth_headers).status_code == 200
    assert client.post("/api/ops/pointage/daily/close", headers=auth_headers).status_code == 200


# ── évènements : scopés (avant : globaux, sans user) ─────────────────────────

def test_restreint_evenement_sans_perimetre_refuse(client, restricted_headers):
    r = client.post("/api/ops/events", headers=restricted_headers, json={
        "title": "Alerte", "message": "Test",  # ni site ni employé
    })
    assert r.status_code == 403, r.text


def test_restreint_evenement_sur_site_etranger_refuse(client, auth_headers, restricted_headers):
    site = _site(client, auth_headers, "Site Evt Etr", society=FOREIGN)
    r = client.post("/api/ops/events", headers=restricted_headers, json={
        "title": "Alerte", "message": "Test", "site_id": int(site),
    })
    assert r.status_code == 403, r.text


def test_restreint_evenement_sur_son_site_passe(client, restricted_headers):
    site = _site(client, restricted_headers, "Site Evt Propre")
    r = client.post("/api/ops/events", headers=restricted_headers, json={
        "title": "Alerte", "message": "Test", "site_id": int(site),
    })
    assert r.status_code in (200, 201), r.text
