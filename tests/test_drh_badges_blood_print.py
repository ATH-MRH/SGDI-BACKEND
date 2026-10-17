"""Studio Badges DRH : groupe sanguin (autorisation, confidentialité), aperçu et impression."""
import json
import re

import pytest
from reportlab.lib.units import mm
from reportlab.pdfbase.pdfmetrics import stringWidth
from sqlalchemy import select

from app.modules.auth.models import AuditEvent
from app.modules.drh import badge_design, badge_pdf
from app.modules.drh.badge_models import BadgeEvent, BadgeSettings, BadgeTemplate, EmployeeBadge
from tests.module_cleanup import purge_rows_created_by_this_module  # noqa: F401 (fixture autouse)
from tests.test_drh_badges import (  # noqa: F401 (fixtures réutilisées)
    API, SOC, _employee, _jpeg, _login, clean_badges, drh, fast_portrait,
)

MINUS = "−"
AUTHORIZED = {"show_blood_group": True, "blood_group_authorization": "Note DRH n° 12/2026"}


@pytest.fixture(autouse=True)
def clean_settings(db):
    yield
    db.rollback()
    db.query(BadgeSettings).delete()
    db.commit()


def _authorize(client, headers, society=SOC, **data):
    resp = client.put(f"{API}/settings", json={"society": society, "data": {**AUTHORIZED, **data}}, headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()["data"]


def _with_blood(db, value, **kwargs):
    emp = _employee(db, **kwargs)
    emp.extra = {**(emp.extra or {}), "groupeSanguin": value}
    db.commit()
    return emp


class _Recorder:
    """Textes réellement dessinés dans le PDF (les flux de page sont compressés)."""

    def __init__(self, monkeypatch):
        self.texts: list[tuple[str, str, float]] = []
        recorder = self

        class Canvas(badge_pdf.pdf_canvas.Canvas):
            def drawString(self, x, y, text, *args, **kwargs):
                recorder.texts.append((text, self._fontname, self._fontsize))
                return super().drawString(x, y, text, *args, **kwargs)

            def drawCentredString(self, x, y, text, *args, **kwargs):
                recorder.texts.append((text, self._fontname, self._fontsize))
                return super().drawCentredString(x, y, text, *args, **kwargs)

        monkeypatch.setattr(badge_pdf.pdf_canvas, "Canvas", Canvas)

    def strings(self) -> list[str]:
        return [text for text, _, _ in self.texts]


# ── Valeurs et maquette ──────────────────────────────────────────────────────

@pytest.mark.parametrize("raw, expected", [
    ("O+", "O+"), ("o -", f"O{MINUS}"), ("A+", "A+"), ("a-", f"A{MINUS}"), ("B +", "B+"), ("B–", f"B{MINUS}"),
    ("AB+", "AB+"), ("AB-", f"AB{MINUS}"), (f"ab{MINUS}", f"AB{MINUS}"), ("O positif", "O+"), ("AB négatif", f"AB{MINUS}"),
    ("0+", "O+"), ("", ""), (None, ""), ("AB", ""), ("A++", ""), ("X+", ""), ("O+ probable", ""), ("groupe A", ""),
])
def test_blood_group_is_normalized_never_guessed(raw, expected):
    assert badge_design.normalize_blood_group(raw) == expected


def test_reference_design_places_a_large_blood_group_without_overlap():
    design = badge_design.reference_design()
    by_id = {element["id"]: element for element in design["pages"][0]["elements"]}
    blood, qr, code, photo = by_id["groupe_sanguin"], by_id["qr"], by_id["code"], by_id["photo"]

    def overlap(a, b):
        return a["x"] < b["x"] + b["w"] and b["x"] < a["x"] + a["w"] and a["y"] < b["y"] + b["h"] and b["y"] < a["y"] + a["h"]

    assert blood["type"] == "blood" and blood["size"] > code["size"]                       # plus grand que le matricule
    assert not overlap(blood, qr) and not overlap(blood, photo) and not overlap(blood, code)
    assert min(qr["w"], qr["h"]) >= badge_design.QR_MIN_MM                                  # QR non réduit
    assert 0 <= blood["x"] and blood["x"] + blood["w"] <= design["width"] and blood["y"] + blood["h"] <= design["height"]
    assert blood["background"] == "#FFCB05" and blood["color"] == "#111111"
    assert badge_design.design_warnings(design) == []


def test_blood_element_properties_are_bounded():
    element = badge_design.sanitize_design({"pages": [{"elements": [
        {"type": "blood", "size": 9999, "color": "red", "background": "", "stroke": "#000000", "strokeWidth": 99,
         "align": "nowhere", "caption": "x" * 99, "captionSize": -3, "onclick": "alert(1)", "hidden": 1, "locked": 1},
    ]}]})["pages"][0]["elements"][0]
    assert element["size"] == 160 and element["color"] == "#111111" and element["background"] == ""
    assert element["strokeWidth"] == 5 and element["align"] == "center" and len(element["caption"]) == 30
    assert element["captionSize"] == 2 and "onclick" not in element and element["hidden"] and element["locked"]


def test_low_contrast_blood_group_is_reported():
    design = badge_design.sanitize_design({"pages": [{"elements": [
        {"type": "qr", "x": 20, "y": 58, "w": 14, "h": 14}, {"type": "photo"},
        {"type": "blood", "x": 2, "y": 2, "w": 12, "h": 10, "color": "#FFFFFF", "background": "#FFFF00"},
    ]}]})
    assert any("contraste" in warning for warning in badge_design.design_warnings(design))


@pytest.mark.parametrize("value", ["O+", f"AB{MINUS}"])
@pytest.mark.parametrize("size", [(54, 86), (85.6, 54), (100, 70)])
def test_pdf_draws_the_blood_group_at_the_exact_card_size(value, size, monkeypatch):
    recorder = _Recorder(monkeypatch)
    design = badge_design.reference_design() if size == (54, 86) else badge_design.sanitize_design({
        "width": size[0], "height": size[1], "pages": [{"elements": [
            {"type": "blood", "x": size[0] - 18, "y": 4, "w": 14, "h": 12, "size": 24},
            {"type": "qr", "x": 4, "y": 4, "w": 15, "h": 15}]}]})
    item = badge_pdf.BadgeItem(design=design, values={"nom": "X", "groupe_sanguin": value}, qr=badge_design.qr_matrix("x"))
    card = badge_pdf.render_cards([item])
    box = re.search(rb"/MediaBox \[ 0 0 ([0-9.]+) ([0-9.]+) \]", card)
    assert abs(float(box.group(1)) - size[0] * mm) < 0.01 and abs(float(box.group(2)) - size[1] * mm) < 0.01
    assert b"/PrintScaling /None" in card                                                   # impression à 100 %
    drawn = [(text, font, points) for text, font, points in recorder.texts if text == value]
    assert drawn, recorder.strings()
    text, font, points = drawn[0]
    blood = next(el for el in design["pages"][0]["elements"] if el["type"] == "blood")
    assert font == "BadgeUnicode-Bold"                                                      # même police pour les 8 groupes
    assert stringWidth(text, font, points) <= blood["w"] * mm + 0.01                         # jamais hors de son cadre
    assert "GROUPE SANGUIN" in recorder.strings()


def test_pdf_draws_nothing_for_a_missing_blood_group(monkeypatch):
    recorder = _Recorder(monkeypatch)
    badge_pdf.render_cards([badge_pdf.BadgeItem(design=badge_design.reference_design(), values={"nom": "X"})])
    assert "GROUPE SANGUIN" not in recorder.strings()
    sheet = badge_pdf.render_sheets([badge_pdf.BadgeItem(design=badge_design.reference_design(), values={"nom": "X"})])
    assert b"/PrintScaling /None" in sheet


# ── Autorisation ─────────────────────────────────────────────────────────────

def test_display_requires_an_explicit_authorization_reference_and_the_admin_right(client, db, drh):
    out = client.put(f"{API}/settings", json={"society": SOC, "data": {"show_blood_group": True}}, headers=drh).json()
    assert out["data"]["show_blood_group"] is False                                         # pas de référence : refusé
    data = _authorize(client, drh)
    assert data["show_blood_group"] is True and data["blood_group_authorization"] == "Note DRH n° 12/2026"
    label = db.execute(select(BadgeEvent.label).where(BadgeEvent.action == "PARAMETRES").order_by(BadgeEvent.id.desc())).scalars().first()
    assert "groupe sanguin AUTORISÉ" in label and "Note DRH" in label
    reader = _login(client, db, role="drh", societies=[SOC], rights=("read", "create", "export"))
    assert client.put(f"{API}/settings", json={"society": SOC, "data": AUTHORIZED}, headers=reader).status_code == 403
    assert client.get(f"{API}/settings", params={"society": SOC}, headers=reader).json()["data"]["show_blood_group"] is True


def test_employee_blood_group_state_follows_the_authorization(client, db, drh):
    with_o, with_ab, empty, wrong = (_with_blood(db, value) for value in ("O+", "AB-", "", "Z+"))
    hidden = client.get(f"{API}/employees/{with_o.id}", headers=drh).json()
    assert hidden["blood_group"] == {"status": "ok", "authorized": False} and "groupe_sanguin" not in hidden   # état seul, jamais la valeur
    rows = client.get(f"{API}/employees", params={"q": with_o.code}, headers=drh).json()["items"]
    assert rows and "groupe_sanguin" not in rows[0]

    _authorize(client, drh)
    assert client.get(f"{API}/employees/{with_o.id}", headers=drh).json()["groupe_sanguin"] == "O+"
    ab = client.get(f"{API}/employees/{with_ab.id}", headers=drh).json()
    assert ab["groupe_sanguin"] == f"AB{MINUS}" and ab["blood_group"] == {"status": "ok", "authorized": True, "value": f"AB{MINUS}"}
    assert client.get(f"{API}/employees/{empty.id}", headers=drh).json()["blood_group"]["status"] == "absent"
    bad = client.get(f"{API}/employees/{wrong.id}", headers=drh).json()
    assert bad["blood_group"]["status"] == "invalide" and "groupe_sanguin" not in bad                # jamais deviné


def test_issued_badge_keeps_the_blood_group_only_while_display_is_authorized(client, db, drh, monkeypatch):
    emp = _with_blood(db, "AB-")
    _authorize(client, drh)
    badge = client.post(f"{API}/issue", json={"employee_id": emp.id}, headers=drh).json()
    assert badge["values"]["groupe_sanguin"] == f"AB{MINUS}"
    stored = db.get(EmployeeBadge, badge["id"])
    assert stored.snapshot["values"]["groupe_sanguin"] == f"AB{MINUS}" and stored.snapshot["blood_group_shown"] is True

    recorder = _Recorder(monkeypatch)
    assert client.post(f"{API}/print/pdf", json={"badge_ids": [badge["id"]], "layout": "card"}, headers=drh).status_code == 200
    assert f"AB{MINUS}" in recorder.strings()

    _authorize(client, drh, show_blood_group=False)                                         # retrait de l'autorisation
    recorder.texts.clear()
    assert client.post(f"{API}/print/pdf", json={"badge_ids": [badge["id"]], "layout": "a4"}, headers=drh).status_code == 200
    assert f"AB{MINUS}" not in recorder.strings() and "GROUPE SANGUIN" not in recorder.strings()
    assert "groupe_sanguin" not in client.get(f"{API}/{badge['id']}", headers=drh).json()["values"]


def test_blood_group_is_never_added_to_a_badge_issued_without_authorization(client, db, drh, monkeypatch):
    emp = _with_blood(db, "O+")
    badge = client.post(f"{API}/issue", json={"employee_id": emp.id}, headers=drh).json()
    assert "groupe_sanguin" not in badge["values"]
    assert "groupe_sanguin" not in db.get(EmployeeBadge, badge["id"]).snapshot["values"]
    _authorize(client, drh)                                                                  # autorisé APRÈS l'émission
    recorder = _Recorder(monkeypatch)
    client.post(f"{API}/print/pdf", json={"badge_ids": [badge["id"]]}, headers=drh)
    assert "O+" not in recorder.strings()                                                    # aucun ajout rétroactif
    renewed = client.post(f"{API}/issue", json={"employee_id": emp.id}, headers=drh).json()  # émission explicite
    assert renewed["values"]["groupe_sanguin"] == "O+"


def test_specimen_of_an_employee_follows_the_authorization(client, db, drh, monkeypatch):
    emp = _with_blood(db, "B-")
    recorder = _Recorder(monkeypatch)
    assert client.post(f"{API}/preview/pdf", json={"employee_id": emp.id}, headers=drh).status_code == 200
    assert f"B{MINUS}" not in recorder.strings() and "O+" not in recorder.strings()          # ni réel ni exemple
    _authorize(client, drh)
    recorder.texts.clear()
    client.post(f"{API}/preview/pdf", json={"employee_id": emp.id}, headers=drh)
    assert f"B{MINUS}" in recorder.strings()
    assert not db.execute(select(EmployeeBadge).where(EmployeeBadge.employee_id == emp.id)).first()   # aucune émission


# ── Confidentialité ──────────────────────────────────────────────────────────

def test_public_api_page_qr_and_logs_never_contain_the_blood_group(client, db, drh):
    emp = _with_blood(db, "AB-")
    _authorize(client, drh)
    badge = client.post(f"{API}/issue", json={"employee_id": emp.id}, headers=drh).json()
    url = db.get(EmployeeBadge, badge["id"]).snapshot["qr_url"]
    assert "sang" not in url.lower() and "AB" not in url.split("?")[0].split("/")[-1]       # rien dans le QR
    path = url.split("://", 1)[1].split("/", 1)[1]
    public = client.get("/api/" + path)
    assert public.status_code == 200 and public.json()["badgeActif"] is True
    assert "groupeSanguin" not in public.json() and "AB-" not in public.text and f"AB{MINUS}" not in public.text
    page = client.get("/" + path)
    assert page.status_code == 200 and "sanguin" not in page.text.lower() and "AB-" not in page.text
    for state in db.execute(select(AuditEvent.new_state).where(AuditEvent.action.like("badge.%"))).scalars():
        assert "groupe_sanguin" not in json.dumps(state or {}, ensure_ascii=False)
    for details in db.execute(select(BadgeEvent.details).where(BadgeEvent.badge_id == badge["id"])).scalars():
        assert "groupe_sanguin" not in json.dumps(details or {}, ensure_ascii=False)


# ── Modèle de référence et badges existants ──────────────────────────────────

def test_reference_template_is_upgraded_but_issued_badges_keep_their_design(client, db, drh):
    client.get(f"{API}/templates", headers=drh)
    reference = db.execute(select(BadgeTemplate).where(BadgeTemplate.system_key == "reference")).scalar_one()
    old_design = {**reference.design, "pages": [{**reference.design["pages"][0], "elements": [
        el for el in reference.design["pages"][0]["elements"] if el["type"] != "blood"]}]}
    reference.design, reference.version = old_design, 1                                       # état de la PR #20
    db.commit()
    emp = _with_blood(db, "O+")
    old_badge = EmployeeBadge(employee_id=emp.id, template_id=reference.id, template_name=reference.name, society=SOC, status="ACTIF",
                              snapshot={"values": {"nom": "ANCIEN", "matricule": emp.code}, "qr_url": "https://x/public/badge/1?t=a&b=1"},
                              design=old_design, width_mm=54, height_mm=86, photo=_jpeg(), number="BDG-OLD-1")
    db.add(old_badge)
    db.commit()

    templates = client.get(f"{API}/templates", headers=drh).json()["items"]
    upgraded = next(t for t in templates if t["is_system"])
    assert upgraded["version"] == badge_design.REFERENCE_VERSION
    assert any(el["type"] == "blood" for el in upgraded["design"]["pages"][0]["elements"])
    assert db.execute(select(BadgeEvent).where(BadgeEvent.action == "MODELE_MODIFIE", BadgeEvent.template_id == reference.id)).first()
    db.expire_all()
    kept = db.get(EmployeeBadge, old_badge.id)
    assert kept.design == old_design and "groupe_sanguin" not in kept.snapshot["values"]          # instantané intact
    _authorize(client, drh)
    reprint = client.post(f"{API}/print/pdf", json={"badge_ids": [old_badge.id]}, headers=drh)
    assert reprint.status_code == 200 and reprint.content.startswith(b"%PDF")
    events = [row.action for row in db.execute(select(BadgeEvent).where(BadgeEvent.badge_id == old_badge.id)).scalars()]
    assert events == ["IMPRESSION"]                                                          # réimpression, pas d'émission


# ── Impression en lot : filtres ──────────────────────────────────────────────

def test_batch_filters_by_site_and_function(client, db, drh):
    first, second = _employee(db, official_code="ETP/LOT/A1"), _employee(db, official_code="ETP/LOT/B2")
    facets = client.get(f"{API}/employees/facets", headers=drh).json()
    codes = {site["code"]: site["id"] for site in facets["sites"]}
    assert {"ETP/LOT/A1", "ETP/LOT/B2"} <= set(codes) and "Cariste" in facets["functions"]
    by_site = client.get(f"{API}/employees", params={"site_id": codes["ETP/LOT/A1"]}, headers=drh).json()["items"]
    assert [row["id"] for row in by_site] == [first.id]
    by_function = client.get(f"{API}/employees", params={"fonction": "cariste", "page_size": 200}, headers=drh).json()["items"]
    assert {first.id, second.id} <= {row["id"] for row in by_function}
    assert client.get(f"{API}/employees", params={"fonction": "Inexistante"}, headers=drh).json()["items"] == []


def test_batch_pdf_prints_each_employee_on_a_multipage_a4_sheet(client, db, drh, monkeypatch):
    employees = [_employee(db) for _ in range(10)]
    ids = [client.post(f"{API}/issue", json={"employee_id": emp.id}, headers=drh).json()["id"] for emp in employees]
    recorder = _Recorder(monkeypatch)
    sheet = client.post(f"{API}/print/pdf", json={"badge_ids": ids, "layout": "a4"}, headers=drh)
    assert sheet.status_code == 200 and sheet.content.count(b"/Type /Page\n") == 2 and b"/PrintScaling /None" in sheet.content
    drawn = recorder.strings()
    assert all(emp.code in "".join(drawn) for emp in employees)                                # chaque badge, ses propres données
    for badge_id in ids:
        assert db.get(EmployeeBadge, badge_id).print_count == 1
    assert db.execute(select(BadgeEvent).where(BadgeEvent.action == "IMPRESSION", BadgeEvent.badge_id.in_(ids))).scalars().all()
