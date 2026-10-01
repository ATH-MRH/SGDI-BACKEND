"""Recherche des employés à enrôler (GET /api/biometrics/employees) — contrat sur lequel repose
la recherche DYNAMIQUE de l'écran Enrôlement : partielle dès 1 caractère, insensible à la casse,
matricule / nom / prénom, 25 résultats au plus, TOUJOURS limitée au périmètre du compte (société,
site) côté serveur, permission biometric_status × read. Aucun code serveur modifié par ce lot."""
import uuid
from datetime import date

import pytest

from app.core.config import settings
from app.core.security import hash_password
from app.modules.auth.models import User, UserFeaturePermission
from app.modules.drh.models import Employee
from app.modules.ops.models import Assignment, Site
from tests.module_cleanup import purge_rows_created_by_this_module  # noqa: F401 (fixture autouse)

SOC = "IRON GLOBAL SOLUTION"
OTHER = "Sword Corporation"
URL = "/api/biometrics/employees"


@pytest.fixture(autouse=True)
def flags(monkeypatch):
    monkeypatch.setattr(settings, "biometric_enrollment_enabled", True)
    monkeypatch.setattr(settings, "biometric_enabled", False)


def _tag():
    return uuid.uuid4().hex[:6].upper()


def _site(db, society=SOC):
    site = Site(name=f"SRCH {_tag()}", active=1, equipment_plan={"societe": society})
    db.add(site); db.flush()
    return site


def _emp(db, site, *, last, first, society=SOC):
    emp = Employee(code=f"SR{_tag()}", first_name=first, last_name=last, society=society, status="actif", position="AGENT")
    db.add(emp); db.flush()
    db.add(Assignment(employee_id=emp.id, site_id=site.id, group_code="A", start_date=date(2026, 1, 1), active=1))
    db.commit()
    return emp


