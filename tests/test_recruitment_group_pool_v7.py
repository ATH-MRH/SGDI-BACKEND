"""Recrutement Groupe V7 : vivier central → ventilation société → transfert DRH."""
import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.exc import OperationalError

from app.core.scope_policy import society_key
from app.core.security import hash_password
from app.modules.auth.models import AuditEvent, User, UserFeaturePermission
from app.modules.drh import service
from app.modules.drh.models import Candidate, Contract, Employee
from tests.module_cleanup import purge_rows_created_by_this_module  # noqa: F401 (fixture autouse)

SECURITE, SOLUTION = "IRON GLOBAL SECURITE", "IRON GLOBAL SOLUTION"       # libellés stockés (majuscules)
SCOPE_SECURITE, SCOPE_SOLUTION = "Iron Global Securite", "Iron Global Solution"  # libellés des périmètres


@pytest.fixture(autouse=True)
def _known_societies(db):
    """Aucun référentiel société n'existe : une société est « connue » dès qu'un compte la porte."""
    if not db.query(User).filter(User.username == "V7SOLUTION").first():
        db.add(User(username="V7SOLUTION", email="v7solution@test.com", full_name="DRH Solution", role="drh", access_level="H3",
                    authorized_societies=[SCOPE_SOLUTION], authorized_structures=[], password_hash=hash_password("unused-pass-123"), is_active=True))
        db.commit()


def _tag():
    return uuid.uuid4().hex[:8].upper()


def _candidate(client, headers, *, society=None, favorable=True, data=None, last=None):
    body = {"first_name": "Vivier", "last_name": last or f"GROUPE{_tag()}", "desired_position": "AGENT DE SECURITE",
            "phone": f"05{uuid.uuid4().int % 10**8:08d}", "status": "nouvelle", "society": society,
            "data": {"avisDecision": "Favorable" if favorable else "Instance", **(data or {})}}
    response = client.post("/api/drh/candidates", headers=headers, json=body)
    assert response.status_code == 200, response.text
    return response.json()["data"]


def _recruiter(client, db, *, societies, ventilation=False, admin_id=None):
    """Compte recruteur à périmètre limité ; la permission de ventilation est explicite."""
    username = f"REC{_tag()}"
    user = User(username=username, email=f"{username.lower()}@test.com", full_name="Recruteur Test", role="recruteur",
                access_level="H3", authorized_societies=societies, authorized_structures=[], authorized_modules=["recrute"],
                authorized_actions=["read", "create", "update"], password_hash=hash_password("recruteur-pass-123"), is_active=True)
    db.add(user); db.flush()
    if ventilation:
        db.add(UserFeaturePermission(user_id=user.id, module_key="recruitment", feature_key="contractualization",
                                     action_key="update", created_by_user_id=admin_id or user.id))
    db.commit()
    login = client.post("/api/auth/login", json={"username": username, "password": "recruteur-pass-123"})
    assert login.status_code == 200, login.text
    return user, {"Authorization": f"Bearer {login.json()['access_token']}"}


def _ids(client, headers, **params):
    response = client.get("/api/drh/candidates/page", headers=headers, params={"page_size": 100, **params})
    assert response.status_code == 200, response.text
    return {item["id"] for item in response.json()["items"]}


def _ventilate(client, headers, candidate_id, society, reason=None):
    return client.post(f"/api/drh/candidates/{candidate_id}/ventilation", headers=headers, json={"society": society, "reason": reason})


def _audit(db, action, candidate_id):
    db.expire_all()
    return db.execute(select(AuditEvent).where(AuditEvent.action == action, AuditEvent.resource_id == str(candidate_id))
                      .order_by(AuditEvent.id)).scalars().all()


# ── Vivier Groupe et ventilation ─────────────────────────────────────────────────────────
def test_unventilated_candidate_lives_in_the_group_pool(client, auth_headers):
    created = _candidate(client, auth_headers)
    assert created["society"] is None and "ventilations" not in created["data"]
    assert created["id"] in _ids(client, auth_headers, mode="new", society="__unassigned__")
    assert created["id"] in _ids(client, auth_headers, mode="new")
    assert created["id"] in _ids(client, auth_headers, mode="pool")
    assert created["id"] not in _ids(client, auth_headers, mode="new", society=SECURITE)


