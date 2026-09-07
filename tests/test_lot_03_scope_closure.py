import json

import pytest

from app.core.scope_policy import (
    ScopeKind,
    SocietyScopeError,
    effective_society_values,
    society_scope,
    society_key,
)
from app.core.security import create_access_token, hash_password
from app.modules.assistant import agent
from app.modules.auth.models import User
from app.modules.drh.models import Employee
from app.modules.erp.service import build_erp_counters


IGS = "IRON GLOBAL SÉCURITÉ"
IGSOL = "IRON GLOBAL SOLUTION"


def _user(db, username, societies=None, *, global_access=False, role="user", level="H1"):
    row = User(
        username=username,
        full_name=username,
        role=role,
        access_level=level,
        authorized_societies=societies,
        authorized_structures=[],
        global_society_access=global_access,
        password_hash=hash_password("ScopeTest123!"),
        is_active=True,
    )
    db.add(row)
    db.commit()
    return row


def _headers(user):
    token = create_access_token(str(user.id), {"role": user.role, "username": user.username})
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.parametrize("societies", [None, []])
def test_none_or_empty_society_scope_is_denied_everywhere(client, db, societies):
    user = _user(db, f"LOT03_NONE_{'NULL' if societies is None else 'EMPTY'}", societies, role="admin", level="H5")
    assert society_scope(user).kind is ScopeKind.NONE
    with pytest.raises(SocietyScopeError):
        effective_society_values(user)
    assert client.get("/api/erp/operational-preparation", headers=_headers(user)).status_code == 403
    assert client.post("/api/assistant/agent", headers=_headers(user), json={"message": "compte les employés"}).status_code == 403
    assert client.get("/api/ui/sidebar-stats", headers=_headers(user)).status_code == 403


def test_limited_scope_normalizes_request_and_refuses_injection(db):
    user = _user(db, "LOT03_LIMITED", [IGS])
    for variant in (IGS, "iron global securite", "  Iron   Global Sécurité  "):
        assert effective_society_values(user, variant) == [IGS]
    with pytest.raises(SocietyScopeError):
        effective_society_values(user, IGSOL)
    with pytest.raises(SocietyScopeError):
        effective_society_values(user, "SWORD CORPORATION")


def test_multiple_societies_are_an_exact_union_and_global_is_explicit(db):
    limited = _user(db, "LOT03_UNION", [IGS, IGSOL, " iron global securite "])
    assert effective_society_values(limited) == [IGS, IGSOL]
    elevated = _user(db, "LOT03_ELEVATED", [IGS], role="admin", level="H5")
    assert society_scope(elevated).kind is ScopeKind.LIMITED
    with pytest.raises(SocietyScopeError):
        effective_society_values(elevated, IGSOL)
    global_user = _user(db, "LOT03_GLOBAL", None, global_access=True)
    assert society_scope(global_user).kind is ScopeKind.GLOBAL
    assert effective_society_values(global_user) is None
    assert effective_society_values(global_user, IGSOL) == [IGSOL]


def test_assistant_read_and_action_tools_cannot_escape_scope(db):
    limited = _user(db, "LOT03_ASSISTANT", [IGS], role="admin", level="H5")
    own = Employee(code="LOT03_IGS", first_name="A", last_name="IGS", society=IGS, status="actif")
    other = Employee(code="LOT03_IGSOL", first_name="B", last_name="IGSOL", society=IGSOL, status="actif")
    db.add_all([own, other])
    db.commit()

    own_detail = json.loads(agent._dispatch("employee_detail", {"reference": own.code}, db, limited))
    other_detail = json.loads(agent._dispatch("employee_detail", {"reference": other.code}, db, limited))
    denied_read = json.loads(agent._dispatch("search_employees", {"society": IGSOL}, db, limited))
    denied_action = json.loads(agent._dispatch(
        "update_employee_status", {"reference": other.code, "statut": "suspendu"}, db, limited
    ))
    assert own_detail["trouve"] is True
    assert other_detail["trouve"] is False
    assert denied_read["refused"] is True
    assert denied_action["ok"] is False
    db.refresh(other)
    assert other.status == "actif"


def test_assistant_without_scope_is_refused_before_any_tool(db):
    user = _user(db, "LOT03_ASSISTANT_NONE", None, role="admin", level="H5")
    result = json.loads(agent._dispatch("dashboard_counts", {}, db, user))
    assert result == {"error": "Aucun périmètre société explicite", "refused": True}


def test_erp_and_cockpit_only_aggregate_authorized_societies(client, db):
    limited = _user(db, "LOT03_COCKPIT", [IGS], role="admin", level="H5")
    db.add_all([
        Employee(code="LOT03_COUNT_IGS", first_name="C", last_name="IGS", society=IGS, status="actif"),
        Employee(code="LOT03_COUNT_IGSOL", first_name="D", last_name="IGSOL", society=IGSOL, status="actif"),
    ])
    db.commit()

    counters = build_erp_counters(db, limited)
    assert counters["employees"]["total"] >= 1
    rows = client.get("/api/erp/operational-preparation", headers=_headers(limited))
    assert rows.status_code == 200, rows.text
    assert all(society_key(item["society"]) == society_key(IGS) for item in rows.json()["items"])
    injected = client.get(
        "/api/erp/operational-preparation", headers=_headers(limited), params={"society": IGSOL}
    )
    assert injected.status_code == 403

    cockpit = client.get("/api/ui/sidebar-stats", headers=_headers(limited))
    assert cockpit.status_code == 200, cockpit.text
    payload = cockpit.json()
    assert payload["scope"]["societies"] == [IGS]
    assert payload["admin"]["societies_total"] == 1
    assert payload["admin"]["utilisateurs"] == 0
