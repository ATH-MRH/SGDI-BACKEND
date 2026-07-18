"""Régression — 2e passe adversariale de confirmation (effets de second ordre).

La 1re passe a confirme les 37 contournements fermes ; la passe de confirmation a
trouve des endpoints FRERES de meme classe non couverts + 1 regression. Corriges ici :
  - OPS  : GET /pointage/standby et GET /movements ignoraient le profil « restreint par
           SITE seul » (authorized_sites rempli, authorized_societies vide).
  - ronde: idem, le module ignorait authorized_sites -> fail-closed au global.
  - irongs REGRESSION /db : le durcissement is_unrestricted cassait la sauvegarde
           frontend d'un compte H2+ « voit tout » ; corrige en require_level(write) route
           + garde societe _snapshot_unrestricted (H1 reste bloque).
  - irongs branches soeurs du dispatcher /actions sans garde societe :
           delete-employee-fiche, unlock-pointage (single), upsert-presence-line, create-item.
  - durcissements: PUT society="" ; materiel site sans societe (fail-closed indu).
"""
import pytest

from app.core.security import hash_password
from app.modules.auth.models import User
from app.modules.drh.models import Employee
from app.modules.irongs import service as irongs_service

SOC = "Iron Global Securite"
FOREIGN = "Sword Corporation"


