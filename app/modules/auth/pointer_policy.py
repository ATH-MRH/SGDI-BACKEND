"""Central pointer accounts must always have an explicit, consistent scope."""
from fastapi import HTTPException
from sqlalchemy import select
from app.core.scope_policy import society_key


def validate_pointer_scope(db, *, role, societies, sites, global_society_access, status_code=422):
    if str(role or '').lower() != 'pointeur':
        return
    from app.modules.ops.models import Site
    from app.modules.ops.routes import _site_society
    keys = {society_key(value) for value in societies or [] if society_key(value)}
    ids = set(sites or [])
    if global_society_access or not keys or not ids:
        raise HTTPException(status_code, 'Un pointeur exige des sociétés et des sites explicites, sans accès global')
    rows = db.scalars(select(Site).where(Site.id.in_(ids))).all()
    if len(rows) != len(ids) or any(society_key(_site_society(row)) not in keys for row in rows):
        raise HTTPException(status_code, 'Sites et sociétés du pointeur incohérents')
