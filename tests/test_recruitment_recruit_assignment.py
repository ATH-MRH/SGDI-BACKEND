"""« Recruter » un dossier non ventilé : la société destinataire vient du périmètre du compte.

Une seule société autorisée → automatique ; plusieurs → à choisir ; aucune → refus. La ventilation
(réaffecter, remettre au vivier, ventiler sans recruter) garde sa permission dédiée."""
import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.exc import OperationalError

from app.core.security import hash_password
from app.modules.auth.models import AuditEvent, User, UserFeaturePermission
from app.modules.drh import service
from app.modules.drh.models import Candidate, Contract, Employee
from tests.module_cleanup import purge_rows_created_by_this_module  # noqa: F401 (fixture autouse)

SECURITE, SOLUTION, SWORD_CORP, SWORD_CONS = "IRON GLOBAL SECURITE", "IRON GLOBAL SOLUTION", "SWORD CORPORATION", "SWORD CONSTRUCTION"
SCOPES = {"Iron Global Securite": SECURITE, "Iron Global Solution": SOLUTION, "Sword Corporation": SWORD_CORP, "Sword Construction": SWORD_CONS}
S_SECURITE, S_SOLUTION, S_CORP, S_CONS = SCOPES
RECRUITER = ("read", "create", "update")


@pytest.fixture(autouse=True)
def _known_societies(db):
    """Aucun référentiel société n'existe : une société est « connue » dès qu'un compte la porte."""
    for index, scope in enumerate(SCOPES):
        username = f"ASSIGNDRH{index}"
        if not db.query(User).filter(User.username == username).first():
            db.add(User(username=username, email=f"{username.lower()}@test.com", full_name="DRH Assign", role="drh", access_level="H3",
                        authorized_societies=[scope], authorized_structures=[], password_hash=hash_password("unused-pass-123"), is_active=True))
    db.commit()


def _tag():
    return uuid.uuid4().hex[:8].upper()


def _candidate(client, headers, *, society=None, opinion="Favorable"):
    body = {"first_name": "Recrute", "last_name": f"ASSIGN{_tag()}", "desired_position": "MAGASINIER",
            "phone": f"05{uuid.uuid4().int % 10**8:08d}", "status": "nouvelle", "society": society,
            "data": {"avisDecision": opinion, "wilaya": "Oran"}}
    response = client.post("/api/drh/candidates", headers=headers, json=body)
    assert response.status_code == 200, response.text
    return response.json()["data"]


def _recruiter(client, db, *, societies, actions=RECRUITER, ventilation=False):
    username = f"REC{_tag()}"
    user = User(username=username, email=f"{username.lower()}@test.com", full_name="Recruteur Assign", role="recruteur",
                access_level="H3", authorized_societies=list(societies), authorized_structures=[], authorized_modules=["recrute"],
                authorized_actions=list(actions), password_hash=hash_password("recruteur-pass-123"), is_active=True)
    db.add(user); db.flush()
    if ventilation:
        db.add(UserFeaturePermission(user_id=user.id, module_key="recruitment", feature_key="contractualization",
                                     action_key="update", created_by_user_id=user.id))
    db.commit()
    login = client.post("/api/auth/login", json={"username": username, "password": "recruteur-pass-123"})
    assert login.status_code == 200, login.text
    return username, {"Authorization": f"Bearer {login.json()['access_token']}"}


