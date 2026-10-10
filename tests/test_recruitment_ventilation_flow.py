"""Parcours de l'interface Recrutement : ventiler un dossier « Non ventilé », puis le recruter.

L'interface enchaîne les deux endpoints existants (ventilation, puis transfert DRH) ; ces tests
vérifient que le serveur garde seul la main sur la société, les permissions et l'historique."""
import uuid

import pytest
from sqlalchemy import select

from app.core.security import hash_password
from app.modules.auth.models import AuditEvent, User, UserFeaturePermission
from app.modules.drh.models import Candidate, Contract, Employee
from tests.module_cleanup import purge_rows_created_by_this_module  # noqa: F401 (fixture autouse)

SECURITE, SOLUTION = "IRON GLOBAL SECURITE", "IRON GLOBAL SOLUTION"
SCOPE_SECURITE, SCOPE_SOLUTION = "Iron Global Securite", "Iron Global Solution"
HR_FIELDS = ("first_name", "last_name", "phone", "email", "desired_position", "status")


@pytest.fixture(autouse=True)
def _known_societies(db):
    """Aucun référentiel société n'existe : une société est « connue » dès qu'un compte la porte."""
    for username, scope in (("FLOWSECURITE", SCOPE_SECURITE), ("FLOWSOLUTION", SCOPE_SOLUTION)):
        if not db.query(User).filter(User.username == username).first():
            db.add(User(username=username, email=f"{username.lower()}@test.com", full_name="DRH Flow", role="drh", access_level="H3",
                        authorized_societies=[scope], authorized_structures=[], password_hash=hash_password("unused-pass-123"), is_active=True))
    db.commit()


def _tag():
    return uuid.uuid4().hex[:8].upper()


def _candidate(client, headers, *, society=None, favorable=True):
    body = {"first_name": "Ventile", "last_name": f"FLOW{_tag()}", "desired_position": "MAGASINIER",
            "phone": f"05{uuid.uuid4().int % 10**8:08d}", "status": "nouvelle", "society": society,
            "data": {"avisDecision": "Favorable" if favorable else "Instance", "wilaya": "Oran", "situationFamiliale": "Marié"}}
    response = client.post("/api/drh/candidates", headers=headers, json=body)
    assert response.status_code == 200, response.text
    return response.json()["data"]


def _recruiter(client, db, *, societies, ventilation):
    username = f"FLOW{_tag()}"
    user = User(username=username, email=f"{username.lower()}@test.com", full_name="Recruteur Flow", role="recruteur",
                access_level="H3", authorized_societies=societies, authorized_structures=[], authorized_modules=["recrute"],
                authorized_actions=["read", "create", "update"], password_hash=hash_password("recruteur-pass-123"), is_active=True)
    db.add(user); db.flush()
    if ventilation:
        db.add(UserFeaturePermission(user_id=user.id, module_key="recruitment", feature_key="contractualization",
                                     action_key="update", created_by_user_id=user.id))
    db.commit()
    login = client.post("/api/auth/login", json={"username": username, "password": "recruteur-pass-123"})
    assert login.status_code == 200, login.text
    return username, {"Authorization": f"Bearer {login.json()['access_token']}"}


def _ventilate(client, headers, candidate_id, society, reason=None):
    return client.post(f"/api/drh/candidates/{candidate_id}/ventilation", headers=headers, json={"society": society, "reason": reason})


def _transfer(client, headers, candidate_id):
    return client.post(f"/api/drh/candidates/{candidate_id}/transfer-drh", headers=headers)


def _audit(db, action, candidate_id):
    db.expire_all()
    return db.execute(select(AuditEvent).where(AuditEvent.action == action, AuditEvent.resource_id == str(candidate_id))
                      .order_by(AuditEvent.id)).scalars().all()


def _page_row(client, headers, candidate_id, **params):
    response = client.get("/api/drh/candidates/page", headers=headers, params={"page_size": 100, **params})
    assert response.status_code == 200, response.text
    return next((item for item in response.json()["items"] if item["id"] == candidate_id), None)