def _user(client, db, *, sites, societies=(SOC,), features=(("biometric_status", "read"),)):
    name = f"PTG{uuid.uuid4().int % 10**6:06d}"
    user = User(username=name, full_name=name, role="agent", access_level="H2", password_hash=hash_password("search-pass-1"),
                is_active=True, authorized_modules=["pointage"], authorized_societies=list(societies), authorized_sites=list(sites))
    db.add(user); db.flush()
    for feature, action in features:
        db.add(UserFeaturePermission(user_id=user.id, module_key="attendance", feature_key=feature, action_key=action))
    db.commit()
    token = client.post("/api/auth/login", json={"username": name, "password": "search-pass-1"}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _codes(client, h, **params):
    r = client.get(URL, headers=h, params=params)
    assert r.status_code == 200, r.text
    return {row["matricule"] for row in r.json()}


def test_partial_case_insensitive_search_on_matricule_last_and_first_name(client, db):
    site = _site(db)
    tag = _tag()
    a = _emp(db, site, last=f"ABDELLI{tag}", first="Karim")
    b = _emp(db, site, last=f"BENALI{tag}", first=f"Abdel{tag}")
    c = _emp(db, site, last=f"OUALI{tag}", first="Amine")
    h = _user(client, db, sites=[site.id])
    assert _codes(client, h, q=a.code.lower()) == {a.code}                       # matricule, casse
    assert _codes(client, h, q=f"benali{tag.lower()}") == {b.code}              # nom, casse
    assert _codes(client, h, q=f"abdel{tag.lower()}") == {b.code}               # prénom, casse
    assert {a.code, b.code} <= _codes(client, h, q="abdel")                     # partiel : nom ET prénom
    assert {a.code, b.code, c.code} <= _codes(client, h, q="a")                 # dès 1 caractère
    assert _codes(client, h, q="zzzz-introuvable") == set()


def test_results_are_capped_at_25(client, db):
    site = _site(db)
    tag = _tag()
    for i in range(30):
        _emp(db, site, last=f"LIMIT{tag}{i:02d}", first="Test")
    h = _user(client, db, sites=[site.id])
    assert len(client.get(URL, headers=h, params={"q": f"LIMIT{tag}"}).json()) == 25
    assert len(client.get(URL, headers=h).json()) <= 25                         # champ vide : jamais toute la base


def test_never_returns_employees_outside_the_account_scope(client, db):
    mine, elsewhere, foreign = _site(db), _site(db), _site(db, society=OTHER)
    tag = _tag()
    inside = _emp(db, mine, last=f"SCOPE{tag}", first="Dedans")
    other_site = _emp(db, elsewhere, last=f"SCOPE{tag}", first="AutreSite")
    other_soc = _emp(db, foreign, last=f"SCOPE{tag}", first="AutreSociete", society=OTHER)
    h = _user(client, db, sites=[mine.id])                                      # type POINTEUR 01 : un site
    assert _codes(client, h, q=f"scope{tag}") == {inside.code}
    for hidden in (other_site, other_soc):
        assert _codes(client, h, q=hidden.code) == set()
    assert client.get(URL, headers=h, params={"q": "a", "site_id": elsewhere.id}).status_code == 404


def test_requires_explicit_biometric_status_permission(client, db):
    site = _site(db)
    h = _user(client, db, sites=[site.id], features=())
    r = client.get(URL, headers=h, params={"q": "a"})
    assert r.status_code == 403 and "Permission biométrique" in r.text


# ── Causes générales d'exclusion d'un matricule existant (diagnostic K115 / K04 / K162) ───
def test_exact_matricule_is_never_pushed_out_by_the_25_result_limit(client, db):
    """Un matricule court (préfixe de nombreux autres : K04 → K040, K0400…) restait introuvable :
    tri par nom puis coupe à 25. La correspondance exacte est désormais classée en premier."""
    site = _site(db)
    prefix = f"Q{uuid.uuid4().int % 10**5:05d}"
    target = Employee(code=prefix, first_name="Cible", last_name="ZZZ-DERNIER-PAR-NOM", society=SOC, status="actif")
    db.add(target); db.flush()
    db.add(Assignment(employee_id=target.id, site_id=site.id, group_code="A", start_date=date(2026, 1, 1), active=1))
    for i in range(30):                                                       # 30 matricules qui le contiennent
        e = Employee(code=f"{prefix}{i:02d}", first_name="Autre", last_name=f"AAA{i:02d}", society=SOC, status="actif")
        db.add(e); db.flush()
        db.add(Assignment(employee_id=e.id, site_id=site.id, group_code="A", start_date=date(2026, 1, 1), active=1))
    db.commit()
    h = _user(client, db, sites=[site.id])
    rows = client.get(URL, headers=h, params={"q": prefix.lower()}).json()
    assert len(rows) == 25 and rows[0]["matricule"] == prefix                 # exact d'abord, malgré le nom
    assert all(r["matricule"].startswith(prefix) for r in rows)


def test_historical_drh_matricule_is_searchable(client, db):
    """La DRH cherche aussi le matricule historique (extra.matricule) ; la biométrie l'ignorait."""
    site = _site(db)
    legacy = f"L{uuid.uuid4().int % 10**5:05d}"
    emp = Employee(code=f"EMP-{_tag()}", first_name="Historique", last_name="Matricule", society=SOC, status="actif",
                   extra={"matricule": legacy})
    db.add(emp); db.flush()
    db.add(Assignment(employee_id=emp.id, site_id=site.id, group_code="A", start_date=date(2026, 1, 1), active=1))
    db.commit()
    h = _user(client, db, sites=[site.id])
    rows = client.get(URL, headers=h, params={"q": legacy}).json()
    assert [r["employee_id"] for r in rows] == [emp.id]


def test_assignment_rule_matches_drh_future_start_counts_ended_does_not(client, db):
    """Même définition que la DRH (_live_assignment_map) : active et non terminée. Une affectation
    dont le début est à venir n'excluait l'employé QUE de la biométrie."""
    from datetime import timedelta
    site = _site(db)
    tag = _tag()
    future = _emp(db, site, last=f"FUTUR{tag}", first="Debut")
    ended = Employee(code=f"SR{_tag()}", first_name="Fin", last_name=f"FUTUR{tag}", society=SOC, status="actif")
    db.add(ended); db.flush()
    db.add(Assignment(employee_id=ended.id, site_id=site.id, group_code="A", start_date=date(2025, 1, 1),
                      end_date=date.today() - timedelta(days=2), active=1))
    asg = db.query(Assignment).filter(Assignment.employee_id == future.id).one()
    asg.start_date = date.today() + timedelta(days=10)
    db.commit()
    h = _user(client, db, sites=[site.id])
    assert _codes(client, h, q=f"futur{tag}") == {future.code}


# ── Filtres serveur, combinables, toujours après le périmètre ─────────────────────────────
def test_filters_combine_with_text_and_stay_inside_the_scope(client, db, tmp_path, monkeypatch):
    from app.modules.biometrics import service
    from app.modules.biometrics.models import BiometricConsent, BiometricTemplate
    site, other = _site(db), _site(db)
    tag = _tag()
    a = _emp(db, site, last=f"FLT{tag}", first="Actif")
    b = _emp(db, site, last=f"FLT{tag}", first="Suspendu")
    b.status = "suspendu"; b.position = "CARISTE"
    c = _emp(db, site, last=f"FLT{tag}", first="Enrole")
    hidden = _emp(db, other, last=f"FLT{tag}", first="AutreSite")
    db.add(BiometricConsent(employee_id=a.id, status="contract_confirmed", source="EMPLOYMENT_CONTRACT", proof_reference="C",
                            notice_version=service.NOTICE_VERSION))
    db.add(BiometricTemplate(employee_id=c.id, status="ACTIVE", embedding_encrypted=b"x", engine="t", config_version=1, source="CAMERA"))
    db.commit()
    monkeypatch.setattr(service, "_employee_photo_path", lambda e: tmp_path if e.id == a.id else None)
    h = _user(client, db, sites=[site.id])
    q = f"flt{tag}"
    assert _codes(client, h, q=q) == {a.code, b.code, c.code}                       # jamais hidden
    assert _codes(client, h, q=q, status="actif") == {a.code, c.code}
    assert _codes(client, h, q=q, status="suspendu") == {b.code}
    assert _codes(client, h, q=q, function="CARISTE") == {b.code}
    assert _codes(client, h, q=q, consent="admissible") == {a.code}
    assert _codes(client, h, q=q, consent="non_admissible") == {b.code, c.code}
    assert _codes(client, h, q=q, enrollment="active") == {c.code}
    assert _codes(client, h, q=q, enrollment="none") == {a.code, b.code}
    assert _codes(client, h, q=q, photo="available") == {a.code}
    assert _codes(client, h, q=q, photo="missing", status="actif") == {c.code}
    assert _codes(client, h, q=q, site_id=site.id, consent="admissible", photo="available", enrollment="none") == {a.code}
    assert hidden.code not in _codes(client, h, q=q, status="suspendu", consent="non_admissible")
    for bad in ({"status": "inactif"}, {"status": "tous"}, {"consent": "oui"}, {"enrollment": "x"}, {"photo": "1"}):
        assert client.get(URL, headers=h, params={"q": q, **bad}).status_code == 422
    assert client.get(URL, headers=h, params={"q": q, "site_id": other.id}).status_code == 404     # site hors périmètre


def test_facets_only_list_the_scope(client, db):
    site, other, foreign = _site(db), _site(db), _site(db, society=OTHER)
    a = _emp(db, site, last="FAC", first="A"); a.position = f"AGENT-{_tag()}"
    o = _emp(db, other, last="FAC", first="B"); o.position = f"SECRET-{_tag()}"
    f = _emp(db, foreign, last="FAC", first="C", society=OTHER); f.position = f"AUTRE-{_tag()}"
    db.commit()
    h = _user(client, db, sites=[site.id])
    facets = client.get(URL + "/facets", headers=h).json()
    assert [s["id"] for s in facets["sites"]] == [site.id]
    assert a.position in facets["functions"] and o.position not in facets["functions"] and f.position not in facets["functions"]
    assert client.get(URL + "/facets", headers=h, params={"site_id": other.id}).status_code == 404
    assert client.get(URL + "/facets", headers=_user(client, db, sites=[site.id], features=())).status_code == 403



# ── Règle métier : statut RH ACTIF ou SUSPENDU, toujours dans le périmètre ────────────────
def _emp_status(db, site, *, status, last, code=None, extra=None):
    emp = Employee(code=code or f"ST{_tag()}", first_name="Statut", last_name=last, society=SOC, status=status, extra=extra or {})
    db.add(emp); db.flush()
    db.add(Assignment(employee_id=emp.id, site_id=site.id, group_code="A", start_date=date(2026, 1, 1), active=1))
    db.commit()
    return emp


def test_active_and_suspended_are_searchable_only_inside_the_scope(client, db):
    site, outside = _site(db), _site(db)
    tag = _tag()
    act = _emp_status(db, site, status="actif", last=f"RH{tag}")
    sus = _emp_status(db, site, status="suspendu", last=f"RH{tag}")
    sus_variant = _emp_status(db, site, status=" Suspendu ", last=f"RH{tag}")            # variante historique
    act_out = _emp_status(db, outside, status="actif", last=f"RH{tag}")
    sus_out = _emp_status(db, outside, status="suspendu", last=f"RH{tag}")
    h = _user(client, db, sites=[site.id])
    assert _codes(client, h, q=f"rh{tag}") == {act.code, sus.code, sus_variant.code}     # hors périmètre : jamais
    assert _codes(client, h, q=f"rh{tag}", status="actif") == {act.code}
    assert _codes(client, h, q=f"rh{tag}", status="suspendu") == {sus.code, sus_variant.code}
    assert act_out.code not in _codes(client, h, q=act_out.code) and sus_out.code not in _codes(client, h, q=sus_out.code)
    rows = {r["matricule"]: r["statut"] for r in client.get(URL, headers=h, params={"q": f"rh{tag}"}).json()}
    assert rows[sus.code] == "suspendu"                                                    # statut affiché tel quel


def test_left_or_archived_employees_are_not_admissible(client, db):
    site = _site(db)
    tag = _tag()
    ok = _emp_status(db, site, status="actif", last=f"OUT{tag}")
    for status in ("sortant", "demissionne", "licencie", "archive", "inactif", "blacklist", "absent", "conge", "maladie"):
        _emp_status(db, site, status=status, last=f"OUT{tag}")
    h = _user(client, db, sites=[site.id])
    assert _codes(client, h, q=f"out{tag}") == {ok.code}


def test_exact_and_historical_matricule_for_active_and_suspended(client, db):
    site = _site(db)
    n = uuid.uuid4().int % 10**5
    exact_act = _emp_status(db, site, status="actif", last="EXACT", code=f"X{n:05d}A")
    exact_sus = _emp_status(db, site, status="suspendu", last="EXACT", code=f"X{n:05d}S")
    histo_act = _emp_status(db, site, status="actif", last="HISTO", extra={"matricule": f"H{n:05d}A"})
    histo_sus = _emp_status(db, site, status="suspendu", last="HISTO", extra={"matricule": f"H{n:05d}S"})
    h = _user(client, db, sites=[site.id])
    for term, emp in ((exact_act.code, exact_act), (exact_sus.code, exact_sus), (f"H{n:05d}A", histo_act), (f"H{n:05d}S", histo_sus)):
        rows = client.get(URL, headers=h, params={"q": term.lower()}).json()
        assert rows and rows[0]["employee_id"] == emp.id, term
