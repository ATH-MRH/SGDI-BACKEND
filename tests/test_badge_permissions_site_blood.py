"""badge.irongs.com : droit opérationnel du module Studio Badges, code officiel du site, groupe sanguin obligatoire."""
import json
import uuid

import pytest
from sqlalchemy import select

from app.core.security import hash_password
from app.modules.auth.models import AuditEvent, User, UserFeaturePermission
from app.modules.drh.badge_models import BadgeEvent, BadgeTemplate, EmployeeBadge
from app.modules.ops.models import Assignment, Site
from tests.module_cleanup import purge_rows_created_by_this_module  # noqa: F401 (fixture autouse)
from tests.test_drh_badges import API, OTHER, SOC, _employee, clean_badges, drh, fast_portrait  # noqa: F401
from tests.test_drh_badges_blood_print import AUTHORIZED, MINUS, _Recorder, _authorize, _with_blood, clean_settings  # noqa: F401

PASSWORD = "studio-badges-1"


def _account(client, db, *, modules=("badge",), actions=(), societies=(SOC,), sites=None, rights=(), active=True):
    name = f"SB{uuid.uuid4().int % 10**6:06d}"
    user = User(username=name, full_name=name, role="agent", access_level="H2", password_hash=hash_password(PASSWORD),
                is_active=True, authorized_modules=list(modules), authorized_actions=list(actions),
                authorized_societies=list(societies), authorized_sites=sites)
    db.add(user)
    db.flush()
    for action in rights:
        db.add(UserFeaturePermission(user_id=user.id, module_key="drh", feature_key="badges", action_key=action))
    db.commit()
    token = client.post("/api/auth/login", json={"username": name, "password": PASSWORD}).json()["access_token"]
    if not active:
        user.is_active = False
        db.commit()
    return {"Authorization": f"Bearer {token}"}


def _site_of(db, employee):
    return db.execute(select(Site).join(Assignment, Assignment.site_id == Site.id).where(Assignment.employee_id == employee.id)).scalar_one()


# ── 1. Autorisations ─────────────────────────────────────────────────────────

def test_studio_badges_user_with_the_usual_profile_creates_issues_and_prints_without_extra_rights(client, db):
    first, second = _employee(db), _employee(db)
    # Profil le plus courant en production : create, read, update, validate (sans « export »), aucune permission fine.
    operator = _account(client, db, actions=("create", "read", "update", "validate"))
    rights = client.get(f"{API}/permissions", headers=operator).json()
    assert rights["create"] and rights["export"] and rights["operational"] and not rights["read_only"]
    assert client.get(f"{API}/employees", params={"q": first.code}, headers=operator).json()["items"]
    assert client.post(f"{API}/preview/pdf", json={"employee_id": first.id}, headers=operator).status_code == 200
    badge = client.post(f"{API}/issue", json={"employee_id": first.id}, headers=operator)
    assert badge.status_code == 200, badge.text
    pdf = client.post(f"{API}/print/pdf", json={"badge_ids": [badge.json()["id"]]}, headers=operator)
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF")
    batch = client.post(f"{API}/issue-batch", json={"employee_ids": [first.id, second.id]}, headers=operator).json()
    assert not batch["skipped"] and len(batch["issued"]) == 2
    sheet = client.post(f"{API}/print/pdf", json={"badge_ids": [row["id"] for row in batch["issued"]], "layout": "a4"}, headers=operator)
    assert sheet.status_code == 200 and sheet.content.startswith(b"%PDF")
    assert client.get(f"{API}", headers=operator).json()["total"] >= 2 and client.get(f"{API}/history", headers=operator).json()["total"] >= 3
    db.expire_all()
    assert db.get(EmployeeBadge, badge.json()["id"]).print_count == 2              # carte puis planche : chaque impression comptée


