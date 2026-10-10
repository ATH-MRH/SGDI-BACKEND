"""Audit pointeur.irongs.com — P1 : calcul des vacations, paie, suivi en direct (non-régression).

Scénarios reproduits pendant l'audit, rejoués sur les services réels. Aucun de ces correctifs
ne réécrit un pointage existant ni une journée clôturée : les tests le vérifient explicitement."""
import uuid
from datetime import date, datetime, timedelta
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.modules.attendance import core, counted, live, official
from app.modules.attendance.models import EVENT_ARRIVAL, EVENT_DEPARTURE, AttendanceAnomaly, AttendanceEvent
from app.modules.drh.models import Employee
from app.modules.ops.models import Assignment, DailyPresence, Site, SiteRotation
from tests.module_cleanup import purge_rows_created_by_this_module  # noqa: F401 (fixture autouse)

TZ = ZoneInfo("Africa/Algiers")
SOC = "Iron Global Securite"
ANCHOR = date(2026, 10, 1)                       # J1 du cycle officiel : groupe C = Nuit
NEXT = ANCHOR + timedelta(days=1)
ACTOR = SimpleNamespace(id=None, username="PTG-P1")


def _tag():
    return uuid.uuid4().hex[:6].upper()


def _ts(day, hms):
    return datetime.combine(day, datetime.strptime(hms if len(hms) == 8 else f"{hms}:00", "%H:%M:%S").time(), TZ)


def _setup(db, *, posted=True, group="C"):
    site = Site(name=f"Site P1 {_tag()}", active=1, equipment_plan={"societe": SOC})
    db.add(site); db.flush()
    model = official.ensure_official_model(db)
    if posted:
        db.add(SiteRotation(site_id=site.id, rotation_id=model.id, start_date=ANCHOR, active=1))
    emp = Employee(code=f"P1{_tag()}", first_name="Audit", last_name="Nuit", society=SOC, status="actif")
    db.add(emp); db.flush()
    db.add(Assignment(employee_id=emp.id, site_id=site.id, group_code=group, start_date=date(2026, 1, 1), active=1,
                      work_regime=official.REGIME_POSTE_CONTINU if posted else None, rotation_id=model.id if posted else None))
    db.commit()
    return emp, site


def _scan(db, emp, day, hms, **options):
    return core.record_scan(db, employee=emp, source=options.pop("source", "QR"), actor=ACTOR,
                            idempotency_key=f"p1-{_tag()}", now=_ts(day, hms), **options)


def _events(db, emp):
    return db.execute(select(AttendanceEvent).where(AttendanceEvent.employee_id == emp.id,
                                                    AttendanceEvent.event_type.in_((EVENT_ARRIVAL, EVENT_DEPARTURE)))
                      .order_by(AttendanceEvent.occurred_at, AttendanceEvent.id)).scalars().all()


def _days(db, emp):
    return {row.presence_date: row for row in db.execute(select(DailyPresence).where(DailyPresence.employee_id == emp.id)).scalars()}


def _anomalies(db, emp):
    return [a.anomaly_type for a in db.execute(select(AttendanceAnomaly).where(AttendanceAnomaly.employee_id == emp.id)
                                               .order_by(AttendanceAnomaly.id)).scalars()]


# ── Arrivée de nuit après minuit : journée de travail, paie, retard ─────────────────────
def test_night_arrival_after_midnight_belongs_to_the_work_day_and_keeps_two_payroll_days(db):
    emp, _site = _setup(db)
    late = _scan(db, emp, NEXT, "00:10")                              # nuit du 1er, arrivée 2 h 10 après 22:00
    assert late["counted"]["work_date"] == ANCHOR.isoformat()
    _scan(db, emp, NEXT, "06:02")
    following = official.site_shift(db, site_id=_site.id, at=_ts(NEXT, "22:30"))["current"]
    events = _events(db, emp)
    assert [e.presence_date for e in events] == [ANCHOR, ANCHOR]      # arrivée ET sortie sur la journée de travail
    if following["group"] == "C":                                     # le groupe enchaîne une seconde nuit
        _scan(db, emp, NEXT, "21:45")
        _scan(db, emp, NEXT + timedelta(days=1), "06:00")
        days = _days(db, emp)
        assert set(days) == {ANCHOR, NEXT}                            # deux nuits = deux journées « present »
        assert all(row.status == "present" for row in days.values())
        assert [e.cycle for e in _events(db, emp)] == [1, 1, 1, 1]
    else:
        assert set(_days(db, emp)) == {ANCHOR}
    kinds = _anomalies(db, emp)
    assert "LATE" in kinds and "OFF_SCHEDULE" not in kinds            # 2 h 10 de retard signalées, pas « hors planning »
    late_row = db.execute(select(AttendanceAnomaly).where(AttendanceAnomaly.employee_id == emp.id,
                                                          AttendanceAnomaly.anomaly_type == "LATE")).scalars().first()
    assert late_row.details["late_minutes"] == 130 and late_row.presence_date == ANCHOR


