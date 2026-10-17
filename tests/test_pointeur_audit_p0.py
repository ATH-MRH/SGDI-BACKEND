"""Audit pointeur.irongs.com — P0 sécurité (non-régression).

Chaque test reproduit un constat de l'audit sur le chemin réel (API), puis vérifie que le
comportement légitime voisin reste intact (OPS, DRH, comptes historiques)."""
import uuid
from datetime import date, timedelta

import pytest

from app.core.photo_storage import DOCS_DIR, PHOTOS_DIR, UPLOADS_ROOT
from app.core.security import hash_password
from app.modules.auth.models import User, UserFeaturePermission
from app.modules.drh.models import Employee
from app.modules.ops.models import Assignment, DailyPresence, Site
from tests.module_cleanup import purge_rows_created_by_this_module  # noqa: F401 (fixture autouse)

SOC_A = "IRON GLOBAL SOLUTION"
SOC_B = "IRON GLOBAL SÉCURITÉ"
PASSWORD = "audit-p0-pass-1234"
POINTEUR = {"Host": "pointeur.irongs.com"}


def _tag() -> str:
    return uuid.uuid4().hex[:6].upper()


def _site(db, society=SOC_A):
    site = Site(name=f"AUDIT {_tag()}", active=1, equipment_plan={"societe": society})
    db.add(site); db.commit()
    return site


def _employee(db, society=SOC_A, site=None, status="actif"):
    employee = Employee(code=f"AP{_tag()}", first_name="Audit", last_name=f"P0{_tag()}", society=society, status=status)
    db.add(employee); db.flush()
    if site is not None:
        db.add(Assignment(employee_id=employee.id, site_id=site.id, start_date=date.today() - timedelta(days=30), active=1))
    db.commit()
    return employee


def _account(db, *, role="agent", modules=("pointeur",), societies=(SOC_A,), sites=(), features=(), actions=("read", "create"),
             prefix="AUD", structures=()):
    username = f"{prefix}{uuid.uuid4().int % 10**7:07d}"
    user = User(username=username, full_name=username, role=role, access_level="H2", password_hash=hash_password(PASSWORD),
                is_active=True, authorized_modules=list(modules) if modules is not None else None,
                authorized_societies=list(societies), authorized_sites=[s.id for s in sites],
                authorized_structures=list(structures), authorized_actions=list(actions) if actions else None)
    db.add(user); db.flush()
    for feature, action in features:
        db.add(UserFeaturePermission(user_id=user.id, module_key="attendance", feature_key=feature, action_key=action))
    db.commit()
    return username


def _headers(client, username, host=None):
    r = client.post("/api/auth/login", headers=host or {}, json={"username": username, "password": PASSWORD})
    assert r.status_code == 200, r.text
    return {"Authorization": "Bearer " + r.json()["access_token"], **(host or {})}


# ── /uploads : le montage statique ne contourne plus les routes protégées ───────────────
@pytest.fixture
def stored_files(db):
    from app.core.photo_storage import PUBLIC_DOC_PREFIX
    from app.modules.drh.models import Document

    PHOTOS_DIR.mkdir(parents=True, exist_ok=True)
    DOCS_DIR.mkdir(parents=True, exist_ok=True)
    (UPLOADS_ROOT / "reports").mkdir(parents=True, exist_ok=True)
    tag = _tag()
    photo = PHOTOS_DIR / f"MAT{tag}.jpg"                             # nom prévisible (ancien format)
    doc = DOCS_DIR / f"MAT{tag}_certificat.pdf"
    report = UPLOADS_ROOT / "reports" / f"rapport-{tag}.txt"
    for path in (photo, doc, report):
        path.write_bytes(b"contenu-" + tag.encode())
    # Document RH identifié : la route gardée exige une authentification pour le servir.
    record = Document(owner_type="employee", owner_id=0, label="Certificat", file_name=doc.name,
                      file_path=f"{PUBLIC_DOC_PREFIX}/{doc.name}", mime_type="application/pdf")
    db.add(record); db.commit()
    yield photo, doc, report
    db.delete(record); db.commit()
    for path in (photo, doc, report):
        path.unlink(missing_ok=True)


