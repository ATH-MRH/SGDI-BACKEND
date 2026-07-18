"""Micro-passe sécurité présence / FPQ — dispatcher /api/irongs/actions.

Verrouille les écritures présence non couvertes par le cloisonnement société :
  - upsert-presence-line / add-presence-agent / assign-vacant-agent
  - save-presence-movement (+ ordre de mouvement opsMouvements)
  - close-presence-day (clôture globale par jour, interdite à un profil cloisonné)

Axes vérifiés : agent cible, site cible (equipment_plan.societe), société directe.
"""
import pytest

from app.core.security import hash_password
from app.modules.auth.models import User
from app.modules.irongs import service as irongs_service

SOC = "Iron Global Securite"
FOREIGN = "Sword Corporation"


def _hdr(client, username):
    r = client.post("/api/auth/login", json={"username": username, "password": "testpass123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _seed_agent(db, agent_id, society):
    if not any(isinstance(a, dict) and a.get("id") == agent_id for a in irongs_service.list_items(db, "agents")):
        irongs_service.create_item(db, "agents", {"id": agent_id, "code": agent_id, "nom": "X", "societe": society})


@pytest.fixture
def h3_soc_a(client, db):
    if not db.query(User).filter(User.username == "fpq_h3_a").first():
        db.add(User(
            username="fpq_h3_a", email="fpq@t.com", full_name="FPQ H3 A",
            role="rh", access_level="H3", authorized_societies=[SOC],
            authorized_structures=[], password_hash=hash_password("testpass123"), is_active=True,
        ))
        db.commit()
    return _hdr(client, "fpq_h3_a")


# ── Écritures présence inter-sociétés refusées (agent d'une autre société) ────

def test_upsert_presence_line_agent_autre_societe_refuse(client, db, h3_soc_a):
    _seed_agent(db, "FPQ_B1", FOREIGN)
    r = client.post("/api/irongs/actions/upsert-presence-line", headers=h3_soc_a,
                    json={"data": {"date": "2026-09-02", "agentId": "FPQ_B1", "patch": {"heureArrivee": "08:00"}}})
    assert r.status_code == 403, r.text


def test_add_presence_agent_autre_societe_refuse(client, db, h3_soc_a):
    _seed_agent(db, "FPQ_B2", FOREIGN)
    r = client.post("/api/irongs/actions/add-presence-agent", headers=h3_soc_a,
                    json={"data": {"date": "2026-09-02", "agentId": "FPQ_B2", "patch": {}}})
    assert r.status_code == 403, r.text


def test_save_presence_movement_autre_societe_refuse(client, db, h3_soc_a):
    _seed_agent(db, "FPQ_B3", FOREIGN)
    r = client.post("/api/irongs/actions/save-presence-movement", headers=h3_soc_a,
                    json={"data": {"date": "2026-09-02", "agentId": "FPQ_B3",
                                   "patch": {"mouvementType": "affectation", "mouvementMotif": "test"}}})
    assert r.status_code == 403, r.text


def test_upsert_presence_line_site_autre_societe_refuse(client, db, h3_soc_a, auth_headers):
    """Dimension SITE : agent autorisé (SOC) mais siteId d'une autre société -> 403."""
    _seed_agent(db, "FPQ_A_SITE", SOC)
    site = client.post("/api/ops/sites", headers=auth_headers,
                       json={"name": "FPQ SITE B", "equipment_plan": {"societe": FOREIGN}})
    assert site.status_code in (200, 201), site.text
    r = client.post("/api/irongs/actions/upsert-presence-line", headers=h3_soc_a,
                    json={"data": {"date": "2026-09-03", "agentId": "FPQ_A_SITE",
                                   "patch": {"site_id": site.json()["id"], "heureArrivee": "08:00"}}})
    assert r.status_code == 403, r.text


# ── Clôture globale de la journée interdite à un profil cloisonné ────────────

def test_close_presence_day_restreint_refuse(client, h3_soc_a):
    r = client.post("/api/irongs/actions/close-presence-day", headers=h3_soc_a,
                    json={"data": {"date": "2026-09-04"}})
    assert r.status_code == 403, r.text


# ── Non-régression : périmètre légitime & admin ──────────────────────────────

def test_upsert_presence_line_propre_societe_ok(client, db, h3_soc_a):
    _seed_agent(db, "FPQ_A_OK", SOC)
    r = client.post("/api/irongs/actions/upsert-presence-line", headers=h3_soc_a,
                    json={"data": {"date": "2026-09-05", "agentId": "FPQ_A_OK", "patch": {"heureArrivee": "08:00"}}})
    assert r.status_code == 200, r.text


def test_admin_upsert_presence_line_toute_societe_ok(client, db, auth_headers):
    _seed_agent(db, "FPQ_B_ADM", FOREIGN)
    r = client.post("/api/irongs/actions/upsert-presence-line", headers=auth_headers,
                    json={"data": {"date": "2026-09-06", "agentId": "FPQ_B_ADM", "patch": {"heureArrivee": "08:00"}}})
    assert r.status_code == 200, r.text


def test_admin_close_presence_day_ok(client, auth_headers):
    r = client.post("/api/irongs/actions/close-presence-day", headers=auth_headers,
                    json={"data": {"date": "2026-09-07"}})
    # Admin (non cloisonné) passe la garde société ; 200 (clôture) ou 422 (déjà clôturée),
    # jamais 403.
    assert r.status_code in (200, 422), r.text


def test_h5_avec_societes_close_presence_day_pas_de_faux_403(client, db):
    """Un H5 (illimité par niveau) avec des sociétés listées ne doit PAS recevoir un
    faux 403 sur close-presence-day (is_unrestricted inclut H5, pas seulement les
    sociétés vides)."""
    if not db.query(User).filter(User.username == "fpq_h5_soc").first():
        db.add(User(
            username="fpq_h5_soc", email="h5@t.com", full_name="H5 Soc",
            role="ops", access_level="H5", authorized_societies=[SOC],
            authorized_structures=[], password_hash=hash_password("testpass123"), is_active=True,
        ))
        db.commit()
    hdr = _hdr(client, "fpq_h5_soc")
    r = client.post("/api/irongs/actions/close-presence-day", headers=hdr,
                    json={"data": {"date": "2026-09-08"}})
    assert r.status_code in (200, 422), r.text  # jamais 403