def _options(client, headers, candidate_id):
    response = client.get(f"/api/drh/candidates/{candidate_id}/transfer-options", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def _recruit(client, headers, candidate_id, society=None, **extra):
    body = None if society is None and not extra else {"society": society, **extra}
    return client.post(f"/api/drh/candidates/{candidate_id}/transfer-drh", headers=headers, json=body)


def _audit(db, action, candidate_id):
    db.expire_all()
    return db.execute(select(AuditEvent).where(AuditEvent.action == action, AuditEvent.resource_id == str(candidate_id))
                      .order_by(AuditEvent.id)).scalars().all()


def _row(db, candidate_id):
    db.expire_all()
    return db.get(Candidate, candidate_id)


def _untouched(db, candidate_id):
    row = _row(db, candidate_id)
    return row.society is None and row.status == "nouvelle" and "ventilations" not in row.data and "drhTransfer" not in row.data


# ── CAS A : une seule société autorisée ──────────────────────────────────────────────────
def test_single_society_account_recruits_into_its_only_society_after_an_explicit_confirmation(client, auth_headers, db):
    username, headers = _recruiter(client, db, societies=[S_SECURITE])
    assert client.get("/api/auth/me", headers=headers).json()["recruitment_ventilation"] is False
    created = _candidate(client, auth_headers)
    cid = created["id"]
    employees, contracts = db.query(Employee).count(), db.query(Contract).count()

    options = _options(client, headers, cid)
    assert options == {"candidate_id": cid, "society": None, "ventilated": False, "favorable": True, "selection": "automatic",
                       "societies": [S_SECURITE], "can_recruit": True, "reason": None}
    # Consulter les options ne recrute pas : rien ne se fait sans confirmation.
    assert _untouched(db, cid)
    # Sans société dans la demande, la règle existante tient : le serveur ne choisit pas en silence.
    silent = _recruit(client, headers, cid)
    assert silent.status_code == 422 and silent.headers["X-Error-Code"] == "SOCIETE_DESTINATAIRE_REQUISE"
    assert _untouched(db, cid)

    done = _recruit(client, headers, cid, options["societies"][0])
    assert done.status_code == 200, done.text
    assert done.json()["data"]["society"] == SECURITE and done.json()["data"]["already_transferred"] is False
    row = _row(db, cid)
    assert row.society == SECURITE and row.status == "a_contractualiser"
    assert [(v["from"], v["to"], v["by"], v["context"]) for v in row.data["ventilations"]] == [(None, SECURITE, username, "recrutement")]
    assert row.data["drhTransfer"]["status"] == "done" and row.data["drhTransfer"]["society"] == SECURITE
    # La ventilation est historisée avant le transfert, chacune auditée au nom du recruteur.
    ventilation, transfer = _audit(db, "recruitment.candidate.ventilation", cid), _audit(db, "recruitment.candidate.drh_transfer", cid)
    assert [(e.result, e.username, e.society) for e in ventilation] == [("success", username, SECURITE)]
    assert [(e.result, e.username, e.society) for e in transfer] == [("success", username, SECURITE)]
    assert ventilation[0].id < transfer[0].id
    # Les informations du candidat sont conservées ; la DRH garde la main sur l'employé et le contrat.
    assert (row.first_name, row.last_name, row.phone, row.desired_position) == tuple(created[k] for k in ("first_name", "last_name", "phone", "desired_position"))
    assert row.data["wilaya"] == "Oran" and row.data["avisDecision"] == "Favorable"
    assert (db.query(Employee).count(), db.query(Contract).count()) == (employees, contracts)
    assert db.query(Candidate).filter(Candidate.last_name == row.last_name).count() == 1
    pending = client.get("/api/drh/candidates", headers=auth_headers, params={"status": "a_contractualiser", "society": SECURITE})
    assert pending.status_code == 200 and cid in [item["id"] for item in pending.json()]


# ── CAS B : plusieurs sociétés autorisées ────────────────────────────────────────────────
@pytest.mark.parametrize("scopes", [(S_SECURITE, S_SOLUTION), (S_SECURITE, S_SOLUTION, S_CORP, S_CONS)])
def test_multi_society_account_must_choose_among_its_own_societies_only(client, auth_headers, db, scopes):
    username, headers = _recruiter(client, db, societies=scopes)
    cid = _candidate(client, auth_headers)["id"]
    options = _options(client, headers, cid)
    assert options["selection"] == "required" and options["societies"] == list(scopes) and options["can_recruit"] is True
    assert _recruit(client, headers, cid).status_code == 422          # la sélection est obligatoire
    chosen = scopes[-1]
    done = _recruit(client, headers, cid, chosen, reason="Besoin site pilote")
    assert done.status_code == 200, done.text
    row = _row(db, cid)
    assert row.society == SCOPES[chosen] and row.status == "a_contractualiser"
    assert [(v["to"], v["reason"], v["context"]) for v in row.data["ventilations"]] == [(SCOPES[chosen], "Besoin site pilote", "recrutement")]


def test_society_outside_the_account_scope_is_refused_even_through_the_api(client, auth_headers, db):
    _, headers = _recruiter(client, db, societies=[S_SECURITE, S_SOLUTION])
    cid = _candidate(client, auth_headers)["id"]
    for forged in (SWORD_CORP, "sword construction", "Société Inexistante"):
        refused = _recruit(client, headers, cid, forged)
        assert refused.status_code == 403 and refused.json()["detail"] == "Société non autorisée pour ce recrutement"
    assert _untouched(db, cid)
    assert [e.result for e in _audit(db, "authorization.recruitment.assignment", cid)] == ["refused"] * 3
    assert _audit(db, "recruitment.candidate.ventilation", cid) == []
    # Mauvais types et libellés démesurés : rejetés avant tout traitement.
    assert client.post(f"/api/drh/candidates/{cid}/transfer-drh", headers=headers, json={"society": ["x"]}).status_code == 422
    assert _recruit(client, headers, cid, "X" * 151).status_code == 422
    assert _untouched(db, cid)


# ── CAS C : aucune société autorisée ─────────────────────────────────────────────────────
def test_account_without_any_society_cannot_recruit(client, auth_headers, db):
    _, headers = _recruiter(client, db, societies=[])
    cid = _candidate(client, auth_headers)["id"]
    blocked = client.get(f"/api/drh/candidates/{cid}/transfer-options", headers=headers)
    assert blocked.status_code == 403 and blocked.json()["detail"] == "Aucun périmètre société explicite"
    assert _recruit(client, headers, cid, SECURITE).status_code == 403
    assert _untouched(db, cid) and _audit(db, "recruitment.candidate.drh_transfer", cid) == []


# ── Permissions : recruter n'est pas ventiler, « Modifier » seul ne suffit pas ───────────
def test_recruiting_into_own_scope_does_not_grant_the_ventilation_permission(client, auth_headers, db):
    _, headers = _recruiter(client, db, societies=[S_SECURITE, S_SOLUTION])
    cid = _candidate(client, auth_headers)["id"]
    # Ventiler sans recruter, réaffecter, remettre au vivier : toujours refusé sans la permission dédiée.
    assert client.get("/api/drh/candidates/ventilation-targets", headers=headers).json()["societies"] == []
    assert client.post(f"/api/drh/candidates/{cid}/ventilation", headers=headers, json={"society": SECURITE}).status_code == 403
    assert client.put(f"/api/drh/candidates/{cid}", headers=headers, json={"society": SECURITE}).status_code == 403
    assert _untouched(db, cid)
    assert _options(client, headers, cid)["can_recruit"] is True
    assert _recruit(client, headers, cid, S_SOLUTION).status_code == 200


@pytest.mark.parametrize("actions", [(), ("read",), ("read", "update"), ("read", "create")])
def test_general_actions_create_and_update_are_both_required_explicitly(client, auth_headers, db, actions):
    _, headers = _recruiter(client, db, societies=[S_SECURITE], actions=actions)
    cid = _candidate(client, auth_headers)["id"]
    options = _options(client, headers, cid)
    assert options["can_recruit"] is False and options["selection"] == "none" and "Créer et Modifier" in options["reason"]
    assert _recruit(client, headers, cid, S_SECURITE).status_code == 403
    assert _untouched(db, cid)
    # Un dossier déjà ventilé dans son périmètre suit la règle de transfert existante, inchangée.
    ventilated = _candidate(client, auth_headers, society=SECURITE)["id"]
    expected = 200 if not actions or "create" in actions else 403
    assert _recruit(client, headers, ventilated).status_code == expected


def test_ventilation_permission_or_global_admin_can_also_assign_on_recruitment(client, auth_headers, db):
    _, granted = _recruiter(client, db, societies=[S_SOLUTION], actions=("read", "create"), ventilation=True)
    cid = _candidate(client, auth_headers)["id"]
    assert _options(client, granted, cid)["selection"] == "automatic"
    assert _recruit(client, granted, cid, S_SOLUTION).status_code == 200
    # Administrateur global : toutes les sociétés connues du système.
    other = _candidate(client, auth_headers)["id"]
    options = _options(client, auth_headers, other)
    assert options["selection"] == "required" and {SECURITE, SOLUTION, SWORD_CORP, SWORD_CONS} <= {s.upper() for s in options["societies"]}
    assert _recruit(client, auth_headers, other, SWORD_CORP).status_code == 200
    assert _row(db, other).society == SWORD_CORP


# ── CAS D : candidat déjà ventilé ────────────────────────────────────────────────────────
def test_already_ventilated_candidate_keeps_its_society_and_is_never_reassigned(client, auth_headers, db):
    cid = _candidate(client, auth_headers, society=SOLUTION)["id"]
    _, both = _recruiter(client, db, societies=[S_SECURITE, S_SOLUTION])
    _, outsider = _recruiter(client, db, societies=[S_SECURITE])

    assert _options(client, both, cid) == {"candidate_id": cid, "society": SOLUTION, "ventilated": True, "favorable": True,
                                             "selection": "assigned", "societies": [SOLUTION], "can_recruit": True, "reason": None}
    refused = _options(client, outsider, cid)
    assert refused["can_recruit"] is False and SOLUTION in refused["reason"]
    assert _recruit(client, outsider, cid).status_code == 403
    assert _recruit(client, outsider, cid, S_SECURITE).status_code == 403

    # Une autre société dans la demande ne réaffecte pas le dossier, même dans le périmètre du compte.
    moved = _recruit(client, both, cid, S_SECURITE)
    assert moved.status_code == 409 and moved.headers["X-Error-Code"] == "SOCIETE_DESTINATAIRE_DEJA_ATTRIBUEE"
    row = _row(db, cid)
    assert row.society == SOLUTION and row.status == "nouvelle" and len(row.data["ventilations"]) == 1
    # La même société (casse / accents différents) confirme simplement le recrutement.
    assert _recruit(client, both, cid, "iron global solution").status_code == 200
    row = _row(db, cid)
    assert row.society == SOLUTION and row.status == "a_contractualiser" and len(row.data["ventilations"]) == 1
    # La réaffectation autorisée reste le mécanisme de ventilation, avec sa permission.
    other = _candidate(client, auth_headers, society=SOLUTION)["id"]
    assert client.post(f"/api/drh/candidates/{other}/ventilation", headers=auth_headers, json={"society": SECURITE}).status_code == 200
    assert _row(db, other).society == SECURITE


# ── Règles métier conservées ─────────────────────────────────────────────────────────────
@pytest.mark.parametrize("opinion", ["Défavorable", "Instance", ""])
def test_unfavorable_opinion_blocks_recruitment_and_nothing_is_ventilated(client, auth_headers, db, opinion):
    _, headers = _recruiter(client, db, societies=[S_SECURITE])
    cid = _candidate(client, auth_headers, opinion=opinion)["id"]
    options = _options(client, headers, cid)
    assert options["can_recruit"] is False and options["favorable"] is False and "Favorable" in options["reason"]
    refused = _recruit(client, headers, cid, S_SECURITE)
    assert refused.status_code == 422 and "Favorable" in refused.json()["detail"]
    assert _untouched(db, cid)


def test_double_click_and_repeated_calls_never_recruit_twice(client, auth_headers, db):
    _, headers = _recruiter(client, db, societies=[S_SECURITE, S_SOLUTION])
    cid = _candidate(client, auth_headers)["id"]
    first, second = _recruit(client, headers, cid, S_SECURITE), _recruit(client, headers, cid, S_SECURITE)
    assert (first.status_code, second.status_code) == (200, 200)
    assert first.json()["data"]["already_transferred"] is False and second.json()["data"]["already_transferred"] is True
    # Même un rejeu vers une autre société ne déplace plus un dossier transféré.
    replay = _recruit(client, headers, cid, S_SOLUTION)
    assert replay.status_code == 200 and replay.json()["data"]["already_transferred"] is True
    row = _row(db, cid)
    assert row.society == SECURITE and len(row.data["ventilations"]) == 1
    assert len(_audit(db, "recruitment.candidate.ventilation", cid)) == 1
    assert len(_audit(db, "recruitment.candidate.drh_transfer", cid)) == 1
    options = _options(client, headers, cid)
    assert options["can_recruit"] is False and "déjà transféré" in options["reason"]


def test_ventilation_failure_blocks_the_drh_transfer(client, auth_headers, db, monkeypatch):
    _, headers = _recruiter(client, db, societies=[S_SECURITE])
    cid = _candidate(client, auth_headers)["id"]

    def broken(*args, **kwargs):
        raise service._business_error(409, "VENTILATION_INDISPONIBLE", "Ventilation impossible")

    monkeypatch.setattr(service, "ventilate_candidate", broken)
    failed = _recruit(client, headers, cid, S_SECURITE)
    assert failed.status_code == 409 and failed.json()["detail"] == "Ventilation impossible"
    monkeypatch.undo()
    assert _untouched(db, cid) and _audit(db, "recruitment.candidate.drh_transfer", cid) == []


def test_transfer_failure_after_ventilation_is_reported_and_resumed_without_duplication(client, auth_headers, db, monkeypatch):
    _, headers = _recruiter(client, db, societies=[S_SECURITE, S_SOLUTION])
    cid = _candidate(client, auth_headers)["id"]
    real_commit, state = db.commit, {"failed": False}

    def flaky_commit():
        row = db.get(Candidate, cid)
        if not state["failed"] and row is not None and row.status == "a_contractualiser":
            state["failed"] = True
            raise OperationalError("COMMIT", {}, Exception("connexion DRH perdue"))
        return real_commit()

    monkeypatch.setattr(db, "commit", flaky_commit)
    failed = _recruit(client, headers, cid, S_SOLUTION)
    assert failed.status_code == 409 and failed.headers["X-Error-Code"] == "TRANSFERT_DRH_A_REPRENDRE"
    monkeypatch.undo()
    # La ventilation est acquise, le dossier reste dans Recrutement, marqué « à reprendre ».
    row = _row(db, cid)
    assert row.society == SOLUTION and row.status == "nouvelle" and row.data["drhTransfer"]["status"] == "failed"
    assert len(row.data["ventilations"]) == 1
    options = _options(client, headers, cid)
    assert options["selection"] == "assigned" and options["society"] == SOLUTION and options["can_recruit"] is True
    # Reprise : avec ou sans la société dans la demande, jamais vers une autre.
    assert _recruit(client, headers, cid, S_SECURITE).status_code == 409
    retry = _recruit(client, headers, cid, S_SOLUTION)
    assert retry.status_code == 200 and retry.json()["data"]["already_transferred"] is False
    row = _row(db, cid)
    assert row.society == SOLUTION and row.status == "a_contractualiser" and len(row.data["ventilations"]) == 1
    assert [e.result for e in _audit(db, "recruitment.candidate.drh_transfer", cid)] == ["failure", "success"]
    assert len(_audit(db, "recruitment.candidate.ventilation", cid)) == 1


def test_options_are_refused_without_recruitment_access_or_token(client, auth_headers, db):
    cid = _candidate(client, auth_headers)["id"]
    assert client.get(f"/api/drh/candidates/{cid}/transfer-options").status_code in (401, 403)
    assert client.get("/api/drh/candidates/999999999/transfer-options", headers=auth_headers).status_code == 404
    outsider = User(username=f"OPS{_tag()}", email=f"ops{_tag().lower()}@test.com", full_name="Ops", role="ops", access_level="H3",
                    authorized_societies=[S_SECURITE], authorized_structures=[], authorized_modules=["ops"], authorized_actions=list(RECRUITER),
                    password_hash=hash_password("ops-pass-12345"), is_active=True)
    db.add(outsider); db.commit()
    login = client.post("/api/auth/login", json={"username": outsider.username, "password": "ops-pass-12345"})
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    assert client.get(f"/api/drh/candidates/{cid}/transfer-options", headers=headers).status_code == 403
    assert _recruit(client, headers, cid, S_SECURITE).status_code == 403
    assert _untouched(db, cid)
