"""Contrat serveur : DRH consulte le Pointage, il ne l'écrit jamais.

Chaque écriture Pointage / Présence / Rotation / QR / Facial a un module propriétaire. Un compte
DRH aux droits d'action les plus larges, mais sans ce module, est refusé (403) AVANT tout contrôle
métier (404, 422, 409) : les requêtes ci-dessous visent volontairement des identifiants
inexistants ou des corps vides, que seul un compte ayant franchi la barrière de module atteint.

L'inventaire couvre les 50 écritures recensées. En sont exclus les deux pointages que l'employé
fait lui-même sur son portail (POST /api/portal/pointages et /api/portal/pointage-qr) : ils sont
liés à sa propre identité portail, pas à un compte de gestion.
"""
import pytest

SOC = "Iron Global Securite"
PASSWORD = "testpass123"
PERIODE = "2026-07"
MODULE_REFUSALS = {"Module non autorise pour ce compte", "Pointage en lecture seule pour ce compte"}
ALL_ACTIONS = ["read", "create", "update", "validate", "delete", "export", "unlock", "admin"]

ACTION_BODY = {"data": {"agentId": "x", "periode": PERIODE, "day": "1", "code": "P", "date": "2026-07-01",
                        "patch": {"heureArrivee": "A"}}}
LEGACY_ACTIONS = [
    "save-pointage-cell", "save-pointage-observation", "clear-pointage-sheet",
    "validate-pointage", "unlock-pointage", "validate-pointage-day", "unlock-pointage-day",
    "validate-pointage-all", "unlock-pointage-all",
    "upsert-presence-line", "delete-presence-line", "add-presence-agent", "assign-vacant-agent",
    "validate-presence-line", "unlock-presence-line", "close-presence-day", "reopen-presence-day",
    "save-presence-movement",
]
POINTAGE_COLLECTIONS = ["pointages", "pointageMensuel", "feuillePresence", "feuillePresenceArchive",
                        "feuillePresenceCloture", "opsMouvements"]

# (méthode, chemin, corps, famille). {collection} est décliné sur POINTAGE_COLLECTIONS.
LEGACY_ACTION_WRITES = [("post", f"/api/irongs/actions/{action}", ACTION_BODY, "action legacy") for action in LEGACY_ACTIONS]
COLLECTION_WRITES = [
    ("put", "/api/irongs/collections/{collection}", {"data": []}, "collection"),
    ("post", "/api/irongs/collections/{collection}/items", {"data": {"id": "x"}}, "collection"),
    ("put", "/api/irongs/collections/{collection}/items/x", {"data": {"id": "x"}}, "collection"),
    ("patch", "/api/irongs/collections/{collection}/items/x", {"data": {"id": "x"}}, "collection"),
    ("delete", "/api/irongs/collections/{collection}/items/x", None, "collection"),
]
OPS_MOVEMENT_WRITES = [
    ("post", "/api/ops/movements", {}, "mouvement OPS"),
    ("post", "/api/ops/assignments", {}, "affectation OPS"),
    ("patch", "/api/ops/assignments/999999", {}, "affectation OPS"),
]
ADMIN_WRITES = [
    ("put", "/api/irongs/db", {"data": {"pointages": []}}, "instantané admin"),
    ("post", "/api/irongs/db", {"pointages": []}, "instantané admin"),
]
OPS_DAILY_WRITES = [
    ("post", "/api/ops/pointage/daily/generate", {}, "saisie quotidienne"),
    ("post", "/api/ops/pointage/daily/generate-rotation", {}, "saisie quotidienne"),
    ("post", "/api/ops/pointage/daily/close", {}, "saisie quotidienne"),
    ("post", "/api/ops/pointage/daily", {}, "saisie quotidienne"),
    ("patch", "/api/ops/pointage/daily/999999", {}, "saisie quotidienne"),
]
MANUAL_WRITES = [
    ("post", "/api/portal/attendance-manual/scan", {"employee_id": 999999}, "saisie manuelle pointeur"),
    ("post", "/api/portal/attendance-manual/abandon", {"employee_id": 999999}, "saisie manuelle pointeur"),
]
SITE_WORKFORCE_WRITES = [
    ("post", "/api/site-workforce/attendance", {}, "site_workforce"),
    ("post", "/api/site-workforce/attendance/close", {}, "site_workforce"),
    ("post", "/api/site-workforce/attendance/999999/correct", {}, "site_workforce"),
    ("post", "/api/site-workforce/absences/999999/decision", {}, "site_workforce"),
]
CONTROL_CENTER_WRITES = [
    ("patch", "/api/attendance/presences/999999", {"reason": "contrat", "status": "absent"}, "centre de contrôle"),
    ("post", "/api/attendance/close", {"presence_date": "2020-01-01", "site_id": 999999}, "centre de contrôle"),
    ("post", "/api/attendance/presences/999999/unlock", {"reason": "contrat"}, "centre de contrôle"),
    ("patch", "/api/attendance/anomalies/999999", {"status": "RESOLVED", "resolution": "contrat"}, "centre de contrôle"),
    ("put", "/api/attendance/rotation-settings/999999", {}, "centre de contrôle"),
    ("put", "/api/attendance/rotation-learning/999999", {}, "centre de contrôle"),
    ("post", "/api/attendance/rotation-learning/999999/rebuild", {}, "centre de contrôle"),
]
OPS_ROTATION_WRITES = [
    ("post", "/api/attendance/rotation-deviations/999999/qualify", {}, "décision de rotation OPS"),
    ("post", "/api/attendance/rotation-planning/999999/decisions", {}, "décision de rotation OPS"),
]
QR_WRITE = [("post", "/api/portal/attendance-qr/scan", {"token": "x"}, "scan QR")]
FACIAL_WRITE = [("post", "/api/biometrics/cameras/999999/recognize", {}, "reconnaissance faciale")]

