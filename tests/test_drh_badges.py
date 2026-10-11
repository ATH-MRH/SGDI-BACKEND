"""Studio Badges DRH : maquette, émission (instantané), impression PDF, révocation, périmètre."""
import base64
import io
import uuid
from datetime import date

import pytest
from PIL import Image
from sqlalchemy import select

from app.core.photo_storage import PHOTOS_DIR, ensure_upload_dirs
from app.core.security import hash_password
from app.modules.auth.models import AuditEvent, User
from app.modules.drh import badge_design, badge_pdf, portrait
from app.modules.drh.badge_models import BadgeEvent, BadgeTemplate, EmployeeBadge
from app.modules.drh.models import Employee
from app.modules.ops.models import Assignment, Site
from tests.module_cleanup import purge_rows_created_by_this_module  # noqa: F401 (fixture autouse)

SOC = "Iron Global Securite"
OTHER = "Sword Corporation"
API = "/api/drh/badges"


def _tag():
    return uuid.uuid4().hex[:6].upper()


def _jpeg(size=(300, 400), colour="white"):
    out = io.BytesIO()
    Image.new("RGB", size, colour).save(out, "JPEG", quality=90)
    return out.getvalue()


def _employee(db, *, society=SOC, photo=True, status="actif", indicatif="ETP/DF/H01"):
    emp = Employee(code=f"BG{_tag()}", first_name="Mohamed", last_name=f"Abdelkader{_tag()}", society=society,
                   status=status, position="Agent")
    db.add(emp)
    db.flush()
    site = Site(name=f"Site {_tag()}", indicatif=indicatif, active=1, equipment_plan={"societe": society})
    db.add(site)
    db.flush()
    db.add(Assignment(employee_id=emp.id, site_id=site.id, group_code="A", position="Cariste", start_date=date(2026, 1, 1), active=1))
    if photo:
        ensure_upload_dirs()
        path = PHOTOS_DIR / f"{emp.code}-{_tag()}.jpg"
        path.write_bytes(_jpeg())
        emp.extra = {"photo": f"/uploads/photos/{path.name}"}
    db.commit()
    return emp


