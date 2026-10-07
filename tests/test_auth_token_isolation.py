"""Isolation des familles de jetons : seul un jeton staff ouvre les routes staff.

Tous les jetons d'ATLAS (staff, portail client, portail employé, QR de pointage, ticket
SSE) sont signés par le même secret. Avant ce correctif, `current_user` lisait `sub` sans
vérifier la famille : un jeton de portail client dont le `sub` valait N ouvrait les routes
staff au nom de l'utilisateur staff N, et un jeton de portail employé provoquait une 500.

Les jetons non-staff utilisés ici sont obtenus par les VRAIS endpoints de chaque portail.
"""
import uuid

import pytest

from app.core.photo_storage import DOCS_DIR, PUBLIC_DOC_PREFIX
from app.core.security import (
    create_access_token,
    create_staff_token,
    decode_token,
    hash_password,
    is_sse_ticket_payload,
    is_staff_token_payload,
)
from app.modules.auth.models import User
from app.modules.drh.models import Document, Employee
from app.modules.irongs import service as legacy_service

SOCIETY = "Iron Global Securite"
PORTAL_PASSWORD = "PortalPass123!"

# Routes staff sondées avec chaque jeton étranger. `/api/auth/me` n'a aucun contrôle de
# module : c'est la preuve la plus directe qu'une identité staff a (ou non) été reconnue.
STAFF_ROUTES = [
    "/api/auth/me",
    "/api/auth/users",
    "/api/drh/employees/page",
    "/api/ops/sites/page",
    "/api/alerts",
    "/api/irongs/events/ticket",
]


def _own_ip() -> dict[str, str]:
    """Les connexions aux portails sont limitées par IP : chaque connexion de ce fichier
    utilise la sienne pour ne pas consommer le quota partagé avec les autres tests."""
    value = uuid.uuid4().int
    return {"X-Forwarded-For": f"10.{value % 250}.{(value >> 8) % 250}.{(value >> 16) % 250 + 1}"}


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _staff_with_id(db, user_id: int) -> User:
    """Garantit qu'un compte staff ADMIN actif existe avec exactement cet identifiant."""
    user = db.get(User, user_id)
    if user is None:
        user = User(
            id=user_id, username=f"TWIN{user_id}", email=f"twin{user_id}@test.com", full_name="Jumeau Staff",
            role="admin", access_level="H5", authorized_societies=[], authorized_structures=[],
            password_hash=hash_password("twin-password"), is_active=True, global_society_access=True,
        )
        db.add(user)
        db.commit()
    assert user.is_active
    return user


def _assert_refused(client, token: str, label: str) -> None:
    for path in STAFF_ROUTES:
        response = client.get(path, headers=_bearer(token))
        assert response.status_code == 401, f"{label} sur {path} : {response.status_code} {response.text[:200]}"
        assert response.json() == {"detail": "Token invalide"}
    stream = client.get("/api/irongs/events/stream", params={"token": token})
    assert stream.status_code == 401, f"{label} sur le flux SSE : {stream.status_code}"


# ── Émission de vrais jetons par chaque portail ──────────────────────────────────────

@pytest.fixture
def client_portal_token(client, auth_headers, db):
    suffix = uuid.uuid4().hex[:8]
    created = client.post("/api/commercial/clients", headers=auth_headers, json={
        "name": f"Client Isolation {suffix}", "society": SOCIETY, "status": "actif", "portal_enabled": True,
    })
    assert created.status_code in (200, 201), created.text
    account = client.post("/api/client-portal/admin/users", headers=auth_headers, json={
        "client_id": created.json()["id"], "full_name": "Interlocuteur Isolation", "username": f"iso{suffix}",
    })
    assert account.status_code == 201, account.text
    login = client.post("/api/client-portal/auth/login", headers=_own_ip(), json={
        "username": f"iso{suffix}", "password": account.json()["temporary_password"],
    })
    assert login.status_code == 200, login.text
    return login.json()["access_token"]


