"""QR de pointage A1 des badges Studio (app.modules.drh.badge_qr) : lisible par la douchette HENEX
HC-866 sur un Mac AZERTY, sans rien relâcher.

Constat réel (2026-10-18) : le badge contient `…?t=<signature>…`, la HC-866 tape `…?t-<signature>…`.
Le format A1 n'emploie que lettres, chiffres et « : / . » (vérifiés sur la douchette) ; le Pointeur
le juge avec EXACTEMENT les règles du badge Studio : la batterie complète de test_pointeur_badge_qr est
rejouée ici avec le QR que le Studio imprime désormais. Données fictives uniquement."""
import json
import re
from datetime import datetime

import pytest
from sqlalchemy import select

import tests.test_pointeur_badge_qr as tqr
from app.modules.auth.models import AuditEvent
from app.modules.drh import badge_design, badge_qr
from app.modules.drh.badge_models import STATUS_REVOKED, EmployeeBadge
from app.modules.drh.badge_routes import _qr_url, _studio_link_v0
from app.modules.ops.models import Assignment, Site
from tests.module_cleanup import purge_rows_created_by_this_module  # noqa: F401 (fixture autouse)
from tests.test_drh_badges import API, SOC, clean_badges, drh, fast_portrait  # noqa: F401 (fixtures)
from tests.test_drh_badges import _employee as _studio_employee
from tests.test_pointeur_audit_p0 import POINTEUR, _account, _headers
from tests.test_pointeur_badge_qr import STUDIO, _badge, _events, _refused, _scan, pg, setup  # noqa: F401 (fixtures)
# Batterie complète du badge Studio, rejouée au format A1 (voir la fixture a1_format).
from tests.test_pointeur_badge_qr import (  # noqa: F401
    test_active_blacklist_entry_blocks_even_if_the_status_was_not_mirrored as test_a1_blacklist_blocks,
    test_badge_disabled_on_the_employee_record_is_refused as test_a1_badge_disabled_on_the_record,
    test_badge_of_a_deleted_employee_link_is_not_recognized as test_a1_badge_of_a_deleted_employee,
    test_closed_day_is_never_modified as test_a1_closed_day,
    test_counters_follow_the_badge_scan as test_a1_counters,
    test_database_failure_never_reports_a_success as test_a1_database_failure,
    test_employee_without_any_assignment_has_no_shift as test_a1_no_shift,
    test_expired_badge_is_refused as test_a1_expired,
    test_inactive_employee_is_refused as test_a1_inactive_employee,
    test_insufficient_permissions_are_refused_before_any_badge_check as test_a1_insufficient_permissions,
    test_new_arrival_too_soon_after_a_departure_is_already_recorded as test_a1_too_soon,
    test_public_consultation_still_works_and_records_nothing as test_a1_public_consultation,
    test_replaced_badge_is_inactive as test_a1_replaced,
    test_revoked_badge_is_refused as test_a1_revoked,
    test_second_scan_of_the_same_badge_is_already_recorded as test_a1_second_scan,
    test_two_simultaneous_badge_scans_record_a_single_arrival_on_postgres as test_a1_concurrent_scans_on_postgres,
    test_valid_studio_badge_records_the_attendance as test_a1_valid_badge,
    test_wrong_site_is_refused as test_a1_wrong_site,
    test_wrong_society_reveals_nothing_about_the_badge as test_a1_wrong_society,
    test_write_failure_on_postgres_leaves_no_attendance as test_a1_write_failure_on_postgres,
)

# Lectures RÉELLES d'une douchette HENEX réglée « AZERTY PC » sur un Mac AZERTY : « = » → « - »
# (HC-866, 2026-10-18), « _ » → « ! » (HC-666). Lettres, chiffres et « : / . ? » arrivent intacts.
HC866_ON_MAC = str.maketrans({"=": "-", "_": "!"})
SCANNER_SAFE = re.compile(r"^[a-z0-9A-Z:/.]+$")
UNRECOGNIZED = ("QR_UNRECOGNIZED", "QR code non reconnu", "error", 400)
MISREAD = ("QR_MISREAD", "QR mal lu par le lecteur — présentez-le à nouveau ou utilisez la caméra", "error", 400)


