"""Pointage & Planning intelligent V3 — lot 1 : feuilles de présence par rotation.

Le pointage réel est un FAIT : la feuille le regroupe par rotation (une ligne par employé),
sans jamais modifier ni bloquer l'événement. Paramètres par site, rien de codé en dur."""
import uuid
from datetime import date, datetime, timedelta

import pytest
from sqlalchemy import func, select

from app.core.config import settings
from app.core.security import hash_password
from app.modules.attendance import core, sheets
from app.modules.attendance.models import (
    SOURCE_FACIAL,
    SOURCE_QR,
    AttendanceEvent,
    AttendanceSheet,
    AttendanceSheetEvent,
    AttendanceSheetLine,
    RotationSetting,
)
from app.modules.auth.models import AuditEvent, User
from app.modules.drh.models import Employee
from app.modules.ops.models import Assignment, Site
from tests.module_cleanup import purge_rows_created_by_this_module  # noqa: F401 (fixture autouse)

SOC = "Iron Global Securite"
TZ = core.TZ
DAY = date(2026, 10, 6)


def _tag():
    return uuid.uuid4().hex[:6].upper()


def _site(db, *, configured=True, first="06:00", minutes=480, groups=4, margin=60, rotation=None):
    site = Site(name=f"ROT {_tag()}", active=1, equipment_plan={"societe": SOC}, rotation_system=rotation)
    db.add(site); db.flush()
    if configured:
        db.add(RotationSetting(site_id=site.id, first_shift_time=first, shift_minutes=minutes, groups_count=groups,
                               early_margin_minutes=margin, active=1, version=1))
    db.commit()
    return site


def _employee(db, site, group="A"):
    emp = Employee(code=f"RS{_tag()}", first_name="Adda", last_name=f"Agent{_tag()}", society=SOC, status="actif", position="MAGASINIER")
    db.add(emp); db.flush()
    db.add(Assignment(employee_id=emp.id, site_id=site.id, group_code=group, start_date=date(2026, 1, 1), active=1))
    db.commit()
    return emp


def _at(day, hh, mm=0, ss=0):
    return datetime(day.year, day.month, day.day, hh, mm, ss, tzinfo=TZ)


def _scan(db, emp, when, *, source=SOURCE_FACIAL):
    return core.record_scan(db, employee=emp, source=source, actor=None, idempotency_key=f"k-{_tag()}", now=when)


def _sheets(db, site):
    db.expire_all()
    return db.execute(select(AttendanceSheet).where(AttendanceSheet.site_id == site.id).order_by(AttendanceSheet.window_start)).scalars().all()


def _lines(db, sheet):
    return db.execute(select(AttendanceSheetLine).where(AttendanceSheetLine.sheet_id == sheet.id)).scalars().all()


def _local(value):
    return core.to_local(value).strftime("%Y-%m-%d %H:%M")


# ── Fenêtre de rotation : paramétrée, jamais codée en dur ───────────────────────────────────
@pytest.mark.parametrize("first, minutes, at, arrival, expected", [
    ("06:00", 480, (14, 32), False, ("14:00", "22:00", 1)),
    ("06:00", 480, (5, 59), False, ("22:00", "06:00", 2)),          # nuit : rotation de la veille
    ("06:00", 480, (13, 10), True, ("14:00", "22:00", 1)),           # arrivée anticipée (marge 60)
    ("06:00", 480, (12, 59), True, ("06:00", "14:00", 0)),           # hors marge : rotation en cours
    ("06:00", 480, (13, 10), False, ("06:00", "14:00", 0)),          # la marge ne vaut que pour l'ARRIVÉE
    ("07:00", 720, (18, 30), True, ("19:00", "07:00", 1)),           # 2 × 12 h
    ("08:00", 1440, (7, 30), True, ("08:00", "08:00", 0)),           # 24 h
])
def test_window_follows_site_parameters(first, minutes, at, arrival, expected):
    setting = RotationSetting(first_shift_time=first, shift_minutes=minutes, groups_count=4, early_margin_minutes=60)
    window = sheets.window_at(setting, _at(DAY, *at), arrival=arrival)
    assert (window.start.strftime("%H:%M"), window.end.strftime("%H:%M"), window.slot_index) == expected
    assert window.end - window.start == timedelta(minutes=minutes)


@pytest.mark.parametrize("args", [("6h", 480, 4, 60), ("06:00", 500, 4, 60), ("06:00", 30, 4, 0), ("06:00", 480, 0, 60), ("06:00", 480, 4, 480)])
def test_invalid_settings_are_refused(args):
    with pytest.raises(ValueError):
        sheets.validate_setting(*args)
    sheets.validate_setting("06:00", 480, 4, 60)
    sheets.validate_setting("07:00", 720, 2, 0)