# Les 12 écritures qu'un compte DRH franchissait avant ce contrat.
FORMERLY_OPEN_TO_DRH = (
    [LEGACY_ACTION_WRITES[-1]] + CONTROL_CENTER_WRITES + OPS_ROTATION_WRITES + QR_WRITE + FACIAL_WRITE
)
INVENTORY = (
    LEGACY_ACTION_WRITES + COLLECTION_WRITES + OPS_MOVEMENT_WRITES + ADMIN_WRITES + OPS_DAILY_WRITES
    + MANUAL_WRITES + SITE_WORKFORCE_WRITES + CONTROL_CENTER_WRITES + OPS_ROTATION_WRITES + QR_WRITE + FACIAL_WRITE
)
# Écritures réservées à OPS : le module du centre de contrôle (« pointage ») n'y donne pas accès.
OPS_ONLY = LEGACY_ACTION_WRITES + COLLECTION_WRITES + OPS_MOVEMENT_WRITES + OPS_ROTATION_WRITES


def _expand(writes):
    for method, url, body, family in writes:
        names = POINTAGE_COLLECTIONS if "{collection}" in url else [None]
        for name in names:
            yield method, url.format(collection=name) if name else url, body, family


def _id(write):
    return f"{write[0].upper()} {write[1]}"


def _call(client, headers, write):
    method, url, body, _family = write
    kwargs = {"headers": headers} if headers else {}
    if body is not None and method != "delete":
        kwargs["json"] = body
    return getattr(client, method)(url, **kwargs)


def _detail(response):
    try:
        return response.json().get("detail")
    except Exception:
        return None


def _stopped_by_module(response) -> bool:
    return response.status_code == 403 and _detail(response) in MODULE_REFUSALS


def _site(db, tag):
    from app.modules.ops.models import Site

    name = f"Site contrat readonly {tag}"
    site = db.query(Site).filter(Site.name == name).first()
    if not site:
        site = Site(name=name, active=1, equipment_plan={"societe": SOC})
        db.add(site)
        db.commit()
    return site


def _headers(client, db, username, **fields):
    from app.core.security import hash_password
    from app.modules.auth.models import User

    if not db.query(User).filter(User.username == username).first():
        db.add(User(
            username=username, email=f"{username}@test.com", full_name=username, access_level="H3",
            authorized_societies=[SOC], password_hash=hash_password(PASSWORD), is_active=True,
            global_society_access=False, **fields,
        ))
        db.commit()
    response = client.post("/api/auth/login", json={"username": username, "password": PASSWORD})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


@pytest.fixture
def drh_wide_headers(client, db):
    """DRH hostile mais réaliste : toutes les actions, aucun module opérationnel, pas admin."""
    return _headers(client, db, "contrat_drh_large", role="drh", authorized_modules=["drh"],
                    authorized_structures=["drh"], authorized_actions=ALL_ACTIONS)


@pytest.fixture
def drh_pointage_headers(client, db):
    """DRH qui détient en plus le module du centre de contrôle, toujours sans OPS."""
    return _headers(client, db, "contrat_drh_pointage", role="drh", authorized_modules=["drh", "pointage"],
                    authorized_structures=["drh"], authorized_actions=ALL_ACTIONS)


@pytest.fixture
def ops_headers(client, db):
    return _headers(client, db, "contrat_ops", role="ops", authorized_modules=["ops"], authorized_structures=["ops"])


@pytest.fixture
def control_center_headers(client, db):
    """Compte du centre de contrôle (pointage.irongs.com), sans OPS ni DRH."""
    return _headers(client, db, "contrat_centre_controle", role="agent", authorized_modules=["pointage"],
                    authorized_actions=ALL_ACTIONS)


