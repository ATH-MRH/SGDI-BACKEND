"""Champ « Client / site » du formulaire DRH de contractualisation : source dc.irongs.com."""
import uuid

from sqlalchemy.exc import OperationalError

from app.core.security import hash_password
from app.modules.auth.models import AuditEvent, User
from app.modules.commercial.models import Client
from app.modules.drh import dc_client_sites
from app.modules.drh.models import Contract, Employee
from app.modules.ops.models import Site

URL = "/api/drh/contracts/dc-client-sites"


def _restricted_drh_headers(client, db, society):
    """Compte DRH limité à une seule société (ni admin ni H5 : le périmètre s'applique)."""
    username = f"drh-{uuid.uuid4().hex[:8]}"
    db.add(User(
        username=username, email=f"{username}@test.com", full_name="Test DRH", role="rh", access_level="H3",
        authorized_societies=[society], authorized_structures=[], authorized_modules=["drh"],
        password_hash=hash_password("testpass123"), is_active=True,
    ))
    db.commit()
    response = client.post("/api/auth/login", json={"username": username, "password": "testpass123"})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def _society() -> str:
    return f"SOC-DC-{uuid.uuid4().hex[:8]}".upper()


def _client(db, society, name, **values):
    row = Client(name=name, society=society, status=values.pop("status", "actif"), **values)
    db.add(row)
    db.commit()
    return row


def _site(db, client, name, active=1, **values):
    row = Site(name=name, client_id=client.id, client_name=client.name, active=active, **values)
    db.add(row)
    db.commit()
    return row


def _employee(db, society):
    row = Employee(code=f"E{uuid.uuid4().hex[:8]}".upper(), first_name="Nadia", last_name="CONTRAT", society=society, status="actif")
    db.add(row)
    db.commit()
    return row


def _items(client, headers, society):
    response = client.get(URL, headers=headers, params={"society": society})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["source"] == "dc.irongs.com"
    return body["items"]


def test_lists_clients_and_sites_from_dc(client, auth_headers, db):
    society = _society()
    alpha = _client(db, society, "ALPHA", address="Siège Alpha")
    site = _site(db, alpha, "DEPOT EST", address="Zone Est", commune="Rouiba", wilaya="Alger")
    items = _items(client, auth_headers, society)
    assert items == [{
        "dc_client_id": alpha.id, "dc_site_id": site.id, "client_name": "ALPHA", "site_name": "DEPOT EST",
        "label": "ALPHA — DEPOT EST", "address": "Zone Est", "commune": "Rouiba", "wilaya": "Alger",
    }]


def test_client_without_site_and_client_with_several_sites(client, auth_headers, db):
    society = _society()
    alone = _client(db, society, "ALPHA SEUL", address="Siège")
    multi = _client(db, society, "BETA")
    first, second = _site(db, multi, "SITE A"), _site(db, multi, "SITE B")
    items = _items(client, auth_headers, society)
    assert [(item["dc_client_id"], item["dc_site_id"], item["label"]) for item in items] == [
        (alone.id, None, "ALPHA SEUL"),
        (multi.id, first.id, "BETA — SITE A"),
        (multi.id, second.id, "BETA — SITE B"),
    ]
    assert items[0]["site_name"] is None and items[0]["address"] == "Siège"


def test_only_active_clients_and_sites_are_returned(client, auth_headers, db):
    society = _society()
    active = _client(db, society, "ACTIF")
    kept = _site(db, active, "SITE OUVERT")
    _site(db, active, "SITE FERME", active=0)
    _client(db, society, "INACTIF", status="inactif")
    _client(db, society, "PROSPECT", status="prospect")
    overridden = _client(db, society, "STATUT FICHE", data={"statut": "inactif"})
    _site(db, overridden, "SITE ORPHELIN")
    closed_sites_only = _client(db, society, "SANS SITE ACTIF")
    _site(db, closed_sites_only, "ANCIEN SITE", active=0)
    items = _items(client, auth_headers, society)
    assert [(item["dc_client_id"], item["dc_site_id"]) for item in items] == [
        (active.id, kept.id), (closed_sites_only.id, None),
    ]


