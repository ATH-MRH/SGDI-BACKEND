from __future__ import annotations

from typing import Any, Iterable

from sqlalchemy import String, cast, func, or_, select
from sqlalchemy.orm import Session


def normalize_page(page: int | None, page_size: int | None) -> tuple[int, int]:
    safe_page = max(int(page or 1), 1)
    safe_size = min(max(int(page_size or 25), 5), 100)
    return safe_page, safe_size


def paginate_statement(
    db: Session,
    stmt: Any,
    *,
    model: Any,
    search_fields: Iterable[Any] | None = None,
    q: str | None = None,
    page: int | None = 1,
    page_size: int | None = 25,
    order_by: Any | None = None,
) -> dict[str, Any]:
    query = str(q or "").strip()
    fields = list(search_fields or [])
    if query and fields:
        pattern = f"%{query}%"
        stmt = stmt.where(or_(*(cast(field, String).ilike(pattern) for field in fields)))

    safe_page, safe_size = normalize_page(page, page_size)
    count_stmt = select(func.count()).select_from(stmt.order_by(None).subquery())
    total = int(db.scalar(count_stmt) or 0)
    pages = max((total + safe_size - 1) // safe_size, 1)
    if safe_page > pages:
        safe_page = pages

    if order_by is None and hasattr(model, "id"):
        order_by = model.id.desc()
    if order_by is not None:
        stmt = stmt.order_by(order_by)

    rows = db.execute(stmt.offset((safe_page - 1) * safe_size).limit(safe_size)).scalars().all()
    return {"items": rows, "total": total, "page": safe_page, "page_size": safe_size, "pages": pages}


def paginate_list(items: list[Any], *, page: int | None = 1, page_size: int | None = 25) -> dict[str, Any]:
    safe_page, safe_size = normalize_page(page, page_size)
    total = len(items)
    pages = max((total + safe_size - 1) // safe_size, 1)
    if safe_page > pages:
        safe_page = pages
    start = (safe_page - 1) * safe_size
    return {"items": items[start:start + safe_size], "total": total, "page": safe_page, "page_size": safe_size, "pages": pages}