@pytest.fixture
def pointeur_headers(client, db):
    site = _site(db, "pointeur")
    return _headers(client, db, "contrat_pointeur", role="pointeur", authorized_modules=["pointeur"],
                    authorized_structures=["pointage"], authorized_actions=["read", "create"],
                    authorized_sites=[site.id])


@pytest.fixture
def site_workforce_headers(client, db):
    site = _site(db, "effectifs")
    return _headers(client, db, "contrat_site_workforce", role="charge_effectifs_site",
                    authorized_modules=["site_workforce"], authorized_structures=[],
                    authorized_actions=["read", "create", "update", "validate"], authorized_sites=[site.id])


def test_inventory_lists_the_fifty_pointage_writes():
    assert len(INVENTORY) == 50
    assert len(FORMERLY_OPEN_TO_DRH) == 12
    assert len({(method, url) for method, url, _body, _family in INVENTORY}) == 50


# ── DRH pur : aucune écriture ────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("write", FORMERLY_OPEN_TO_DRH, ids=_id)
def test_drh_with_every_action_is_stopped_by_the_module_gate(client, drh_wide_headers, write):
    response = _call(client, drh_wide_headers, write)
    assert _stopped_by_module(response), f"{_id(write)} -> {response.status_code} {response.text[:200]}"


@pytest.mark.parametrize("write", list(_expand(INVENTORY)), ids=_id)
def test_drh_with_every_action_cannot_reach_any_pointage_write(client, drh_wide_headers, write):
    response = _call(client, drh_wide_headers, write)
    assert response.status_code == 403, f"{_id(write)} -> {response.status_code} {response.text[:200]}"


@pytest.mark.parametrize("write", FORMERLY_OPEN_TO_DRH, ids=_id)
def test_unauthenticated_write_is_rejected(client, write):
    assert _call(client, None, write).status_code == 401


def test_drh_movement_leaves_presence_and_movements_unchanged(client, auth_headers, drh_wide_headers):
    def state():
        return [client.get(f"/api/irongs/collections/{name}", headers=auth_headers).json()["data"]
                for name in ("feuillePresence", "opsMouvements")]

    before = state()
    refused = client.post("/api/irongs/actions/save-presence-movement", headers=drh_wide_headers, json={"data": {
        "date": "2026-07-02", "agentId": "x", "patch": {"heureArrivee": "A", "mouvementMotif": "contrat"}}})
    assert refused.status_code == 403 and _detail(refused) == "Pointage en lecture seule pour ce compte"
    assert state() == before


# ── DRH pur : les lectures prévues restent ouvertes ──────────────────────────────────────────
DRH_READS = [
    "/api/attendance/board",
    f"/api/attendance/workspace?month={PERIODE}",
    "/api/attendance/sites",
    "/api/attendance/anomalies",
    "/api/attendance/sheets",
    "/api/attendance/rotation-settings?site_id={site}",
    "/api/attendance/rotation-learning",
    "/api/attendance/rotation-deviations",
    "/api/attendance/rotation-planning?site_id={site}",
    "/api/irongs/collections/pointages",
    "/api/irongs/collections/feuillePresence",
    "/api/irongs/collections/feuillePresenceCloture",
    "/api/irongs/collections/feuillePresenceArchive",
]


@pytest.fixture
def site_id(db):
    return _site(db, "lecture").id


@pytest.mark.parametrize("url", DRH_READS)
def test_drh_keeps_reading_pointage(client, drh_wide_headers, site_id, url):
    url = url.format(site=site_id)
    response = client.get(url, headers=drh_wide_headers)
    assert response.status_code == 200, f"GET {url} -> {response.status_code} {response.text[:200]}"


@pytest.mark.parametrize("read, write", [
    ("/api/attendance/anomalies", CONTROL_CENTER_WRITES[3]),
    ("/api/attendance/rotation-settings?site_id={site}", CONTROL_CENTER_WRITES[4]),
    ("/api/attendance/rotation-learning", CONTROL_CENTER_WRITES[5]),
    ("/api/attendance/rotation-deviations", OPS_ROTATION_WRITES[0]),
    ("/api/attendance/rotation-planning?site_id={site}", OPS_ROTATION_WRITES[1]),
], ids=lambda value: value if isinstance(value, str) else _id(value))
def test_drh_reads_a_resource_it_cannot_write(client, drh_wide_headers, site_id, read, write):
    assert client.get(read.format(site=site_id), headers=drh_wide_headers).status_code == 200
    assert _stopped_by_module(_call(client, drh_wide_headers, write))


# ── DRH + module du centre de contrôle : pas d'écriture OPS pour autant ──────────────────────
@pytest.mark.parametrize("write", list(_expand(OPS_ONLY)), ids=_id)
def test_drh_with_control_center_module_does_not_gain_ops_writes(client, drh_pointage_headers, write):
    response = _call(client, drh_pointage_headers, write)
    assert response.status_code == 403, f"{_id(write)} -> {response.status_code} {response.text[:200]}"