def test_sensitive_operations_stay_reserved(client, db):
    emp = _employee(db)
    operator = _account(client, db)
    badge = client.post(f"{API}/issue", json={"employee_id": emp.id}, headers=operator).json()
    template_id = badge["template_id"]
    refused = {
        "revoke": client.post(f"{API}/{badge['id']}/revoke", json={"reason": "perdu"}, headers=operator),
        "settings": client.put(f"{API}/settings", json={"society": SOC, "data": AUTHORIZED}, headers=operator),
        "new template": client.post(f"{API}/templates", json={"name": "x", "society": SOC, "design": badge["design"]}, headers=operator),
        "edit template": client.put(f"{API}/templates/{template_id}", json={"name": "x", "design": badge["design"]}, headers=operator),
        "default": client.post(f"{API}/templates/{template_id}/default", headers=operator),
        "archive": client.delete(f"{API}/templates/{template_id}", headers=operator),
    }
    assert {name: resp.status_code for name, resp in refused.items()} == dict.fromkeys(refused, 403)
    assert "Modèles partagés et paramètres réservés" in refused["settings"].json()["detail"]
    db.expire_all()
    assert db.get(EmployeeBadge, badge["id"]).status == "ACTIF" and db.get(BadgeTemplate, template_id).version == badge_template_version(db, template_id)
    manager = _account(client, db, rights=("validate", "admin"))
    assert client.post(f"{API}/{badge['id']}/revoke", json={"reason": "perdu"}, headers=manager).status_code == 200


def badge_template_version(db, template_id):
    return db.get(BadgeTemplate, template_id).version


def test_drh_only_inactive_read_only_and_other_society_accounts_are_refused(client, db):
    emp = _employee(db)
    drh_only = _account(client, db, modules=("drh",), rights=("read", "create", "export"))
    assert client.post(f"{API}/issue", json={"employee_id": emp.id}, headers=drh_only).status_code == 403
    inactive = _account(client, db, active=False)
    assert client.post(f"{API}/issue", json={"employee_id": emp.id}, headers=inactive).status_code == 401
    reader = _account(client, db, actions=("read",))                    # restriction explicite de lecture seule : plus forte
    rights = client.get(f"{API}/permissions", headers=reader).json()
    assert rights["read_only"] and not rights["create"] and not rights["export"]
    assert client.post(f"{API}/preview/pdf", json={"employee_id": emp.id}, headers=reader).status_code == 200   # épreuve permise
    refused = client.post(f"{API}/issue", json={"employee_id": emp.id}, headers=reader)
    assert refused.status_code == 403 and "limité à la consultation" in refused.json()["detail"]
    validator = _account(client, db, actions=("read", "validate"))       # aucune écriture au profil : lecture seule aussi
    assert client.post(f"{API}/issue", json={"employee_id": emp.id}, headers=validator).status_code == 403
    foreign = _account(client, db, societies=(OTHER,))
    assert client.post(f"{API}/issue", json={"employee_id": emp.id}, headers=foreign).status_code == 403
    assert not db.execute(select(EmployeeBadge).where(EmployeeBadge.employee_id == emp.id)).first()


def test_site_restricted_accounts_only_reach_their_sites(client, db):
    mine, other = _employee(db), _employee(db)
    restricted = _account(client, db, sites=[_site_of(db, mine).id])
    codes = {row["matricule"] for row in client.get(f"{API}/employees", headers=restricted).json()["items"]}
    assert mine.code in codes and other.code not in codes
    assert client.post(f"{API}/issue", json={"employee_id": other.id}, headers=restricted).status_code == 403
    assert client.get(f"{API}/employees/{other.id}", headers=restricted).status_code == 403
    badge = client.post(f"{API}/issue", json={"employee_id": mine.id}, headers=restricted)
    assert badge.status_code == 200, badge.text
    elsewhere = client.post(f"{API}/issue", json={"employee_id": other.id}, headers=_account(client, db)).json()
    assert client.post(f"{API}/print/pdf", json={"badge_ids": [elsewhere["id"]]}, headers=restricted).status_code == 404


# ── 2. Code officiel du site ─────────────────────────────────────────────────

