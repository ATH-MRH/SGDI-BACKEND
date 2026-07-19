"""CRUD Incidents / Main courante (module pilote de la reconstruction frontend v2).

Vérifie : parité des champs (date/heure/catégorie/gravité/sujet/consigne/destinataire/
historique), les 7 KPI du dashboard, l'axe NIVEAU (create=H2, clôture=H3) et le
cloisonnement SOCIÉTÉ (corrige la fuite « site orphelin visible partout » du legacy).
"""
import pytest

from app.core.security import hash_password
from app.modules.auth.models import User

SOC = "Iron Global Securite"
FOREIGN = "Sword Corporation"


def _hdr(client, username):
    r = client.post("/api/auth/login", json={"username": username, "password": "testpass123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture
def h2_soc(client, db):
    if not db.query(User).filter(User.username == "inc_h2").first():
        db.add(User(username="inc_h2", email="inc2@t.com", full_name="Inc H2", role="ops",
                    access_level="H2", authorized_societies=[SOC], authorized_structures=[],
                    password_hash=hash_password("testpass123"), is_active=True))
        db.commit()
    return _hdr(client, "inc_h2")


def test_create_incident_parite_champs(client, auth_headers):
    payload = {
        "incident_date": "2026-07-19", "incident_time": "08:30", "event_type": "site",
        "category": "Sécurité", "severity": "majeur", "subject": "Intrusion détectée",
        "description": "Tentative sur le portail nord", "consigne": "Renforcer la ronde",
        "destinataire": "OPS", "status": "en_cours", "society": SOC,
    }
    r = client.post("/api/ops/incidents", headers=auth_headers, json=payload)
    assert r.status_code in (200, 201), r.text
    inc = r.json()
    # Tous les champs legacy sont préservés (dont consigne/destinataire/historique via data).
    for k in ("incident_date", "incident_time", "event_type", "category", "severity",
              "subject", "description", "consigne", "destinataire", "status", "society"):
        assert inc[k] == payload[k], (k, inc[k], payload[k])
    assert inc["actions"] and inc["actions"][0]["type"] == "creation"


def test_dashboard_7_kpi(client, auth_headers):
    # 2 incidents site (1 critique), 1 autre, 1 clos.
    base = {"society": SOC}
    client.post("/api/ops/incidents", headers=auth_headers, json={**base, "event_type": "site", "severity": "critique", "subject": "A"})
    client.post("/api/ops/incidents", headers=auth_headers, json={**base, "event_type": "site", "severity": "mineur", "subject": "B"})
    client.post("/api/ops/incidents", headers=auth_headers, json={**base, "event_type": "autre", "subject": "C"})
    d = client.get("/api/ops/incidents/dashboard", headers=auth_headers).json()
    k = d["kpis"]
    assert set(k) == {"total", "site", "autres", "ouverts", "critiques", "clos", "aujourdhui"}
    assert k["autres"] >= 1 and k["site"] >= 2 and k["critiques"] >= 1
    assert isinstance(d["alertes"], list) and len(d["alertes"]) <= 6


def test_page_filtre_type_et_pagination(client, auth_headers):
    page = client.get("/api/ops/incidents/page?event_type=autre&page_size=5", headers=auth_headers).json()
    assert set(page) == {"items", "total", "page", "page_size", "pages"}
    assert all(i["event_type"] == "autre" for i in page["items"])


def test_actions_acquitter_escalader_cloturer(client, auth_headers):
    inc = client.post("/api/ops/incidents", headers=auth_headers, json={"society": SOC, "severity": "mineur", "subject": "Flux"}).json()
    iid = inc["id"]
    # Escalade : statut -> en_cours, gravité -> majeur, historique +1.
    r = client.post(f"/api/ops/incidents/{iid}/action", headers=auth_headers, json={"action": "escalader", "note": "monte"})
    assert r.status_code == 200, r.text
    assert r.json()["severity"] == "majeur" and r.json()["status"] == "en_cours"
    # Clôture : statut -> clos.
    r2 = client.post(f"/api/ops/incidents/{iid}/action", headers=auth_headers, json={"action": "cloturer"})
    assert r2.status_code == 200 and r2.json()["status"] == "clos"
    assert any(a["type"] == "Clôturé" for a in r2.json()["actions"])


# ── Axe NIVEAU ───────────────────────────────────────────────────────────────

def test_h1_ne_peut_pas_creer(client, db):
    if not db.query(User).filter(User.username == "inc_h1").first():
        db.add(User(username="inc_h1", email="inc1@t.com", full_name="Inc H1", role="ops",
                    access_level="H1", authorized_societies=[SOC], authorized_structures=[],
                    password_hash=hash_password("testpass123"), is_active=True))
        db.commit()
    r = client.post("/api/ops/incidents", headers=_hdr(client, "inc_h1"), json={"society": SOC, "subject": "x"})
    assert r.status_code == 403


def test_h2_ne_peut_pas_cloturer(client, auth_headers, h2_soc):
    inc = client.post("/api/ops/incidents", headers=auth_headers, json={"society": SOC, "subject": "y"}).json()
    r = client.post(f"/api/ops/incidents/{inc['id']}/action", headers=h2_soc, json={"action": "cloturer"})
    assert r.status_code == 403, r.text  # clôture = validation (H3)


# ── Cloisonnement SOCIÉTÉ (corrige la fuite legacy) ──────────────────────────

def test_incident_autre_societe_invisible_et_verrouille(client, auth_headers, restricted_headers):
    # Incident FOREIGN créé par l'admin ; l'utilisateur restreint à SOC ne doit ni le voir ni y toucher.
    inc = client.post("/api/ops/incidents", headers=auth_headers, json={"society": FOREIGN, "subject": "secret"}).json()
    ids = {i["id"] for i in client.get("/api/ops/incidents", headers=restricted_headers).json()}
    assert inc["id"] not in ids
    assert client.get(f"/api/ops/incidents/{inc['id']}", headers=restricted_headers).status_code == 403
    assert client.post(f"/api/ops/incidents/{inc['id']}/action", headers=restricted_headers,
                       json={"action": "acquitter"}).status_code == 403