def test_society_isolation(client, auth_headers, restricted_headers, db):
    society, other = _society(), _society()
    headers = _restricted_drh_headers(client, db, society)
    mine = _client(db, society, "CLIENT AUTORISE")
    foreign = _client(db, other, "CLIENT AUTRE SOCIETE")
    untagged = _client(db, None, "CLIENT SANS SOCIETE")
    ids = {item["dc_client_id"] for item in _items(client, headers, society)}
    assert ids == {mine.id} and foreign.id not in ids and untagged.id not in ids
    # Sans société demandée, le compte mono-société est ramené à son périmètre.
    implicit = client.get(URL, headers=headers)
    assert implicit.status_code == 200 and implicit.json()["society"] == society
    assert client.get(URL, headers=headers, params={"society": other}).status_code == 403
    # Un compte sans le module DRH n'atteint pas la source, quel que soit son périmètre.
    assert client.get(URL, headers=restricted_headers, params={"society": "Iron Global Securite"}).status_code == 403
    assert client.get(URL, headers=auth_headers).status_code == 422
    assert client.get(URL).status_code == 401
    # Écriture : un contrat de la société autorisée ne peut pas viser un client d'une autre société.
    employee = _employee(db, society)
    refused = client.post("/api/drh/contracts", headers=headers, json={"employee_id": employee.id, "dc_client_id": foreign.id})
    assert refused.status_code == 403, refused.text


def test_dc_failure_returns_retryable_error(client, auth_headers, db, monkeypatch):
    execute = db.execute

    def broken(statement, *args, **kwargs):
        # Seule la lecture de la source DC échoue : l'authentification reste fonctionnelle.
        if "FROM clients" in str(statement):
            raise OperationalError("select", {}, Exception("connexion DC perdue"))
        return execute(statement, *args, **kwargs)

    monkeypatch.setattr(db, "execute", broken)
    response = client.get(URL, headers=auth_headers, params={"society": _society()})
    assert response.status_code == 503
    assert response.json()["detail"] == "Impossible de charger les clients et sites depuis DC. Réessayez."
    assert dc_client_sites.DC_UNAVAILABLE_DETAIL == response.json()["detail"]


def test_contract_stores_dc_identifiers_and_snapshot(client, auth_headers, db):
    society = _society()
    employee = _employee(db, society)
    dc_client = _client(db, society, "GAMMA")
    site = _site(db, dc_client, "ENTREPOT NORD")
    created = client.post("/api/drh/contracts", headers=auth_headers, json={
        "employee_id": employee.id, "contract_type": "CDD", "dc_client_id": dc_client.id, "dc_site_id": site.id,
        # Un libellé envoyé par le navigateur n'est jamais repris.
        "dc_client_site_label": "FAUX LIBELLE",
    })
    assert created.status_code == 200, created.text
    body = created.json()
    assert (body["dc_client_id"], body["dc_site_id"], body["dc_client_site_label"]) == (dc_client.id, site.id, "GAMMA — ENTREPOT NORD")
    row = db.get(Contract, body["id"])
    assert (row.dc_client_id, row.dc_site_id, row.dc_client_site_label) == (dc_client.id, site.id, "GAMMA — ENTREPOT NORD")
    audit = db.query(AuditEvent).filter_by(action="drh.contract.dc_client_site", resource_id=str(row.id)).one()
    assert audit.society == society and audit.username == "testadmin"

    # Le libellé reste figé si le site est renommé dans DC ; l'identifiant fait foi.
    site.name = "ENTREPOT RENOMME"
    db.commit()
    listed = client.get(f"/api/drh/contracts?employee_id={employee.id}", headers=auth_headers).json()
    assert listed[0]["dc_site_id"] == site.id and listed[0]["dc_client_site_label"] == "GAMMA — ENTREPOT NORD"

    # Passage à « client seul », puis retrait complet.
    updated = client.put(f"/api/drh/contracts/{row.id}", headers=auth_headers, json={"dc_client_id": dc_client.id, "dc_site_id": None})
    assert updated.status_code == 200, updated.text
    assert (updated.json()["dc_site_id"], updated.json()["dc_client_site_label"]) == (None, "GAMMA")
    cleared = client.put(f"/api/drh/contracts/{row.id}", headers=auth_headers, json={"dc_client_id": None, "dc_site_id": None})
    assert (cleared.json()["dc_client_id"], cleared.json()["dc_client_site_label"]) == (None, None)
    # Une mise à jour sans rapport ne touche pas au rattachement.
    client.put(f"/api/drh/contracts/{row.id}", headers=auth_headers, json={"dc_client_id": dc_client.id, "dc_site_id": site.id})
    untouched = client.put(f"/api/drh/contracts/{row.id}", headers=auth_headers, json={"position": "MAGASINIER"})
    assert untouched.json()["dc_site_id"] == site.id