@pytest.fixture
def employee_portal(client, db):
    """Compte portail employé réel ; `numeric=True` donne un matricule purement numérique."""
    def _make(numeric: bool = False) -> tuple[str, str]:
        code = str(uuid.uuid4().int % 10**9 + 10**9) if numeric else f"ISO{uuid.uuid4().hex[:6].upper()}"
        db.add(Employee(code=code, first_name="Iso", last_name="Portail", society=SOCIETY, status="actif"))
        legacy_service.create_item(db, "portalAccounts", {
            "id": code, "username": code.lower(), "matricule": code,
            "passwordHash": hash_password(PORTAL_PASSWORD), "societe": SOCIETY, "active": True,
        })
        db.commit()
        login = client.post("/api/portal/login", headers=_own_ip(), json={"username": code, "password": PORTAL_PASSWORD})
        assert login.status_code == 200, login.text
        return code, login.json()["portal_token"]
    return _make


# ── A. Le jeton staff continue de fonctionner, RBAC inchangé ─────────────────────────

def test_staff_login_token_is_typed_and_accepted(client):
    login = client.post("/api/auth/login", json={"username": "testadmin", "password": "test-admin-password"})
    assert login.status_code == 200, login.text
    token = login.json()["access_token"]
    payload = decode_token(token)
    assert payload["token_use"] == "staff"
    assert is_staff_token_payload(payload)

    me = client.get("/api/auth/me", headers=_bearer(token))
    assert me.status_code == 200, me.text
    assert me.json()["username"] == "testadmin"
    assert client.get("/api/drh/employees/page", headers=_bearer(token)).status_code == 200


def test_staff_token_still_subject_to_rbac(client):
    login = client.post("/api/auth/login", json={"username": "testops", "password": "testpass123"})
    assert login.status_code == 200, login.text
    headers = _bearer(login.json()["access_token"])
    assert client.get("/api/auth/me", headers=headers).status_code == 200
    assert client.get("/api/ops/sites/page", headers=headers).status_code == 200
    # Module non coché pour ce compte : le typage du jeton ne contourne pas le RBAC.
    assert client.get("/api/drh/employees/page", headers=headers).status_code == 403
    assert client.get("/api/auth/users", headers=headers).status_code == 403


def test_admin_system_login_token_is_typed_and_accepted(client):
    login = client.post("/api/auth/admin-system-login", json={"username": "testadmin", "password": "test-admin-password"})
    assert login.status_code == 200, login.text
    payload = decode_token(login.json()["access_token"])
    assert payload["token_use"] == "staff" and payload["admin_system"] is True
    assert client.get("/api/auth/me", headers=_bearer(login.json()["access_token"])).status_code == 200


def test_staff_token_issued_before_the_fix_remains_valid(client, db):
    """Jetons en circulation au moment du déploiement (sans `token_use`) : pas de déconnexion forcée."""
    admin = db.query(User).filter(User.username == "testadmin").one()
    for claims in ({"role": admin.role, "username": admin.username},
                   {"role": admin.role, "username": admin.username, "admin_system": True},
                   {}):
        token = create_access_token(str(admin.id), claims)
        assert client.get("/api/auth/me", headers=_bearer(token)).status_code == 200, claims


# ── B + H. Portail client → routes staff ─────────────────────────────────────────────

def test_real_client_portal_token_is_refused_on_staff_routes(client, db, client_portal_token):
    payload = decode_token(client_portal_token)
    assert payload["client_portal"] is True
    # Cas d'exploitation : un compte staff ADMIN actif porte le même identifiant numérique.
    _staff_with_id(db, int(payload["sub"]))
    _assert_refused(client, client_portal_token, "jeton portail client")


def test_client_portal_token_never_becomes_the_staff_user_with_same_id(client, db):
    admin = db.query(User).filter(User.username == "testadmin").one()
    forged = create_access_token(str(admin.id), claims={"client_portal": True, "client_id": 1}, ttl_minutes=720)
    _assert_refused(client, forged, "jeton portail client de même identifiant")
    # Même en ajoutant les claims d'un jeton staff historique, le marqueur étranger l'emporte.
    disguised = create_access_token(str(admin.id), claims={
        "client_portal": True, "client_id": 1, "role": "admin", "username": admin.username,
    })
    _assert_refused(client, disguised, "jeton portail client déguisé")


# ── C. Portail employé → routes staff (et plus aucune 500) ───────────────────────────

def test_real_employee_portal_token_is_refused_without_server_error(client, employee_portal):
    _, token = employee_portal()
    assert decode_token(token)["portal"] is True
    _assert_refused(client, token, "jeton portail employé")


def test_employee_portal_token_with_numeric_matricule_matching_staff_id(client, db, employee_portal):
    code, token = employee_portal(numeric=True)
    _staff_with_id(db, int(code))
    _assert_refused(client, token, "jeton portail employé à matricule numérique")