def test_simple_ventilation_updates_the_list_status_and_leaves_hr_data_untouched(client, auth_headers, db):
    created = _candidate(client, auth_headers)
    cid = created["id"]
    assert _page_row(client, auth_headers, cid, mode="new", society="__unassigned__")["society"] is None
    employees, contracts = db.query(Employee).count(), db.query(Contract).count()

    response = _ventilate(client, auth_headers, cid, SOLUTION, "Besoin site pilote")
    assert response.status_code == 200, response.text
    body = response.json()
    # La réponse porte la société canonique : l'interface s'en sert pour actualiser la ligne.
    assert body["status"] == "success" and body["data"]["society"] == SOLUTION
    assert [(v["from"], v["to"], v["reason"]) for v in body["data"]["data"]["ventilations"]] == [(None, SOLUTION, "Besoin site pilote")]

    # Statut « Non ventilé » levé immédiatement dans la liste.
    assert _page_row(client, auth_headers, cid, mode="new", society="__unassigned__") is None
    assert _page_row(client, auth_headers, cid, mode="new", society=SOLUTION)["society"] == SOLUTION

    db.expire_all()
    row = db.get(Candidate, cid)
    assert {field: getattr(row, field) for field in HR_FIELDS} == {field: created[field] for field in HR_FIELDS}
    untouched = {key: value for key, value in row.data.items() if key != "ventilations"}
    assert untouched == created["data"], "la ventilation ne modifie aucune information RH du dossier"
    # Ventiler ne recrute pas : ni employé, ni contrat, ni transfert.
    assert (db.query(Employee).count(), db.query(Contract).count()) == (employees, contracts)
    assert "drhTransfer" not in row.data and row.status == "nouvelle"
    events = _audit(db, "recruitment.candidate.ventilation", cid)
    assert [(e.result, e.username, e.society) for e in events] == [("success", "testadmin", SOLUTION)]
    assert _audit(db, "recruitment.candidate.drh_transfer", cid) == []


def test_ventilation_then_recruitment_uses_the_existing_transfer_and_audits_both_steps(client, auth_headers, db):
    username, headers = _recruiter(client, db, societies=[SCOPE_SECURITE], ventilation=True)
    cid = _candidate(client, auth_headers)["id"]
    # Sans société destinataire, le recrutement est refusé par le serveur, quel que soit l'écran.
    blocked = _transfer(client, headers, cid)
    assert blocked.status_code == 422 and blocked.headers["X-Error-Code"] == "SOCIETE_DESTINATAIRE_REQUISE"

    targets = client.get("/api/drh/candidates/ventilation-targets", headers=headers).json()
    assert targets["can_ventilate"] is True and targets["societies"] == [SCOPE_SECURITE]
    assert _ventilate(client, headers, cid, targets["societies"][0]).status_code == 200
    employees, contracts = db.query(Employee).count(), db.query(Contract).count()

    first = _transfer(client, headers, cid)
    assert first.status_code == 200, first.text
    assert first.json()["data"]["already_transferred"] is False and first.json()["data"]["society"] == SECURITE
    # Double clic sur « Ventiler et recruter » : aucun second effet.
    again = _transfer(client, headers, cid)
    assert again.status_code == 200 and again.json()["data"]["already_transferred"] is True
    late = _ventilate(client, auth_headers, cid, SOLUTION)
    assert late.status_code == 409 and late.headers["X-Error-Code"]

    db.expire_all()
    row = db.get(Candidate, cid)
    assert row.society == SECURITE and row.status == "a_contractualiser"
    assert row.data["drhTransfer"]["status"] == "done" and row.data["drhTransfer"]["by"] == username
    assert len(row.data["ventilations"]) == 1
    # Le circuit DRH existant crée l'employé et le contrat, pas le recrutement.
    assert (db.query(Employee).count(), db.query(Contract).count()) == (employees, contracts)
    assert db.query(Candidate).filter(Candidate.last_name == row.last_name).count() == 1
    assert [(e.result, e.username) for e in _audit(db, "recruitment.candidate.ventilation", cid)] == [("success", username)]
    assert [(e.result, e.username) for e in _audit(db, "recruitment.candidate.drh_transfer", cid)] == [("success", username)]
    assert _page_row(client, auth_headers, cid, mode="new") is None


