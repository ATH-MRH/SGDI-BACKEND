"""Studio Badges DRH : l'épreuve PDF « SPÉCIMEN » est une consultation, permise en lecture seule."""
import uuid

import pytest
from sqlalchemy import func, select
from starlette.requests import Request

from app.core.security import hash_password
from app.modules.auth.dependencies import request_action
from app.modules.auth.models import AuditEvent, User, UserFeaturePermission
from app.modules.drh.badge_models import BadgeEvent, BadgeSettings, BadgeTemplate, EmployeeBadge
from tests.module_cleanup import purge_rows_created_by_this_module  # noqa: F401 (fixture autouse)
from tests.test_drh_badges import API, SOC, _employee, clean_badges, drh, fast_portrait  # noqa: F401

ALL_BADGE_RIGHTS = ("read", "create", "validate", "export", "admin")


def _account(client, db, *, actions, modules=("drh", "badge"), badge_rights=()):
    """Compte de recette : actions autorisées restreintes (contrôle générique de l'application)."""
    name = f"RO{uuid.uuid4().int % 10**6:06d}"
    user = User(username=name, full_name=name, role="drh" if "drh" in modules else "commercial", access_level="H2",
                password_hash=hash_password("lecture-seule-1"), is_active=True, authorized_modules=list(modules),
                authorized_societies=[SOC], authorized_actions=list(actions))
    db.add(user)
    db.flush()
    for action in badge_rights:
        db.add(UserFeaturePermission(user_id=user.id, module_key="drh", feature_key="badges", action_key=action))
    db.commit()
    token = client.post("/api/auth/login", json={"username": name, "password": "lecture-seule-1"}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _counts(db):
    return {
        "badges": db.scalar(select(func.count()).select_from(EmployeeBadge)),
        "events": db.scalar(select(func.count()).select_from(BadgeEvent)),
        "templates": db.scalar(select(func.count()).select_from(BadgeTemplate)),
        "template_versions": db.scalar(select(func.coalesce(func.sum(BadgeTemplate.version), 0))),
        "settings": db.scalar(select(func.count()).select_from(BadgeSettings)),
        "prints": db.scalar(select(func.coalesce(func.sum(EmployeeBadge.print_count), 0))),
        "badge_audit": db.scalar(select(func.count()).select_from(AuditEvent).where(AuditEvent.action.like("badge.%"))),
    }


def _request(method, path):
    return Request({"type": "http", "method": method, "path": path, "headers": [], "query_string": b""})


def test_specimen_route_is_classified_read_and_nothing_else_moves():
    assert request_action(_request("POST", "/api/drh/badges/preview/pdf")) == "read"
    assert request_action(_request("POST", "/api/drh/badges/preview/pdf/")) == "read"
    # Impression officielle, émission, révocation, modèles, paramètres : classification inchangée.
    assert request_action(_request("POST", "/api/drh/badges/print/pdf")) == "export"
    assert request_action(_request("POST", "/api/drh/badges/issue")) == "create"
    assert request_action(_request("POST", "/api/drh/badges/issue-batch")) == "create"
    assert request_action(_request("POST", "/api/drh/badges/12/revoke")) == "create"
    assert request_action(_request("POST", "/api/drh/badges/templates")) == "create"
    assert request_action(_request("PUT", "/api/drh/badges/templates/3")) == "update"
    assert request_action(_request("DELETE", "/api/drh/badges/templates/3")) == "delete"
    assert request_action(_request("PUT", "/api/drh/badges/settings")) == "update"
    # Ailleurs, « /pdf » reste un export, quelle que soit la méthode.
    assert request_action(_request("POST", "/api/drh/contracts/5/pdf")) == "export"
    assert request_action(_request("GET", "/api/drh/preview/pdf")) == "export"


def test_read_only_account_gets_the_specimen_without_any_write(client, db, drh):
    emp = _employee(db)
    issued = client.post(f"{API}/issue", json={"employee_id": emp.id}, headers=drh).json()   # badge existant (compte habilité)
    reader = _account(client, db, actions=("read",))
    rights = client.get(f"{API}/permissions", headers=reader).json()
    assert {key: rights[key] for key in ("create", "validate", "export", "admin")} == {"create": False, "validate": False, "export": False, "admin": False}
    assert rights["read_only"] is True and "consultation" in rights["reasons"]["create"]
    before = _counts(db)
    for body in ({"employee_id": emp.id}, {"template_id": issued["template_id"]}, {"design": issued["design"]}):
        resp = client.post(f"{API}/preview/pdf", json=body, headers=reader)
        assert resp.status_code == 200, resp.text
        assert resp.headers["content-type"] == "application/pdf" and resp.content.startswith(b"%PDF")
        assert "epreuve" in resp.headers["content-disposition"]
    db.expire_all()
    assert _counts(db) == before                                    # ni badge, ni historique, ni impression, ni modèle, ni paramètre
    assert db.get(EmployeeBadge, issued["id"]).print_count == 0
    # Consultations ordinaires du même compte
    for path in ("/templates", "/dashboard", "/employees", f"/employees/{emp.id}", f"/{issued['id']}", "/history", "/settings"):
        assert client.get(f"{API}{path}", headers=reader).status_code == 200, path


@pytest.mark.parametrize("with_badge_rights", [False, True])
def test_writes_stay_refused_for_a_read_only_account(client, db, drh, with_badge_rights):
    emp = _employee(db)
    issued = client.post(f"{API}/issue", json={"employee_id": emp.id}, headers=drh).json()
    template_id = issued["template_id"]
    reader = _account(client, db, actions=("read",), badge_rights=ALL_BADGE_RIGHTS if with_badge_rights else ())
    before = _counts(db)
    writes = [
        ("post", "/issue", {"employee_id": emp.id}), ("post", "/issue-batch", {"employee_ids": [emp.id]}),
        ("post", f"/{issued['id']}/revoke", {"reason": "perdu"}), ("post", "/print/pdf", {"badge_ids": [issued["id"]]}),
        ("post", "/templates", {"name": "x", "design": issued["design"]}), ("put", f"/templates/{template_id}", {"name": "x", "design": issued["design"]}),
        ("post", f"/templates/{template_id}/duplicate", None), ("post", f"/templates/{template_id}/default", None),
        ("delete", f"/templates/{template_id}", None), ("put", "/settings", {"society": SOC, "data": {"show_blood_group": True, "blood_group_authorization": "x"}}),
    ]
    for method, path, body in writes:
        resp = getattr(client, method)(f"{API}{path}", headers=reader, **({"json": body} if body is not None else {}))
        assert resp.status_code == 403, (method, path, resp.status_code, resp.text)
    db.expire_all()
    after = _counts(db)
    assert {k: v for k, v in after.items() if k != "badge_audit"} == {k: v for k, v in before.items() if k != "badge_audit"}
    assert db.get(EmployeeBadge, issued["id"]).status == "ACTIF"


def test_the_badge_module_grants_issue_and_print_while_sensitive_actions_stay_explicit(client, db, drh):
    emp = _employee(db)
    issued = client.post(f"{API}/issue", json={"employee_id": emp.id}, headers=drh).json()
    plain = _account(client, db, actions=())                         # module Studio Badges, aucune permission explicite
    assert client.post(f"{API}/preview/pdf", json={"employee_id": emp.id}, headers=plain).status_code == 200
    assert client.post(f"{API}/print/pdf", json={"badge_ids": [issued["id"]]}, headers=plain).status_code == 200
    for method, path, body in (("post", f"/{issued['id']}/revoke", {"reason": "perdu"}), ("put", "/settings", {"society": SOC, "data": {}})):
        assert getattr(client, method)(f"{API}{path}", json=body, headers=plain).status_code == 403, path
    # Profil courant sans « export » (create, read, update, validate) : l'impression ne demande plus rien de plus.
    usual = _account(client, db, actions=("create", "read", "update", "validate"))
    assert client.post(f"{API}/print/pdf", json={"badge_ids": [issued["id"]]}, headers=usual).status_code == 200
    reissued = client.post(f"{API}/issue", json={"employee_id": emp.id}, headers=usual)
    assert reissued.status_code == 200, reissued.text
    printer = _account(client, db, actions=("read", "export"))       # impression seule au profil : émission aussi permise par le module
    assert client.post(f"{API}/print/pdf", json={"badge_ids": [reissued.json()["id"]]}, headers=printer).status_code == 200
    # Sans le module, rien ne passe, même avec toutes les permissions explicites.
    outsider = _account(client, db, actions=(), modules=("drh",), badge_rights=("read", "create", "export"))
    assert client.post(f"{API}/print/pdf", json={"badge_ids": [reissued.json()["id"]]}, headers=outsider).status_code == 403


def test_account_without_drh_access_is_still_refused(client, db, drh):
    emp = _employee(db)
    outsider = _account(client, db, actions=("read",), modules=("commercial",))
    assert client.post(f"{API}/preview/pdf", json={"employee_id": emp.id}, headers=outsider).status_code == 403
