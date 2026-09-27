"""Scoped operational employee reads and on-demand canonical raster photos.

List queries never hydrate Employee.extra. The recursive photo query walks JSON
inside the database and returns only presence flags for the selected page.
"""
import base64
import binascii
import hashlib
import re
from datetime import date
from urllib.parse import unquote, urlsplit

from fastapi import HTTPException, Request, Response
from sqlalchemy import String, and_, bindparam, case, cast, func, or_, select, text
from sqlalchemy.orm import Session

from app.core import photo_storage
from app.core.config import settings
from app.core.pagination import normalize_page
from app.core.scope_policy import SocietyScopeError, effective_society_values, society_key
from app.modules.drh.models import Employee, EmployeeBlacklistEntry, Leave
from app.modules.materiel.models import StockMovement
from app.modules.erp.service import unrestricted_scope
from app.modules.ops.models import Assignment, Site


OPERATIONAL_FIELDS = (
    "id", "code", "first_name", "last_name", "phone", "position", "society", "status",
    "contract_type", "recruit_date", "contract_end_date", "trial_end_date",
)


def _active_assignment_conditions():
    today = date.today()
    return (Assignment.active == 1, Assignment.start_date <= today,
            or_(Assignment.end_date.is_(None), Assignment.end_date >= today))


def _site_ids(user):
    if unrestricted_scope(user):
        return []
    return [int(v) for v in (user.authorized_sites or []) if str(v).strip().lstrip("-").isdigit()]


def employee_scope_conditions(db: Session, user, society=None):
    try:
        allowed = effective_society_values(user, society)
    except SocietyScopeError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    conditions = []
    if allowed is not None:
        wanted = {society_key(value) for value in allowed}
        # Labels only, not employee rows. This preserves the existing Unicode /
        # accents / whitespace scope semantics without a PostgreSQL extension.
        labels = [value for value in db.scalars(select(Employee.society).distinct())
                  if society_key(value) in wanted]
        conditions.append(Employee.society.in_(labels))
    sites = _site_ids(user)
    if sites:
        conditions.append(select(Assignment.id).where(
            Assignment.employee_id == Employee.id, Assignment.site_id.in_(sites),
            *_active_assignment_conditions()).exists())
    return conditions, sites