def test_reorientation_keeps_one_candidate_and_its_whole_history(client, auth_headers, db):
    interview = {"dernierEntretien": {"id": "ent_1", "moyenne": 8, "valide": True}, "entretiens": [{"id": "ent_1"}],
                 "derniereConvocation": {"date": "2026-10-08", "heure": "09:00"}, "notes": "Dossier conservé"}
    created = _candidate(client, auth_headers, data=interview)
    cid = created["id"]
    before = db.execute(select(Candidate.id)).scalars().all()
    for target, reason in ((SECURITE, "Besoin site A"), (None, "Poste pourvu"), (SOLUTION, None)):
        response = _ventilate(client, auth_headers, cid, target, reason)
        assert response.status_code == 200, response.text
        assert response.json()["data"]["id"] == cid and response.json()["data"]["society"] == target
    db.expire_all()
    assert db.execute(select(Candidate.id)).scalars().all() == before        # jamais de copie par société
    row = db.get(Candidate, cid)
    assert [(v["from"], v["to"], v["reason"]) for v in row.data["ventilations"]] == [
        (None, SECURITE, "Besoin site A"), (SECURITE, None, "Poste pourvu"), (None, SOLUTION, None)]
    assert all(v["by"] == "testadmin" and v["at"] and v["context"] == "ventilation" for v in row.data["ventilations"])
    for key, value in interview.items():
        assert row.data[key] == value                                        # entretiens, avis, notes intacts
    assert row.data["avisDecision"] == "Favorable" and row.status == "nouvelle"
    events = _audit(db, "recruitment.candidate.ventilation", cid)
    assert [e.result for e in events] == ["success"] * 3 and events[0].username == "testadmin"
    assert SECURITE in events[0].new_state and "Besoin site A" in events[0].new_state
    # Même société : aucune écriture, aucun doublon d'historique.
    assert _ventilate(client, auth_headers, cid, "  iron global SOLUTION ").status_code == 200
    db.expire_all()
    assert len(db.get(Candidate, cid).data["ventilations"]) == 3
    assert cid in _ids(client, auth_headers, mode="new", society=SOLUTION)
    assert cid in _ids(client, auth_headers, mode="new", society="Iron Global Solution")   # filtre insensible à la casse
    assert cid not in _ids(client, auth_headers, mode="new", society="__unassigned__")


def test_reserve_candidate_can_be_ventilated_and_stays_in_reserve(client, auth_headers, db):
    row = Candidate(first_name="Reserve", last_name=f"VIVIER{_tag()}", status="reserve",
                    data={"statut": "reserve", "fichePositionValidee": True, "avisDecision": "Favorable"})
    db.add(row); db.commit()
    assert row.id in _ids(client, auth_headers, mode="reserve", society="__unassigned__")
    assert _ventilate(client, auth_headers, row.id, SECURITE).status_code == 200
    assert row.id in _ids(client, auth_headers, mode="reserve", society=SECURITE)
    assert row.id not in _ids(client, auth_headers, mode="new")


def test_client_cannot_forge_ventilation_history_or_transfer_proof(client, auth_headers, db):
    created = _candidate(client, auth_headers)
    assert _ventilate(client, auth_headers, created["id"], SECURITE).status_code == 200
    forged = client.put(f"/api/drh/candidates/{created['id']}", headers=auth_headers, json={"data": {
        "avisDecision": "Favorable", "ventilations": [], "drhTransfer": {"status": "done"}}})
    assert forged.status_code == 200, forged.text
    db.expire_all()
    data = db.get(Candidate, created["id"]).data
    assert len(data["ventilations"]) == 1 and "drhTransfer" not in data
    forged_new = client.post("/api/drh/candidates", headers=auth_headers, json={
        "first_name": "Forge", "last_name": f"FORGE{_tag()}", "data": {"ventilations": [{"to": "X"}], "drhTransfer": {"status": "done"}}})
    assert "ventilations" not in forged_new.json()["data"]["data"] and "drhTransfer" not in forged_new.json()["data"]["data"]