# ── D. QR de pointage → routes staff ─────────────────────────────────────────────────

def test_real_attendance_qr_token_is_refused_on_staff_routes(client, db, employee_portal):
    code, portal_token = employee_portal(numeric=True)
    issued = client.get("/api/portal/attendance-qr", headers=_bearer(portal_token))
    assert issued.status_code == 200, issued.text
    qr_token = issued.json()["token"]
    assert decode_token(qr_token)["attendance_qr"] is True
    _staff_with_id(db, int(code))
    _assert_refused(client, qr_token, "QR de pointage")


# ── E. Ticket SSE → routes staff ─────────────────────────────────────────────────────

def test_real_sse_ticket_is_refused_on_staff_routes_but_valid_for_the_stream(client, auth_headers):
    issued = client.get("/api/irongs/events/ticket", headers=auth_headers)
    assert issued.status_code == 200, issued.text
    ticket = issued.json()["ticket"]
    payload = decode_token(ticket)
    # Le ticket désigne un vrai compte staff actif : c'est sa FAMILLE qui le rend inutilisable ailleurs.
    assert is_sse_ticket_payload(payload) and not is_staff_token_payload(payload)
    for path in STAFF_ROUTES:
        response = client.get(path, headers=_bearer(ticket))
        assert response.status_code == 401, f"ticket SSE sur {path} : {response.status_code}"


def test_sse_ticket_cannot_be_obtained_or_replaced_by_a_foreign_token(client, db, client_portal_token):
    _staff_with_id(db, int(decode_token(client_portal_token)["sub"]))
    assert client.get("/api/irongs/events/ticket", headers=_bearer(client_portal_token)).status_code == 401
    assert client.get("/api/irongs/events/stream", params={"ticket": client_portal_token}).status_code == 401
    # Un « ticket » portant un claim d'une autre famille n'est pas un ticket.
    admin = db.query(User).filter(User.username == "testadmin").one()
    mixed = create_access_token(str(admin.id), claims={"sse_ticket": True, "client_portal": True}, ttl_minutes=1)
    assert client.get("/api/irongs/events/stream", params={"ticket": mixed}).status_code == 401


# ── F + G. Jeton expiré, invalide, absent ────────────────────────────────────────────

def test_expired_invalid_and_missing_tokens_return_401(client, db):
    admin = db.query(User).filter(User.username == "testadmin").one()
    expired = create_access_token(str(admin.id), {"token_use": "staff"}, ttl_seconds=-5)
    valid = create_staff_token(admin.id)
    head, body, signature = valid.split(".")
    tampered = f"{head}.{body}.{signature[:-2]}AA"
    for label, token in [("expiré", expired), ("signature altérée", tampered), ("illisible", "abc"),
                         ("trois segments vides", ".."), ("non JWT", "a.b.c")]:
        for path in STAFF_ROUTES:
            response = client.get(path, headers=_bearer(token))
            assert response.status_code == 401, f"{label} sur {path} : {response.status_code}"
    assert client.get("/api/auth/me").status_code == 401
    assert client.get("/api/auth/me").json() == {"detail": "Token manquant"}


# ── I. Refus par défaut : aucune forme inattendue n'est acceptée ni ne provoque de 500 ──

@pytest.mark.parametrize("subject,claims", [
    ("1", {"token_use": "client_portal"}),
    ("1", {"token_use": "employee_portal"}),
    ("1", {"token_use": ""}),
    ("1", {"token_use": None}),
    ("1", {"token_use": "STAFF"}),
    ("1", {"portal": True}),
    ("1", {"portal": False}),
    ("1", {"attendance_qr": True, "nonce": "n", "employee_id": 1}),
    ("1", {"sse_ticket": True}),
    ("1", {"famille_future": True}),
    ("1", {"scope": "staff"}),
    ("AGT001", {}),
    ("AGT001", {"token_use": "staff"}),
    ("", {}),
    ("-1", {}),
    ("1.0", {}),
    ("١", {}),
    (" 1", {}),
])
def test_unexpected_token_shapes_are_denied_by_default(client, subject, claims):
    token = create_access_token(subject, claims)
    for path in STAFF_ROUTES:
        response = client.get(path, headers=_bearer(token))
        assert response.status_code == 401, f"sub={subject!r} claims={claims} sur {path} : {response.status_code}"


