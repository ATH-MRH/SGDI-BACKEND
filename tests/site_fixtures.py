"""Seed historical sites for tests of editing/assignments, not creation endpoints.

New production sites must be published by DC. Tests exercising that workflow use
/api/commercial/dc/clients/{id}/contract directly.
"""
import httpx
from app.db.session import get_db
from app.modules.ops.models import Site
from app.modules.ops.schemas import SiteOut, SiteCreate


def historical_site(client, *, headers=None, json):
    provider = client.app.dependency_overrides.get(get_db, get_db)()
    db = next(provider)
    try:
        row = Site(**SiteCreate(**json).model_dump())
        db.add(row); db.commit(); db.refresh(row)
        return httpx.Response(200, json=SiteOut.model_validate(row).model_dump(mode='json'))
    finally:
        provider.close()


def historical_portal_site(client, client_id, payload):
    from app.modules.client_portal import service
    from app.modules.client_portal.schemas import SiteCreateIn
    provider = client.app.dependency_overrides.get(get_db, get_db)()
    db = next(provider)
    try:
        return httpx.Response(201, json=service.create_site_for_client(db, client_id, SiteCreateIn(**payload)))
    finally:
        provider.close()


def historical_legacy_site(client, *, headers, json):
    item = dict(json['data'])
    row = historical_site(client, json={'name':item.get('nom') or 'Historical site'}).json()
    item['backendId'] = row['id']
    return client.post('/api/irongs/collections/sites/items',headers=headers,json={'data':item})