def _a1_qr(employee, badge):
    """Contenu exact du QR d'un badge émis aujourd'hui : adresse produite par le Studio lui-même."""
    return _qr_url(STUDIO, employee, badge.id)


@pytest.fixture(autouse=True)
def a1_format(monkeypatch):
    monkeypatch.setattr(tqr, "_qr", _a1_qr)


def _code(url):
    return url.rsplit("/", 1)[1]


def _last_refusal(db):
    db.expire_all()
    row = db.execute(select(AuditEvent).where(AuditEvent.action == "attendance.qr_scan.refused")
                     .order_by(AuditEvent.id.desc())).scalars().first()
    return json.loads(row.new_state) if isinstance(row.new_state, str) else row.new_state


def _pointeur_for(client, db, employee):
    site = db.get(Site, db.execute(select(Assignment.site_id).where(Assignment.employee_id == employee.id,
                                                                  Assignment.active == 1)).scalar())
    return site, _headers(client, _account(db, modules=("pointeur",), societies=(SOC,), sites=(site,)), POINTEUR)


# ── Émission réelle par le Studio, impression, lecture ────────────────────────────────────────
def test_studio_issues_an_a1_qr_that_the_hc866_cannot_alter(client, db, drh):
    emp = _studio_employee(db)
    issued = client.post(f"{API}/issue", json={"employee_id": emp.id}, headers=drh)
    assert issued.status_code in (200, 201), issued.text
    badge_id = issued.json()["id"]
    url = db.get(EmployeeBadge, badge_id).snapshot["qr_url"]
    assert badge_qr.read(url) == (badge_qr.OK, badge_id)
    assert SCANNER_SAFE.match(url) and "/p/A1" in url and len(_code(url)) == 25, "lettres, chiffres, « : / . » seulement"
    assert url.translate(HC866_ON_MAC) == url, "la douchette ne peut rien en changer"
    assert emp.code not in url and emp.last_name.upper() not in url.upper(), "aucune donnée personnelle dans le QR"
    assert client.get(f"{API}/{badge_id}", headers=drh).json()["qr"] == badge_design.qr_matrix(url), "QR dessiné = adresse A1"

    site, pointeur = _pointeur_for(client, db, emp)
    scanned = _scan(client, pointeur, url.translate(HC866_ON_MAC), site)                   # lecture douchette
    assert scanned.status_code == 201, scanned.text
    assert [(e.event_type, e.source) for e in _events(db, emp)] == [("ARRIVAL", "QR")]

    # Le même badge au format d'avant, lu par la HC-866 : « ?t- » — refusé, jamais « réparé ».
    old = _studio_link_v0(STUDIO, emp, badge_id)
    assert "?t-" in old.translate(HC866_ON_MAC)
    _refused(_scan(client, pointeur, old.translate(HC866_ON_MAC), site), *MISREAD)
    assert len(_events(db, emp)) == 1

    # Réémission : l'ancien badge A1 est remplacé, le nouveau seul est valable.
    renewed = client.post(f"{API}/issue", json={"employee_id": emp.id}, headers=drh).json()
    new_url = db.get(EmployeeBadge, renewed["id"]).snapshot["qr_url"]
    assert new_url != url and badge_qr.read(new_url) == (badge_qr.OK, renewed["id"])
    replaced = db.get(EmployeeBadge, badge_id); db.refresh(replaced)
    assert replaced.revoked_at is not None                                                     # remplacé = révoqué par le Studio
    _refused(_scan(client, pointeur, url, site), "BADGE_REVOKED", "Badge révoqué", "error", 403)
    assert client.post(f"{API}/{renewed['id']}/revoke", json={"reason": "perdu"}, headers=drh).status_code == 200
    _refused(_scan(client, pointeur, new_url, site), "BADGE_REVOKED", "Badge révoqué", "error", 403)
    assert len(_events(db, emp)) == 1