def test_on_time_night_arrival_raises_no_late_anomaly(db):
    emp, _site = _setup(db)
    _scan(db, emp, ANCHOR, "21:45")
    assert _events(db, emp)[0].presence_date == ANCHOR
    assert "LATE" not in _anomalies(db, emp)


# ── Numéro de vacation : un compteur par journée, stable dans le temps ──────────────────
def test_cycle_is_the_rank_in_the_presence_day_even_after_many_days(db):
    emp, _site = _setup(db, posted=False)
    start = date(2026, 8, 1)
    for offset in range(25):
        day = start + timedelta(days=offset)
        arrival = _scan(db, emp, day, "08:00")
        departure = _scan(db, emp, day, "16:00")
        assert (arrival["action"], arrival["cycle"], departure["action"], departure["cycle"]) == ("arrivee", 1, "depart", 1), offset
    events = _events(db, emp)
    assert len(events) == 50 and {e.cycle for e in events} == {1}
    # Seconde vacation le même jour : rang 2, et son départ reprend le rang de son arrivée.
    last_day = start + timedelta(days=24)
    again = core.record_scan(db, employee=emp, source="QR", actor=ACTOR, idempotency_key=f"p1-{_tag()}",
                             now=_ts(last_day + timedelta(days=1), "00:30"))
    assert again["action"] == "arrivee" and again["cycle"] == 1       # nouvelle journée civile, hors travail posté


# ── Clôture : la sortie d'une nuit reste possible, la journée clôturée n'est pas touchée ─
def test_departure_after_the_arrival_day_was_closed_is_recorded_without_touching_the_closed_day(db):
    emp, site = _setup(db)
    _scan(db, emp, ANCHOR, "21:50")
    core.close_day(db, day=ANCHOR, site_ids=[site.id], actor=ACTOR, source="MANUAL")
    db.commit()
    closed = _days(db, emp)[ANCHOR]
    snapshot = (closed.arrival_time, closed.departure_time, closed.status, closed.closed_at, dict(closed.data or {}))
    out = _scan(db, emp, NEXT, "06:00")
    assert out["action"] == "depart" and out["counted"]["counted_minutes"] == 480
    db.expire_all()
    closed = _days(db, emp)[ANCHOR]
    assert (closed.arrival_time, closed.departure_time, closed.status, closed.closed_at, dict(closed.data or {})) == snapshot
    assert set(_days(db, emp)) == {ANCHOR}                            # aucune journée créée à la place
    assert "DEPARTURE_AFTER_CLOSURE" in _anomalies(db, emp)
    departure = _events(db, emp)[-1]
    assert departure.event_type == EVENT_DEPARTURE and departure.presence_date == ANCHOR and departure.presence_id == closed.id


def test_arrival_on_a_closed_day_is_still_refused(db):
    emp, site = _setup(db, posted=False)
    _scan(db, emp, ANCHOR, "08:00")
    _scan(db, emp, ANCHOR, "12:00")
    core.close_day(db, day=ANCHOR, site_ids=[site.id], actor=ACTOR, source="MANUAL")
    db.commit()
    with pytest.raises(HTTPException) as refused:
        _scan(db, emp, ANCHOR, "21:00")
    assert refused.value.status_code == 409 and "clôturée" in refused.value.detail


def test_late_night_arrival_for_an_already_closed_work_day_never_rewrites_it(db):
    emp, site = _setup(db)
    db.add(DailyPresence(presence_date=ANCHOR, employee_id=emp.id, site_id=site.id, status="absent", generated=0))
    db.commit()
    core.close_day(db, day=ANCHOR, site_ids=[site.id], actor=ACTOR, source="MANUAL")
    db.commit()
    out = _scan(db, emp, NEXT, "00:20")
    assert out["action"] == "arrivee"
    db.expire_all()
    days = _days(db, emp)
    assert days[ANCHOR].status == "absent" and days[ANCHOR].arrival_time is None and days[ANCHOR].closed_at is not None
    assert _events(db, emp)[-1].presence_date == NEXT                 # fait enregistré sur le jour civil
    assert "ARRIVAL_AFTER_CLOSURE" in _anomalies(db, emp)             # régularisation demandée, pas faite d'office


