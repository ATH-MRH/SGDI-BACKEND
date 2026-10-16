"""File push : persistance, reprises bornées, tickets, reçus et changements d'espace."""
import asyncio
from datetime import datetime, timedelta

import pytest
from app.modules import recruitment_engage_service as engage
from app.modules import recruitment_push_worker as worker
from app.modules.recruitment_engage_models import RecruitmentNotification as Notification, RecruitmentPushDevice as Device, RecruitmentPushDelivery as Delivery
from tests.test_recruitment_jobs_api import apply, clean, publish, securite, session  # noqa: F401 — fixtures partagées

API='/api/public/emploi'


@pytest.fixture(autouse=True)
def no_real_network(monkeypatch):
    """Garde-fou : aucun test de ce fichier ne joint le vrai service Expo ; chaque test qui envoie remplace `post`."""
    monkeypatch.setattr(worker, 'post', lambda *args: pytest.fail('appel réseau réel vers Expo'))


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


def _no_network(monkeypatch):
    monkeypatch.setattr(worker, 'post', lambda *args: pytest.fail('aucun envoi attendu'))


def test_deleting_the_space_drops_its_queue_and_keeps_transmitted_snapshots(client, db, securite, monkeypatch):
    """Suppression de l'espace : rien de ce qui était en file ne part, en attente ou en reprise programmée. Les
    candidatures transmises restent au service recrutement avec leur copie du profil, sans suppression implicite."""
    headers, notification, row = queued(client, db, monkeypatch)
    from app.modules.recruitment_jobs_models import RecruitmentApplication
    sent = []
    monkeypatch.setattr(worker, 'post', lambda url, body: sent.extend(body) or {'data': [{'status': 'ok', 'id': f'ticket-{i}'} for i, _ in enumerate(body)]})
    offer = publish(client, securite)                                                           # nouvelle offre : envoyée à ce téléphone
    application_id = apply(client, headers, offer['id'], profile={'address': 'Adresse transmise', 'wilaya': 'Alger'}).json()['application_id']
    retry = engage.notify(db, notification.account_id, 'message', 'Message', 'Nouveau message')
    db.commit()
    later = db.query(Delivery).filter(Delivery.notification_id == retry.id).one()
    later.attempts, later.next_at = 1, datetime.utcnow() + timedelta(seconds=30)               # reprise programmée
    db.commit()
    queue, notification_id = [row.id, later.id], notification.id
    assert [m['data']['kind'] for m in sent] == ['offer'] and row.state == 'pending'             # rien d'autre n'est parti
    assert client.delete(f'{API}/me', headers=headers).status_code == 204
    db.expire_all()
    _no_network(monkeypatch)
    assert worker.dispatch(db) == 0 and worker.dispatch(db, now=datetime.utcnow() + timedelta(minutes=5)) == 0
    assert db.query(Delivery).filter(Delivery.id.in_(queue)).count() == 0 and db.query(Notification).filter(Notification.id == notification_id).count() == 0
    kept = db.get(RecruitmentApplication, application_id)
    assert kept.account_id is None and kept.profile_snapshot['data']['adresse'] == 'Adresse transmise'


@pytest.mark.parametrize('one_phone', [True, False])
def test_an_unregistered_phone_receives_nothing_still_pending(client, db, monkeypatch, one_phone):
    """Désinscription (ce téléphone à la déconnexion, ou tous les appareils) : la ligne en file est écartée."""
    headers, notification, row = queued(client, db, monkeypatch)
    params = {'token': 'ExponentPushToken[test-queue]'} if one_phone else None
    assert client.delete(f'{API}/me/push-device', headers=headers, params=params).status_code == 204
    db.expire_all()
    _no_network(monkeypatch)
    assert worker.dispatch(db) == 0
    assert (row.state, row.device_id, row.error_code) == ('skipped', None, 'unregistered_or_disabled')
    assert db.get(Notification, notification.id) is not None                                 # la notification reste dans l'espace


def test_a_phone_moved_to_another_space_never_gets_the_previous_space_queue(client, db, monkeypatch):
    """Changement d'espace : ni l'envoi en attente ni une reprise programmée de l'ancien espace ne partent ;
    les notifications du nouvel espace, elles, partent normalement."""
    _, _, row = queued(client, db, monkeypatch)
    row.attempts, row.next_at = 1, datetime.utcnow() + timedelta(seconds=30)
    db.commit()
    other, _ = session(client, phone='0661122334', first_name='Karim', last_name='Emploi-Deux')
    client.put(API + '/me/push-device', headers=other, json={'token': 'ExponentPushToken[test-queue]', 'platform': 'android'})
    device = db.query(Device).one()
    db.refresh(device)
    fresh = engage.notify(db, device.account_id, 'application', 'Candidature', 'Nouvel espace')
    db.commit()
    seen = []
    monkeypatch.setattr(worker, 'post', lambda url, body: seen.extend(body) or {'data': [{'status': 'ok', 'id': f'ticket-{i}'} for i, _ in enumerate(body)]})
    worker.dispatch(db, now=datetime.utcnow() + timedelta(minutes=1))
    assert [message['data']['notification_id'] for message in seen] == [fresh.id]
    assert row.state == 'skipped'


def test_the_background_loop_survives_a_failed_round_and_stops_cleanly(monkeypatch):
    """Un tour en échec n'arrête pas la boucle ; l'arrêt annule la tâche, et un nouveau démarrage reprend la file."""
    rounds, pause = [], asyncio.sleep

    def run_once():
        rounds.append(len(rounds))
        if len(rounds) == 1:
            raise RuntimeError('base indisponible')

    async def quick(_seconds):
        await pause(0)

    async def scenario():
        monkeypatch.setenv('RECRUITMENT_PUSH_ENABLED', 'true')
        monkeypatch.setattr(worker, 'run_once', run_once)
        monkeypatch.setattr(worker.asyncio, 'sleep', quick)
        worker.start_worker()
        while len(rounds) < 3:
            await quick(0)
        task = worker._task
        worker.stop_worker()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert worker._task is None
        stopped_at = len(rounds)
        worker.start_worker()
        while len(rounds) <= stopped_at:
            await quick(0)
        worker.stop_worker()

    asyncio.run(scenario())
    assert len(rounds) > 3

