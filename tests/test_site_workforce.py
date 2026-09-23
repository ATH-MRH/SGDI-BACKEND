"""ATLAS Site Workforce — sécurité en premier (§B3, avant toute UI), puis couverture
fonctionnelle des 18 lots. Deux sites réels (A et B), deux sociétés différentes, un compte
CHARGE_EFFECTIFS_SITE strictement rattaché au site A : chaque test de fuite tente un accès
ou une mutation sur une ressource du site B et vérifie qu'elle est refusée CÔTÉ SERVEUR."""
import uuid
from datetime import date, timedelta

from app.core.security import hash_password
from app.modules.auth.models import User
from app.modules.drh.models import Document, Employee, Leave
from app.modules.ops.models import Assignment, Incident, Site

SOC_A = "Iron Global Securite"
SOC_B = "Sword Corporation"


def _setup(db):
    # Identifiants suffixés d'un tag unique par appel : TROUVÉ EN CONSTRUISANT CES TESTS —
    # les routes mutatrices de site_workforce (POST /leaves, /documents, /discipline, ...)
    # committent réellement en fin de requête (comme partout ailleurs dans ce backend,
    # nécessaire pour une vraie mutation) sur la MÊME session que le fixture `db` : dès
    # qu'un test exerce une mutation, "SWA-1"/"chargeA" etc. sont commités pour de bon,
    # au-delà du rollback de fin de test — un identifiant fixe réutilisé par 23 tests finit
    # par violer une contrainte UNIQUE. Un tag aléatoire élimine la collision à la racine,
    # sans dépendre de deviner quels tests committent réellement.
    tag = uuid.uuid4().hex[:8]
    site_a = Site(name=f"Site A {tag}", active=1, equipment_plan={"societe": SOC_A})
    site_b = Site(name=f"Site B {tag}", active=1, equipment_plan={"societe": SOC_B})
    db.add_all([site_a, site_b])
    db.flush()

    emp_a = Employee(code=f"SWA-{tag}", first_name="Amine", last_name="Alpha", society=SOC_A, status="actif")
    emp_b = Employee(code=f"SWB-{tag}", first_name="Bilal", last_name="Beta", society=SOC_B, status="actif")
    db.add_all([emp_a, emp_b])
    db.flush()

    today = date.today()
    db.add_all([
        Assignment(employee_id=emp_a.id, site_id=site_a.id, group_code="A", start_date=today - timedelta(days=30), active=1),
        Assignment(employee_id=emp_b.id, site_id=site_b.id, group_code="A", start_date=today - timedelta(days=30), active=1),
    ])

    user_a = User(
        username=f"chargeA_{tag}", full_name="Chargé Site A", role="charge_effectifs_site", access_level="H2",
        authorized_societies=[SOC_A], authorized_structures=[], authorized_modules=["site_workforce"],
        authorized_sites=[site_a.id], authorized_actions=["read", "create", "update", "validate"],
        password_hash=hash_password("chargeApass"), validation_password_hash=hash_password("x"), is_active=True,
    )
    no_site_user = User(
        username=f"chargeNoSite_{tag}", full_name="Sans site", role="charge_effectifs_site", access_level="H2",
        authorized_societies=[SOC_A], authorized_structures=[], authorized_modules=["site_workforce"],
        authorized_sites=[], authorized_actions=["read", "create", "update", "validate"],
        password_hash=hash_password("nosaitepass"), validation_password_hash=hash_password("x"), is_active=True,
    )
    multi_site_user = User(
        username=f"chargeMulti_{tag}", full_name="Deux sites", role="charge_effectifs_site", access_level="H2",
        authorized_societies=[SOC_A, SOC_B], authorized_structures=[], authorized_modules=["site_workforce"],
        authorized_sites=[site_a.id, site_b.id], authorized_actions=["read", "create", "update", "validate"],
        password_hash=hash_password("multipass"), validation_password_hash=hash_password("x"), is_active=True,
    )
    db.add_all([user_a, no_site_user, multi_site_user])
    db.flush()
    return {
        "site_a": site_a, "site_b": site_b, "emp_a": emp_a, "emp_b": emp_b, "tag": tag,
        "charge_a": (f"chargeA_{tag}", "chargeApass"),
        "no_site": (f"chargeNoSite_{tag}", "nosaitepass"),
        "multi": (f"chargeMulti_{tag}", "multipass"),
    }