@pytest.mark.parametrize("variant", [
    "/uploads//photos/{name}", "/uploads/photos//{name}", "/uploads/./photos/{name}",
    "/uploads/photos/./{name}", "/uploads/photos/{name}/", "/uploads/reports/../photos/{name}",
    "/uploads/Photos/{name}", "/uploads/%2e/photos/{name}",
])
def test_uploads_mount_never_serves_the_photos_tree(client, stored_files, monkeypatch, variant):
    from app.core.config import settings
    photo, doc, _report = stored_files
    monkeypatch.setattr(settings, "photos_require_unguessable_names", True)
    # Forme canonique : la route gardée refuse le nom prévisible.
    assert client.get(f"/uploads/photos/{photo.name}").status_code == 404
    # Aucune variante de chemin ne retombe sur le montage statique.
    response = client.get(variant.format(name=photo.name))
    assert response.status_code == 404, (variant, response.status_code)
    response = client.get(variant.format(name="docs/" + doc.name))
    assert response.status_code in (401, 404), (variant, response.status_code)
    assert b"contenu-" not in response.content


def test_uploads_mount_still_serves_other_folders(client, stored_files):
    _photo, _doc, report = stored_files
    response = client.get(f"/uploads/reports/{report.name}")
    assert response.status_code == 200 and response.content.startswith(b"contenu-")


def test_guarded_photo_route_still_serves_unguessable_names(client, monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, "photos_require_unguessable_names", True)
    PHOTOS_DIR.mkdir(parents=True, exist_ok=True)
    name = f"MAT-{uuid.uuid4().hex}.jpg"
    (PHOTOS_DIR / name).write_bytes(b"jpeg")
    try:
        assert client.get(f"/uploads/photos/{name}").status_code == 200
    finally:
        (PHOTOS_DIR / name).unlink(missing_ok=True)


# ── Porte de module sur toutes les routes de pointage du portail ────────────────────────
READ_ROUTES = ["attendance-sites", "attendance-sheet", "attendance-live", "attendance-anomalies", "attendance-feed",
               "attendance-staffing", "attendance-alerts", "attendance-statistics", "attendance-employees"]


@pytest.mark.parametrize("route", READ_ROUTES)
def test_other_module_account_cannot_read_attendance_routes_on_any_host(client, db, route):
    """Un compte commercial de la même société n'atteint aucune route de pointage, y compris
    hors de l'hôte pointeur.irongs.com (le contrôle d'hôte ne jouait que sur ce domaine)."""
    headers = _headers(client, _account(db, modules=("dc",)))
    assert client.get(f"/api/portal/{route}", headers=headers).status_code == 403
    assert client.get(f"/api/portal/{route}", headers={**headers, "Host": "atlas.irongs.com"}).status_code == 403


def test_other_module_account_cannot_validate_an_employee_qr(client, db):
    headers = _headers(client, _account(db, modules=("dc",)))
    response = client.post("/api/portal/attendance-qr/scan", headers=headers, json={"token": "x"})
    assert response.status_code == 403 and "Module" in response.text


def test_revoked_pointer_module_closes_every_attendance_route(client, db):
    site = _site(db)
    username = _account(db, modules=("pointeur",), sites=(site,))
    headers = _headers(client, username, POINTEUR)
    assert client.get("/api/portal/attendance-live", headers=headers).status_code == 200
    user = db.query(User).filter(User.username == username).one()
    user.authorized_modules = []
    db.commit()
    plain = {"Authorization": headers["Authorization"]}
    for route in ("attendance-live", "attendance-feed", "attendance-sites"):
        assert client.get(f"/api/portal/{route}", headers=plain).status_code == 403
    assert client.post("/api/portal/attendance-qr/scan", headers=plain, json={"token": "x"}).status_code == 403