def _login(client, db, *, role, societies, modules=("drh",)):
    name = f"BG{uuid.uuid4().int % 10**6:06d}"
    db.add(User(username=name, full_name=name, role=role, access_level="H2", password_hash=hash_password("badge-pass-1"),
                is_active=True, authorized_modules=list(modules), authorized_societies=list(societies)))
    db.commit()
    token = client.post("/api/auth/login", json={"username": name, "password": "badge-pass-1"}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def drh(client, db):
    return _login(client, db, role="drh", societies=[SOC])


@pytest.fixture(autouse=True)
def fast_portrait(monkeypatch):
    monkeypatch.setattr(portrait, "render", lambda source: portrait.Portrait(_jpeg(), portrait.METHOD_CENTERED))


@pytest.fixture(autouse=True)
def clean_badges(db):
    yield
    db.rollback()
    for model in (BadgeEvent, EmployeeBadge):
        db.query(model).delete()
    db.query(BadgeTemplate).filter(BadgeTemplate.is_system == 0).delete()
    db.commit()


# ── Maquette ──────────────────────────────────────────────────────────────────

def test_reference_design_matches_the_official_model():
    design = badge_design.reference_design()
    assert (design["width"], design["height"]) == (54, 86)
    by_id = {element["id"]: element for element in design["pages"][0]["elements"]}
    assert by_id["bandeau_haut"]["fill"] == "#111111" and by_id["bandeau_bas"]["fill"] == "#FFCB05"
    assert by_id["site"]["text"] == "SITE : {{site_code}}" and by_id["site"]["color"] == "#FFFFFF"
    assert by_id["photo"]["stroke"] == "#FFCB05"
    assert by_id["code"]["text"] == "CODE : **{{matricule}}**"
    assert by_id["fonction"]["color"] == "#111111" and by_id["fonction"]["y"] > by_id["qr"]["y"]
    assert {"nom", "prenom", "qr", "filet"} <= set(by_id)


def test_sanitize_design_keeps_only_known_bounded_properties():
    png = io.BytesIO()
    Image.new("RGB", (4, 4), "red").save(png, "PNG")
    good = "data:image/png;base64," + base64.b64encode(png.getvalue()).decode()
    design = badge_design.sanitize_design({"width": 9999, "height": "x", "onload": "alert(1)", "pages": [{"background": "red", "elements": [
        {"type": "text", "id": "a b<script>", "text": "x" * 900, "size": 9999, "color": "javascript:alert(1)", "font": "Comic", "evil": 1},
        {"type": "script", "text": "nope"},
        {"type": "image", "src": good, "fit": "weird"},
        {"type": "shape", "shape": "polygon", "points": [[0, 0]]},
        {"type": "shape", "shape": "path", "path": [["M", 0, 0], ["X", 1], ["L", 1, 1], ["Z"]], "fill": ""},
    ]}]})
    assert design["width"] == 300 and design["height"] == 86 and "onload" not in design
    text, image, polygon, path = design["pages"][0]["elements"]
    assert design["pages"][0]["background"] == "#FFFFFF"
    assert text["id"] == "el1" and len(text["text"]) == 500 and text["size"] == 160 and text["color"] == "#111111"
    assert text["font"] == "Helvetica" and "evil" not in text
    assert image["fit"] == "contain" and polygon["shape"] == "rect"
    assert path["path"] == [["M", 0, 0], ["L", 1, 1], ["Z"]] and path["fill"] == ""
    for src in ("data:image/svg+xml;base64,PHN2Zy8+", "https://example.org/a.png", "data:image/png;base64,QUJD"):
        with pytest.raises(badge_design.DesignError):
            badge_design.sanitize_design({"pages": [{"elements": [{"type": "image", "src": src}]}]})
    with pytest.raises(badge_design.DesignError):
        badge_design.sanitize_design({"pages": []})


def test_fields_are_filled_after_bold_markup_is_split():
    runs = badge_design.split_runs("CODE : **{{matricule}}**", False)
    assert runs == [("CODE : ", False), ("{{matricule}}", True)]
    assert badge_design.fill_fields("{{nom}} {{inconnu}} {{site}}", {"nom": "**x**"}, uppercase=True) == "**X** {{INCONNU}} —"


def test_pdf_is_the_card_alone_at_its_exact_size():
    from reportlab.lib.units import mm

    item = badge_pdf.BadgeItem(design=badge_design.reference_design(), values={"nom": "ABDELKADER", "prenom": "MOHAMED",
                               "matricule": "K26", "fonction": "CARISTE", "site_code": "ETP/DF/H01"},
                               photo=_jpeg(), qr=badge_design.qr_matrix("https://exemple.test/badge"))
    card = badge_pdf.render_cards([item])
    assert card.startswith(b"%PDF")
    assert f"/MediaBox [ 0 0 {54 * mm:.4f}".rstrip("0").encode()[:22] in card
    assert card.count(b"/Type /Page\n") == 1
    sheet = badge_pdf.render_sheets([item] * 10)
    assert sheet.count(b"/Type /Page\n") == 2                       # 9 cartes par planche A4


def test_cover_box_always_fills_the_frame():
    for crop in (None, {"zoom": 2, "dx": 0.5, "dy": -0.5}, {"zoom": 99, "dx": 9, "dy": -9}):
        x, y, w, h = badge_design.cover_box(300, 400, 21.3, 24.5, crop)
        assert x <= 1e-6 and y <= 1e-6 and x + w >= 21.3 - 1e-6 and y + h >= 24.5 - 1e-6


# ── Émission, instantané, impression ──────────────────────────────────────────

def test_issue_takes_a_snapshot_that_survives_later_changes(client, db, drh):
    emp = _employee(db)
    prepared = client.get(f"{API}/employees/{emp.id}", headers=drh).json()
    assert prepared["site_code"] == "ETP/DF/H01" and prepared["fonction"] == "Cariste" and prepared["has_photo"]
    assert prepared["badge"] is None and len(prepared["qr"]) >= 21 and prepared["default_template_id"]
    assert client.get(f"{API}/employees/{emp.id}/photo", headers=drh).headers["content-type"] == "image/jpeg"

    resp = client.post(f"{API}/issue", json={"employee_id": emp.id, "crop": {"zoom": 1.5, "dx": 0.1, "dy": 9}}, headers=drh)
    assert resp.status_code == 200, resp.text
    badge = resp.json()
    assert badge["status"] == "ACTIF" and badge["number"] == f"BDG-{date.today().year}-{badge['id']:06d}"
    assert badge["values"]["matricule"] == emp.code and badge["values"]["site_code"] == "ETP/DF/H01"
    assert badge["crop"] == {"zoom": 1.5, "dx": 0.1, "dy": 0.5} and badge["has_photo"]
    assert "qr_url" not in badge and "qr_url" not in badge["values"]

    emp.last_name, emp.position = "Renomme", "Chef"
    db.query(Assignment).filter(Assignment.employee_id == emp.id).update({"position": "Chef de poste"})
    db.commit()
    again = client.get(f"{API}/{badge['id']}", headers=drh).json()
    assert again["values"] == badge["values"] and again["design"] == badge["design"]
    assert client.get(f"{API}/{badge['id']}/photo", headers=drh).status_code == 200

    stored = db.get(EmployeeBadge, badge["id"])
    assert "/public/badge/" in stored.snapshot["qr_url"] and "?t=" in stored.snapshot["qr_url"]
    actions = [row.action for row in db.execute(select(BadgeEvent).where(BadgeEvent.badge_id == badge["id"])).scalars()]
    assert actions == ["EMISSION"]
    assert db.execute(select(AuditEvent).where(AuditEvent.action == "badge.emission", AuditEvent.resource_id == str(badge["id"]))).first()


def test_new_badge_replaces_the_previous_one_and_revocation_closes_the_public_page(client, db, drh):
    emp = _employee(db)
    first = client.post(f"{API}/issue", json={"employee_id": emp.id}, headers=drh).json()
    second = client.post(f"{API}/issue", json={"employee_id": emp.id}, headers=drh).json()
    db.expire_all()
    assert db.get(EmployeeBadge, first["id"]).status == "REMPLACE" and second["status"] == "ACTIF"
    assert db.get(Employee, emp.id).extra.get("badgeActif") is not False

    assert client.post(f"{API}/print/pdf", json={"badge_ids": [first["id"]]}, headers=drh).status_code == 409
    assert client.post(f"{API}/{second['id']}/revoke", json={"reason": "inconnu"}, headers=drh).status_code == 422
    revoked = client.post(f"{API}/{second['id']}/revoke", json={"reason": "perdu", "comment": "déclaré le 3"}, headers=drh)
    assert revoked.status_code == 200 and revoked.json()["status"] == "REVOQUE"
    assert revoked.json()["revoke_reason"] == "Badge perdu — déclaré le 3"
    db.expire_all()
    assert db.get(Employee, emp.id).extra["badgeActif"] is False
    assert db.get(Employee, emp.id).extra["photo"].startswith("/uploads/photos/")      # fiche intacte par ailleurs
    assert client.post(f"{API}/{second['id']}/revoke", json={"reason": "perdu"}, headers=drh).status_code == 409


def test_print_returns_a_pdf_and_counts_every_print(client, db, drh):
    badges = [client.post(f"{API}/issue", json={"employee_id": _employee(db).id}, headers=drh).json() for _ in range(2)]
    ids = [badge["id"] for badge in badges]
    card = client.post(f"{API}/print/pdf", json={"badge_ids": ids}, headers=drh)
    assert card.status_code == 200 and card.headers["content-type"] == "application/pdf" and card.content.startswith(b"%PDF")
    assert card.headers["cache-control"] == "private, no-store" and card.content.count(b"/Type /Page\n") == 2
    sheet = client.post(f"{API}/print/pdf", json={"badge_ids": ids, "layout": "a4"}, headers=drh)
    assert sheet.status_code == 200 and sheet.content.count(b"/Type /Page\n") == 1
    db.expire_all()
    assert [db.get(EmployeeBadge, badge_id).print_count for badge_id in ids] == [2, 2]
    board = client.get(f"{API}/dashboard", headers=drh).json()
    assert board["to_print"] == 0 and board["with_badge"] >= 2 and board["recent"][0]["action"] == "IMPRESSION"
    listed = client.get(f"{API}/history", params={"action": "impression"}, headers=drh).json()
    assert listed["total"] == 4


def test_missing_photo_and_outgoing_employees_are_refused(client, db, drh):
    no_photo = _employee(db, photo=False)
    refused = client.post(f"{API}/issue", json={"employee_id": no_photo.id}, headers=drh)
    assert refused.status_code == 409 and "Photo manquante" in refused.json()["detail"]
    assert client.get(f"{API}/employees/{no_photo.id}/photo", headers=drh).status_code == 404
    leaving = _employee(db, status="sortant")
    assert client.post(f"{API}/issue", json={"employee_id": leaving.id}, headers=drh).status_code == 409
    listed = client.get(f"{API}/employees", params={"state": "no_photo", "q": no_photo.last_name}, headers=drh).json()
    assert [row["id"] for row in listed["items"]] == [no_photo.id]
    assert leaving.id not in [row["id"] for row in client.get(f"{API}/employees", params={"page_size": 200}, headers=drh).json()["items"]]

    assert client.put(f"{API}/settings", json={"society": SOC, "data": {"require_photo": False, "validity_months": 12, "number_prefix": "ig-s!"}},
                      headers=drh).status_code == 200
    issued = client.post(f"{API}/issue", json={"employee_id": no_photo.id}, headers=drh).json()
    assert issued["has_photo"] is False and issued["number"].startswith("IGS-") and issued["valid_until"] is not None
    assert client.post(f"{API}/print/pdf", json={"badge_ids": [issued["id"]]}, headers=drh).status_code == 200
    db.query(__import__("app.modules.drh.badge_models", fromlist=["BadgeSettings"]).BadgeSettings).delete()
    db.commit()


def test_batch_issue_reports_each_refusal_without_blocking_the_others(client, db, drh):
    ok, no_photo, foreign = _employee(db), _employee(db, photo=False), _employee(db, society=OTHER)
    existing = client.post(f"{API}/issue", json={"employee_id": ok.id}, headers=drh).json()
    other_ok = _employee(db)
    result = client.post(f"{API}/issue-batch", json={"employee_ids": [ok.id, no_photo.id, foreign.id, other_ok.id, 99999999]}, headers=drh).json()
    assert [badge["id"] for badge in result["issued"]][0] == existing["id"] and len(result["issued"]) == 2
    assert {row["employee_id"] for row in result["skipped"]} == {no_photo.id, foreign.id, 99999999}


# ── Modèles ───────────────────────────────────────────────────────────────────

def test_templates_lifecycle(client, db, drh):
    listing = client.get(f"{API}/templates", headers=drh).json()
    reference = next(row for row in listing["items"] if row["is_system"])
    assert reference["is_default"] and "matricule" in listing["fields"]
    assert sum(row["is_system"] for row in client.get(f"{API}/templates", headers=drh).json()["items"]) == 1
    body = {"name": "Essai", "society": SOC, "design": reference["design"]}
    assert client.put(f"{API}/templates/{reference['id']}", json=body, headers=drh).status_code == 409
    assert client.delete(f"{API}/templates/{reference['id']}", headers=drh).status_code == 409
    assert client.post(f"{API}/templates", json={**body, "society": None}, headers=drh).status_code == 403    # modèle commun
    assert client.post(f"{API}/templates", json={**body, "society": OTHER}, headers=drh).status_code == 403
    assert client.post(f"{API}/templates", json={**body, "design": {"pages": []}}, headers=drh).status_code == 422

    copy = client.post(f"{API}/templates/{reference['id']}/duplicate", headers=drh).json()
    assert copy["society"] == SOC and not copy["is_system"] and copy["design"] == reference["design"]
    design = copy["design"]
    design["pages"][0]["elements"].append({"type": "text", "id": "note", "text": "{{societe}}", "x": 2, "y": 2, "w": 20, "h": 4})
    updated = client.put(f"{API}/templates/{copy['id']}", json={"name": "IGS vertical", "society": SOC, "design": design}, headers=drh).json()
    assert updated["version"] == 2 and updated["design"]["pages"][0]["elements"][-1]["id"] == "note"
    assert client.post(f"{API}/templates/{copy['id']}/default", headers=drh).json()["is_default"]
    assert client.delete(f"{API}/templates/{copy['id']}", headers=drh).status_code == 409                    # modèle par défaut

    emp = _employee(db)
    assert client.get(f"{API}/employees/{emp.id}", headers=drh).json()["default_template_id"] == copy["id"]
    badge = client.post(f"{API}/issue", json={"employee_id": emp.id}, headers=drh).json()
    assert badge["template_name"] == "IGS vertical"
    proof = client.post(f"{API}/preview/pdf", json={"design": design, "employee_id": emp.id}, headers=drh)
    assert proof.status_code == 200 and proof.content.startswith(b"%PDF")
    assert client.post(f"{API}/preview/pdf", json={"design": {"pages": "x"}}, headers=drh).status_code == 422
    db.expire_all()
    assert db.get(EmployeeBadge, badge["id"]).print_count == 0                                                # une épreuve n'est pas une impression


# ── Périmètre et droits ───────────────────────────────────────────────────────

def test_society_scope_and_roles(client, db, drh):
    mine, foreign = _employee(db), _employee(db, society=OTHER)
    badge = client.post(f"{API}/issue", json={"employee_id": mine.id}, headers=drh).json()
    assert client.post(f"{API}/issue", json={"employee_id": foreign.id}, headers=drh).status_code == 403
    assert client.get(f"{API}/employees/{foreign.id}", headers=drh).status_code == 403

    other = _login(client, db, role="drh", societies=[OTHER])
    assert client.get(f"{API}/{badge['id']}", headers=other).status_code == 404
    assert client.get(f"{API}/{badge['id']}/photo", headers=other).status_code == 404
    assert client.post(f"{API}/print/pdf", json={"badge_ids": [badge["id"]]}, headers=other).status_code == 404
    assert client.post(f"{API}/{badge['id']}/revoke", json={"reason": "perdu"}, headers=other).status_code == 404
    assert client.get(f"{API}", headers=other).json()["total"] == 0
    assert client.get(f"{API}/history", headers=other).json()["total"] == 0

    agent = _login(client, db, role="agent", societies=[SOC])                     # DRH en consultation : émet, ne gère pas
    assert client.get(f"{API}", headers=agent).json()["total"] == 1
    assert client.post(f"{API}/{badge['id']}/revoke", json={"reason": "perdu"}, headers=agent).status_code == 403
    assert client.put(f"{API}/settings", json={"society": SOC, "data": {}}, headers=agent).status_code == 403
    assert client.post(f"{API}/templates", json={"name": "x", "society": SOC, "design": badge["design"]}, headers=agent).status_code == 403

    outsider = _login(client, db, role="agent", societies=[SOC], modules=("fac",))
    for path in ("", "/dashboard", "/employees", "/templates", "/history", "/settings", f"/{badge['id']}"):
        assert client.get(f"{API}{path}", headers=outsider).status_code == 403, path
        assert client.get(f"{API}{path}").status_code == 401, path