def test_permissions_and_society_isolation_hold_for_the_whole_flow(client, auth_headers, db):
    cid = _candidate(client, auth_headers)["id"]
    _, plain = _recruiter(client, db, societies=[SCOPE_SECURITE], ventilation=False)
    _, securite = _recruiter(client, db, societies=[SCOPE_SECURITE], ventilation=True)
    _, solution = _recruiter(client, db, societies=[SCOPE_SOLUTION], ventilation=True)

    # Pas de permission : aucune cible proposée, aucune ventilation, refus audité.
    assert client.get("/api/drh/candidates/ventilation-targets", headers=plain).json()["societies"] == []
    assert _ventilate(client, plain, cid, SECURITE).status_code == 403
    assert [e.result for e in _audit(db, "authorization.recruitment.ventilation", cid)] == ["refused"]
    # Permission limitée : uniquement vers ses propres sociétés.
    assert client.get("/api/drh/candidates/ventilation-targets", headers=securite).json()["societies"] == [SCOPE_SECURITE]
    assert _ventilate(client, securite, cid, SOLUTION).status_code == 403
    db.expire_all()
    assert db.get(Candidate, cid).society is None

    assert _ventilate(client, solution, cid, SOLUTION).status_code == 200
    # Une autre société ne peut ni reprendre le dossier, ni le recruter.
    assert _ventilate(client, securite, cid, SECURITE).status_code == 403
    assert _transfer(client, securite, cid).status_code == 403
    assert _transfer(client, plain, cid).status_code == 403
    db.expire_all()
    row = db.get(Candidate, cid)
    assert row.society == SOLUTION and row.status == "nouvelle" and "drhTransfer" not in row.data
    assert _transfer(client, solution, cid).status_code == 200


def test_backend_errors_are_explicit_and_change_nothing(client, auth_headers, db):
    cid = _candidate(client, auth_headers)["id"]
    assert client.post(f"/api/drh/candidates/{cid}/ventilation", json={"society": SOLUTION}).status_code in (401, 403)
    assert _ventilate(client, auth_headers, 999_999_999, SOLUTION).status_code == 404
    unknown = _ventilate(client, auth_headers, cid, "Société Inexistante")
    assert unknown.status_code == 403 and unknown.json()["detail"] == "Société non autorisée pour la ventilation"
    assert _ventilate(client, auth_headers, cid, SOLUTION, "x" * 501).status_code == 422
    assert client.post(f"/api/drh/candidates/{cid}/ventilation", headers=auth_headers, json={"society": 12}).status_code == 422
    db.expire_all()
    row = db.get(Candidate, cid)
    assert row.society is None and "ventilations" not in row.data
    assert _audit(db, "recruitment.candidate.ventilation", cid) == []

    # Dossier ventilé mais sans avis favorable : le recrutement reste refusé, la ventilation tient.
    pending = _candidate(client, auth_headers, favorable=False)["id"]
    assert _ventilate(client, auth_headers, pending, SECURITE).status_code == 200
    refused = _transfer(client, auth_headers, pending)
    assert refused.status_code == 422 and "Favorable" in refused.json()["detail"]
    db.expire_all()
    assert db.get(Candidate, pending).society == SECURITE and db.get(Candidate, pending).status == "nouvelle"


def test_ventilation_permission_is_discoverable_in_the_permission_catalog():
    from app.core.permission_catalog import FEATURE_CATALOG

    label, description, actions = FEATURE_CATALOG["recruitment"]["features"]["contractualization"]
    assert "Ventilation" in description and "update" in actions