@pytest.mark.parametrize("modules", [("pointeur",), ("pointage",), ("ops",), ("drh",)])
def test_attendance_applications_keep_their_read_access(client, db, modules):
    site = _site(db)
    headers = _headers(client, _account(db, modules=modules, sites=(site,)))
    assert client.get("/api/portal/attendance-sites", headers=headers).status_code == 200
    assert client.get("/api/portal/attendance-feed", headers=headers).status_code == 200
    assert client.get("/api/portal/attendance-employees", headers=headers).status_code == 200


def test_legacy_supervisor_without_explicit_modules_keeps_the_feed(client, db):
    """Compte historique (modules NULL, rôle ops, identifiant libre) : accès conservé."""
    site = _site(db)
    headers = _headers(client, _account(db, role="ops", modules=None, sites=(site,), prefix="legacy-sup-"))
    assert client.get("/api/portal/attendance-feed", headers=headers).status_code == 200


def test_legacy_account_of_another_role_is_refused(client, db):
    headers = _headers(client, _account(db, role="commercial", modules=None, prefix="legacy-com-"))
    assert client.get("/api/portal/attendance-feed", headers=headers).status_code == 403


# ── Périmètre vide ≠ tout voir ───────────────────────────────────────────────────────────
def test_account_without_scope_sees_no_employee_directory_or_statistics(client, db):
    _employee(db, SOC_A); _employee(db, SOC_B)
    headers = _headers(client, _account(db, modules=("ops",), societies=()))
    directory = client.get("/api/portal/attendance-employees", headers=headers)
    assert directory.status_code == 403, directory.text
    stats = client.get("/api/portal/attendance-statistics", headers=headers)
    assert stats.status_code in (200, 403)
    if stats.status_code == 200:
        body = stats.json()
        assert not body.get("site_options") and not body.get("employees")


def test_employee_directory_is_limited_to_the_account_societies(client, db):
    mine, other = _employee(db, SOC_A), _employee(db, SOC_B)
    headers = _headers(client, _account(db, modules=("ops",), societies=(SOC_A,)))
    rows = client.get("/api/portal/attendance-employees", headers=headers).json()
    ids = {row["id"] for row in rows}
    assert mine.id in ids and other.id not in ids
    assert client.get("/api/portal/attendance-employees", headers=headers, params={"society": SOC_B}).status_code == 403


def test_global_administrator_still_sees_the_whole_directory(client, auth_headers, db):
    a, b = _employee(db, SOC_A), _employee(db, SOC_B)
    ids = {row["id"] for row in client.get("/api/portal/attendance-employees", headers=auth_headers).json()}
    assert {a.id, b.id} <= ids


# ── /api/ops/pointage : le terminal terrain lit, n'écrit pas ────────────────────────────
def _daily(employee, site=None, day=None):
    body = {"employee_id": employee.id, "presence_date": (day or date.today()).isoformat(), "status": "present",
            "arrival_time": "08:00", "departure_time": "16:00"}
    if site is not None:
        body["site_id"] = site.id
    return body


def test_pointer_cannot_write_ops_daily_presence(client, db):
    site = _site(db)
    employee = _employee(db, SOC_A, site)
    headers = _headers(client, _account(db, role="pointeur", modules=("pointeur",), sites=(site,),
                                        features=(("manual_entry", "create"), ("qr_scanning", "create"))))
    assert client.get("/api/ops/pointage/daily", headers=headers, params={"site_id": site.id}).status_code == 200   # lecture conservée
    before = db.query(DailyPresence).filter(DailyPresence.employee_id == employee.id).count()
    backdated = client.post("/api/ops/pointage/daily", headers=headers, json=_daily(employee, site, date.today() - timedelta(days=20)))
    assert backdated.status_code == 403, backdated.text
    assert client.post("/api/ops/pointage/daily/generate", headers=headers).status_code == 403
    db.expire_all()
    assert db.query(DailyPresence).filter(DailyPresence.employee_id == employee.id).count() == before