def _hdr(client, username):
    r = client.post("/api/auth/login", json={"username": username, "password": "testpass123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _mk(db, username, role, level, societies, sites=None):
    if not db.query(User).filter(User.username == username).first():
        db.add(User(
            username=username, email=f"{username}@t.com", full_name=username,
            role=role, access_level=level, authorized_societies=societies,
            authorized_sites=sites or [], authorized_structures=[],
            password_hash=hash_password("testpass123"), is_active=True,
        ))
        db.commit()


# ── OPS : restreint par SITE seul — standby + movements ──────────────────────

def test_ops_standby_et_movements_restreint_par_site_ne_fuit_pas(client, db, auth_headers):
    DAY = "2026-08-10"
    sa = client.post("/api/ops/sites", headers=auth_headers, json={"name": "R2 SITE A", "equipment_plan": {"societe": SOC}})
    sb = client.post("/api/ops/sites", headers=auth_headers, json={"name": "R2 SITE B", "equipment_plan": {"societe": FOREIGN}})
    sa_id, sb_id = sa.json()["id"], sb.json()["id"]

    ea = Employee(code="R2EA", first_name="A", last_name="A", society=SOC, status="actif", phone="111")
    eb = Employee(code="R2EB", first_name="B", last_name="B", society=FOREIGN, status="actif", phone="222")
    db.add_all([ea, eb]); db.commit()

    # Mouvements dans chaque société/site.
    for eid, sid, soc in ((ea.id, sa_id, SOC), (eb.id, sb_id, FOREIGN)):
        r = client.post("/api/ops/movements", headers=auth_headers, json={
            "external_id": f"R2MV_{sid}", "employee_id": eid, "site_id": sid, "society": soc,
            "movement_type": "affectation",
        })
        assert r.status_code in (200, 201), r.text

    _mk(db, "r2_site_a", "ops", "H2", [], sites=[sa_id])
    hdr = _hdr(client, "r2_site_a")

    # /movements : ne doit contenir que le site autorisé.
    mv = client.get("/api/ops/movements", headers=hdr).json()
    mv_sites = {m["site_id"] for m in mv}
    assert sb_id not in mv_sites, "fuite : mouvement d'un site d'une autre société visible"

    # /pointage/standby : ne doit pas exposer le roster de l'autre société (pas de site_id 5 partagé).
    sb_rows = client.get(f"/api/ops/pointage/standby?presence_date={DAY}", headers=hdr).json()
    assert all(r.get("site_id") == sa_id for r in sb_rows), "fuite : roster standby inter-sociétés"


def test_ops_standby_et_movements_restreint_par_site_param_society_ne_fuit_pas(client, db, auth_headers):
    """Contournement via ?society=B : un « restreint par SITE seul » ne doit PAS voir
    le périmètre d'une autre société même en passant le paramètre society."""
    DAY = "2026-08-11"
    sa = client.post("/api/ops/sites", headers=auth_headers, json={"name": "R2P SITE A", "equipment_plan": {"societe": SOC}})
    sb = client.post("/api/ops/sites", headers=auth_headers, json={"name": "R2P SITE B", "equipment_plan": {"societe": FOREIGN}})
    sa_id, sb_id = sa.json()["id"], sb.json()["id"]
    eb = Employee(code="R2PEB", first_name="B", last_name="B", society=FOREIGN, status="actif", phone="222")
    db.add(eb); db.commit()
    r = client.post("/api/ops/movements", headers=auth_headers, json={
        "external_id": "R2PMV_B", "employee_id": eb.id, "site_id": sb_id, "society": FOREIGN, "movement_type": "affectation",
    })
    assert r.status_code in (200, 201), r.text

    _mk(db, "r2p_site_a", "ops", "H2", [], sites=[sa_id])
    hdr = _hdr(client, "r2p_site_a")

    # Le paramètre society=FOREIGN ne doit rien exfiltrer de la société étrangère.
    mv = client.get(f"/api/ops/movements?society={FOREIGN}", headers=hdr).json()
    assert all(m["site_id"] == sa_id for m in mv), "fuite : ?society=B expose les mouvements d'une autre société"
    sbrows = client.get(f"/api/ops/pointage/standby?presence_date={DAY}&society={FOREIGN}", headers=hdr).json()
    assert all(r.get("site_id") == sa_id for r in sbrows), "fuite : ?society=B expose le roster d'une autre société"


# ── ronde : restreint par SITE seul -> fail-closed au global ─────────────────

def test_ronde_restreint_par_site_ne_voit_que_global(client, db, auth_headers):
    soc_c = client.post("/api/ronde/circuits", headers=auth_headers, json={"name": "R2 ronde SOC", "societe": FOREIGN})
    glob_c = client.post("/api/ronde/circuits", headers=auth_headers, json={"name": "R2 ronde GLOBAL"})  # sans société
    assert soc_c.status_code in (200, 201) and glob_c.status_code in (200, 201)
    soc_id, glob_id = soc_c.json()["id"], glob_c.json()["id"]

    _mk(db, "r2_ronde_site", "ops", "H4", [], sites=[999])
    hdr = _hdr(client, "r2_ronde_site")

    ids = {c["id"] for c in client.get("/api/ronde/circuits", headers=hdr).json()}
    assert soc_id not in ids, "fuite : circuit d'une société visible par un restreint-par-site"
    assert glob_id in ids, "le circuit global doit rester visible"
    # Écriture sur une société nommée refusée ; lecture directe d'un circuit société refusée.
    assert client.get(f"/api/ronde/circuits/{soc_id}", headers=hdr).status_code == 403
    assert client.put(f"/api/ronde/circuits/{soc_id}", headers=hdr, json={"name": "X"}).status_code == 403
    assert client.post("/api/ronde/circuits", headers=hdr, json={"name": "Y", "societe": FOREIGN}).status_code == 403


# ── irongs /db : régression corrigée (H2 voit-tout OK, H1 bloqué) ────────────

def test_irongs_db_h2_voit_tout_peut_sauvegarder(client, db):
    """Un compte H2 non-admin à sociétés vides (« voit tout ») doit pouvoir sauvegarder
    via PUT /db (chemin frontend) — la 1re correction (is_unrestricted) le cassait."""
    _mk(db, "r2_h2_all", "rh", "H2", [])
    hdr = _hdr(client, "r2_h2_all")
    r = client.put("/api/irongs/db", headers=hdr, json={"data": {"prospects": []}})
    assert r.status_code == 200, r.text


def test_irongs_db_h1_reste_bloque(client, db):
    _mk(db, "r2_h1_all", "rh", "H1", [])
    hdr = _hdr(client, "r2_h1_all")
    r = client.put("/api/irongs/db", headers=hdr, json={"data": {"prospects": []}})
    assert r.status_code == 403, r.text
    assert "niveau" in r.json()["detail"].lower()


# ── irongs /actions : branches sœurs cloisonnées par société ─────────────────

@pytest.fixture
def h4_soc_a(client, db):
    _mk(db, "r2_h4_a", "rh", "H4", [SOC])
    return _hdr(client, "r2_h4_a")


def test_irongs_delete_employee_fiche_autre_societe_refuse(client, db, h4_soc_a):
    # Agent d'une AUTRE société dans la collection legacy « agents ».
    agents = irongs_service.list_items(db, "agents")
    if not any(isinstance(a, dict) and a.get("id") == "R2AGF" for a in agents):
        irongs_service.create_item(db, "agents", {"id": "R2AGF", "code": "R2AGF", "nom": "X", "societe": FOREIGN})
    r = client.post("/api/irongs/actions/delete-employee-fiche", headers=h4_soc_a,
                    json={"item_id": "R2AGF"})
    assert r.status_code == 403, r.text


def test_irongs_unlock_pointage_autre_societe_refuse(client, db, h4_soc_a):
    agents = irongs_service.list_items(db, "agents")
    if not any(isinstance(a, dict) and a.get("id") == "R2AGU" for a in agents):
        irongs_service.create_item(db, "agents", {"id": "R2AGU", "code": "R2AGU", "nom": "X", "societe": FOREIGN})
    r = client.post("/api/irongs/actions/unlock-pointage", headers=h4_soc_a,
                    json={"data": {"agentId": "R2AGU", "periode": "2026-07"}})
    assert r.status_code == 403, r.text


def test_irongs_upsert_presence_line_autre_societe_refuse(client, db, restricted_headers):
    agents = irongs_service.list_items(db, "agents")
    if not any(isinstance(a, dict) and a.get("id") == "R2AGP" for a in agents):
        irongs_service.create_item(db, "agents", {"id": "R2AGP", "code": "R2AGP", "nom": "X", "societe": FOREIGN})
    r = client.post("/api/irongs/actions/upsert-presence-line", headers=restricted_headers,
                    json={"data": {"date": "2026-07-20", "agentId": "R2AGP", "patch": {"heureArrivee": "08:00"}}})
    assert r.status_code == 403, r.text


def test_irongs_create_item_autre_societe_refuse(client, restricted_headers):
    r = client.post("/api/irongs/actions/create-item", headers=restricted_headers,
                    json={"collection": "prospects", "data": {"nom": "X", "societe": FOREIGN}})
    assert r.status_code == 403, r.text


# ── Durcissements ────────────────────────────────────────────────────────────

def test_achats_put_fournisseur_society_vide_refuse(client, auth_headers, restricted_headers):
    """society="" ne doit plus orpheliner un record (court-circuit du garde de déplacement)."""
    created = client.post("/api/achats/fournisseurs", headers=auth_headers, json={"name": "R2 Fourn", "society": SOC})
    fid = created.json()["id"]
    r = client.put(f"/api/achats/fournisseurs/{fid}", headers=restricted_headers, json={"society": "", "name": "Z"})
    assert r.status_code == 403, r.text


def test_materiel_dotation_site_sans_societe_ne_bloque_pas(client, auth_headers, db):
    """Un site sans société dans equipment_plan ne doit pas provoquer un 403 fail-closed
    pour un utilisateur cloisonné légitime (régression de disponibilité)."""
    site = client.post("/api/ops/sites", headers=auth_headers, json={"name": "R2 SITE NOSOC"})  # pas de société
    site_id = site.json()["id"]
    store = client.post("/api/materiel/stores", headers=auth_headers, json={"name": "R2 STORE", "society": SOC})
    assert store.status_code in (200, 201), store.text
    art = client.post("/api/materiel/articles", headers=auth_headers, json={
        "code": "R2ART", "designation": "R2 ART", "society": SOC, "store_id": store.json()["id"],
    })
    assert art.status_code in (200, 201), art.text
    art_id = art.json()["id"]
    _mk(db, "r2_mat_a", "rh", "H2", [SOC])
    hdr = _hdr(client, "r2_mat_a")
    r = client.post("/api/materiel/dotations", headers=hdr, json={
        "article_id": art_id, "target_type": "site", "site_id": site_id, "quantity": 1,
    })
    # Ne doit PAS renvoyer 403 « Société non autorisée » (site sans société -> pas de verrou).
    assert r.status_code != 403, r.text