def _decode(cv2, image):
    text, _points, _straight = cv2.QRCodeDetector().detectAndDecode(image)
    return text


def test_the_printed_qr_matrix_decodes_to_the_a1_address(client, db, drh):
    cv2 = pytest.importorskip("cv2")
    numpy = pytest.importorskip("numpy")
    emp = _studio_employee(db)
    badge_id = client.post(f"{API}/issue", json={"employee_id": emp.id}, headers=drh).json()["id"]
    url = db.get(EmployeeBadge, badge_id).snapshot["qr_url"]
    rows = client.get(f"{API}/{badge_id}", headers=drh).json()["qr"]                    # matrice que le Studio imprime
    grid = numpy.array([[0 if bit == "1" else 255 for bit in row] for row in rows], dtype=numpy.uint8)
    image = numpy.kron(numpy.pad(grid, 4, constant_values=255), numpy.ones((8, 8), dtype=numpy.uint8))
    assert _decode(cv2, image) == url
    assert badge_qr.read(_decode(cv2, image).translate(HC866_ON_MAC)) == (badge_qr.OK, badge_id)


def test_the_printed_pdf_badge_decodes_to_the_a1_address(client, db, drh):
    cv2 = pytest.importorskip("cv2")
    numpy = pytest.importorskip("numpy")
    pdfium = pytest.importorskip("pypdfium2")
    emp = _studio_employee(db)
    badge_id = client.post(f"{API}/issue", json={"employee_id": emp.id}, headers=drh).json()["id"]
    url = db.get(EmployeeBadge, badge_id).snapshot["qr_url"]
    sheet = client.post(f"{API}/print/pdf", json={"badge_ids": [badge_id]}, headers=drh)
    assert sheet.status_code == 200
    pages = pdfium.PdfDocument(sheet.content)
    found = set()
    for index in range(len(pages)):
        bitmap = pages[index].render(scale=600 / 72).to_numpy()          # 600 ppp, comme une imprimante à cartes
        gray = cv2.cvtColor(bitmap, cv2.COLOR_BGRA2GRAY if bitmap.shape[2] == 4 else cv2.COLOR_BGR2GRAY)
        ok, texts, _, _ = cv2.QRCodeDetector().detectAndDecodeMulti(gray)
        found.update(text for text in (texts if ok else ()) if text)
    assert url in found, f"QR imprimé : {sorted(found)}"


# ── Lecture : variantes acceptées par définition, aucune réparation ──────────────────────────
def test_case_and_bare_code_are_the_same_badge_by_definition(client, db, setup):
    url = _a1_qr(setup.employee, setup.badge)
    assert _scan(client, setup.headers, url.upper(), setup.site).status_code == 201           # Verr. Maj.
    again = _scan(client, setup.headers, _code(url).lower(), setup.site)                       # code seul, minuscules
    assert again.status_code == 201 and again.json()["duplicate"] is True
    assert len(_events(db, setup.employee)) == 1