def test_defaults_come_from_configuration_not_from_the_engine(monkeypatch):
    assert sheets.default_setting()["shift_minutes"] == 480 and sheets.default_setting()["groups_count"] == 4
    monkeypatch.setattr(settings, "attendance_rotation_default_shift_minutes", 720)
    monkeypatch.setattr(settings, "attendance_rotation_default_groups", 3)
    assert (sheets.default_setting()["shift_minutes"], sheets.default_setting()["groups_count"]) == (720, 3)


# ── Une feuille par rotation, une ligne par employé ─────────────────────────────────────────
def test_one_line_per_employee_and_raw_events_are_kept(db):
    site = _site(db)
    emp = _employee(db, site, group="B")
    assert _scan(db, emp, _at(DAY, 14, 32, 26))["action"] == "arrivee"
    assert _scan(db, emp, _at(DAY, 14, 37, 28))["action"] == "depart"
    assert _scan(db, emp, _at(DAY, 14, 39))["duplicate"] is True      # anti-rebond : aucun fait, aucune ligne
    all_sheets = _sheets(db, site)
    assert [(_local(s.window_start), _local(s.window_end), s.status, s.slot_index) for s in all_sheets] == [
        ("2026-10-06 14:00", "2026-10-06 22:00", "OPEN", 1)]
    lines = _lines(db, all_sheets[0])
    assert len(lines) == 1
    line = lines[0]
    assert (core.to_local(line.first_entry_at).strftime("%H:%M:%S"), core.to_local(line.last_exit_at).strftime("%H:%M:%S"),
            line.state, line.events_count, line.declared_group) == ("14:32:26", "14:37:28", "SORTI", 2, "B")
    # Les deux événements bruts existent toujours, inchangés, et sont rattachés à la feuille.
    events = db.execute(select(AttendanceEvent).where(AttendanceEvent.employee_id == emp.id).order_by(AttendanceEvent.id)).scalars().all()
    assert [e.event_type for e in events] == ["ARRIVAL", "DEPARTURE"]
    links = db.execute(select(AttendanceSheetEvent).where(AttendanceSheetEvent.sheet_id == all_sheets[0].id)).scalars().all()
    assert sorted(l.event_id for l in links) == [e.id for e in events]
    assert {l.line_id for l in links} == {line.id}


def test_several_employees_share_the_sheet_and_the_active_view(db):
    site = _site(db)
    a, b, c = _employee(db, site, "A"), _employee(db, site, "A"), _employee(db, site, "C")
    for emp, minute in ((a, 1), (b, 4), (c, 9)):
        _scan(db, emp, _at(DAY, 6, minute))
    _scan(db, a, _at(DAY, 13, 58), source=SOURCE_QR)
    view = sheets.active_view(db, site.id, _at(DAY, 13, 59))
    assert view["configured"] is True
    sheet = view["sheet"]
    assert (sheet["label"], sheet["status"], sheet["lines_count"], sheet["present_count"], sheet["out_count"]) == ("06:00 – 14:00", "OPEN", 3, 2, 1)
    assert sheet["observed_group"] == "A" and sheet["groups"] == {"A": 2, "C": 1}
    assert sheet["expected_group"] is None                              # planning appris : lots suivants
    assert sorted(line["matricule"] for line in sheet["lines"]) == sorted(e.code for e in (a, b, c))
    row = next(line for line in sheet["lines"] if line["matricule"] == a.code)
    assert (row["first_entry"], row["last_exit"], row["state"], row["events_count"]) == ("06:01:00", "13:58:00", "SORTI", 2)


def test_early_arrival_belongs_to_the_next_rotation_and_shows_as_upcoming(db):
    site = _site(db)
    current, early = _employee(db, site), _employee(db, site, "B")
    _scan(db, current, _at(DAY, 6, 5))
    _scan(db, early, _at(DAY, 13, 20))                                  # 40 min avant 14 h
    all_sheets = _sheets(db, site)
    assert [(_local(s.window_start)[11:], len(_lines(db, s))) for s in all_sheets] == [("06:00", 1), ("14:00", 1)]
    view = sheets.active_view(db, site.id, _at(DAY, 13, 30))
    assert view["sheet"]["label"] == "06:00 – 14:00" and [l["matricule"] for l in view["sheet"]["lines"]] == [current.code]
    assert view["next"]["label"] == "14:00 – 22:00" and [l["matricule"] for l in view["next"]["lines"]] == [early.code]


