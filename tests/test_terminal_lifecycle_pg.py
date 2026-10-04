"""Real terminal lifecycle races on a disposable PostgreSQL database."""
import os
import threading
import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, select, func
from sqlalchemy.orm import sessionmaker

URL = os.getenv('ATTENDANCE_PG_URL')
pytestmark = pytest.mark.skipif(not URL, reason='Disposable ATTENDANCE_PG_URL required')

@pytest.fixture(scope='module')
def sessions():
    import app.main
    from app.db.base import Base
    engine = create_engine(URL)
    Base.metadata.create_all(engine)
    yield sessionmaker(bind=engine)
    engine.dispose()

def setup_terminal(sessions):
    from app.modules.auth.models import User
    from app.modules.ops.models import Site
    from app.modules.biometrics.routes import add_terminal, TerminalIn
    with sessions() as db:
        tag = uuid.uuid4().hex
        user = User(username='T'+tag, full_name='Race admin', role='ADMIN', password_hash='unused', is_active=True, global_society_access=True)
        site = Site(name='Race '+tag, active=1, equipment_plan={'societe':'RACE'})
        db.add_all([user,site]); db.commit()
        payload = TerminalIn(name='SMARTPHONE HAMOUL 01', terminal_type='SMARTPHONE_ANDROID', site_id=site.id)
        row = add_terminal(payload, db, user)
        return user.id, row, payload

def race(sessions, user_id, operations):
    from app.modules.auth.models import User
    barrier = threading.Barrier(len(operations))
    results, errors = [], []
    def worker(operation):
        with sessions() as db:
            user = db.get(User,user_id); barrier.wait()
            try: results.append((200,operation(db,user)))
            except HTTPException as e: db.rollback(); results.append((e.status_code,None))
            except Exception as e: errors.append(e)
    threads = [threading.Thread(target=worker,args=(fn,)) for fn in operations]
    for thread in threads: thread.start()
    for thread in threads: thread.join(timeout=30); assert not thread.is_alive()
    assert not errors, errors
    return results

@pytest.mark.parametrize('scenario',['double_delete','delete_revoke','delete_create','duplicate_create'])
def test_terminal_races(sessions, scenario):
    from app.modules.biometrics.routes import delete_terminal, revoke_terminal, add_terminal, TerminalDeleteIn, RevokeIn
    from app.modules.biometrics.models import BiometricTerminal
    from app.modules.auth.models import AuditEvent,User
    uid,old,payload = setup_terminal(sessions)
    delete = lambda db,user: delete_terminal(old['id'],TerminalDeleteIn(reason='Race'),db,user)
    if scenario == 'duplicate_create':
        payload.name += ' SECOND'
        operations = [lambda db,user: add_terminal(payload,db,user)]*2
    elif scenario == 'double_delete': operations = [delete,delete]
    elif scenario == 'delete_revoke': operations = [delete,lambda db,user: revoke_terminal(old['id'],RevokeIn(reason='Race revoke'),db,user)]
    else: operations = [delete,lambda db,user: add_terminal(payload,db,user)]
    results = race(sessions,uid,operations)
    if scenario == 'double_delete': assert [code for code,_ in results] == [200,200]
    if scenario == 'duplicate_create': assert sorted(code for code,_ in results) == [200,409]
    with sessions() as db:
        original = db.get(BiometricTerminal,old['id'])
        if scenario != 'duplicate_create':
            assert original.deleted_at and not original.enabled and original.public_key is None and original.pairing_code_hash is None
            assert db.scalar(select(func.count(AuditEvent.id)).where(AuditEvent.resource_id == str(original.id), AuditEvent.action == 'biometrics.terminal.delete')) == 1
        if scenario == 'delete_create':
            live = db.scalar(select(BiometricTerminal).where(BiometricTerminal.site_id==payload.site_id,BiometricTerminal.name==payload.name,BiometricTerminal.deleted_at.is_(None)))
            if live is None:
                new = add_terminal(payload,db,db.get(User,uid)); live = db.get(BiometricTerminal,new['id'])
            assert live.id != original.id and live.public_id != original.public_id
        if scenario == 'delete_revoke': assert all(code in (200,404,409) for code,_ in results)