def test_forged_or_damaged_a1_codes_are_refused_and_never_repaired(client, db, setup, monkeypatch):
    from app.core.config import settings
    from app.main import _public_employee_token

    url = _a1_qr(setup.employee, setup.badge)
    code = _code(url)
    other = _badge(db, setup.employee)
    other_code = badge_qr.token_for(other.id)
    flip = lambda text, i: text[:i] + ("2" if text[i] != "2" else "3") + text[i + 1:]
    v0_token = _public_employee_token("badge", f"{setup.employee.id}:{setup.badge.id}")
    with monkeypatch.context() as other_server:
        other_server.setattr(settings, "jwt_secret", settings.jwt_secret + "-autre-serveur")
        foreign = badge_qr.url_for("https://drh.irongs.com/", setup.badge.id)
    cases = [
        ("signature altérée", url.replace(code, flip(code, 24)), UNRECOGNIZED, "signature_invalide"),
        ("numéro d'un autre badge, signature gardée", url.replace(code, other_code[:9] + code[9:]), UNRECOGNIZED, "signature_invalide"),
        ("signé par un autre serveur", foreign, UNRECOGNIZED, "signature_invalide"),
        ("jeton de lien public recyclé", url.replace(code, code[:9] + v0_token[:16].upper()), UNRECOGNIZED, "signature_invalide"),
        ("lettre O à la place de 0", url.replace(code, code[:24] + "O"), UNRECOGNIZED, "format_invalide"),
        ("autre préfixe", url.replace(code, "A2" + code[2:]), UNRECOGNIZED, "format_invalide"),
        ("« : » abîmé", url.replace("https:", "https;"), MISREAD, "lecture_alteree"),
        ("« / » abîmé", url.replace("/p/", "!p!"), MISREAD, "lecture_alteree"),
    ]
    for label, qr, expected, fault in cases:
        response = _scan(client, setup.headers, qr, setup.site)
        _refused(response, *expected)
        state = _last_refusal(db)
        assert (state["qr"], state["fault"]) == ("badge-a1", fault), label
        assert code not in json.dumps(state) and code not in response.text, label
    for qr in (url[:-1], url + "Z"):                                                          # tronqué / rallongé
        _refused(_scan(client, setup.headers, qr, setup.site), *UNRECOGNIZED)
    assert _events(db, setup.employee) == []
    assert _scan(client, setup.headers, url, setup.site).status_code == 201                   # le vrai badge, intact


# ── Badges et liens existants : conservés tels quels ──────────────────────────────────────────
def test_badges_issued_before_a1_keep_their_printed_qr_and_stay_valid(client, db, drh):
    emp = _studio_employee(db)
    badge_id = client.post(f"{API}/issue", json={"employee_id": emp.id}, headers=drh).json()["id"]
    badge = db.get(EmployeeBadge, badge_id)
    before_a1 = _studio_link_v0(STUDIO, emp, badge_id)                       # badge imprimé avant le format A1
    badge.snapshot = {**badge.snapshot, "qr_url": before_a1}
    db.commit()
    assert client.get(f"{API}/{badge_id}", headers=drh).json()["qr"] == badge_design.qr_matrix(before_a1), "rien n'est réécrit"
    site, pointeur = _pointeur_for(client, db, emp)
    assert _scan(client, pointeur, before_a1, site).status_code == 201
    path = before_a1.split("://", 1)[1].split("/", 1)[1]
    assert client.get("/api/" + path).json()["badgeActif"] is True and client.get("/" + path).status_code == 200


# ── Téléphone : le même QR ouvre la page publique du badge ────────────────────────────────────
def test_phone_opens_the_public_badge_page_from_the_a1_qr(client, db, setup):
    setup.employee.extra = {"groupeSanguin": "AB-"}; db.commit()
    url = _a1_qr(setup.employee, setup.badge)
    code = _code(url)
    for path in (f"/p/{code}", f"/P/{code}", f"/p/{code.lower()}"):
        page = client.get(path)
        assert page.status_code == 200 and "Badge actif" in page.text and setup.employee.last_name in page.text, path
        assert "AB-" not in page.text and "sanguin" not in page.text.lower(), path
    assert client.get(f"/api/p/{code}").json()["badgeActif"] is True
    flip = code[:24] + ("2" if code[24] != "2" else "3")
    assert client.get(f"/p/{flip}").status_code == 404 and client.get(f"/api/p/{flip}").status_code == 404
    setup.badge.status, setup.badge.revoked_at = STATUS_REVOKED, datetime.utcnow(); db.commit()
    assert client.get(f"/api/p/{code}").json()["badgeActif"] is False
    assert "Badge désactivé" in client.get(f"/p/{code}").text
    assert _events(db, setup.employee) == []