def test_departure_closes_the_line_of_its_own_entry_across_rotation_end_and_midnight(db):
    site = _site(db)
    late_leaver, night = _employee(db, site), _employee(db, site, "D")
    _scan(db, late_leaver, _at(DAY, 14, 2))
    _scan(db, night, _at(DAY, 22, 1))
    _scan(db, late_leaver, _at(DAY, 22, 20))                            # sort 20 min après la fin de sa rotation
    _scan(db, night, _at(DAY + timedelta(days=1), 6, 4))                # sort le lendemain matin
    by_start = {_local(s.window_start): s for s in _sheets(db, site)}
    assert sorted(by_start) == ["2026-10-06 14:00", "2026-10-06 22:00"]  # aucune feuille « du lendemain » créée par les sorties
    afternoon, night_sheet = by_start["2026-10-06 14:00"], by_start["2026-10-06 22:00"]
    assert [(l.employee_id, l.state, core.to_local(l.last_exit_at).strftime("%d %H:%M")) for l in _lines(db, afternoon)] == [(late_leaver.id, "SORTI", "06 22:20")]
    assert [(l.employee_id, l.state, core.to_local(l.last_exit_at).strftime("%d %H:%M")) for l in _lines(db, night_sheet)] == [(night.id, "SORTI", "07 06:04")]
    assert (afternoon.status, night_sheet.status) == ("CLOSED", "CLOSED")
    assert night_sheet.local_date == DAY and night_sheet.slot_index == 2


# ── Clôture sans cron fragile ───────────────────────────────────────────────────────────────
def test_closure_is_caught_up_on_access_and_is_idempotent(db):
    site = _site(db)
    emp = _employee(db, site)
    _scan(db, emp, _at(DAY, 6, 10))
    assert [s.status for s in _sheets(db, site)] == ["OPEN"]
    # Aucun passage planifié entre-temps : le prochain accès clôt la feuille dépassée et ouvre la suivante.
    first = sheets.maintain(db, _at(DAY, 15, 0), [site.id]); db.commit()
    assert first == {"closed": 1, "archived": 0, "created": 1}
    again = sheets.maintain(db, _at(DAY, 15, 0), [site.id]); db.commit()
    assert again == {"closed": 0, "archived": 0, "created": 0}
    rows = _sheets(db, site)
    assert [(_local(s.window_start)[11:], s.status, s.source) for s in rows] == [("06:00", "CLOSED", "EVENT"), ("14:00", "OPEN", "ACCESS")]
    assert rows[0].closed_by == "system" and _local(rows[0].closed_at) == "2026-10-06 15:00"
    # Un pointage suffit aussi à rattraper (aucune feuille dépassée ne reste active).
    other = _site(db)
    worker = _employee(db, other)
    _scan(db, worker, _at(DAY, 6, 10))
    _scan(db, _employee(db, other), _at(DAY, 23, 0))
    assert [(_local(s.window_start)[11:], s.status) for s in _sheets(db, other)] == [("06:00", "CLOSED"), ("22:00", "OPEN")]


def test_only_one_sheet_per_site_and_window_even_when_created_twice(db):
    site = _site(db)
    setting = sheets.setting_for(db, site.id)
    window = sheets.window_at(setting, _at(DAY, 7, 0))
    first = sheets._get_or_create_sheet(db, site, setting, window, "ACCESS")
    second = sheets._get_or_create_sheet(db, site, setting, window, "EVENT")
    db.commit()
    assert first.id == second.id and len(_sheets(db, site)) == 1
    # Insertion directe d'un doublon : refusée par la contrainte unique de la base.
    from sqlalchemy.exc import IntegrityError
    db.add(AttendanceSheet(site_id=site.id, window_start=first.window_start, window_end=first.window_end, local_date=DAY,
                           slot_index=0, status="OPEN", source="EVENT"))
    with pytest.raises(IntegrityError):
        db.flush()
    db.rollback()


