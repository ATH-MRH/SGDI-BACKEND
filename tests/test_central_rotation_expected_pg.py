"""PostgreSQL réel : pour une vacation publiée où 2 agents sont attendus, moteur = simulation =
Pointeur = API Pointeur = BEO = API BEO = 2, avec le même identifiant d'occurrence.

Base jetable migrée par Alembic jusqu'à la tête ; publication par le vrai parcours OPS
(brouillon, simulation, publication) ; affectations sans régime explicite, comme en production."""
import os
import uuid
from datetime import datetime, timedelta
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy.orm import Session

from tests.test_central_rotation_engine import config
from tests.test_facial_device_authorizations_migration_pg import alembic, pg_database  # noqa: F401

pytestmark = pytest.mark.skipif(not os.getenv('TEST_POSTGRES_ADMIN_URL'), reason='PostgreSQL jetable explicitement requis')
TZ = ZoneInfo('Africa/Algiers')
SOC = 'SOCIETE PG ROTATIONS'


def test_two_expected_agents_are_identical_across_engine_api_pointeur_and_beo(pg_database, monkeypatch):
    url, engine = pg_database
    result = alembic(url, 'upgrade', 'head'); assert result.returncode == 0, result.stderr
    import app.main  # noqa: F401
    from fastapi.testclient import TestClient
    from app.core.security import hash_password
    from app.db.session import get_db
    from app.main import app
    from app.modules.attendance import core, live
    from app.modules.auth.models import User
    from app.modules.drh.models import Employee
    from app.modules.ops.models import Assignment, Site
    from app.modules.rotations import service, views
    from app.modules.rotations.models import RotationDraft

    tag = uuid.uuid4().hex[:8]
    effective = datetime.now(TZ).date() + timedelta(days=1)
    with Session(engine) as db:
        site = Site(name=f'Site PG {tag}', active=1, equipment_plan={'societe': SOC}); db.add(site); db.flush()
        staff = {}
        for group, count in (('A', 1), ('B', 2), ('C', 1), ('D', 1)):
            for n in range(count):
                e = Employee(code=f'PG{tag}{group}{n}', first_name='Synthétique', last_name=f'{group}{n}', society=SOC, status='actif')
                db.add(e); db.flush()
                db.add(Assignment(employee_id=e.id, site_id=site.id, group_code=group, start_date=effective - timedelta(days=30), active=1))
                staff.setdefault(group, []).append(e.id)
        for username, role, modules, sites in ((f'adm{tag}', 'admin', None, []), (f'beo{tag}', 'charge_effectifs_site', ['site_workforce'], [site.id])):
            db.add(User(username=username, full_name=username, role=role, access_level='H5' if role == 'admin' else 'H2',
                        authorized_societies=[SOC], authorized_structures=[], authorized_modules=modules, authorized_sites=sites,
                        authorized_actions=['read'] if role != 'admin' else None, global_society_access=role == 'admin',
                        password_hash=hash_password('pg-pass-1'), validation_password_hash=hash_password('x'), is_active=True))
        draft = RotationDraft(site_id=site.id, effective_from=effective, reason='Publication PG synthétique', created_by='test',
                              config=config('1/3', anchor=str(effective)))
        db.add(draft); db.flush()
        draft.simulation = service.simulate(db, draft, 30); db.commit()
        assert draft.simulation['valid'], draft.simulation['errors'][:3]
        published = service.publish(db, draft, SimpleNamespace(id=None, username='OPS PG', role='ops'), draft.simulation['context_hash'])
        db.commit()
        site_id, published_id, draft_id = site.id, published.id, draft.id

    at = datetime.combine(effective, datetime.min.time(), TZ) + timedelta(hours=23)      # Nuit B (16:30 → 08:00)
    with Session(engine) as db:
        slot = next(s for s in views.site_occurrences(db, site_id, effective) if s['shift'] == 'NUIT')
        assert (slot['group'], slot['configuration_id']) == ('B', published_id)
        engine_ids = service.expected_population(db, site_id, slot)
        simulated = next(s for s in db.get(RotationDraft, draft_id).simulation['slots'] if s['start'] == slot['start'])
        simulation_calendar = db.get(RotationDraft, draft_id).simulation['calendar']
        post = live.control_post(db, site_id, at)
        cover = views.coverage(db, {site_id}, effective, now=at, shift_kind='NUIT')['rows'][0]
    expected = set(staff['B'])
    assert engine_ids == expected and set(simulated['employee_ids']) == expected
    assert simulation_calendar['week_start'] == 6 and simulation_calendar['workdays'] == [6, 0, 1, 2, 3]
    assert post['kpi']['expected'] == 2 and {r['employee']['id'] for r in post['expected']} == expected
    assert cover['expected'] == 2
    key = service.occurrence_key(site_id, slot)
    assert post['current']['occurrence_id'] == cover['occurrence_id'] == key

    def override():
        with Session(engine) as session:
            yield session
    app.dependency_overrides[get_db] = override
    monkeypatch.setattr(core, '_now_local', lambda: at)
    try:
        with TestClient(app) as client:
            def token(username):
                response = client.post('/api/auth/login', json={'username': username, 'password': 'pg-pass-1'})
                assert response.status_code == 200, response.text
                return {'Authorization': 'Bearer ' + response.json()['access_token']}
            pointeur = client.get('/api/portal/attendance-live', params={'site_id': site_id}, headers=token(f'adm{tag}'))
            assert pointeur.status_code == 200, pointeur.text
            assert pointeur.json()['post']['kpi']['expected'] == 2
            assert pointeur.json()['post']['current']['occurrence_id'] == key
            beo = client.get('/api/site-workforce/attendance/coverage', params={'date': effective.isoformat(), 'shift': 'NUIT'},
                             headers=token(f'beo{tag}'))
            assert beo.status_code == 200, beo.text
            assert beo.json()['rows'][0]['expected'] == 2 and beo.json()['rows'][0]['occurrence_id'] == key
    finally:
        app.dependency_overrides.pop(get_db, None)