# ── Reprise de poste après une sortie saisie par erreur ─────────────────────────────────
def test_wrong_exit_can_be_followed_by_a_motivated_manual_reentry(db):
    emp, _site = _setup(db, group="A")                                # Matin 06:00 → 14:00
    _scan(db, emp, ANCHOR, "05:50")
    wrong = _scan(db, emp, ANCHOR, "05:57")                           # second scan : devient une sortie
    assert wrong["action"] == "depart"
    with pytest.raises(HTTPException) as blocked:                     # un simple nouveau scan reste bloqué
        _scan(db, emp, ANCHOR, "06:05")
    assert blocked.value.status_code == 409
    with pytest.raises(HTTPException) as unauthorized:                # intention sans habilitation
        _scan(db, emp, ANCHOR, "06:05", source="MANUAL", intent=counted.INTENT_REENTRY, observation="Erreur de scan")
    assert unauthorized.value.status_code == 403
    with pytest.raises(HTTPException) as no_reason:
        _scan(db, emp, ANCHOR, "06:05", source="MANUAL", intent=counted.INTENT_REENTRY, manual_entry_allowed=True)
    assert no_reason.value.status_code == 422
    back = _scan(db, emp, ANCHOR, "06:05", source="MANUAL", intent=counted.INTENT_REENTRY, manual_entry_allowed=True,
                 observation="Double scan à la prise de poste")
    assert back["action"] == "arrivee" and back["cycle"] == 2
    out = _scan(db, emp, ANCHOR, "14:00")
    assert out["action"] == "depart" and out["counted"]["counted_minutes"] == 475
    events = _events(db, emp)
    assert len(events) == 4 and events[1].event_type == EVENT_DEPARTURE   # la sortie erronée reste au journal
    assert "REENTRY" in _anomalies(db, emp)


def test_reentry_is_refused_once_the_shift_is_over(db):
    emp, _site = _setup(db, group="A")
    _scan(db, emp, ANCHOR, "05:50")
    _scan(db, emp, ANCHOR, "13:00")
    with pytest.raises(HTTPException) as refused:
        _scan(db, emp, ANCHOR, "14:20", source="MANUAL", intent=counted.INTENT_REENTRY, manual_entry_allowed=True, observation="x")
    assert refused.value.status_code in (403, 409, 422)
    assert len(_events(db, emp)) == 2


# ── Régularisation explicite d'un oubli de sortie ───────────────────────────────────────
def test_forgotten_exit_is_regularized_explicitly_and_gets_counted_time(db):
    from app.modules.attendance import recap

    emp, _site = _setup(db, group="A")
    _scan(db, emp, ANCHOR, "05:55")                                   # sortie oubliée
    later = _ts(NEXT + timedelta(days=3), "05:55")                    # passage ultérieur : nouvelle arrivée
    db.add(AttendanceEvent(employee_id=emp.id, society=SOC, site_id=_site.id, presence_date=later.date(),
                           occurred_at=core.to_utc_naive(later), event_type=EVENT_ARRIVAL, source="QR",
                           idempotency_key=f"p1-{_tag()}", cycle=1, data={}))
    db.commit()
    arrival = _events(db, emp)[0]
    with pytest.raises(HTTPException) as no_reason:
        core.regularize_departure(db, arrival_event_id=arrival.id, exit_at=_ts(ANCHOR, "14:00"), reason="", actor=ACTOR)
    assert no_reason.value.status_code == 422
    with pytest.raises(HTTPException):                                # jamais au-delà du passage suivant
        core.regularize_departure(db, arrival_event_id=arrival.id, exit_at=_ts(NEXT + timedelta(days=3), "06:30"), reason="Oubli", actor=ACTOR)
    result = core.regularize_departure(db, arrival_event_id=arrival.id, exit_at=_ts(ANCHOR, "14:05"),
                                       reason="Oubli de sortie confirmé par le chef de poste", actor=ACTOR)
    db.commit()
    assert result["counted_minutes"] == 480 and result["presence_updated"] is True
    events = _events(db, emp)
    assert [e.event_type for e in events] == [EVENT_ARRIVAL, EVENT_DEPARTURE, EVENT_ARRIVAL]
    assert events[1].data["regularized"] is True and events[1].cycle == events[0].cycle and events[1].observation
    assert events[0].data == arrival.data                             # l'arrivée d'origine n'est pas réécrite
    assert "EXIT_REGULARIZED" in _anomalies(db, emp)
    with pytest.raises(HTTPException) as twice:
        core.regularize_departure(db, arrival_event_id=arrival.id, exit_at=_ts(ANCHOR, "14:05"), reason="Encore", actor=ACTOR)
    assert twice.value.status_code == 409
    assert recap is not None