def test_badge_prints_the_official_site_code_never_the_radio_call_sign_or_the_name(client, db, drh, monkeypatch):
    emp = _employee(db, official_code="ETP/DF/H01", indicatif="RACHID (HAROUN-HICHEM)")
    site = _site_of(db, emp)
    detail = client.get(f"{API}/employees/{emp.id}", headers=drh).json()
    assert detail["site_code"] == "ETP/DF/H01" and detail["site_code_status"] == "ok" and detail["site_code_problem"] is None
    assert detail["site"] == site.name and detail["site"] != detail["site_code"]
    recorder = _Recorder(monkeypatch)
    badge = client.post(f"{API}/issue", json={"employee_id": emp.id}, headers=drh).json()
    assert badge["values"]["site_code"] == "ETP/DF/H01"
    client.post(f"{API}/print/pdf", json={"badge_ids": [badge["id"]]}, headers=drh)
    drawn = " ".join(text for text, _font, _size in recorder.texts)
    assert "ETP/DF/H01" in drawn and "RACHID" not in drawn and site.name.upper() not in drawn
    facets = client.get(f"{API}/employees/facets", headers=drh).json()["sites"]
    assert {"id": site.id, "name": site.name, "code": "ETP/DF/H01"} in facets


def test_missing_official_code_blocks_issuance_without_guessing(client, db, drh):
    emp = _employee(db, official_code=None, indicatif="ALPHA")
    detail = client.get(f"{API}/employees/{emp.id}", headers=drh).json()
    assert detail["site_code"] == "" and detail["site_code_status"] == "absent"
    assert "Code officiel du site non renseigné" in detail["site_code_problem"] and "Gestion des sites" in detail["site_code_problem"]
    refused = client.post(f"{API}/issue", json={"employee_id": emp.id}, headers=drh)
    assert refused.status_code == 409 and "Code officiel du site non renseigné" in refused.json()["detail"]
    batch = client.post(f"{API}/issue-batch", json={"employee_ids": [emp.id]}, headers=drh).json()
    assert not batch["issued"] and "Code officiel du site non renseigné" in batch["skipped"][0]["reason"]
    assert client.post(f"{API}/preview/pdf", json={"employee_id": emp.id}, headers=drh).status_code == 200   # l'épreuve reste possible
    db.query(Assignment).filter(Assignment.employee_id == emp.id).update({"active": 0})
    db.commit()
    no_site = client.post(f"{API}/issue", json={"employee_id": emp.id}, headers=drh)
    assert no_site.status_code == 409 and "pas d'affectation active" in no_site.json()["detail"]
    assert not db.execute(select(EmployeeBadge).where(EmployeeBadge.employee_id == emp.id)).first()


def test_a_template_without_the_site_code_does_not_require_it(client, db, drh):
    emp = _employee(db, official_code=None)
    reference = client.get(f"{API}/templates", headers=drh).json()["items"][0]
    full = db.get(BadgeTemplate, reference["id"]).design
    design = {**full, "pages": [{**full["pages"][0], "elements": [el for el in full["pages"][0]["elements"] if el["id"] != "site"]}]}
    template = client.post(f"{API}/templates", json={"name": "Sans site", "society": SOC, "design": design}, headers=drh).json()
    assert client.post(f"{API}/issue", json={"employee_id": emp.id, "template_id": template["id"]}, headers=drh).status_code == 200


def test_long_official_codes_fit_the_black_band(client, db, drh, monkeypatch):
    long_code = "ETP/DIRECTION-FINANCES/HANGAR-NORD-01"
    emp = _employee(db, official_code=long_code)
    recorder = _Recorder(monkeypatch)
    badge = client.post(f"{API}/issue", json={"employee_id": emp.id}, headers=drh).json()
    assert badge["values"]["site_code"] == long_code
    assert client.post(f"{API}/print/pdf", json={"badge_ids": [badge["id"]]}, headers=drh).status_code == 200
    from reportlab.pdfbase.pdfmetrics import stringWidth
    from reportlab.lib.units import mm

    site_texts = [(text, font, size) for text, font, size in recorder.texts if long_code in text]
    assert site_texts
    text, font, size = site_texts[0]
    assert stringWidth(text, font, size) <= 42 * mm + 0.5 and size < 12            # réduit pour tenir dans le bandeau