def test_archive_flags_missing_departure_without_touching_raw_events(db, monkeypatch):
    monkeypatch.setattr(settings, "attendance_sheet_archive_after_hours", 36)
    site = _site(db)
    gone, forgot = _employee(db, site), _employee(db, site)
    _scan(db, gone, _at(DAY, 6, 5)); _scan(db, forgot, _at(DAY, 6, 6)); _scan(db, gone, _at(DAY, 14, 1))
    before = db.execute(select(func.count(AttendanceEvent.id)).where(AttendanceEvent.site_id == site.id)).scalar_one()
    assert sheets.maintain(db, _at(DAY + timedelta(days=1), 12, 0), [site.id], ensure_current=False)["archived"] == 0   # 22 h après la fin
    assert sheets.maintain(db, _at(DAY + timedelta(days=2), 3, 0), [site.id], ensure_current=False)["archived"] == 1    # 37 h après la fin
    db.commit()
    sheet = _sheets(db, site)[0]
    assert sheet.status == "ARCHIVED" and sheet.archived_at is not None
    assert {l.employee_id: (l.state, l.anomaly) for l in _lines(db, sheet)} == {gone.id: ("SORTI", None), forgot.id: ("PRESENT", "DEPART_MANQUANT")}
    assert db.execute(select(func.count(AttendanceEvent.id)).where(AttendanceEvent.site_id == site.id)).scalar_one() == before


# ── Compatibilité : additif, jamais bloquant ───────────────────────────────────────────────
def test_unconfigured_site_keeps_the_historical_behaviour(db):
    site = _site(db, configured=False)
    emp = _employee(db, site)
    assert _scan(db, emp, _at(DAY, 8, 0))["action"] == "arrivee"
    assert _scan(db, emp, _at(DAY, 16, 6))["action"] == "depart"
    assert _sheets(db, site) == []
    assert sheets.active_view(db, site.id, _at(DAY, 9, 0)) == {"configured": False, "site_id": site.id, "sheet": None, "next": None,
                                                                 "server_time": _at(DAY, 9, 0).isoformat()}


def test_a_sheet_failure_never_blocks_or_alters_the_scan(db, monkeypatch):
    site = _site(db)
    emp = _employee(db, site)

    def boom(*args, **kwargs):
        raise RuntimeError("panne de la feuille")

    monkeypatch.setattr(sheets, "attach_event", boom)
    result = _scan(db, emp, _at(DAY, 6, 3))
    assert result["success"] is True and result["action"] == "arrivee"
    db.expire_all()
    event = db.execute(select(AttendanceEvent).where(AttendanceEvent.employee_id == emp.id)).scalar_one()
    assert event.event_type == "ARRIVAL" and event.presence_id is not None       # le fait et la journée sont écrits
    # (les identifiants d'événements sont réutilisés par SQLite entre modules de test : on lit le dernier audit)
    assert db.execute(select(AuditEvent).where(AuditEvent.action == "attendance.event", AuditEvent.resource_id == str(event.id))
                      .order_by(AuditEvent.id.desc())).scalars().first() is not None
    assert _sheets(db, site) == []


def test_business_rules_of_attendance_core_are_unchanged_on_a_configured_site(db):
    site = _site(db)
    emp = _employee(db, site)
    assert _scan(db, emp, _at(DAY, 6, 0))["action"] == "arrivee"
    assert _scan(db, emp, _at(DAY, 6, 4))["duplicate"] is True                    # 300 s
    assert _scan(db, emp, _at(DAY, 6, 6))["action"] == "depart"                   # cycle ouvert
    with pytest.raises(Exception) as refused:                                     # nouvelle entrée < 8 h
        _scan(db, emp, _at(DAY, 12, 0))
    assert getattr(refused.value, "status_code", None) == 409
    assert _scan(db, emp, _at(DAY, 14, 1))["action"] == "arrivee"                 # 8 h après la dernière entrée
    by_start = {_local(s.window_start)[11:]: _lines(db, s) for s in _sheets(db, site)}
    assert {start: [(l.state, l.events_count) for l in lines] for start, lines in by_start.items()} == {
        "06:00": [("SORTI", 2)], "14:00": [("PRESENT", 1)]}