# ── Permissions : refus par défaut, périmètre société ────────────────────────────────────
def test_ventilation_is_denied_by_default_and_scoped_to_authorized_societies(client, auth_headers, db):
    created = _candidate(client, auth_headers)
    cid = created["id"]
    _, plain = _recruiter(client, db, societies=[SCOPE_SECURITE])
    me = client.get("/api/auth/me", headers=plain).json()
    assert me["recruitment_access"] is True and me["recruitment_ventilation"] is False
    assert client.get("/api/drh/candidates/ventilation-targets", headers=plain).json() == {"can_ventilate": False, "societies": [], "portfolios": [SCOPE_SECURITE]}
    assert _ventilate(client, plain, cid, SECURITE).status_code == 403
    assert client.put(f"/api/drh/candidates/{cid}", headers=plain, json={"society": SECURITE}).status_code == 403
    refused = _audit(db, "authorization.recruitment.ventilation", cid)
    assert [e.result for e in refused] == ["refused", "refused"]
    assert db.get(Candidate, cid).society is None
    # Une modification de fiche sans changement de société reste permise.
    assert client.put(f"/api/drh/candidates/{cid}", headers=plain, json={"phone": "0550999888"}).status_code == 200

    _, granted = _recruiter(client, db, societies=[SCOPE_SECURITE], ventilation=True)
    assert client.get("/api/auth/me", headers=granted).json()["recruitment_ventilation"] is True
    assert client.get("/api/drh/candidates/ventilation-targets", headers=granted).json() == {"can_ventilate": True, "societies": [SCOPE_SECURITE], "portfolios": [SCOPE_SECURITE]}
    assert _ventilate(client, granted, cid, SOLUTION).status_code == 403          # société non autorisée
    assert client.put(f"/api/drh/candidates/{cid}", headers=granted, json={"society": SOLUTION}).status_code == 403
    assert db.get(Candidate, cid).society is None
    ok = _ventilate(client, granted, cid, "iron global securite")
    assert ok.status_code == 200 and ok.json()["data"]["society"] == SECURITE      # libellé canonique du périmètre
    assert _ventilate(client, granted, cid, None).status_code == 200             # retour au vivier Groupe
    # Un dossier ventilé vers une société hors périmètre ne peut pas lui être retiré.
    assert _ventilate(client, auth_headers, cid, SOLUTION).status_code == 200
    assert _ventilate(client, granted, cid, SECURITE).status_code == 403
    assert _ventilate(client, granted, cid, None).status_code == 403
    db.expire_all()
    assert db.get(Candidate, cid).society == SOLUTION

    targets = client.get("/api/drh/candidates/ventilation-targets", headers=auth_headers).json()
    # Compte global : sociétés réellement connues, dédoublonnées par clé canonique (casse / accents).
    known = {society_key(value) for value in targets["societies"]}
    assert targets["can_ventilate"] is True and {society_key(SECURITE), society_key(SOLUTION)} <= known
    assert len(known) == len(targets["societies"])
    assert _ventilate(client, auth_headers, cid, "Société Inexistante").status_code == 403


def test_put_society_change_is_recorded_as_a_ventilation(client, auth_headers, db):
    created = _candidate(client, auth_headers)
    update = client.put(f"/api/drh/candidates/{created['id']}", headers=auth_headers, json={"society": SECURITE, "phone": "0550111000"})
    assert update.status_code == 200, update.text
    db.expire_all()
    row = db.get(Candidate, created["id"])
    assert row.society == SECURITE and row.phone == "0550111000"
    assert [(v["from"], v["to"], v["context"]) for v in row.data["ventilations"]] == [(None, SECURITE, "fiche")]
    assert len(_audit(db, "recruitment.candidate.ventilation", row.id)) == 1
    direct = _candidate(client, auth_headers, society=SOLUTION)
    assert [(v["to"], v["context"]) for v in direct["data"]["ventilations"]] == [(SOLUTION, "creation")]


# ── Recruter = transfert DRH ─────────────────────────────────────────────────────────────
def test_transfer_requires_a_destination_society_and_a_favorable_opinion(client, auth_headers, db):
    created = _candidate(client, auth_headers)
    refused = client.post(f"/api/drh/candidates/{created['id']}/transfer-drh", headers=auth_headers)
    assert refused.status_code == 422
    assert refused.headers["X-Error-Code"] == "SOCIETE_DESTINATAIRE_REQUISE"
    assert "Société destinataire requise" in refused.json()["detail"]
    assert created["id"] in _ids(client, auth_headers, mode="new")
    pending = _candidate(client, auth_headers, society=SECURITE, favorable=False)
    assert client.post(f"/api/drh/candidates/{pending['id']}/transfer-drh", headers=auth_headers).status_code == 422
    db.expire_all()
    assert db.get(Candidate, pending["id"]).status == "nouvelle"


