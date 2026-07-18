"""Régression — corrections de la vérification adversariale finale (flotte 12 agents).

Chaque test verrouille un contournement CONFIRMÉ par la flotte, regroupé par patron :
  A  hijack inter-sociétés via `payload.society or existing.society` (le `or` masquait
     la société réelle du record)                → accounting, achats
  C  prise de contrôle par clé naturelle         → drh /generated-contracts/from-form
  D  module ronde sans cloisonnement société     → circuits
  F  dispatcher irongs /actions mono-gate `write` → delete/validate rétrogradés
  G  irongs PUT/POST /db gardé par sociétés-vides → un non-admin « voit tout » écrivait
  cal calibrage strict des niveaux (clôture=validate H3, suppression=delete H4,
     génération=generate H3)                      → accounting, drh, irongs
"""
import pytest

from app.core.security import hash_password
from app.modules.auth.models import User
from app.modules.drh.models import Employee
from app.modules.irongs import service as irongs_service

SOC = "Iron Global Securite"
FOREIGN = "Sword Corporation"


def _mk_user(db, username, role, level, societies):
    if not db.query(User).filter(User.username == username).first():
        db.add(User(
            username=username, email=f"{username}@t.com", full_name=username,
            role=role, access_level=level, authorized_societies=societies,
            authorized_structures=[], password_hash=hash_password("testpass123"), is_active=True,
        ))
        db.commit()