def canonical_photos(db: Session, employee_ids, *, content=False):
    """Newest photo key wins, including an explicit empty/null removal.

    This matches flatten_employee_extra's 60-level limit. Extra/documents remain
    database-local even for old records containing megabytes of embedded files.
    """
    if not employee_ids:
        return {}
    postgres = db.get_bind().dialect.name == "postgresql"
    if postgres:
        legacy = "node -> '_legacy'"
        object_test = "json_typeof(node -> '_legacy') = 'object'"
        present = "node -> 'photo' IS NOT NULL"
        scalar = "CASE WHEN json_typeof(node -> 'photo') = 'string' THEN node ->> 'photo' ELSE NULL END"
    else:
        legacy = "json_extract(node, '$._legacy')"
        object_test = "json_type(node, '$._legacy') = 'object'"
        present = "json_type(node, '$.photo') IS NOT NULL"
        scalar = "CASE WHEN json_type(node, '$.photo') = 'text' THEN json_extract(node, '$.photo') ELSE NULL END"
    value = ("CASE WHEN length(photo) <= :max_chars THEN photo ELSE NULL END" if content else
             "CASE WHEN photo IS NOT NULL AND trim(photo) <> '' THEN 1 ELSE 0 END")
    statement = text(f"""
        WITH RECURSIVE photo_nodes(employee_id, node, depth) AS (
            SELECT id, extra, 0 FROM employees WHERE id IN :employee_ids
            UNION ALL
            SELECT employee_id, {legacy}, depth + 1 FROM photo_nodes
            WHERE depth < 59 AND {object_test} AND NOT ({present})
        ), photo_values AS (
            SELECT employee_id, {scalar} AS photo FROM photo_nodes WHERE {present}
        )
        SELECT employee_id, {value} AS photo_value FROM photo_values
    """).bindparams(bindparam("employee_ids", expanding=True))
    params = {"employee_ids": list(employee_ids), "max_chars": settings.max_photo_upload_bytes * 4 // 3 + 1024}
    return dict(db.execute(statement, params).all())


def _operational_statement(db, user, society):
    conditions, authorized_sites = employee_scope_conditions(db, user, society)
    ranked = select(
        Assignment.id, Assignment.employee_id, Assignment.site_id, Assignment.position,
        Assignment.group_code, Assignment.start_date,
        func.row_number().over(partition_by=Assignment.employee_id, order_by=Assignment.id.desc()).label("rank"),
    ).where(*_active_assignment_conditions()).subquery("ops_current_assignment")
    visible = ranked.c.site_id.in_(authorized_sites) if authorized_sites else True
    site_id = case((visible, ranked.c.site_id), else_=None)
    site_name = case((visible, Site.name), else_=None)
    current_position = case((visible, ranked.c.position), else_=None)
    position = func.coalesce(func.nullif(current_position, ""), Employee.position, "")
    columns = [getattr(Employee, key) for key in OPERATIONAL_FIELDS]
    columns += [Employee.updated_at, Employee.created_at,
                Employee.extra["_legacy"]["id"].as_string().label("legacy_id"),
                site_id.label("assignment_site_id"), site_name.label("assignment_site_name"),
                case((visible, ranked.c.id), else_=None).label("assignment_id"),
                current_position.label("assignment_position"),
                case((visible, ranked.c.group_code), else_=None).label("assignment_group"),
                case((visible, ranked.c.start_date), else_=None).label("assignment_start"),
                case((visible, Site.client_name), else_=None).label("assignment_client"),
                case((visible, func.coalesce(Site.equipment_plan["_legacy"]["id"].as_string(),
                                            Site.equipment_plan["id"].as_string())), else_=None).label("legacy_site_id")]
    stmt = select(*columns).outerjoin(ranked, and_(ranked.c.employee_id == Employee.id, ranked.c.rank == 1))
    stmt = stmt.outerjoin(Site, Site.id == ranked.c.site_id).where(*conditions)
    return stmt, position, site_id, site_name


def read_operational_employees(db, user, *, society=None, page=None, page_size=25, q=None, mode=None,
                               site_id=None, sort="nom_asc", poste=None, situation=None,
                               recrut_from=None, recrut_to=None, birth_from=None, birth_to=None,
                               age_min=None, age_max=None, operational_requires_dotation=True,
                               operational_requires_pv=True):
    stmt, position, current_site, site_name = _operational_statement(db, user, society)
    # Full-scope options remain available when a later page is being displayed.
    postes = None
    if page is not None:
        postes = [value for value in db.scalars(stmt.with_only_columns(position).order_by(position).distinct()) if value]
    if site_id == "__none__":
        stmt = stmt.where(current_site.is_(None))
    elif site_id not in (None, ""):
        try:
            selected_site = int(site_id)
        except (TypeError, ValueError) as exc:
            raise HTTPException(status_code=422, detail="Site invalide") from exc
        # Filter the same current, scope-masked assignment that is displayed.
        # An older still-active assignment must not reveal another site's row.
        stmt = stmt.where(current_site == selected_site)
    if poste:
        stmt = stmt.where(position == poste)
    if recrut_from:
        stmt = stmt.where(Employee.recruit_date >= recrut_from)
    if recrut_to:
        stmt = stmt.where(or_(Employee.recruit_date.is_(None), Employee.recruit_date <= recrut_to))
    # These RH fields are deliberately absent from the OPS DTO. Preserve the
    # existing empty-value filter behavior, without granting extra RH access.
    if situation or birth_from or age_min is not None or age_max is not None:
        stmt = stmt.where(False)
    selected_mode = (mode or ("actifs" if page is not None else "all")).strip().casefold()
    status = func.lower(Employee.status)
    modes = {"actifs": ("actif", "active"), "active": ("actif", "active"), "actif": ("actif", "active"),
             "absents": ("absent",), "absence": ("absent",), "suspension": ("suspendu",),
             "suspendus": ("suspendu",), "sortant": ("sortant", "demissionne", "licencie"),
             "sortants": ("sortant", "demissionne", "licencie")}
    if selected_mode == "instance_affectation":
        stmt = stmt.where(current_site.is_(None), status.not_in(("sortant", "demissionne", "licencie", "archive")))
    elif selected_mode in {"conge", "maladie"}:
        sick = func.lower(Leave.leave_type) == "maladie"
        stmt = stmt.where(select(Leave.id).where(
            Leave.employee_id == Employee.id, Leave.status == "approuve",
            Leave.start_date <= date.today(), Leave.end_date >= date.today(),
            sick if selected_mode == "maladie" else ~sick).exists())
    elif selected_mode == "blacklist":
        stmt = stmt.where(or_(status.in_(("blacklist", "blackliste", "blacklisté")),
            select(EmployeeBlacklistEntry.id).where(EmployeeBlacklistEntry.employee_id == Employee.id,
                EmployeeBlacklistEntry.status == "active").exists()))
    elif selected_mode == "operationnels":
        stmt = stmt.where(status.in_(("actif", "active")), current_site.is_not(None))
        # Match the existing OPS list's rules without importing private RH/PV
        # metadata into the operational DTO. No PV flag is exposed by that DTO.
        if operational_requires_pv:
            stmt = stmt.where(False)
        elif operational_requires_dotation:
            stmt = stmt.where(select(StockMovement.id).where(StockMovement.employee_id == Employee.id,
                StockMovement.movement_type.in_(("sortie", "perte", "casse", "nouvelle_dotation",
                    "renouvellement_dotation", "dotation_pret", "dotation_pret_mission", "reforme"))).exists())
    elif selected_mode not in {"all", "tous", "recap"}:
        stmt = stmt.where(status.in_(modes.get(selected_mode, (selected_mode,))))
    if q and q.strip():
        haystack = func.lower(func.coalesce(Employee.code, "") + " " + func.coalesce(Employee.first_name, "") + " " +
                             func.coalesce(Employee.last_name, "") + " " + func.coalesce(Employee.phone, "") + " " +
                             func.coalesce(Employee.society, "") + " " + position + " " + func.coalesce(site_name, "") + " " +
                             func.coalesce(cast(Employee.recruit_date, String), "") + " " + func.coalesce(Employee.status, ""))
        stmt = stmt.where(haystack.contains(q.strip().lower(), autoescape=True))
    key, _, direction = (sort or "nom_asc").rpartition("_")
    sort_fields = {"nom": func.lower(func.coalesce(Employee.last_name, "") + " " + func.coalesce(Employee.first_name, "")),
                   "mat": Employee.code, "societe": Employee.society, "poste": position, "site": site_name,
                   "statut": Employee.status, "recrut": Employee.recruit_date}
    order = sort_fields.get(key, Employee.last_name)
    if key == "mat":
        # Employee codes grow past two digits (K99 -> K100). Match the UI's
        # natural sort without casting arbitrary legacy codes to integers.
        prefix = func.rtrim(func.coalesce(Employee.code, ""), "0123456789")
        suffix = func.substr(Employee.code, func.length(prefix) + 1)
        orders = (prefix, func.length(suffix), suffix)
    else:
        orders = (order,)
    stmt = stmt.order_by(*(value.desc().nulls_last() if direction == "desc" else value.asc().nulls_first()
                           for value in orders), Employee.id.asc())
    if page is not None:
        page, page_size = normalize_page(page, page_size)
        total = int(db.scalar(select(func.count()).select_from(stmt.order_by(None).subquery())) or 0)
        pages = max((total + page_size - 1) // page_size, 1)
        page = min(page, pages)
        stmt = stmt.offset((page - 1) * page_size).limit(page_size)
    rows = db.execute(stmt).mappings().all()
    photos = canonical_photos(db, [row["id"] for row in rows])
    items = []
    for row in rows:
        item = {key: row[key] for key in OPERATIONAL_FIELDS}
        assignment = {}
        if row["assignment_site_id"] is not None:
            assignment = {"siteId": row["legacy_site_id"] or f"st_{row['assignment_site_id']}",
                          "siteName": row["assignment_site_name"] or "", "siteBackendId": row["assignment_site_id"],
                          "clientName": row["assignment_client"] or "", "groupe": row["assignment_group"] or "",
                          "poste": row["assignment_position"] or "", "dateDebut": row["assignment_start"].isoformat() if row["assignment_start"] else "",
                          "assignmentBackendId": row["assignment_id"]}
        item["extra"] = {"_legacy": {"id": row["legacy_id"] or str(row["id"]), "affectationCourante": assignment}}
        item["has_photo"] = bool(photos.get(row["id"]))
        version = row["updated_at"] or row["created_at"]
        item["photo_url"] = f"/api/ops/employees/{row['id']}/photo?v={version.isoformat() if version else '0'}" if item["has_photo"] else ""
        items.append(item)
    if page is None:
        return items
    return {"items": items, "total": total, "page": page, "page_size": page_size, "pages": pages,
            "filters": {"postes": postes}}


def _raster_type(content):
    if content.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if content.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if content.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif"
    if content[:4] == b"RIFF" and content[8:12] == b"WEBP":
        return "image/webp"
    if content.startswith(b"BM"):
        return "image/bmp"
    if content[4:8] == b"ftyp" and any(brand in content[8:32] for brand in (b"avif", b"avis")):
        return "image/avif"
    return None


def employee_photo_response(db, user, employee_id: int, request: Request):
    conditions, _ = employee_scope_conditions(db, user)
    if db.scalar(select(Employee.id).where(Employee.id == employee_id, *conditions)) is None:
        raise HTTPException(status_code=404, detail="Photo introuvable")
    reference = canonical_photos(db, [employee_id], content=True).get(employee_id)
    if not isinstance(reference, str) or not reference.strip():
        raise HTTPException(status_code=404, detail="Photo introuvable")
    reference = reference.strip()
    maximum = settings.max_photo_upload_bytes
    if reference.startswith("/uploads/photos/"):
        try:
            parsed = urlsplit(reference)
            relative = unquote(parsed.path[len("/uploads/photos/"):])
            root = photo_storage.PHOTOS_DIR.resolve()
            path = (root / relative).resolve()
            path.relative_to(root)
        except (ValueError, OSError, RuntimeError) as exc:
            raise HTTPException(status_code=404, detail="Photo introuvable") from exc
        if (path == root or photo_storage.DOCS_DIR.resolve() in path.parents
                or (root / "docs").resolve() in path.parents or not path.is_file()):
            raise HTTPException(status_code=404, detail="Photo introuvable")
        try:
            if path.stat().st_size > maximum:
                raise HTTPException(status_code=404, detail="Photo introuvable")
            content = path.read_bytes()
        except OSError as exc:
            raise HTTPException(status_code=404, detail="Photo introuvable") from exc
    elif reference.startswith("data:image/") or (len(reference) > 500 and not reference.startswith(("/", "http:" , "https:"))):
        encoded = re.sub(r"^data:image/[^;]+;base64,", "", reference, flags=re.IGNORECASE)
        try:
            content = base64.b64decode(encoded, validate=True)
        except (ValueError, binascii.Error) as exc:
            raise HTTPException(status_code=404, detail="Photo introuvable") from exc
    else:
        raise HTTPException(status_code=404, detail="Photo introuvable")
    mime = _raster_type(content)
    if not mime or not content or len(content) > maximum:
        raise HTTPException(status_code=404, detail="Photo introuvable")
    etag = '"' + hashlib.sha256(content).hexdigest() + '"'
    headers = {"Cache-Control": "private, no-cache", "ETag": etag, "Vary": "Authorization",
               "X-Content-Type-Options": "nosniff"}
    if any(value.strip().removeprefix("W/") in {etag, "*"} for value in request.headers.get("if-none-match", "").split(",")):
        return Response(status_code=304, headers=headers)
    return Response(content=content, media_type=mime, headers=headers)