def test_transfer_is_atomic_idempotent_and_removes_the_candidate_from_recruitment(client, auth_headers, db):
    created = _candidate(client, auth_headers, last=f"TRANSFERT{_tag()}")
    cid = created["id"]
    assert _ventilate(client, auth_headers, cid, SOLUTION).status_code == 200
    employees, contracts = db.query(Employee).count(), db.query(Contract).count()
    stats = client.get("/api/drh/candidates/recruitment-stats", headers=auth_headers).json()["transferred_this_month"]

    first = client.post(f"/api/drh/candidates/{cid}/transfer-drh", headers=auth_headers)
    assert first.status_code == 200, first.text
    body = first.json()["data"]
    assert body["already_transferred"] is False and body["society"] == SOLUTION and body["status"] == "a_contractualiser"
    assert body["transfer"]["status"] == "done" and body["transfer"]["key"] == f"candidate-{cid}" and body["transfer"]["by"] == "testadmin"
    # Double clic / retry réseau / ancien point d'entrée : même transfert, aucun second effet.
    again = client.post(f"/api/drh/candidates/{cid}/transfer-drh", headers=auth_headers).json()["data"]
    assert again["already_transferred"] is True and again["transfer"] == body["transfer"]
    assert client.post(f"/api/drh/candidates/{cid}/marquer-contractualisation", headers=auth_headers).status_code == 200
    assert [e.result for e in _audit(db, "recruitment.candidate.drh_transfer", cid)] == ["success"]
    # Workflow DRH respecté : ni employé ni contrat au transfert.
    assert (db.query(Employee).count(), db.query(Contract).count()) == (employees, contracts)

    # Le dossier a quitté toutes les vues, la recherche et les compteurs Recrutement…
    for mode in ("new", "reserve", "archive", "pool"):
        assert cid not in _ids(client, auth_headers, mode=mode), mode
        assert cid not in _ids(client, auth_headers, mode=mode, q=created["last_name"]), mode
    assert client.get("/api/drh/candidates/recruitment-stats", headers=auth_headers).json()["transferred_this_month"] == stats + 1
    assert client.get("/api/drh/candidates/recruitment-stats", headers=auth_headers, params={"society": SECURITE}).json()["transferred_this_month"] <= stats
    # …mais la trace est conservée (preuve, anti-doublon) et n'est plus ventilable.
    db.expire_all()
    row = db.get(Candidate, cid)
    assert row is not None and row.status == "a_contractualiser" and len(row.data["ventilations"]) == 1
    late = _ventilate(client, auth_headers, cid, SECURITE)
    assert late.status_code == 409 and late.headers["X-Error-Code"] == "CANDIDAT_DEJA_TRANSFERE"
    assert client.put(f"/api/drh/candidates/{cid}", headers=auth_headers, json={"society": SECURITE}).status_code == 409

    # Le dossier n'apparaît que dans le périmètre DRH de la société destinataire.
    def drh_queue(society):
        rows = client.get("/api/drh/candidates", headers=auth_headers, params={"status": "a_contractualiser", "society": society})
        return {item["id"] for item in rows.json()}
    assert cid in drh_queue(SOLUTION) and cid not in drh_queue(SECURITE)
    _, securite_drh = _recruiter(client, db, societies=[SCOPE_SECURITE])
    assert cid not in {item["id"] for item in client.get("/api/drh/candidates", headers=securite_drh, params={"status": "a_contractualiser"}).json()}
    assert client.post(f"/api/drh/candidates/{cid}/recruit", headers=securite_drh).status_code == 403

    # La DRH établit le contrat par son service existant : un seul employé, jamais deux.
    hired = client.post(f"/api/drh/candidates/{cid}/recruit", headers=auth_headers)
    assert hired.status_code == 200, hired.text
    employee = hired.json()["data"]
    assert employee["society"] == SOLUTION
    assert client.post(f"/api/drh/candidates/{cid}/recruit", headers=auth_headers).json()["data"]["id"] == employee["id"]
    linked = client.post(f"/api/drh/candidates/{cid}/transfer-drh", headers=auth_headers).json()["data"]
    assert linked["already_transferred"] is True and linked["employee_id"] == employee["id"]
    assert db.query(Employee).count() == employees + 1 and db.query(Contract).count() == contracts + 1
    db.expire_all()
    assert db.get(Employee, employee["id"]).extra["sourceCandidateId"] == cid          # rapprochement Candidate → Employee
    for mode in ("new", "reserve", "archive", "pool"):
        assert cid not in _ids(client, auth_headers, mode=mode), mode                   # un recruté n'est jamais archivé