def test_contract_rejects_inconsistent_dc_selection(client, auth_headers, db):
    society = _society()
    employee = _employee(db, society)
    dc_client = _client(db, society, "DELTA")
    other_client = _client(db, society, "EPSILON")
    other_site = _site(db, other_client, "SITE EPSILON")
    closed_site = _site(db, dc_client, "SITE FERME", active=0)
    inactive = _client(db, society, "ZETA", status="inactif")
    foreign = _client(db, _society(), "ETA")

    def post(**link):
        return client.post("/api/drh/contracts", headers=auth_headers, json={"employee_id": employee.id, **link})

    assert post(dc_client_id=dc_client.id, dc_site_id=other_site.id).status_code == 422
    assert post(dc_client_id=dc_client.id, dc_site_id=closed_site.id).status_code == 422
    assert post(dc_client_id=inactive.id).status_code == 422
    assert post(dc_client_id=999_999_999).status_code == 422
    assert post(dc_site_id=other_site.id).status_code == 422
    assert post(dc_client_id=foreign.id).status_code == 403
    assert db.query(Contract).filter_by(employee_id=employee.id).count() == 0


def test_candidates_page_status_filter(client, auth_headers, db):
    from app.modules.drh.models import Candidate

    society = _society()
    db.add_all([
        Candidate(first_name="A", last_name="PENDING", society=society, status="a_contractualiser", data={}),
        Candidate(first_name="B", last_name="OTHER", society=society, status="nouvelle", data={}),
    ])
    db.commit()
    page = client.get("/api/drh/candidates/page", headers=auth_headers,
                      params={"mode": "drh_pending", "society": society, "status": "A_CONTRACTUALISER"})
    assert page.status_code == 200, page.text
    assert [item["last_name"] for item in page.json()["items"]] == ["PENDING"]


def test_generated_contract_from_form_stores_dc_identifiers(client, auth_headers, db):
    """Contractualisation d'un candidat : le contrat généré depuis le formulaire porte le lien DC."""
    from io import BytesIO

    from docx import Document as WordDocument

    from app.modules.drh.models import GeneratedContract

    society = _society()
    dc_client = _client(db, society, "THETA")
    site = _site(db, dc_client, "PLATEFORME SUD")
    foreign = _client(db, _society(), "IOTA")
    template = BytesIO()
    document = WordDocument()
    document.add_paragraph("Contrat {{NOM}} {{CLIENT}}")
    document.save(template)
    code = f"DC{uuid.uuid4().hex[:8]}".upper()
    upload = client.post(
        "/api/drh/contract-templates", headers=auth_headers,
        data={"code": code, "title": "Contrat DC", "contract_type": "CDD", "position": "MAGASINIER", "active": 1},
        files={"file": ("dc.docx", template.getvalue(), "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
    )
    assert upload.status_code == 200, upload.text
    payload = {
        "template_id": upload.json()["id"], "matricule": code, "contract_type": "CDD", "first_name": "Zakaria",
        "last_name": "Hashas", "position": "MAGASINIER", "society": society, "client": "THETA",
        "output_format": "docx", "values": {},
    }
    refused = client.post("/api/drh/generated-contracts/from-form", headers=auth_headers, json={**payload, "dc_client_id": foreign.id})
    assert refused.status_code == 403, refused.text
    assert db.query(Employee).filter_by(code=code).count() == 0

    response = client.post("/api/drh/generated-contracts/from-form", headers=auth_headers,
                           json={**payload, "dc_client_id": dc_client.id, "dc_site_id": site.id})
    assert response.status_code == 200, response.text
    generated = db.get(GeneratedContract, response.json()["id"])
    contract = db.get(Contract, generated.contract_id)
    assert (contract.dc_client_id, contract.dc_site_id, contract.dc_client_site_label) == (dc_client.id, site.id, "THETA — PLATEFORME SUD")
    assert db.query(AuditEvent).filter_by(action="drh.contract.dc_client_site", resource_id=str(contract.id)).count() == 1
