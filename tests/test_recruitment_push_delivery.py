"""File push : persistance, reprises bornées, tickets, reçus et changements d'espace."""
from datetime import datetime, timedelta
import pytest
from app.modules import recruitment_engage_service as engage
from app.modules import recruitment_push_worker as worker
from app.modules.recruitment_engage_models import RecruitmentNotification as Notification, RecruitmentPushDevice as Device, RecruitmentPushDelivery as Delivery
from tests.test_recruitment_jobs_api import clean, session

API='/api/public/emploi'


def queued(client,db,monkeypatch):
    headers,_=session(client)
    client.put(API+'/me/push-device',headers=headers,json={'token':'ExponentPushToken[test-queue]','platform':'android'})
    monkeypatch.setenv('RECRUITMENT_PUSH_ENABLED','true')
    device=db.query(Device).one()
    row=engage.notify(db,device.account_id,'application','Candidature','Mise à jour')
    db.commit()
    return headers,row,db.query(Delivery).one()


def test_committed_notification_survives_missing_immediate_send(client,db,monkeypatch):
    _,notification,row=queued(client,db,monkeypatch)
    assert row.state=='pending'
    seen=[]
    monkeypatch.setattr(worker,'post',lambda url,body: seen.append(body) or {'data':[{'status':'ok','id':'ticket-one'}]})
    assert worker.dispatch(db)==1
    assert worker.dispatch(db)==0 and len(seen)==1
    assert row.state=='accepted' and row.ticket_id=='ticket-one'
    assert seen[0][0]['data']['notification_id']==notification.id
    monkeypatch.setattr(worker,'post',lambda url,body: {'data':{'ticket-one':{'status':'ok'}}})
    worker.receipts(db,now=datetime.utcnow()+timedelta(minutes=16))
    assert row.state=='provider_accepted'  # pas une preuve de livraison au téléphone


def test_retry_is_delayed_and_bounded(client,db,monkeypatch):
    _,_,row=queued(client,db,monkeypatch)
    def fail(*args): raise TimeoutError()
    monkeypatch.setattr(worker,'post',fail)
    now=datetime.utcnow()
    assert worker.dispatch(db,now=now)==0 and row.attempts==1
    assert worker.dispatch(db,now=now)==0 and row.attempts==1
    for _ in range(3): worker.dispatch(db,now=row.next_at+timedelta(seconds=1))
    assert row.attempts==4 and row.state=='failed'


def test_invalid_or_missing_tickets_are_not_success(client,db,monkeypatch):
    _,_,row=queued(client,db,monkeypatch)
    monkeypatch.setattr(worker,'post',lambda *args: {'data':[]})
    assert worker.dispatch(db)==0
    assert row.state=='pending' and row.error_code=='invalid_ticket'


@pytest.mark.parametrize('at_receipt',[False,True])
def test_unregistered_device_is_removed_without_losing_notification(client,db,monkeypatch,at_receipt):
    _,notification,row=queued(client,db,monkeypatch)
    if at_receipt:
        row.state,row.ticket_id='accepted','ticket-dead'
        row.next_at=datetime.utcnow()-timedelta(seconds=1)
        db.commit()
        monkeypatch.setattr(worker,'post',lambda *args:{'data':{'ticket-dead':{'status':'error','details':{'error':'DeviceNotRegistered'}}}})
        worker.receipts(db)
    else:
        monkeypatch.setattr(worker,'post',lambda *args:{'data':[{'status':'error','details':{'error':'DeviceNotRegistered'}}]})
        assert worker.dispatch(db)==0
    db.expire_all()
    assert row.state=='failed' and row.device_id is None
    assert db.query(Device).count()==0 and db.get(Notification,notification.id) is not None


def test_receipt_timeout_stays_unknown_not_delivered(client,db,monkeypatch):
    _,_,row=queued(client,db,monkeypatch)
    row.state,row.ticket_id='accepted','missing'
    db.commit()
    monkeypatch.setattr(worker,'post',lambda *args:{'data':{}})
    worker.receipts(db,now=row.created_at+timedelta(hours=23))
    assert row.state=='unknown' and row.error_code=='receipt_unavailable'


def test_device_reassigned_before_dispatch_is_skipped(client,db,monkeypatch):
    _,_,row=queued(client,db,monkeypatch)
    other,_=session(client,phone='0661122334',first_name='Karim',last_name='Emploi-Deux')
    client.put(API+'/me/push-device',headers=other,json={'token':'ExponentPushToken[test-queue]','platform':'android'})
    monkeypatch.setattr(worker,'post',lambda *args: pytest.fail('ancien espace : aucun envoi'))
    assert worker.dispatch(db)==0 and row.state=='skipped'


def test_disabled_push_preserves_queue_without_network(client,db,monkeypatch):
    _,_,row=queued(client,db,monkeypatch)
    monkeypatch.setenv('RECRUITMENT_PUSH_ENABLED','false')
    monkeypatch.setattr(worker,'post',lambda *args: pytest.fail('push désactivé'))
    assert worker.dispatch(db)==0 and row.state=='pending'