def test_ops_daily_presence_checks_the_employee_society_and_site(client, db):
    site_a, site_a2 = _site(db, SOC_A), _site(db, SOC_A)
    mine = _employee(db, SOC_A, site_a)
    elsewhere = _employee(db, SOC_A, site_a2)
    foreign = _employee(db, SOC_B)
    society_ops = _headers(client, _account(db, role="ops", modules=("ops",), societies=(SOC_A,)))
    assert client.post("/api/ops/pointage/daily", headers=society_ops, json=_daily(foreign, site_a)).status_code == 403
    assert client.post("/api/ops/pointage/daily", headers=society_ops, json=_daily(mine, site_a)).status_code == 200
    site_ops = _headers(client, _account(db, role="ops", modules=("ops",), societies=(SOC_A,), sites=(site_a,)))
    assert client.post("/api/ops/pointage/daily", headers=site_ops, json=_daily(mine)).status_code == 403            # site obligatoire
    assert client.post("/api/ops/pointage/daily", headers=site_ops, json=_daily(elsewhere, site_a)).status_code == 403  # hors de ses sites
    assert client.post("/api/ops/pointage/daily", headers=site_ops, json=_daily(mine, site_a)).status_code == 200


# ── Pont legacy : le pointeur n'écrit pas, et le périmètre porte sur l'employé résolu ────
def test_pointer_role_cannot_write_legacy_presence_or_assignments(client, db):
    site = _site(db)
    employee = _employee(db, SOC_A, site)
    other_site = _site(db)
    headers = _headers(client, _account(db, role="pointeur", modules=("pointeur",), sites=(site,)))
    presence = client.post("/api/irongs/collections/feuillePresence/items", headers=headers, json={"data": {
        "id": "fp-" + _tag(), "agentBackendId": employee.id, "date": (date.today() - timedelta(days=10)).isoformat(),
        "statut": "present", "heureArrivee": "08:00"}})
    assert presence.status_code == 403, presence.text
    assignment = client.post("/api/irongs/collections/assignments/items", headers=headers, json={"data": {
        "id": "as-" + _tag(), "agentBackendId": employee.id, "siteBackendId": other_site.id}})
    assert assignment.status_code == 403, assignment.text


def test_legacy_presence_scope_uses_the_resolved_employee_not_the_declared_society(client, db):
    site = _site(db, SOC_A)
    foreign = _employee(db, SOC_B)
    mine = _employee(db, SOC_A, site)
    headers = _headers(client, _account(db, role="ops", modules=("ops",), societies=(SOC_A,)))
    item = {"id": "fp-" + _tag(), "date": date.today().isoformat(), "statut": "present", "heureArrivee": "08:00"}
    refused = client.post("/api/irongs/collections/feuillePresence/items", headers=headers,
                          json={"data": {**item, "agentBackendId": foreign.id}})                 # aucune société déclarée
    assert refused.status_code == 403, refused.text
    disguised = client.post("/api/irongs/collections/feuillePresence/items", headers=headers,
                            json={"data": {**item, "id": "fp-" + _tag(), "agentBackendId": foreign.id, "societe": SOC_A}})
    assert disguised.status_code == 403, disguised.text
    accepted = client.post("/api/irongs/collections/feuillePresence/items", headers=headers,
                           json={"data": {**item, "id": "fp-" + _tag(), "agentBackendId": mine.id, "siteBackendId": site.id, "societe": SOC_A}})
    assert accepted.status_code == 200, accepted.text


def test_legacy_assignment_scope_checks_the_site_grants(client, db):
    site, other = _site(db, SOC_A), _site(db, SOC_A)
    employee = _employee(db, SOC_A, site)
    headers = _headers(client, _account(db, role="ops", modules=("ops",), societies=(SOC_A,), sites=(site,)))
    refused = client.post("/api/irongs/collections/assignments/items", headers=headers, json={"data": {
        "id": "as-" + _tag(), "agentBackendId": employee.id, "siteBackendId": other.id, "societe": SOC_A}})
    assert refused.status_code == 403, refused.text
