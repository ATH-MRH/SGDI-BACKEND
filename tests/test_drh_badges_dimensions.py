"""Studio Badges — dimensions du modèle et impression directe (GO DG) : `design.width/height` est la
seule source de vérité ; le modèle enregistré, le badge émis, le PDF et l'impression ont exactement la
même taille (54 × 86, 85,6 × 54, format personnalisé), recto et verso compris."""
import re

import pytest
from reportlab.lib.units import mm

from app.modules.drh import badge_design, badge_pdf
from tests.test_drh_badges import API, SOC, _employee, clean_badges, drh, fast_portrait  # noqa: F401  (fixtures)

BOX = re.compile(rb"/MediaBox \[ 0 0 ([0-9.]+) ([0-9.]+) \]")


def page_sizes(pdf: bytes):
    return [(round(float(w) / mm, 2), round(float(h) / mm, 2)) for w, h in BOX.findall(pdf)]


def resized(design, width, height, *, verso=False):
    out = {**design, "width": width, "height": height}
    if verso:
        out["pages"] = [design["pages"][0], {**design["pages"][0], "name": "Verso"}]
    return out


def template(client, drh, name, design):
    response = client.post(f"{API}/templates", json={"name": name, "society": SOC, "design": design}, headers=drh)
    assert response.status_code == 200, response.text
    return response.json()


def print_pdf(client, drh, badge_id, layout="card"):
    response = client.post(f"{API}/print/pdf", json={"badge_ids": [badge_id], "layout": layout}, headers=drh)
    assert response.status_code == 200, response.text
    return response


@pytest.mark.parametrize("width,height", [(54, 86), (85.6, 54), (70, 100)])
def test_card_pdf_has_exactly_the_model_size_with_print_preferences(width, height):
    design = resized(badge_design.reference_design(), width, height)
    pdf = badge_pdf.render_cards([badge_pdf.BadgeItem(design=design, values={}, qr=badge_design.qr_matrix("https://exemple.test/b"))])
    assert page_sizes(pdf) == [(width, height)]
    assert b"/PrintScaling /None" in pdf and b"/PickTrayByPDFSize true" in pdf        # taille réelle, papier selon la carte


def test_template_size_change_is_saved_reloaded_and_used_by_issue_preview_and_print(client, db, drh):
    reference = next(row for row in client.get(f"{API}/templates", headers=drh).json()["items"] if row["is_system"])
    portrait = template(client, drh, "Portrait 54 × 86", resized(reference["design"], 54, 86))
    assert (portrait["width_mm"], portrait["height_mm"]) == (54, 86)
    # 54 × 86 → 85,6 × 54 : enregistré, puis relu à l'identique (design et colonnes dérivées).
    update = client.put(f"{API}/templates/{portrait['id']}", headers=drh,
                        json={"name": portrait["name"], "society": SOC, "design": resized(portrait["design"], 85.6, 54, verso=True)})
    assert update.status_code == 200, update.text
    reloaded = next(row for row in client.get(f"{API}/templates", headers=drh).json()["items"] if row["id"] == portrait["id"])
    assert (reloaded["design"]["width"], reloaded["design"]["height"]) == (85.6, 54)
    assert (reloaded["width_mm"], reloaded["height_mm"]) == (85.6, 54) and reloaded["version"] == portrait["version"] + 1

    # Épreuve : la taille du modèle sélectionné.
    proof = client.post(f"{API}/preview/pdf", json={"template_id": portrait["id"]}, headers=drh)
    assert proof.status_code == 200 and page_sizes(proof.content) == [(85.6, 54), (85.6, 54)]

    # Émission avec ce modèle puis impression directe : carte exacte, recto et verso de même taille.
    emp = _employee(db)
    badge = client.post(f"{API}/issue", json={"employee_id": emp.id, "template_id": portrait["id"]}, headers=drh).json()
    assert (badge["width_mm"], badge["height_mm"]) == (85.6, 54)
    card = print_pdf(client, drh, badge["id"])
    assert card.headers["x-badge-page-size-mm"] == "85.6x54"
    assert page_sizes(card.content) == [(85.6, 54), (85.6, 54)]
    sheet = print_pdf(client, drh, badge["id"], "a4")                                   # planche : A4 seulement
    assert sheet.headers["x-badge-page-size-mm"] == "A4" and set(page_sizes(sheet.content)) == {(210, 297)}

    # Le badge émis garde sa taille figée même si le modèle change ensuite (réimpression identique).
    client.put(f"{API}/templates/{portrait['id']}", headers=drh, json={"name": portrait["name"], "society": SOC, "design": resized(portrait["design"], 54, 86)})
    assert page_sizes(print_pdf(client, drh, badge["id"]).content) == [(85.6, 54), (85.6, 54)]


def test_custom_size_is_kept_to_the_tenth_of_a_millimetre(client, db, drh):
    reference = next(row for row in client.get(f"{API}/templates", headers=drh).json()["items"] if row["is_system"])
    custom = template(client, drh, "Format 70 × 100,5", resized(reference["design"], 70, 100.5))
    assert (custom["design"]["width"], custom["design"]["height"]) == (70, 100.5)
    badge = client.post(f"{API}/issue", json={"employee_id": _employee(db).id, "template_id": custom["id"]}, headers=drh).json()
    card = print_pdf(client, drh, badge["id"])
    assert card.headers["x-badge-page-size-mm"] == "70x100.5" and page_sizes(card.content) == [(70, 100.5)]