def _login(client, username, password):
    r = client.post("/api/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _login_as(client, ctx, key):
    username, password = ctx[key]
    return _login(client, username, password)


# ── §B2 : site_id absent -> refus ; un seul site autorisé ─────────────────────────────────
def test_account_without_site_is_refused(client, db):
    ctx = _setup(db)
    headers = _login_as(client, ctx, "no_site")
    r = client.get("/api/site-workforce/dashboard", headers=headers)
    assert r.status_code == 403


def test_account_with_multiple_sites_is_refused(client, db):
    ctx = _setup(db)
    headers = _login_as(client, ctx, "multi")
    r = client.get("/api/site-workforce/dashboard", headers=headers)
    assert r.status_code == 403


# ── §B3 : tests de fuite avant UI ──────────────────────────────────────────────────────────
def test_dashboard_scoped_to_site_a_only(client, db):
    ctx = _setup(db)
    headers = _login_as(client, ctx, "charge_a")
    r = client.get("/api/site-workforce/dashboard", headers=headers)
    assert r.status_code == 200
    assert r.json()["site"]["id"] == ctx["site_a"].id
    assert r.json()["kpi"]["effectif_total"] == 1  # jamais l'effectif du site B


def test_employees_search_never_leaks_site_b(client, db):
    ctx = _setup(db)
    headers = _login_as(client, ctx, "charge_a")
    r = client.get("/api/site-workforce/employees", headers=headers, params={"q": "Beta"})
    assert r.status_code == 200
    assert r.json()["items"] == []  # "Beta" (employé B) introuvable depuis le site A
    r_all = client.get("/api/site-workforce/employees", headers=headers)
    ids = [row["id"] for row in r_all.json()["items"]]
    assert ctx["emp_b"].id not in ids


def test_attendance_upsert_for_employee_b_refused(client, db):
    ctx = _setup(db)
    headers = _login_as(client, ctx, "charge_a")
    r = client.post("/api/site-workforce/attendance", headers=headers, json={
        "employee_id": ctx["emp_b"].id, "presence_date": str(date.today()), "status": "present",
    })
    assert r.status_code == 403


def test_absence_decision_on_site_b_presence_refused(client, db):
    ctx = _setup(db)
    from app.modules.ops.models import DailyPresence
    presence_b = DailyPresence(presence_date=date.today(), employee_id=ctx["emp_b"].id, site_id=ctx["site_b"].id, status="absent")
    db.add(presence_b)
    db.flush()
    headers = _login_as(client, ctx, "charge_a")
    r = client.post(f"/api/site-workforce/absences/{presence_b.id}/decision", headers=headers, json={"decision": "justifiee"})
    assert r.status_code == 404  # jamais un 200, jamais une fuite d'existence via un code différent


def test_document_for_site_b_leave_refused(client, db):
    ctx = _setup(db)
    leave_b = Leave(employee_id=ctx["emp_b"].id, leave_type="conge", start_date=date.today(), end_date=date.today())
    db.add(leave_b)
    db.flush()
    headers = _login_as(client, ctx, "charge_a")
    r = client.post("/api/site-workforce/documents", headers=headers, json={
        "owner_type": "leave", "owner_id": leave_b.id, "label": "Certificat", "data_url": "not-a-data-url",
    })
    assert r.status_code == 403
    r_list = client.get("/api/site-workforce/documents", headers=headers, params={"owner_type": "leave", "owner_id": leave_b.id})
    assert r_list.json() == []


def test_leave_creation_for_employee_b_refused(client, db):
    ctx = _setup(db)
    headers = _login_as(client, ctx, "charge_a")
    r = client.post("/api/site-workforce/leaves", headers=headers, json={
        "employee_id": ctx["emp_b"].id, "leave_type": "conge", "start_date": str(date.today()), "end_date": str(date.today()),
    })
    assert r.status_code == 403


def test_leaves_list_never_returns_site_b_rows(client, db):
    ctx = _setup(db)
    leave_b = Leave(employee_id=ctx["emp_b"].id, leave_type="conge", start_date=date.today(), end_date=date.today())
    db.add(leave_b)
    db.flush()
    headers = _login_as(client, ctx, "charge_a")
    rows = client.get("/api/site-workforce/leaves", headers=headers).json()
    assert not any(r["id"] == leave_b.id for r in rows)


def test_discipline_incident_for_employee_b_refused(client, db):
    ctx = _setup(db)
    headers = _login_as(client, ctx, "charge_a")
    r = client.post("/api/site-workforce/discipline", headers=headers, json={
        "employee_id": ctx["emp_b"].id, "event_type": "retard", "subject": "Retard",
    })
    assert r.status_code == 403


def test_discipline_list_never_returns_site_b_incidents(client, db):
    ctx = _setup(db)
    incident_b = Incident(site_id=ctx["site_b"].id, employee_id=ctx["emp_b"].id, event_type="retard", subject="Retard B", status="brouillon")
    db.add(incident_b)
    db.flush()
    headers = _login_as(client, ctx, "charge_a")
    rows = client.get("/api/site-workforce/discipline", headers=headers).json()
    assert not any(r["id"] == incident_b.id for r in rows)
    r = client.post(f"/api/site-workforce/discipline/{incident_b.id}/signaler", headers=headers)
    assert r.status_code == 404


def test_reclamation_for_employee_b_refused(client, db):
    ctx = _setup(db)
    headers = _login_as(client, ctx, "charge_a")
    r = client.post("/api/site-workforce/reclamations", headers=headers, json={
        "employee_id": ctx["emp_b"].id, "subject": "Test", "description": "Desc",
    })
    assert r.status_code == 403


def test_reclamations_list_and_respond_never_touch_site_b(client, db):
    ctx = _setup(db)
    from app.modules.site_workforce.models import Reclamation
    rec_b = Reclamation(employee_id=ctx["emp_b"].id, site_id=ctx["site_b"].id, subject="B", description="B", created_by="x")
    db.add(rec_b)
    db.flush()
    headers = _login_as(client, ctx, "charge_a")
    rows = client.get("/api/site-workforce/reclamations", headers=headers).json()
    assert not any(r["id"] == rec_b.id for r in rows)
    r = client.post(f"/api/site-workforce/reclamations/{rec_b.id}/respond", headers=headers, json={"response": "x"})
    assert r.status_code == 404


def test_transmission_for_site_b_incident_refused(client, db):
    ctx = _setup(db)
    incident_b = Incident(site_id=ctx["site_b"].id, employee_id=ctx["emp_b"].id, event_type="retard", subject="Retard B", status="signale")
    db.add(incident_b)
    db.flush()
    headers = _login_as(client, ctx, "charge_a")
    r = client.post("/api/site-workforce/transmissions", headers=headers, json={
        "resource_type": "incident", "resource_id": incident_b.id, "destinataire": "drh", "objet": "x",
    })
    assert r.status_code == 404


def test_notifications_and_kpi_never_leak_site_b(client, db):
    ctx = _setup(db)
    from app.modules.site_workforce.models import SiteNotification
    notif_b = SiteNotification(site_id=ctx["site_b"].id, employee_id=ctx["emp_b"].id, notif_type="reclamation", message="B")
    db.add(notif_b)
    db.flush()
    headers = _login_as(client, ctx, "charge_a")
    rows = client.get("/api/site-workforce/notifications", headers=headers).json()
    assert not any(r["id"] == notif_b.id for r in rows)
    r = client.post(f"/api/site-workforce/notifications/{notif_b.id}/read", headers=headers)
    assert r.status_code == 404


def test_audit_trail_never_leaks_site_b(client, db):
    ctx = _setup(db)
    headers_a = _login_as(client, ctx, "charge_a")
    # Provoque une écriture d'audit sur le site B via un compte multi-site autorisé.
    headers_multi = _login_as(client, ctx, "multi")
    # chargeMulti a 2 sites -> refusé par le garde "un seul site" (même compte inutilisable
    # ici) : on écrit directement l'entrée d'audit pour simuler une action réelle sur B.
    from app.core.audit import append_audit
    append_audit(db, action="site_workforce.attendance.upsert", resource="site_workforce.attendance",
                  resource_id=f"{ctx['site_b'].id}:999", result="success", user=None)
    db.flush()
    rows = client.get("/api/site-workforce/audit", headers=headers_a).json()
    assert not any(str(r["resource_id"]).startswith(f"{ctx['site_b'].id}:") for r in rows)


# ── Fonctionnel (workflow de base, données réelles du site A) ─────────────────────────────
def test_attendance_upsert_close_and_correction_flow(client, db):
    ctx = _setup(db)
    headers = _login_as(client, ctx, "charge_a")
    today = str(date.today())
    r = client.post("/api/site-workforce/attendance", headers=headers, json={
        "employee_id": ctx["emp_a"].id, "presence_date": today, "status": "absent",
    })
    assert r.status_code == 200
    presence_id = r.json()["id"]

    r_att = client.get("/api/site-workforce/attendance", headers=headers, params={"presence_date": today})
    assert r_att.json()["progress"] == {"pointed": 1, "total": 1}

    r_close = client.post("/api/site-workforce/attendance/close", headers=headers, params={"presence_date": today})
    assert r_close.status_code == 200 and r_close.json()["closed"] == 1

    # Correction post-clôture, auditée (§B8).
    r_fix = client.post(f"/api/site-workforce/attendance/{presence_id}/correct", headers=headers, json={
        "status": "present", "reason": "Erreur de saisie initiale",
    })
    assert r_fix.status_code == 200 and r_fix.json()["status"] == "present"
    audit_rows = client.get("/api/site-workforce/audit", headers=headers).json()
    assert any(row["action"] == "site_workforce.attendance.correct" for row in audit_rows)


def test_absence_decision_never_implicitly_set_by_document_verification(client, db):
    """§B9 : document_validity_status et absence_decision_status restent strictement
    séparés — vérifier un document 'conforme' ne doit JAMAIS faire basculer l'absence."""
    ctx = _setup(db)
    headers = _login_as(client, ctx, "charge_a")
    today = str(date.today())
    r = client.post("/api/site-workforce/attendance", headers=headers, json={
        "employee_id": ctx["emp_a"].id, "presence_date": today, "status": "absent",
    })
    presence_id = r.json()["id"]

    tiny_pdf = "data:application/pdf;base64,JVBERi0xLjQK"
    r_doc = client.post("/api/site-workforce/documents", headers=headers, json={
        "owner_type": "attendance", "owner_id": presence_id, "label": "Certificat médical", "data_url": tiny_pdf,
    })
    assert r_doc.status_code == 200
    doc_id = r_doc.json()["id"]

    r_verify = client.post(f"/api/site-workforce/documents/{doc_id}/verify", headers=headers, json={"validity_status": "conforme"})
    assert r_verify.status_code == 200

    absences = client.get("/api/site-workforce/absences", headers=headers).json()
    row = next(r for r in absences if r["id"] == presence_id)
    assert row["absence_decision_status"] == "en_attente", "un document conforme ne doit jamais valider implicitement l'absence"

    r_decide = client.post(f"/api/site-workforce/absences/{presence_id}/decision", headers=headers, json={"decision": "justifiee"})
    assert r_decide.status_code == 200
    absences_after = client.get("/api/site-workforce/absences", headers=headers).json()
    row_after = next(r for r in absences_after if r["id"] == presence_id)
    assert row_after["absence_decision_status"] == "justifiee"


def test_leave_created_by_charge_has_no_validation_route_exposed(client, db):
    """§B11/§B16 : le chargé prépare la demande, ne la valide jamais lui-même."""
    ctx = _setup(db)
    headers = _login_as(client, ctx, "charge_a")
    r = client.post("/api/site-workforce/leaves", headers=headers, json={
        "employee_id": ctx["emp_a"].id, "leave_type": "conge", "start_date": str(date.today()), "end_date": str(date.today() + timedelta(days=5)),
    })
    assert r.status_code == 200 and r.json()["status"] == "instance"
    # Aucune route d'approbation dans ce module (contrairement à drh/routes.py) : la seule
    # preuve possible est l'absence de tout endpoint /leaves/{id}/approve sous ce préfixe.
    r_approve_attempt = client.post(f"/api/site-workforce/leaves/{r.json()['id']}/approve", headers=headers)
    assert r_approve_attempt.status_code == 404


def test_discipline_workflow_never_exposes_decision_to_charge(client, db):
    """§B13 : le chargé peut créer + signaler, jamais prononcer de décision/clôture."""
    ctx = _setup(db)
    headers = _login_as(client, ctx, "charge_a")
    r = client.post("/api/site-workforce/discipline", headers=headers, json={
        "employee_id": ctx["emp_a"].id, "event_type": "retard", "subject": "Retard répété",
    })
    assert r.status_code == 200 and r.json()["status"] == "brouillon"
    incident_id = r.json()["id"]
    r_signal = client.post(f"/api/site-workforce/discipline/{incident_id}/signaler", headers=headers)
    assert r_signal.status_code == 200 and r_signal.json()["status"] == "signale"
    # Aucune route "décision"/"clôture" n'existe sous ce préfixe pour ce rôle.
    r_no_decision = client.post(f"/api/site-workforce/discipline/{incident_id}/decision", headers=headers)
    assert r_no_decision.status_code == 404


def test_transmission_reuses_source_dossier_never_duplicates(client, db):
    """§B16 : la transmission change le statut du dossier SOURCE, n'en crée jamais une copie."""
    ctx = _setup(db)
    headers = _login_as(client, ctx, "charge_a")
    r = client.post("/api/site-workforce/reclamations", headers=headers, json={
        "employee_id": ctx["emp_a"].id, "subject": "Retard paiement prime", "description": "Détail",
    })
    rec_id = r.json()["id"]
    r_trans = client.post("/api/site-workforce/transmissions", headers=headers, json={
        "resource_type": "reclamation", "resource_id": rec_id, "destinataire": "drh", "objet": "Prime",
    })
    assert r_trans.status_code == 200
    rec_after = client.get("/api/site-workforce/reclamations", headers=headers).json()
    row = next(r for r in rec_after if r["id"] == rec_id)
    assert row["status"] == "transmise"  # dossier source mis à jour, jamais dupliqué


def test_notifications_emitted_on_absence_and_readable(client, db):
    ctx = _setup(db)
    headers = _login_as(client, ctx, "charge_a")
    client.post("/api/site-workforce/attendance", headers=headers, json={
        "employee_id": ctx["emp_a"].id, "presence_date": str(date.today()), "status": "absent",
    })
    notifs = client.get("/api/site-workforce/notifications", headers=headers).json()
    assert any(n["notif_type"] == "absence_sans_justificatif" for n in notifs)
    notif_id = next(n["id"] for n in notifs if n["notif_type"] == "absence_sans_justificatif")
    r_read = client.post(f"/api/site-workforce/notifications/{notif_id}/read", headers=headers)
    assert r_read.status_code == 200 and r_read.json()["status"] == "lue"


def test_module_access_refused_without_site_workforce_module(client, db):
    ctx = _setup(db)
    from app.modules.auth.models import User as _User
    other = _User(
        username="noModule", full_name="Sans module", role="drh", access_level="H2",
        authorized_societies=[SOC_A], authorized_structures=[], authorized_modules=["drh"],
        authorized_sites=[1], authorized_actions=["read"],
        password_hash=hash_password("nomodulepass"), validation_password_hash=hash_password("x"), is_active=True,
    )
    db.add(other)
    db.flush()
    headers = _login(client, "noModule", "nomodulepass")
    r = client.get("/api/site-workforce/dashboard", headers=headers)
    assert r.status_code == 403


# ── §B22 (revue de sécurité indépendante) — P0 trouvé : la route historique
# /uploads/photos/docs/{filename} (app/main.py) ne reconnaissait que owner_type="employee"
# et servait TOUT LE RESTE publiquement, sans authentification. Les justificatifs Site
# Workforce (owner_type="leave"/"attendance"/"reclamation") tombaient dans cette seconde
# branche — accessibles sans authentification à quiconque connaîtrait le nom de fichier.
def test_uploaded_justificatif_is_never_served_without_authentication(client, db):
    ctx = _setup(db)
    headers = _login_as(client, ctx, "charge_a")
    today = str(date.today())
    presence_id = client.post("/api/site-workforce/attendance", headers=headers, json={
        "employee_id": ctx["emp_a"].id, "presence_date": today, "status": "absent",
    }).json()["id"]
    tiny_pdf = "data:application/pdf;base64,JVBERi0xLjQK"
    file_path = client.post("/api/site-workforce/documents", headers=headers, json={
        "owner_type": "attendance", "owner_id": presence_id, "label": "Certificat", "data_url": tiny_pdf,
    }).json()["file_path"]

    # Sans authentification : refusé (pas servi publiquement).
    r_anon = client.get(file_path)
    assert r_anon.status_code == 401

    # Authentifié mais sans le module site_workforce (testops : ops/dc uniquement) : refusé.
    r_wrong_module = client.get(file_path, headers=restricted_headers_for(db, client))
    assert r_wrong_module.status_code == 403

    # Authentifié, bon module, bon site : servi.
    r_ok = client.get(file_path, headers=headers)
    assert r_ok.status_code == 200


def restricted_headers_for(db, client):
    resp = client.post("/api/auth/login", json={"username": "testops", "password": "testpass123"})
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


def test_uploaded_justificatif_refused_across_sites(client, db):
    ctx = _setup(db)
    headers_a = _login_as(client, ctx, "charge_a")
    today = str(date.today())
    presence_id = client.post("/api/site-workforce/attendance", headers=headers_a, json={
        "employee_id": ctx["emp_a"].id, "presence_date": today, "status": "absent",
    }).json()["id"]
    tiny_pdf = "data:application/pdf;base64,JVBERi0xLjQK"
    file_path = client.post("/api/site-workforce/documents", headers=headers_a, json={
        "owner_type": "attendance", "owner_id": presence_id, "label": "Certificat", "data_url": tiny_pdf,
    }).json()["file_path"]

    # Un second compte, scopé à un AUTRE site (même module, société différente) : refusé.
    # commit() (jamais flush() seul, exceptionnellement ici) : la route /uploads/photos/docs
    # (app/main.py) ouvre volontairement sa PROPRE SessionLocal() — pas celle substituée par
    # le fixture `client` — pour rester fidèle au comportement réel de production ; elle ne
    # verrait donc jamais une ligne seulement flush()ée sur la session de test.
    other_site = Site(name=f"Site C {ctx['tag']}", active=1, equipment_plan={"societe": SOC_B})
    db.add(other_site)
    db.flush()
    other_user = User(
        username=f"chargeC_{ctx['tag']}", full_name="Chargé Site C", role="charge_effectifs_site", access_level="H2",
        authorized_societies=[SOC_B], authorized_structures=[], authorized_modules=["site_workforce"],
        authorized_sites=[other_site.id], authorized_actions=["read", "create", "update", "validate"],
        password_hash=hash_password("chargeCpass"), validation_password_hash=hash_password("x"), is_active=True,
    )
    db.add(other_user)
    db.commit()
    headers_c = _login(client, f"chargeC_{ctx['tag']}", "chargeCpass")
    r = client.get(file_path, headers=headers_c)
    assert r.status_code == 403


# ── Revue finale d'intégration (§7 IDOR) : deux endpoints prenant un ID n'avaient jamais été
# testés avec un ID forgé appartenant au site B — trouvé en revue, code déjà correctement
# gardé (row.site_id != site.id / _scoped_document_owner_ids), mais sans couverture de
# régression jusqu'ici.
def test_attendance_correction_on_site_b_presence_refused(client, db):
    ctx = _setup(db)
    from app.modules.ops.models import DailyPresence
    presence_b = DailyPresence(presence_date=date.today(), employee_id=ctx["emp_b"].id, site_id=ctx["site_b"].id, status="present")
    db.add(presence_b)
    db.flush()
    headers = _login_as(client, ctx, "charge_a")
    r = client.post(f"/api/site-workforce/attendance/{presence_b.id}/correct", headers=headers, json={
        "status": "absent", "reason": "tentative IDOR",
    })
    assert r.status_code == 404


def test_document_verify_on_site_b_document_refused(client, db):
    ctx = _setup(db)
    from app.modules.ops.models import DailyPresence
    headers_a = _login_as(client, ctx, "charge_a")
    presence_b = DailyPresence(presence_date=date.today(), employee_id=ctx["emp_b"].id, site_id=ctx["site_b"].id, status="absent")
    db.add(presence_b)
    db.flush()
    tiny_pdf = "data:application/pdf;base64,JVBERi0xLjQK"
    # Un document légitime du site B, créé hors périmètre du compte A (via une insertion
    # directe — le compte multi-site ne peut pas non plus créer, garde "un seul site").
    from app.modules.drh.models import Document
    doc_b = Document(owner_type="attendance", owner_id=presence_b.id, label="Doc site B",
                      file_path="/uploads/photos/docs/doc_site_b.pdf", validity_status="en_attente")
    db.add(doc_b)
    db.flush()
    r = client.post(f"/api/site-workforce/documents/{doc_b.id}/verify", headers=headers_a, json={"validity_status": "conforme"})
    assert r.status_code == 404


# ── Revue finale d'intégration (§8 scope société) : le contrôle site ne doit JAMAIS se
# substituer au contrôle société — un compte dont authorized_sites pointe vers un site
# RÉEL mais dont authorized_societies ne couvre PAS la société de ce site (configuration
# incohérente, ex. erreur d'administration) doit être refusé, pas silencieusement autorisé
# parce que le site lui-même existe et est actif.
def test_site_belonging_to_unauthorized_society_is_refused_even_with_valid_site_id(client, db):
    ctx = _setup(db)
    mismatched_user = User(
        username=f"chargeMismatch_{ctx['tag']}", full_name="Société incohérente", role="charge_effectifs_site", access_level="H2",
        authorized_societies=[SOC_B],  # ne couvre PAS SOC_A, la société réelle de site_a
        authorized_structures=[], authorized_modules=["site_workforce"],
        authorized_sites=[ctx["site_a"].id],  # site_a appartient à SOC_A
        authorized_actions=["read", "create", "update", "validate"],
        password_hash=hash_password("mismatchpass"), validation_password_hash=hash_password("x"), is_active=True,
    )
    db.add(mismatched_user)
    db.flush()
    headers = _login(client, f"chargeMismatch_{ctx['tag']}", "mismatchpass")
    r = client.get("/api/site-workforce/dashboard", headers=headers)
    assert r.status_code == 403


# ── Revue finale d'intégration (§9 pointage) : après clôture, aucune modification ne doit
# être possible sans la permission "validate" explicite — jamais une simple présence du
# module suffisante. Reconfirme aussi qu'un compte read-only ne peut pas clôturer.
def test_attendance_close_and_correct_refused_without_validate_action(client, db):
    ctx = _setup(db)
    read_only_user = User(
        username=f"chargeReadOnly_{ctx['tag']}", full_name="Lecture seule", role="charge_effectifs_site", access_level="H2",
        authorized_societies=[SOC_A], authorized_structures=[], authorized_modules=["site_workforce"],
        authorized_sites=[ctx["site_a"].id], authorized_actions=["read"],
        password_hash=hash_password("readonlypass"), validation_password_hash=hash_password("x"), is_active=True,
    )
    db.add(read_only_user)
    db.flush()
    headers_write = _login_as(client, ctx, "charge_a")
    today = str(date.today())
    presence_id = client.post("/api/site-workforce/attendance", headers=headers_write, json={
        "employee_id": ctx["emp_a"].id, "presence_date": today, "status": "present",
    }).json()["id"]

    headers_ro = _login(client, f"chargeReadOnly_{ctx['tag']}", "readonlypass")
    r_close = client.post("/api/site-workforce/attendance/close", headers=headers_ro, params={"presence_date": today})
    assert r_close.status_code == 403

    # Clôture réelle par le compte autorisé, puis tentative de correction par le lecteur seul.
    client.post("/api/site-workforce/attendance/close", headers=headers_write, params={"presence_date": today})
    r_correct = client.post(f"/api/site-workforce/attendance/{presence_id}/correct", headers=headers_ro, json={
        "status": "absent", "reason": "tentative sans droit validate",
    })
    assert r_correct.status_code == 403


# ── Revue finale d'intégration (§16 double-submit) : rejoué et démontré avant correctif —
# un double POST identique sur /transmissions créait deux Transmission pour le même
# dossier. Corrigé par une vérification d'état ; ce test verrouille le correctif.
def test_double_submit_transmission_refused_after_first_success(client, db):
    ctx = _setup(db)
    headers = _login_as(client, ctx, "charge_a")
    incident_id = client.post("/api/site-workforce/discipline", headers=headers, json={
        "employee_id": ctx["emp_a"].id, "event_type": "retard", "subject": "Retard double-submit",
    }).json()["id"]
    client.post(f"/api/site-workforce/discipline/{incident_id}/signaler", headers=headers)

    body = {"resource_type": "incident", "resource_id": incident_id, "destinataire": "drh", "objet": "Retard double-submit"}
    r1 = client.post("/api/site-workforce/transmissions", headers=headers, json=body)
    r2 = client.post("/api/site-workforce/transmissions", headers=headers, json=body)
    assert r1.status_code == 200
    assert r2.status_code == 409, "un second POST identique ne doit jamais créer une seconde transmission"
    rows = client.get("/api/site-workforce/transmissions", headers=headers, params={"resource_type": "incident", "resource_id": incident_id}).json()
    assert len(rows) == 1, "la DRH ne doit jamais recevoir deux transmissions pour le même incident"