def test_official_code_is_edited_in_site_management_validated_and_audited(client, db, drh):
    emp = _employee(db, official_code=None)
    site = _site_of(db, emp)
    admin = _account(client, db, modules=(), actions=(), societies=())
    admin_user = db.execute(select(User).order_by(User.id.desc())).scalars().first()
    admin_user.role, admin_user.global_society_access = "admin", True
    db.commit()
    bad = client.put(f"/api/ops/sites/{site.id}", json={"official_code": "RACHID (HAROUN-HICHEM)"}, headers=admin)
    assert bad.status_code == 422
    ok = client.put(f"/api/ops/sites/{site.id}", json={"official_code": " etp/df/h01 "}, headers=admin)
    assert ok.status_code == 200, ok.text
    assert ok.json()["official_code"] == "ETP/DF/H01" and ok.json()["indicatif"] == site.indicatif
    event = db.execute(select(AuditEvent).where(AuditEvent.action == "ops.site.official_code").order_by(AuditEvent.id.desc())).scalars().first()
    as_dict = lambda value: json.loads(value) if isinstance(value, str) else value  # noqa: E731
    assert event and as_dict(event.new_state) == {"official_code": "ETP/DF/H01"} and as_dict(event.old_state) == {"official_code": None}
    assert client.post(f"{API}/issue", json={"employee_id": emp.id}, headers=drh).status_code == 200


def test_issued_badges_keep_their_site_code_when_the_site_changes(client, db, drh):
    emp = _employee(db, official_code="ETP/DF/H01")
    badge = client.post(f"{API}/issue", json={"employee_id": emp.id}, headers=drh).json()
    site = _site_of(db, emp)
    site.official_code = "ETP/DF/H02"
    db.commit()
    assert client.get(f"{API}/{badge['id']}", headers=drh).json()["values"]["site_code"] == "ETP/DF/H01"   # instantané
    assert client.get(f"{API}/employees/{emp.id}", headers=drh).json()["site_code"] == "ETP/DF/H02"         # renouvellement explicite
    renewed = client.post(f"{API}/issue", json={"employee_id": emp.id}, headers=drh).json()
    assert renewed["values"]["site_code"] == "ETP/DF/H02"


# ── 3. Groupe sanguin ────────────────────────────────────────────────────────

@pytest.mark.parametrize("raw, shown", [("O+", "O+"), ("AB-", f"AB{MINUS}"), ("ab neg", f"AB{MINUS}"), ("0 pos", "O+")])
def test_authorized_badges_show_the_declared_blood_group_large(client, db, drh, monkeypatch, raw, shown):
    emp = _with_blood(db, raw)
    _authorize(client, drh)
    recorder = _Recorder(monkeypatch)
    badge = client.post(f"{API}/issue", json={"employee_id": emp.id}, headers=drh).json()
    assert badge["values"]["groupe_sanguin"] == shown
    client.post(f"{API}/print/pdf", json={"badge_ids": [badge["id"]]}, headers=drh)
    sizes = [size for text, _font, size in recorder.texts if text == shown]
    assert sizes and max(sizes) >= (18 if len(shown) == 2 else 13)                     # en grand (AB− réduit pour tenir dans le bloc)
    assert any(text == "GROUPE SANGUIN" for text, _font, _size in recorder.texts)
    db.expire_all()
    assert (db.get(type(emp), emp.id).extra or {}).get("groupeSanguin") == raw          # fiche jamais réécrite