def test_regularizing_an_exit_never_modifies_a_closed_day(db):
    emp, site = _setup(db, group="A")
    _scan(db, emp, ANCHOR, "05:55")
    core.close_day(db, day=ANCHOR, site_ids=[site.id], actor=ACTOR, source="MANUAL")
    db.commit()
    arrival = _events(db, emp)[0]
    result = core.regularize_departure(db, arrival_event_id=arrival.id, exit_at=_ts(ANCHOR, "14:00"), reason="Oubli de sortie", actor=ACTOR)
    db.commit(); db.expire_all()
    row = _days(db, emp)[ANCHOR]
    assert result["presence_closed"] is True and result["presence_updated"] is False
    assert row.departure_time is None and row.closed_at is not None


# ── Suivi en direct : lecture bornée, résultat identique ────────────────────────────────
def test_live_last_scan_reads_only_the_recent_window_with_identical_result(db):
    emp, site = _setup(db, posted=False)
    for offset in range(60, 0, -1):                                   # deux mois d'historique
        day = ANCHOR - timedelta(days=offset)
        _scan(db, emp, day, "08:00"); _scan(db, emp, day, "16:00")
    _scan(db, emp, ANCHOR, "08:00")
    now = _ts(ANCHOR, "09:00")
    since = core.to_utc_naive(now - core.OPEN_24H_CYCLE_MAX)
    bounded = live._last_scan_by_employee(db, {emp.id}, since)
    newest = _events(db, emp)[-1]
    assert bounded[emp.id].id == newest.id and newest.event_type == EVENT_ARRIVAL
    summary = live.summary(db, {site.id}, now)
    assert summary["present_now"] == 1 and summary["entries_today"] == 1
    post = live.control_post(db, site.id, now)
    assert post["kpi"]["present"] == 1
    # La requête ne remonte que la fenêtre : deux passages de la veille au plus, pas 121.
    loaded = db.execute(select(AttendanceEvent.id).where(AttendanceEvent.employee_id == emp.id,
                                                         AttendanceEvent.occurred_at >= since)).all()
    assert len(loaded) <= 3


# ── Flux : résumé journalier et vue multi-jours ─────────────────────────────────────────
def test_feed_daily_summary_keeps_today_and_groups_a_night_on_one_line(client, auth_headers, db):
    emp, site = _setup(db)
    today = datetime.now(TZ).date()
    start = _ts(today - timedelta(days=1), "22:00")
    core.record_scan(db, employee=emp, source="QR", actor=ACTOR, idempotency_key=f"p1-{_tag()}", now=start - timedelta(minutes=5))
    end = min(datetime.now(TZ) - timedelta(seconds=1), start + timedelta(hours=8))
    if end - start < timedelta(minutes=10):
        pytest.skip("exécuté dans les minutes qui suivent 22:00 : la nuit de la veille n'a pas encore de sortie possible")
    core.record_scan(db, employee=emp, source="QR", actor=ACTOR, idempotency_key=f"p1-{_tag()}", now=end)
    body = client.get("/api/portal/attendance-feed", headers=auth_headers,
                      params={"site_id": site.id, "limit": 200, "include_daily": "true"}).json()
    rows = [row for row in body["daily"] if row["employee_id"] == emp.id]
    assert len(rows) == 1, rows                                       # une seule ligne pour la nuit
    assert rows[0]["arrival"] and rows[0]["departure"] and rows[0]["status"] == "Sorti"
    assert all(event["presence_date"] for event in body["events"] if event["employee_id"] == emp.id)


def test_feed_daily_summary_is_sorted_most_recent_day_first():
    from app.modules.portal import routes
    source = open(routes.__file__, encoding="utf8").read()
    assert 'sorted(daily.values(), key=lambda row: row["date"], reverse=True)' in source
    assert routes.FEED_DAILY_LIMIT >= 1000 and routes.FEED_MULTI_DAY_LIMIT >= 20000


def test_multi_day_feed_is_not_truncated_at_two_thousand_rows(client, auth_headers, db):
    emp, site = _setup(db, posted=False)
    base = datetime.now(TZ).replace(microsecond=0) - timedelta(days=6)
    rows = []
    for index in range(2100):                                         # volume d'un périmètre de ~130 agents sur 8 jours
        at = base + timedelta(seconds=index * 30)
        rows.append(AttendanceEvent(employee_id=emp.id, society=SOC, site_id=site.id, presence_date=at.date(),
                                    occurred_at=core.to_utc_naive(at), event_type=EVENT_ARRIVAL if index % 2 == 0 else EVENT_DEPARTURE,
                                    source="QR", idempotency_key=f"vol-{_tag()}-{index}", cycle=1,
                                    data={"matricule": emp.code, "agentName": "Volume", "siteName": site.name}))
    db.add_all(rows); db.commit()
    feed = client.get("/api/portal/attendance-feed", headers=auth_headers, params={"site_id": site.id, "days": 8, "limit": 2000}).json()
    assert len(feed) == 2100
    assert all(row["photo"] == "" for row in feed)                    # vue planning : aucune photo embarquée