def test_failed_transfer_keeps_the_candidate_visible_and_can_be_retried(client, auth_headers, db, monkeypatch):
    created = _candidate(client, auth_headers, society=SECURITE)
    cid = created["id"]
    real_commit, state = db.commit, {"failed": False}

    def flaky_commit():
        row = db.get(Candidate, cid)
        if not state["failed"] and row is not None and row.status == "a_contractualiser":
            state["failed"] = True
            raise OperationalError("COMMIT", {}, Exception("connexion DRH perdue"))
        return real_commit()

    monkeypatch.setattr(db, "commit", flaky_commit)
    failed = client.post(f"/api/drh/candidates/{cid}/transfer-drh", headers=auth_headers)
    assert failed.status_code == 409 and failed.headers["X-Error-Code"] == "TRANSFERT_DRH_A_REPRENDRE"
    monkeypatch.undo()
    db.expire_all()
    row = db.get(Candidate, cid)
    assert row.status == "nouvelle" and row.society == SECURITE                 # rien n'a quitté Recrutement
    assert row.data["drhTransfer"]["status"] == "failed" and "removedFromRecruitmentAt" not in row.data
    assert cid in _ids(client, auth_headers, mode="new") and cid in _ids(client, auth_headers, mode="pool")
    assert [e.result for e in _audit(db, "recruitment.candidate.drh_transfer", cid)] == ["failure"]

    retry = client.post(f"/api/drh/candidates/{cid}/transfer-drh", headers=auth_headers)
    assert retry.status_code == 200, retry.text
    assert retry.json()["data"]["transfer"]["status"] == "done" and retry.json()["data"]["already_transferred"] is False
    assert cid not in _ids(client, auth_headers, mode="pool")
    assert [e.result for e in _audit(db, "recruitment.candidate.drh_transfer", cid)] == ["failure", "success"]


def test_archives_hold_refused_files_only_never_transferred_ones(client, auth_headers, db):
    refused = Candidate(first_name="Refus", last_name=f"ARCHIVE{_tag()}", status="archive", society=SECURITE,
                        data={"statut": "archive", "archivedAt": "2026-10-01", "motifArchive": "Refus", "avisDecision": "Défavorable"})
    legacy = Candidate(first_name="Ancien", last_name=f"TRANSMIS{_tag()}", status="a_contractualiser", society=SECURITE,
                       data={"statut": "a_contractualiser", "avisDecision": "Favorable", "recruitmentArchivedAt": "2026-09-01T10:00:00"})
    hired = Candidate(first_name="Ancien", last_name=f"RECRUTE{_tag()}", status="embauche", society=SECURITE,
                      data={"statut": "embauche", "convertedEmployeeId": 1, "recruitmentArchivedAt": "2026-09-01T10:00:00"})
    db.add_all([refused, legacy, hired]); db.commit()
    archive = _ids(client, auth_headers, mode="archive")
    assert refused.id in archive and legacy.id not in archive and hired.id not in archive
    pool = _ids(client, auth_headers, mode="pool")
    assert refused.id in pool and legacy.id not in pool and hired.id not in pool
    assert service._candidate_left_recruitment(legacy) and service._candidate_left_recruitment(hired)


def test_transfer_respects_the_recruiter_society_scope(client, auth_headers, db):
    created = _candidate(client, auth_headers, society=SOLUTION)
    _, securite = _recruiter(client, db, societies=[SCOPE_SECURITE])
    assert client.post(f"/api/drh/candidates/{created['id']}/transfer-drh", headers=securite).status_code == 403
    _, solution = _recruiter(client, db, societies=[SCOPE_SOLUTION])
    assert client.post(f"/api/drh/candidates/{created['id']}/transfer-drh", headers=solution).status_code == 200