@pytest.mark.parametrize("raw, word", [("", "non renseigné"), ("Z+", "invalide")])
def test_missing_or_invalid_blood_group_blocks_issuance_until_regularized_or_waived(client, db, drh, raw, word):
    emp = _with_blood(db, raw)
    _authorize(client, drh)
    detail = client.get(f"{API}/employees/{emp.id}", headers=drh).json()
    assert detail["blood_group"]["status"] == ("absent" if not raw else "invalide") and "groupe_sanguin" not in detail
    refused = client.post(f"{API}/issue", json={"employee_id": emp.id}, headers=drh)
    assert refused.status_code == 409 and word in refused.json()["detail"]
    batch = client.post(f"{API}/issue-batch", json={"employee_ids": [emp.id]}, headers=drh).json()
    assert not batch["issued"] and word in batch["skipped"][0]["reason"]
    operator = _account(client, db)                                                   # sans droit de révocation : pas de dérogation
    assert client.post(f"{API}/issue", json={"employee_id": emp.id, "blood_group_waiver": "non_communique"}, headers=operator).status_code == 403
    assert client.post(f"{API}/issue", json={"employee_id": emp.id, "blood_group_waiver": "au_hasard"}, headers=drh).status_code == 422
    waived = client.post(f"{API}/issue", json={"employee_id": emp.id, "blood_group_waiver": "non_communique"}, headers=drh)
    assert waived.status_code == 200, waived.text
    assert "groupe_sanguin" not in waived.json()["values"]                              # aucune valeur supposée
    event = db.execute(select(BadgeEvent).where(BadgeEvent.badge_id == waived.json()["id"], BadgeEvent.action == "EMISSION")).scalar_one()
    assert event.details["blood_group_waiver"] == "non_communique"
    emp.extra = {**emp.extra, "groupeSanguin": "B+"}                                   # fiche régularisée
    db.commit()
    assert client.post(f"{API}/issue", json={"employee_id": emp.id}, headers=drh).json()["values"]["groupe_sanguin"] == "B+"


def test_without_compliance_authorization_the_value_is_never_shown_but_its_state_is_checked(client, db, drh):
    present, absent = _with_blood(db, "O+"), _with_blood(db, "")
    assert client.get(f"{API}/employees/{present.id}", headers=drh).json()["blood_group"] == {"status": "ok", "authorized": False}
    assert client.get(f"{API}/employees/{absent.id}", headers=drh).json()["blood_group"] == {"status": "absent", "authorized": False}
    badge = client.post(f"{API}/issue", json={"employee_id": absent.id}, headers=drh)       # pas d'obligation sans autorisation
    assert badge.status_code == 200 and "groupe_sanguin" not in badge.json()["values"]
    assert "groupe_sanguin" not in client.post(f"{API}/issue", json={"employee_id": present.id}, headers=drh).json()["values"]


def test_medical_data_never_reaches_qr_public_page_or_logs_even_with_a_waiver(client, db, drh):
    emp, other = _with_blood(db, "AB-"), _with_blood(db, "")
    _authorize(client, drh)
    badge = client.post(f"{API}/issue", json={"employee_id": emp.id}, headers=drh).json()
    client.post(f"{API}/issue", json={"employee_id": other.id, "blood_group_waiver": "analyse_en_attente"}, headers=drh)
    client.post(f"{API}/print/pdf", json={"badge_ids": [badge["id"]]}, headers=drh)
    url = db.get(EmployeeBadge, badge["id"]).snapshot["qr_url"]
    assert "AB" not in url.split("?")[0].split("/")[-1] and "sang" not in url.lower()
    path = url.split("://", 1)[1].split("/", 1)[1]
    assert "AB-" not in client.get("/api/" + path).text and "sanguin" not in client.get("/" + path).text.lower()
    for state in db.execute(select(AuditEvent.new_state).where(AuditEvent.action.like("badge.%"))).scalars():
        dumped = json.dumps(state or {}, ensure_ascii=False)
        assert "groupe_sanguin" not in dumped and f"AB{MINUS}" not in dumped
    for details in db.execute(select(BadgeEvent.details)).scalars():
        assert "groupe_sanguin" not in json.dumps(details or {}, ensure_ascii=False)