@pytest.mark.parametrize("write", QR_WRITE + CONTROL_CENTER_WRITES + OPS_DAILY_WRITES, ids=_id)
def test_control_center_module_keeps_its_own_writes(client, drh_pointage_headers, control_center_headers, write):
    """Le module « pointage » ouvre le centre de contrôle et le scan, pour DRH comme pour tout autre compte."""
    for headers in (drh_pointage_headers, control_center_headers):
        response = _call(client, headers, write)
        assert not _stopped_by_module(response) and response.status_code != 401, f"{_id(write)} -> {response.text[:200]}"


@pytest.mark.parametrize("write", OPS_ROTATION_WRITES + [LEGACY_ACTION_WRITES[-1]], ids=_id)
def test_control_center_account_without_ops_cannot_take_ops_decisions(client, control_center_headers, write):
    assert _stopped_by_module(_call(client, control_center_headers, write))


# ── Propriétaires opérationnels : la barrière de module reste franchie ───────────────────────
OPS_WRITES = (
    LEGACY_ACTION_WRITES + [COLLECTION_WRITES[1]] + OPS_MOVEMENT_WRITES + OPS_DAILY_WRITES
    + CONTROL_CENTER_WRITES + OPS_ROTATION_WRITES + QR_WRITE + FACIAL_WRITE
)


@pytest.mark.parametrize("write", list(_expand(OPS_WRITES)), ids=_id)
def test_ops_still_crosses_the_module_gate(client, ops_headers, write):
    response = _call(client, ops_headers, write)
    assert not _stopped_by_module(response) and response.status_code != 401, f"{_id(write)} -> {response.text[:200]}"


def test_ops_still_records_a_personnel_movement(client, auth_headers, ops_headers):
    employee = client.post("/api/drh/employees", headers=auth_headers, json={
        "code": "CONTRAT_OM", "first_name": "Contrat", "last_name": "Mouvement", "society": SOC, "status": "actif"})
    assert employee.status_code in (200, 201), employee.text
    saved = client.post("/api/irongs/actions/save-presence-movement", headers=ops_headers, json={"data": {
        "date": "2031-03-04", "agentId": "CONTRAT_OM", "employee_id": employee.json()["id"],
        "patch": {"heureArrivee": "P", "mouvementMotif": "renfort", "societe": SOC}}})
    assert saved.status_code == 200, saved.text
    assert saved.json()["data"]["item"]["date"] == "2031-03-04"


@pytest.mark.parametrize("write", QR_WRITE + FACIAL_WRITE + MANUAL_WRITES[:1], ids=_id)
def test_pointeur_still_crosses_the_module_gate(client, pointeur_headers, write):
    response = _call(client, pointeur_headers, write)
    assert not _stopped_by_module(response) and response.status_code != 401, f"{_id(write)} -> {response.text[:200]}"


def test_pointeur_abandon_still_depends_on_its_explicit_permission(client, pointeur_headers):
    """Abandon de poste : module pointeur franchi, puis la permission explicite de saisie manuelle décide."""
    response = _call(client, pointeur_headers, MANUAL_WRITES[1])
    assert response.status_code == 403 and _detail(response) == "Saisie manuelle non autorisée"


@pytest.mark.parametrize("write", SITE_WORKFORCE_WRITES, ids=_id)
def test_site_workforce_keeps_its_dedicated_writes(client, site_workforce_headers, write):
    response = _call(client, site_workforce_headers, write)
    assert not _stopped_by_module(response) and response.status_code != 401, f"{_id(write)} -> {response.text[:200]}"


@pytest.mark.parametrize("write", CONTROL_CENTER_WRITES + OPS_ROTATION_WRITES + QR_WRITE + FACIAL_WRITE, ids=_id)
def test_site_workforce_does_not_gain_central_writes(client, site_workforce_headers, write):
    assert _stopped_by_module(_call(client, site_workforce_headers, write))


@pytest.mark.parametrize("write", FORMERLY_OPEN_TO_DRH, ids=_id)
def test_administrator_role_keeps_its_bypass(client, auth_headers, write):
    response = _call(client, auth_headers, write)
    assert response.status_code not in (401, 403), f"{_id(write)} -> {response.status_code} {response.text[:200]}"


def test_action_named_admin_is_not_an_administrator(client, drh_wide_headers):
    """L'action « admin » d'un compte non administrateur n'ouvre ni le module ni l'instantané global."""
    for write in ADMIN_WRITES + [LEGACY_ACTION_WRITES[-1]]:
        assert _call(client, drh_wide_headers, write).status_code == 403