# ── API : périmètre, configuration versionnée, historique ───────────────────────────────────
def _user(client, db, *, sites=None, modules=("pointage",), actions=None, societies=(SOC,)):
    username = f"u{_tag()}"
    db.add(User(username=username, full_name=username, role="ops", access_level="H3",
                authorized_societies=list(societies), authorized_sites=list(sites or []),
                authorized_modules=list(modules), authorized_actions=list(actions or []),
                password_hash=hash_password("apipassword1"), is_active=True))
    db.commit()
    token = client.post("/api/auth/login", json={"username": username, "password": "apipassword1"}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_settings_api_validates_versions_and_audits(client, db):
    site = _site(db, configured=False)
    other = _site(db, configured=False)
    headers = _user(client, db, sites=[site.id], modules=("ops",))
    proposed = client.get(f"/api/attendance/rotation-settings?site_id={site.id}", headers=headers).json()
    assert (proposed["configured"], proposed["shift_minutes"], proposed["groups_count"], proposed["first_shift_time"]) == (False, 480, 4, "06:00")
    body = {"first_shift_time": "06:00", "shift_minutes": 480, "groups_count": 4, "early_margin_minutes": 60}
    assert client.put(f"/api/attendance/rotation-settings/{site.id}", json={**body, "shift_minutes": 500}, headers=headers).status_code == 422
    assert client.put(f"/api/attendance/rotation-settings/{other.id}", json=body, headers=headers).status_code in (403, 404)
    saved = client.put(f"/api/attendance/rotation-settings/{site.id}", json=body, headers=headers).json()
    assert (saved["configured"], saved["version"]) == (True, 1)
    same = client.put(f"/api/attendance/rotation-settings/{site.id}", json=body, headers=headers).json()
    assert same["version"] == 1                                                     # rien n'a changé
    changed = client.put(f"/api/attendance/rotation-settings/{site.id}", json={**body, "first_shift_time": "07:00"}, headers=headers).json()
    assert (changed["version"], changed["first_shift_time"]) == (2, "07:00")
    db.expire_all()
    audits = db.execute(select(AuditEvent).where(AuditEvent.action == "attendance.rotation_settings")
                        .order_by(AuditEvent.id.desc()).limit(1)).scalar_one()
    assert "07:00" in (audits.new_state or "") and "06:00" in (audits.old_state or "")
    read_only = _user(client, db, sites=[site.id], modules=("ops",), actions=["read"])
    assert client.put(f"/api/attendance/rotation-settings/{site.id}", json=body, headers=read_only).status_code == 403


def test_history_api_is_scoped_and_returns_lines_with_raw_events(client, db):
    mine, theirs = _site(db), _site(db)
    emp, stranger = _employee(db, mine, "A"), _employee(db, theirs)
    _scan(db, emp, _at(DAY, 6, 2)); _scan(db, emp, _at(DAY, 14, 3)); _scan(db, stranger, _at(DAY, 6, 5))
    sheets.maintain(db, _at(DAY, 15, 0)); db.commit()
    headers = _user(client, db, sites=[mine.id], modules=("drh",))
    listing = client.get(f"/api/attendance/sheets?date_from={DAY}&date_to={DAY}", headers=headers).json()
    assert {item["site_id"] for item in listing["items"]} == {mine.id}
    closed = next(item for item in listing["items"] if item["label"] == "06:00 – 14:00")
    assert (closed["site"], closed["lines_count"], closed["out_count"]) == (mine.name, 1, 1)
    assert closed["status"] in ("CLOSED", "ARCHIVED")
    detail = client.get(f"/api/attendance/sheets/{closed['id']}", headers=headers).json()
    assert [(l["matricule"], l["first_entry"], l["last_exit"], l["state"]) for l in detail["lines"]] == [(emp.code, "06:02:00", "14:03:00", "SORTI")]
    assert [(e["type"], e["heure"]) for e in detail["lines"][0]["events"]] == [("ENTREE", "06:02:00"), ("SORTIE", "14:03:00")]
    foreign = db.execute(select(AttendanceSheet).where(AttendanceSheet.site_id == theirs.id)).scalars().first()
    assert client.get(f"/api/attendance/sheets/{foreign.id}", headers=headers).status_code == 404
    assert client.get(f"/api/attendance/sheets?site_id={theirs.id}", headers=headers).status_code in (403, 404)
    assert client.get("/api/attendance/sheets?status=nope", headers=headers).status_code == 422


def test_pointeur_endpoint_returns_only_the_active_sheet_of_its_site(client, db):
    site, other = _site(db), _site(db)
    emp = _employee(db, site)
    headers = _user(client, db, sites=[site.id], modules=("pointeur",))
    view = client.get(f"/api/portal/attendance-sheet?site_id={site.id}", headers=headers).json()
    assert view["configured"] is True and view["sheet"]["status"] == "OPEN" and view["sheet"]["lines"] == []
    core.record_scan(db, employee=emp, source=SOURCE_QR, actor=None, idempotency_key=f"live-{_tag()}")
    view = client.get(f"/api/portal/attendance-sheet?site_id={site.id}", headers=headers).json()
    target = view["sheet"] if view["sheet"]["lines"] else view["next"]
    assert [line["matricule"] for line in target["lines"]] == [emp.code]
    assert client.get(f"/api/portal/attendance-sheet?site_id={other.id}", headers=headers).status_code == 403
    multi = _user(client, db, sites=[site.id, other.id], modules=("pointeur",))
    assert client.get("/api/portal/attendance-sheet", headers=multi).json()["configured"] is False