def test_staff_token_requires_an_expiry(client):
    import hashlib
    import hmac

    import app.core.security as security

    token = create_access_token("1", {"token_use": "staff"})
    head, _, _ = token.split(".")
    body = security._b64url_encode(b'{"sub":"1","token_use":"staff"}')
    signature = hmac.new(security.settings.jwt_secret.encode(), f"{head}.{body}".encode(), hashlib.sha256).digest()
    eternal = f"{head}.{body}.{security._b64url_encode(signature)}"
    assert decode_token(eternal)["sub"] == "1"  # signature valide, mais pas un jeton staff
    assert client.get("/api/auth/me", headers=_bearer(eternal)).status_code == 401


# ── Document RH protégé : même règle hors de `current_user` ──────────────────────────

def test_protected_document_refuses_foreign_tokens(client, db, auth_headers, client_portal_token, employee_portal):
    emp = Employee(code=f"DOC{uuid.uuid4().hex[:6].upper()}", first_name="Doc", last_name="Protege", society=SOCIETY, status="actif")
    db.add(emp)
    db.flush()
    filename = f"iso_{uuid.uuid4().hex}.pdf"
    DOCS_DIR.mkdir(parents=True, exist_ok=True)
    (DOCS_DIR / filename).write_bytes(b"%PDF-1.4 confidentiel")
    db.add(Document(owner_type="employee", owner_id=emp.id, label="Contrat", file_name=filename,
                    file_path=f"{PUBLIC_DOC_PREFIX}/{filename}", mime_type="application/pdf"))
    db.commit()
    url = f"{PUBLIC_DOC_PREFIX}/{filename}"

    _staff_with_id(db, int(decode_token(client_portal_token)["sub"]))
    _, portal_token = employee_portal()
    ticket = client.get("/api/irongs/events/ticket", headers=auth_headers).json()["ticket"]
    assert client.get(url).status_code == 401
    for label, token in [("portail client", client_portal_token), ("portail employé", portal_token), ("ticket SSE", ticket)]:
        response = client.get(url, headers=_bearer(token))
        assert response.status_code == 401, f"{label} : {response.status_code}"
        assert b"confidentiel" not in response.content
    allowed = client.get(url, headers=auth_headers)
    assert allowed.status_code == 200 and b"confidentiel" in allowed.content


# ── J. Chaque portail fonctionne toujours sur SES endpoints, et refuse les autres familles ──

def test_client_portal_still_works_and_rejects_other_families(client, auth_headers, client_portal_token, employee_portal):
    me = client.get("/api/client-portal/me", headers=_bearer(client_portal_token))
    assert me.status_code == 200, me.text
    assert me.json()["full_name"] == "Interlocuteur Isolation"
    _, portal_token = employee_portal()
    assert client.get("/api/client-portal/me", headers=auth_headers).status_code == 401
    assert client.get("/api/client-portal/me", headers=_bearer(portal_token)).status_code == 401


def test_employee_portal_still_works_and_rejects_other_families(client, auth_headers, client_portal_token, employee_portal):
    code, portal_token = employee_portal()
    own = client.get(f"/api/portal/pointages/{code}", headers=_bearer(portal_token))
    assert own.status_code == 200, own.text
    assert client.get("/api/portal/attendance-qr", headers=_bearer(portal_token)).status_code == 200
    for label, headers in [("staff", auth_headers), ("portail client", _bearer(client_portal_token))]:
        response = client.get("/api/portal/attendance-qr", headers=headers)
        assert response.status_code == 403, f"{label} : {response.status_code}"


def test_attendance_qr_still_scans_and_staff_token_is_not_a_qr(client, db, auth_headers, employee_portal):
    _, portal_token = employee_portal()
    qr_token = client.get("/api/portal/attendance-qr", headers=_bearer(portal_token)).json()["token"]
    # Un jeton staff présenté comme QR est refusé par le lecteur.
    staff_token = auth_headers["Authorization"].removeprefix("Bearer ")
    refused = client.post("/api/portal/attendance-qr/scan", headers=auth_headers, json={"token": staff_token})
    assert refused.status_code == 400, refused.text
    # Le vrai QR est toujours reconnu comme tel : il passe le contrôle de famille du lecteur.
    scanned = client.post("/api/portal/attendance-qr/scan", headers=auth_headers, json={"token": qr_token})
    assert scanned.status_code != 500
    assert "n'est pas un QR de pointage" not in scanned.text
