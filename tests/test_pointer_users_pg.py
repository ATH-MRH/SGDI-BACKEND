"""Concurrent central pointer creation with real PostgreSQL sessions."""
import os
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi import HTTPException
from starlette.requests import Request
from sqlalchemy import create_engine,select,func
from sqlalchemy.orm import sessionmaker

URL=os.getenv('ATTENDANCE_PG_URL')
pytestmark=pytest.mark.skipif(not URL,reason='Disposable PostgreSQL ATTENDANCE_PG_URL required')


def test_same_identifier_concurrently_creates_one_user_and_one_audit():
    import app.main
    from app.db.base import Base
    from app.modules.auth.models import User,AuditEvent,UserFeaturePermission
    from app.modules.ops.models import Site
    from app.modules.attendance.pointer_users import add_pointer,PointerCreate
    engine=create_engine(URL)
    Base.metadata.create_all(engine);Session=sessionmaker(bind=engine)
    tag=uuid.uuid4().hex[:12].upper()
    try:
        with Session() as db:
            manager=User(username='ADMIN'+tag,full_name='Admin race',role='ADMIN',password_hash='unused',is_active=True,global_society_access=True)
            site=Site(name='Pointer race '+tag,active=1,equipment_plan={'societe':'RACE'})
            db.add_all([manager,site]);db.commit();uid,site_id=manager.id,site.id
        barrier=threading.Barrier(2)
        def create(index):
            with Session() as db:
                manager=db.get(User,uid)
                payload=PointerCreate(username=('ptg' if index else 'PTG')+tag,full_name='Pointeur race',password='PG-Pointer-test-1234',societies=['RACE'],site_ids=[site_id])
                barrier.wait()
                try:
                    value=add_pointer(payload,Request({'type':'http','path':'/api/attendance/pointers','headers':[],'client':('127.0.0.1',0)}),db,manager)
                    return 200,value['id']
                except HTTPException as e:
                    db.rollback();return e.status_code,None
        with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(create,range(2)))
        assert sorted(code for code,_ in results)==[200,409]
        with Session() as db:
            users=list(db.scalars(select(User).where(User.username=='PTG'+tag)))
            assert len(users)==1
            assert db.scalar(select(func.count(AuditEvent.id)).where(AuditEvent.resource_id==str(users[0].id),AuditEvent.action=='pointer_user.created'))==1
            assert db.scalar(select(func.count(UserFeaturePermission.id)).where(UserFeaturePermission.user_id==users[0].id))==4
    finally:
        engine.dispose()
