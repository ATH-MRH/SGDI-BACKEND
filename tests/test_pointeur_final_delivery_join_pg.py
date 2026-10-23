"""Livraison Pointeur depuis l'état réel de production : base en 20261017_0003 (main avec le journal
du lot exceptionnel d'import des contrats, le recrutement et le code officiel des sites), peuplée, puis
migrée jusqu'à la jonction 20261023_0001.

Données entièrement fictives. Exécuté uniquement si TEST_POSTGRES_ADMIN_URL désigne un serveur
PostgreSQL JETABLE."""
import os
from datetime import datetime

import pytest
import sqlalchemy as sa

from tests.test_facial_device_authorizations_migration_pg import pg_database  # noqa: F401
from tests.test_pointeur_badges_merge_pg import seed_badges
from tests.test_pointeur_iron_emploi_merge_pg import alembic, ok, revisions, seed_emploi, snapshot

pytestmark = pytest.mark.skipif(not os.getenv('TEST_POSTGRES_ADMIN_URL'), reason='PostgreSQL jetable requis')

# FINAL : tête actuelle (jonction 20261023_0001 puis champs Fiche de position BEO 20261024_0001).
PRODUCTION, FINAL = '20261017_0003', '20261025_0001'


def seed_contract_import_grant(engine):
    with engine.begin() as db:
        db.execute(sa.text(
            "INSERT INTO drh_contract_import_oneoff_grants (batch_key, session_id, file_sha256, authorized_by_user_id, "
            "authorized_by_username, authorized_at, candidate_ids, reason, preparation) VALUES "
            "('lot-fictif', 'session-fictive', :sha, 1, 'FICTIF', :at, '[1, 2]', 'Essai fictif', '{}')"),
            {"sha": "0" * 64, "at": datetime(2026, 10, 15, 12, 0)})


def test_production_state_joins_the_pointeur_delivery_without_loss(pg_database):
    url, engine = pg_database
    ok(alembic(url, 'upgrade', PRODUCTION))
    assert revisions(engine) == {PRODUCTION}
    seed_emploi(engine)
    seed_badges(engine)
    seed_contract_import_grant(engine)
    before = snapshot(engine)
    with engine.connect() as db:
        old_models = db.execute(sa.text('SELECT row_to_json(r)::text FROM rotation_templates r ORDER BY id')).scalars().all()

    ok(alembic(url, 'upgrade', 'head'))
    after = snapshot(engine)
    assert revisions(engine) == {FINAL}
    assert set(after) == set(before) | {'facial_device_authorizations', 'user_field_permissions'}  # tables ajoutées, vides
    assert {table: after[table] for table in before if table != 'rotation_templates'} == {table:value for table,value in before.items() if table != 'rotation_templates'}
    with engine.connect() as db:
        assert db.execute(sa.text("SELECT row_to_json(r)::text FROM rotation_templates r WHERE code != '3X8-FIXED-ABCD-V7' ORDER BY id")).scalars().all() == old_models
        assert db.scalar(sa.text("SELECT COUNT(*) FROM rotation_templates WHERE code='3X8-FIXED-ABCD-V7'")) == 1
    ok(alembic(url, 'upgrade', 'head'))                                        # rejouable
    assert snapshot(engine) == after


def test_facial_branch_rollback_returns_exactly_to_the_production_state(pg_database):
    url, engine = pg_database
    ok(alembic(url, 'upgrade', PRODUCTION))
    seed_badges(engine)
    seed_contract_import_grant(engine)
    before = snapshot(engine)
    ok(alembic(url, 'upgrade', 'head'))

    ok(alembic(url, 'downgrade', '20261017_0001@20261014_0001'))              # table faciale vide : retirée
    assert revisions(engine) == {PRODUCTION} and snapshot(engine) == before
    ok(alembic(url, 'upgrade', 'head'))
    assert revisions(engine) == {FINAL}

    with engine.begin() as db:                                                 # une autorisation saisie : refus
        user = db.execute(sa.text("SELECT id FROM users ORDER BY id LIMIT 1")).scalar_one()
        from app.modules.biometrics.models import Camera
        from app.modules.ops.models import Site
        site = db.execute(Site.__table__.insert().values(name="Site fictif", active=1).returning(Site.id)).scalar_one()
        camera = db.execute(Camera.__table__.insert().values(name="Cam fictive", manufacturer="X", model="Y", adapter="DAHUA", society="Fictive",
                                                             site_id=site, host="camera.example.invalid", active=False,
                                                             facial_attendance_enabled=False).returning(Camera.id)).scalar_one()
        db.execute(sa.text("INSERT INTO facial_device_authorizations (user_id, camera_id) VALUES (:u, :c)"), {"u": user, "c": camera})
    denied = alembic(url, 'downgrade', '20261017_0001@20261014_0001')
    assert denied.returncode != 0 and 'Downgrade refusé' in denied.stdout + denied.stderr
    assert revisions(engine) == {FINAL}
    with engine.connect() as db:
        assert db.execute(sa.text("SELECT count(*) FROM facial_device_authorizations")).scalar_one() == 1