def _hdr(client, username):
    r = client.post("/api/auth/login", json={"username": username, "password": "testpass123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture
def h2_soc_a(client, db):
    """Saisie (H2) restreint à la société A — ne doit ni valider, ni générer, ni supprimer."""
    _mk_user(db, "adv_h2_a", "rh", "H2", [SOC])
    return _hdr(client, "adv_h2_a")


@pytest.fixture
def empty_h1(client, db):
    """H1 non-admin avec authorized_societies vide (= « voit tout » en lecture)."""
    _mk_user(db, "adv_empty_h1", "rh", "H1", [])
    return _hdr(client, "adv_empty_h1")


# ── Patron A : hijack inter-sociétés sur les PUT (accounting, achats) ─────────

def test_A_accounting_put_compte_autre_societe_refuse(client, auth_headers, restricted_headers):
    created = client.post("/api/accounting/comptes", headers=auth_headers, json={
        "numero": "ADVA100", "libelle": "C", "type_compte": "charge", "society": FOREIGN,
    })
    assert created.status_code in (200, 201), created.text
    cid = created.json()["id"]
    # L'utilisateur restreint à SOC tente de « voler » le compte de FOREIGN en le réassignant.
    r = client.put(f"/api/accounting/comptes/{cid}", headers=restricted_headers,
                   json={"society": SOC, "libelle": "HACKED"})
    assert r.status_code == 403, r.text


def test_A_achats_put_fournisseur_autre_societe_refuse(client, auth_headers, restricted_headers):
    created = client.post("/api/achats/fournisseurs", headers=auth_headers, json={
        "name": "Fourn FOREIGN", "society": FOREIGN,
    })
    assert created.status_code in (200, 201), created.text
    fid = created.json()["id"]
    r = client.put(f"/api/achats/fournisseurs/{fid}", headers=restricted_headers,
                   json={"society": SOC, "name": "HACKED"})
    assert r.status_code == 403, r.text


# ── Patron cal : suppression de ligne comptable = delete (H4) ────────────────

def test_cal_accounting_delete_ligne_exige_delete(client, auth_headers, restricted_headers):
    ec = client.post("/api/accounting/ecritures", headers=auth_headers, json={
        "society": SOC, "date_ecriture": "2026-05-01", "libelle": "E", "journal": "ACH",
        "lignes": [
            {"compte_numero": "ADVL1", "debit": 100, "credit": 0},
            {"compte_numero": "ADVL2", "debit": 0, "credit": 100},
        ],
    })
    assert ec.status_code in (200, 201), ec.text
    eid = ec.json()["id"]
    lignes = client.get(f"/api/accounting/ecritures/{eid}", headers=auth_headers).json()["lignes"]
    lid = lignes[0]["id"]
    # H3 (restricted) < H4 : la suppression de ligne est désormais réservée à delete.
    r = client.delete(f"/api/accounting/ecritures/{eid}/lignes/{lid}", headers=restricted_headers)
    assert r.status_code == 403, r.text
    assert "niveau" in r.json()["detail"].lower()


# ── Patron C + cal : drh /generated-contracts/from-form ──────────────────────

def test_C_drh_from_form_employe_autre_societe_refuse(client, db, restricted_headers):
    """Un employé EXISTANT d'une autre société (résolu par matricule) ne peut être
    ni réassigné ni écrasé par un utilisateur restreint."""
    if not db.query(Employee).filter(Employee.code == "SWX01").first():
        db.add(Employee(code="SWX01", first_name="Cible", last_name="Sword", society=FOREIGN, status="actif"))
        db.commit()
    r = client.post("/api/drh/generated-contracts/from-form", headers=restricted_headers, json={
        "first_name": "Cible", "last_name": "Sword", "society": SOC, "matricule": "SWX01",
    })
    assert r.status_code == 403, r.text


def test_cal_drh_generate_from_form_exige_generate(client, h2_soc_a):
    # H2 (saisie) < H3 : la génération de contrat exige désormais generate (H3).
    r = client.post("/api/drh/generated-contracts/from-form", headers=h2_soc_a, json={
        "first_name": "Nouveau", "last_name": "Candidat", "society": SOC,
    })
    assert r.status_code == 403, r.text
    assert "niveau" in r.json()["detail"].lower()


# ── Patron D : module ronde — cloisonnement société ──────────────────────────

def test_D_ronde_circuit_autre_societe_invisible_et_verrouille(client, auth_headers, restricted_headers):
    created = client.post("/api/ronde/circuits", headers=auth_headers,
                          json={"name": "Circuit FOREIGN", "societe": FOREIGN})
    assert created.status_code in (200, 201), created.text
    cid = created.json()["id"]

    # Liste : le circuit de FOREIGN ne doit pas apparaître pour un utilisateur SOC.
    ids = {c["id"] for c in client.get("/api/ronde/circuits", headers=restricted_headers).json()}
    assert cid not in ids

    # Lecture directe et modification : refus société.
    assert client.get(f"/api/ronde/circuits/{cid}", headers=restricted_headers).status_code == 403
    assert client.put(f"/api/ronde/circuits/{cid}", headers=restricted_headers,
                      json={"name": "HACKED"}).status_code == 403


def test_D_ronde_creation_dans_autre_societe_refuse(client, restricted_headers):
    r = client.post("/api/ronde/circuits", headers=restricted_headers,
                    json={"name": "X", "societe": FOREIGN})
    assert r.status_code == 403, r.text


def test_D_ronde_propre_societe_ok(client, restricted_headers):
    """Non-régression : l'utilisateur reste pleinement opérationnel sur SA société."""
    r = client.post("/api/ronde/circuits", headers=restricted_headers,
                    json={"name": "Circuit SOC", "societe": SOC})
    assert r.status_code in (200, 201), r.text
    cid = r.json()["id"]
    assert client.get(f"/api/ronde/circuits/{cid}", headers=restricted_headers).status_code == 200


# ── Patron F : dispatcher irongs /actions — niveau par action ────────────────

def test_F_irongs_delete_item_exige_delete(client, restricted_headers):
    # H3 < H4 : delete-item (suppression) ne doit plus passer au niveau write.
    r = client.post("/api/irongs/actions/delete-item", headers=restricted_headers,
                    json={"collection": "prospects", "item_id": "inexistant"})
    assert r.status_code == 403, r.text
    assert "niveau" in r.json()["detail"].lower()


def test_F_irongs_validate_pointage_exige_validate(client, h2_soc_a):
    # H2 < H3 : validate-pointage (validation) ne doit plus passer au niveau write.
    r = client.post("/api/irongs/actions/validate-pointage", headers=h2_soc_a,
                    json={"data": {"agentId": "x", "periode": "2026-07"}})
    assert r.status_code == 403, r.text
    assert "niveau" in r.json()["detail"].lower()


# ── Patron G : irongs PUT/POST /db réservé à l'administration système ─────────

def test_G_irongs_db_replace_refuse_non_admin_societes_vides(client, empty_h1):
    """Un H1 non-admin avec authorized_societies vide (= « voit tout ») ne doit PAS
    pouvoir réécrire la base globale (auparavant autorisé par _snapshot_unrestricted)."""
    r = client.put("/api/irongs/db", headers=empty_h1, json={"data": {"prospects": []}})
    assert r.status_code == 403, r.text
    r2 = client.post("/api/irongs/db", headers=empty_h1, json={"data": {"prospects": []}})
    assert r2.status_code == 403, r2.text


# ── Patron B : OPS — utilisateur restreint PAR SITE (society vide) ────────────

def test_B_ops_pointage_daily_restreint_par_site_ne_fuit_pas(client, db, auth_headers):
    """Un utilisateur restreint par SITE (authorized_sites non vide, authorized_societies
    vide) ne doit voir QUE les présences de ses sites — l'ancien `_employee_in_scope`
    laissait fuiter TOUTES les présences (rattachées à un employé) inter-sociétés."""
    DAY = "2026-06-15"
    # Sites dans deux sociétés distinctes.
    sa = client.post("/api/ops/sites", headers=auth_headers,
                     json={"name": "SITE ADV A", "equipment_plan": {"societe": SOC}})
    sb = client.post("/api/ops/sites", headers=auth_headers,
                     json={"name": "SITE ADV B", "equipment_plan": {"societe": FOREIGN}})
    assert sa.status_code in (200, 201) and sb.status_code in (200, 201), (sa.text, sb.text)
    sa_id, sb_id = sa.json()["id"], sb.json()["id"]

    # Employés + présences dans chaque société.
    ea = Employee(code="ADVEA", first_name="A", last_name="A", society=SOC, status="actif")
    eb = Employee(code="ADVEB", first_name="B", last_name="B", society=FOREIGN, status="actif")
    db.add_all([ea, eb])
    db.commit()
    pa = client.post("/api/ops/pointage/daily", headers=auth_headers,
                     json={"presence_date": DAY, "employee_id": ea.id, "site_id": sa_id})
    pb = client.post("/api/ops/pointage/daily", headers=auth_headers,
                     json={"presence_date": DAY, "employee_id": eb.id, "site_id": sb_id})
    assert pa.status_code in (200, 201) and pb.status_code in (200, 201), (pa.text, pb.text)

    # Utilisateur restreint UNIQUEMENT au site A (aucune société autorisée).
    if not db.query(User).filter(User.username == "adv_site_a").first():
        db.add(User(
            username="adv_site_a", email="sa@t.com", full_name="Site A",
            role="ops", access_level="H2", authorized_societies=[],
            authorized_sites=[sa_id], authorized_structures=[],
            password_hash=hash_password("testpass123"), is_active=True,
        ))
        db.commit()
    hdr = _hdr(client, "adv_site_a")

    rows = client.get(f"/api/ops/pointage/daily?presence_date={DAY}", headers=hdr).json()
    site_ids = {r["site_id"] for r in rows}
    assert sb_id not in site_ids, "fuite : présence d'un site d'une autre société visible"
    assert sa_id in site_ids, "le site autorisé doit rester visible"


# ── Patron E : portal — annuaire des comptes cloisonné par société ───────────

def test_E_portal_accounts_cloisonne_par_societe(client, db, restricted_headers):
    for mid, soc in (("advp_soc", SOC), ("advp_foreign", FOREIGN)):
        if not any(a.get("id") == mid for a in irongs_service.list_items(db, "portalAccounts") if isinstance(a, dict)):
            irongs_service.create_item(db, "portalAccounts", {
                "id": mid, "username": mid, "matricule": mid.upper(),
                "nom": "N", "prenom": "P", "societe": soc, "active": True,
                "passwordHash": hash_password("x"),
            })
    matricules = {a.get("matricule") for a in client.get("/api/portal/accounts", headers=restricted_headers).json()}
    assert "ADVP_FOREIGN" not in matricules, "fuite : compte portail d'une autre société visible"
