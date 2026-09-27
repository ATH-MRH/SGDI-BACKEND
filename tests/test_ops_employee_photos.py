"""Canonical OPS photos: real HTTP, SQL pagination, scoped access and bounded payloads.

The 600-person fixture deliberately carries large private RH documents. A light
response alone is insufficient: SELECT instrumentation also rejects fetching those
blobs, and compares query counts for differently sized pages.
"""
from __future__ import annotations

import base64
import json
import re
import struct
import time
import uuid
import zlib
from contextlib import contextmanager
from datetime import date, datetime, timedelta
from urllib.parse import urlparse

import pytest
from sqlalchemy import delete, event

from app.core import photo_storage
from app.core.security import create_access_token
from app.modules.auth.models import User
from app.modules.drh.models import Employee
from app.modules.ops.models import Assignment, Site
from tests.conftest import TestSessionLocal, test_engine

PREFIX = "OPS-PHOTO-REGRESSION"
SOCIETIES = [f"{PREFIX} Sécurité", f"{PREFIX} Solution", f"{PREFIX} Services"]
PRIVATE_MARKER = "PRIVATE_RH_DOCUMENT_MUST_NEVER_REACH_OPS"


def _png(index: int) -> bytes:
    """A valid, distinct one-pixel PNG, using only the standard library."""
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
    pixel = bytes((index % 256, (index // 256) % 256, (index * 37) % 256))
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(b"\0" + pixel)) + chunk(b"IEND", b""))


def _headers(user_id):
    return {"Authorization": f"Bearer {create_access_token(str(user_id))}"}


@pytest.fixture(scope="module")
def population(create_tables):
    photo_storage.PHOTOS_DIR.mkdir(parents=True, exist_ok=True)
    session = TestSessionLocal()
    sites, people, files = [], [], []
    try:
        for company_index, society in enumerate(SOCIETIES):
            for site_index in range(2):
                site = Site(name=f"{PREFIX}-{company_index}-{site_index}", active=1,
                            equipment_plan={"societe": society, "dateOuverture": "2020-01-01"})
                session.add(site)
                session.flush()
                sites.append({"id": site.id, "society": society})
        for index in range(600):
            company = index // 200
            content = _png(index)
            extra = {"documents": {"private": {"url": PRIVATE_MARKER + "x" * 16_384}},
                     "private_note": PRIVATE_MARKER, "_legacy": {"id": f"old-{index}"}}
            has_photo = index % 3 != 2
            if index % 3 == 0:
                name = f"{PREFIX}-{index}.png"
                path = photo_storage.PHOTOS_DIR / name
                path.write_bytes(content)
                files.append(path)
                extra["photo"] = f"/uploads/photos/{name}"
            elif index % 3 == 1:
                extra["_legacy"]["photo"] = "data:image/png;base64," + base64.b64encode(content).decode()
            employee = Employee(code=f"{PREFIX}-{index:04d}", first_name=f"Prenom{index:04d}",
                                last_name=f"Nom{599-index:04d}", society=SOCIETIES[company],
                                status="absent" if index % 10 == 0 else "actif", position="Agent",
                                recruit_date=date(2020, 1, 1) + timedelta(days=index),
                                extra=extra, updated_at=datetime(2026, 1, 1))
            session.add(employee)
            session.flush()
            site = sites[company * 2 + index % 2]
            session.add(Assignment(employee_id=employee.id, site_id=site["id"], active=1,
                                   start_date=date(2020, 1, 1), group_code="A"))
            people.append({"id": employee.id, "code": employee.code, "last_name": employee.last_name,
                           "society": employee.society, "site_id": site["id"], "status": employee.status,
                           "recruit_date": employee.recruit_date.isoformat(), "photo": content if has_photo else None})
        users = {}
        for name, modules, societies, site_ids in [
            ("scoped", ["ops"], [SOCIETIES[0]], [sites[0]["id"]]),
            ("society", ["ops"], [SOCIETIES[0]], []),
            ("no_module", ["drh"], [SOCIETIES[0]], []),
            ("no_scope", ["ops"], [], []),
        ]:
            user = User(username=f"{PREFIX}-{name}", full_name="Photo regression", role="ops", access_level="H2",
                        authorized_modules=modules, authorized_societies=societies, authorized_sites=site_ids,
                        authorized_structures=[], password_hash="unused", is_active=True, global_society_access=False)
            session.add(user)
            session.flush()
            users[name] = _headers(user.id)
        session.commit()
        yield {"people": people, "by_id": {person["id"]: person for person in people}, "sites": sites, "headers": users}
    finally:
        session.rollback()
        ids = [person["id"] for person in people]
        if ids:
            session.execute(delete(Assignment).where(Assignment.employee_id.in_(ids)))
            session.execute(delete(Employee).where(Employee.id.in_(ids)))
        if sites:
            session.execute(delete(Site).where(Site.id.in_([site["id"] for site in sites])))
        session.execute(delete(User).where(User.username.like(f"{PREFIX}-%")))
        session.commit()
        session.close()
        for path in files:
            path.unlink(missing_ok=True)


def _page(client, headers, **params):
    response = client.get("/api/ops/employees/page", headers=headers,
                          params={"q": PREFIX, "mode": "all", "page_size": 25, **params})
    assert response.status_code == 200, response.text
    return response, response.json()


def _assert_light(row):
    assert isinstance(row["has_photo"], bool)
    assert "photo" not in row
    assert "documents" not in row
    # The old OPS assignment envelope remains an operational compatibility field.
    if "extra" in row:
        assert set(row["extra"]) <= {"_legacy"}
        assert set(row["extra"].get("_legacy", {})) <= {"id", "affectationCourante"}
    encoded = json.dumps(row)
    assert PRIVATE_MARKER not in encoded
    assert "data:image" not in encoded
    assert "base64" not in encoded


def _assert_identity(client, headers, row, expected):
    _assert_light(row)
    assert row["id"] == expected["id"]
    assert row["has_photo"] is bool(expected["photo"])
    if expected["photo"] is None:
        assert row.get("photo_url") in (None, "")
        return
    parsed = urlparse(row["photo_url"])
    assert not parsed.netloc
    assert parsed.path == f"/api/ops/employees/{expected['id']}/photo"
    image = client.get(row["photo_url"], headers=headers)
    assert image.status_code == 200, image.text
    assert image.content == expected["photo"], "photo belongs to a different employee"
    assert image.headers["content-type"].startswith("image/png")
    assert "private" in image.headers["cache-control"]
    assert "no-cache" in image.headers["cache-control"]
    assert image.headers.get("etag")


def test_population_all_pages_keep_sql_identity_and_light_photos(client, auth_headers, population):
    seen = []
    for page in range(1, 25):
        response, data = _page(client, auth_headers, page=page, sort="mat_asc")
        assert data["total"] == 600
        assert len(data["items"]) == 25
        assert len(response.content) < 25_000
        for row in data["items"]:
            expected = population["by_id"][row["id"]]
            _assert_identity(client, auth_headers, row, expected)
            seen.append(row["id"])
    assert seen == [person["id"] for person in population["people"]]
    assert len(set(seen)) == 600
    # Existing pagination contract clamps an out-of-range page to the last one.
    beyond = _page(client, auth_headers, page=25, sort="mat_asc")[1]
    assert beyond["page"] == 24
    assert [row["id"] for row in beyond["items"]] == seen[-25:]


@pytest.mark.parametrize("sort,field,reverse", [("nom_asc", "last_name", False), ("nom_desc", "last_name", True),
    ("mat_asc", "code", False), ("mat_desc", "code", True), ("recrut_asc", "recruit_date", False),
    ("recrut_desc", "recruit_date", True)])
def test_sort_search_society_site_and_page_preserve_photo_identity(client, auth_headers, population, sort, field, reverse):
    site = population["sites"][2]
    expected = [person for person in population["people"] if person["site_id"] == site["id"]]
    expected.sort(key=lambda row: row[field], reverse=reverse)
    _, data = _page(client, auth_headers, sort=sort, site_id=site["id"], society=site["society"], page=2)
    assert data["total"] == 100
    assert [row["id"] for row in data["items"]] == [row["id"] for row in expected[25:50]]
    for row in data["items"][:3]:
        _assert_identity(client, auth_headers, row, population["by_id"][row["id"]])
    target = expected[31]
    _, found = _page(client, auth_headers, q=target["code"], society=site["society"], sort=sort)
    assert found["total"] == 1
    _assert_identity(client, auth_headers, found["items"][0], target)


def test_status_filter_and_non_paginated_bootstrap_are_light(client, auth_headers, population):
    _, data = _page(client, auth_headers, mode="absents", page_size=100)
    expected = [row for row in population["people"] if row["status"] == "absent"]
    assert data["total"] == 60
    assert {row["id"] for row in data["items"]} == {row["id"] for row in expected}
    response = client.get("/api/ops/employees", headers=auth_headers, params={"society": SOCIETIES[0]})
    assert response.status_code == 200
    assert len(response.json()) == 200
    assert len(response.content) < 200_000
    for row in response.json():
        _assert_light(row)


def test_ops_module_society_and_site_scope_apply_to_both_json_and_images(client, population):
    people, headers = population["people"], population["headers"]
    allowed, other_site, other_society = people[0], people[1], people[201]
    for endpoint in ("/api/ops/employees", "/api/ops/employees/page", f"/api/ops/employees/{allowed['id']}/photo"):
        assert client.get(endpoint).status_code == 401
        assert client.get(endpoint, headers=headers["no_module"]).status_code == 403
        assert client.get(endpoint, headers=headers["no_scope"]).status_code == 403
    _, scoped = _page(client, headers["scoped"], page_size=200)
    assert scoped["total"] == 100
    assert {row["id"] for row in scoped["items"]} == {p["id"] for p in people if p["site_id"] == allowed["site_id"]}
    assert client.get(f"/api/ops/employees/{allowed['id']}/photo", headers=headers["scoped"]).content == allowed["photo"]
    for denied in (other_site, other_society):
        assert client.get(f"/api/ops/employees/{denied['id']}/photo", headers=headers["scoped"]).status_code in (403, 404)
    outside_site = client.get("/api/ops/employees/page", headers=headers["scoped"], params={"site_id": other_site["site_id"]})
    assert outside_site.status_code == 403 or (outside_site.status_code == 200 and outside_site.json()["items"] == [])
    assert client.get("/api/ops/employees/page", headers=headers["society"], params={"society": SOCIETIES[1]}).status_code == 403
    # Accent/case spelling changes must not silently empty or widen the scope.
    _, society = _page(client, headers["society"], society=SOCIETIES[0].replace("Sécurité", "securite"), page_size=200)
    assert society["total"] == 200
    assert all(row["society"] == SOCIETIES[0] for row in society["items"])


def _new_employee(db, extra, *, code=None):
    employee = Employee(code=code or f"PHOTO-CASE-{uuid.uuid4().hex[:12]}", first_name="Photo", last_name="Case",
                        society=SOCIETIES[0], status="actif", extra=extra, updated_at=datetime(2026, 1, 1))
    db.add(employee)
    db.commit()
    return employee


@pytest.mark.parametrize("assignment_state", ["inactive", "ended", "future"])
def test_historical_or_future_assignment_does_not_grant_site_photo_access(client, db, auth_headers, population, assignment_state):
    employee = _new_employee(db, {"photo": "data:image/png;base64," + base64.b64encode(_png(880)).decode()})
    today = date.today()
    assignment = Assignment(employee_id=employee.id, site_id=population["sites"][0]["id"],
                            active=0 if assignment_state == "inactive" else 1,
                            start_date=today + timedelta(days=1) if assignment_state == "future" else today - timedelta(days=10),
                            end_date=today - timedelta(days=1) if assignment_state == "ended" else None)
    db.add(assignment)
    db.commit()
    headers = population["headers"]["scoped"]
    _, data = _page(client, headers, q=employee.code)
    assert data["total"] == 0
    assert client.get(f"/api/ops/employees/{employee.id}/photo", headers=headers).status_code in (403, 404)
    assert client.get(f"/api/ops/employees/{employee.id}/photo", headers=auth_headers).status_code == 200


@pytest.mark.parametrize("value", [None, "", "data:image/png;base64,NOT-BASE64!", "data:image/png;base64,SGVsbG8=",
    "https://example.invalid/private.png", "/uploads/photos/missing-test-photo.png", "/etc/passwd",
    "/uploads/photos/../secret.png", "/uploads/photos/%2e%2e/secret.png", "/uploads/photos/docs/private.png",
    "data:image/svg+xml;base64,PHN2Zy8+", {"url": "/uploads/photos/a.png"}])
def test_missing_corrupt_or_forbidden_sources_return_404_without_redirect(client, db, auth_headers, value):
    employee = _new_employee(db, {"photo": value})
    response = client.get(f"/api/ops/employees/{employee.id}/photo", headers=auth_headers, follow_redirects=False)
    assert response.status_code == 404
    assert "location" not in response.headers
    assert response.headers.get("content-type", "").startswith("application/json")


def test_corrupt_file_and_symlink_cannot_be_served_as_a_photo(client, db, auth_headers, tmp_path):
    photo_storage.PHOTOS_DIR.mkdir(parents=True, exist_ok=True)
    corrupt = photo_storage.PHOTOS_DIR / f"corrupt-{uuid.uuid4().hex}.png"
    outside = tmp_path / "outside.png"
    outside.write_bytes(_png(991))
    link = photo_storage.PHOTOS_DIR / f"link-{uuid.uuid4().hex}.png"
    corrupt.write_bytes(b"not a real image")
    link.symlink_to(outside)
    try:
        for path in (corrupt, link):
            employee = _new_employee(db, {"photo": f"/uploads/photos/{path.name}"})
            assert client.get(f"/api/ops/employees/{employee.id}/photo", headers=auth_headers).status_code == 404
    finally:
        corrupt.unlink(missing_ok=True)
        link.unlink(missing_ok=True)


def test_top_level_clear_wins_over_legacy_photo_and_nested_history_is_read(client, db, auth_headers):
    data = "data:image/png;base64," + base64.b64encode(_png(901)).decode()
    nested = {"photo": data}
    for _ in range(8):
        nested = {"_legacy": nested}
    employee = _new_employee(db, nested)
    endpoint = f"/api/ops/employees/{employee.id}/photo"
    assert client.get(endpoint, headers=auth_headers).content == _png(901)
    employee.extra = {"photo": "", "_legacy": nested}
    db.commit()
    assert client.get(endpoint, headers=auth_headers).status_code == 404
    _, page = _page(client, auth_headers, q=employee.code)
    assert page["items"][0]["has_photo"] is False


def test_photo_replacement_updates_bytes_version_and_etag_without_cross_person_reuse(client, db, auth_headers):
    first, second = _png(700), _png(701)
    employee = _new_employee(db, {"photo": "data:image/png;base64," + base64.b64encode(first).decode()})
    _, before_page = _page(client, auth_headers, q=employee.code)
    before_url = before_page["items"][0]["photo_url"]
    before = client.get(before_url, headers=auth_headers)
    assert before.content == first
    employee.extra = {"photo": "data:image/png;base64," + base64.b64encode(second).decode()}
    employee.updated_at = datetime(2026, 2, 1)
    db.commit()
    _, after_page = _page(client, auth_headers, q=employee.code)
    after_url = after_page["items"][0]["photo_url"]
    assert after_url != before_url
    after = client.get(after_url, headers={**auth_headers, "If-None-Match": before.headers["etag"]})
    assert after.status_code == 200
    assert after.content == second
    assert after.headers["etag"] != before.headers["etag"]
    assert client.get(before_url, headers=auth_headers).content == second


@contextmanager
def _selects():
    statements = []
    def collect(_conn, _cursor, statement, parameters, _context, _executemany):
        if statement.lstrip().upper().startswith(("SELECT", "WITH")):
            statements.append((statement, parameters, [column[0].lower() for column in (_cursor.description or [])]))
    event.listen(test_engine, "after_cursor_execute", collect)
    try:
        yield statements
    finally:
        event.remove(test_engine, "after_cursor_execute", collect)


def test_pagination_sql_projection_query_count_and_payload_stay_bounded(client, db, auth_headers, population):
    samples = []
    for size in (5, 100):
        db.expunge_all()
        with _selects() as statements:
            started = time.perf_counter()
            response, page = _page(client, auth_headers, page_size=size, page=2, sort="mat_asc")
            elapsed = time.perf_counter() - started
        assert len(page["items"]) == size
        assert len(response.content) < size * 1_000
        assert elapsed < 5, f"page of {size} took {elapsed:.3f}s"
        # A JSON has-photo boolean may inspect extra in SQL, but the SELECT
        # projection must never return the complete Employee.extra blob.
        for statement, _, columns in statements:
            sql = " ".join(statement.lower().split())
            assert not any(column in {"extra", "employees_extra", "documents", "photo", "photo_source", "canonical_photo"} for column in columns), columns
            assert not re.search(r"\bfrom\s+documents\b", sql), sql
            if "photo_value" in columns:
                assert "then 1 else 0 end as photo_value" in sql, "photo projection must return only presence flags"
        employee_reads = [(sql, params) for sql, params, columns in statements
                          if "first_name" in columns and "last_name" in columns and "count(" not in sql.lower()]
        assert employee_reads, "must inspect the real SQL employee page"
        assert all("limit" in sql.lower() and "offset" in sql.lower() for sql, _ in employee_reads), employee_reads
        assert len(statements) <= 12, f"unexpected query amplification: {len(statements)}"
        samples.append((size, len(statements), len(response.content), elapsed))
    assert samples[1][1] <= samples[0][1] + 1, f"N+1: {samples}"
    print("OPS_PHOTO_PERF", json.dumps(samples))


def test_site_filter_uses_latest_active_assignment_and_keeps_its_photo(client, db, auth_headers, population):
    content = _png(990)
    employee = _new_employee(db, {"photo": "data:image/png;base64," + base64.b64encode(content).decode()})
    first_site, latest_site = population["sites"][:2]
    for site in (first_site, latest_site):
        db.add(Assignment(employee_id=employee.id, site_id=site["id"], active=1,
                          start_date=date(2020, 1, 1), group_code="A"))
        db.commit()
    _, old = _page(client, auth_headers, q=employee.code, site_id=first_site["id"])
    assert old["total"] == 0
    _, current = _page(client, auth_headers, q=employee.code, site_id=latest_site["id"])
    assert current["total"] == 1
    row = current["items"][0]
    assert row["extra"]["_legacy"]["affectationCourante"]["siteBackendId"] == latest_site["id"]
    _assert_identity(client, auth_headers, row, {"id": employee.id, "photo": content})
    # The employee may remain in a supervisor's authorized cohort via the older
    # active assignment, but the other site's current details must stay hidden.
    _, scoped = _page(client, population["headers"]["scoped"], q=employee.code)
    assert scoped["total"] == 1
    assert scoped["items"][0]["extra"]["_legacy"]["affectationCourante"] == {}
    _, scoped_old_site = _page(client, population["headers"]["scoped"], q=employee.code, site_id=first_site["id"])
    assert scoped_old_site["total"] == 0


def test_thousands_of_heavy_employees_keep_page_sql_memory_and_payload_bounded(client, db, auth_headers, population):
    """Scale 600 -> 3,600 employees, including 192 MiB of additional RH JSON."""
    import tracemalloc
    from sqlalchemy import insert

    scale_prefix = f"{PREFIX}-S"
    metrics = []

    def measure(expected_total):
        for size in (5, 100):
            db.expunge_all()
            tracemalloc.start()
            try:
                with _selects() as statements:
                    started = time.perf_counter()
                    response, page = _page(client, auth_headers, page_size=size, page=2, sort="mat_asc")
                    elapsed = time.perf_counter() - started
                _, peak = tracemalloc.get_traced_memory()
            finally:
                tracemalloc.stop()
            assert page["total"] == expected_total
            assert len(page["items"]) == size
            assert len(response.content) < size * 1_000
            assert elapsed < 5, f"{expected_total} employees / page {size}: {elapsed:.3f}s"
            assert peak < 8 * 1024 * 1024, f"RH blobs unexpectedly loaded: peak {peak:,} bytes"
            for statement, _, columns in statements:
                sql = " ".join(statement.lower().split())
                assert not any(column in {"extra", "employees_extra", "documents", "photo", "photo_source"} for column in columns), columns
                if "photo_value" in columns:
                    assert "then 1 else 0 end as photo_value" in sql
                if "first_name" in columns and "last_name" in columns:
                    assert "limit" in sql and "offset" in sql
            assert len(statements) <= 12
            metrics.append({"employees": expected_total, "page_size": size, "selects": len(statements),
                            "bytes": len(response.content), "seconds": elapsed, "peak_python_bytes": peak})

    # Other cases deliberately create extra records. Do not depend on test order.
    initial_total = _page(client, auth_headers, page_size=5)[1]["total"]
    assert initial_total >= len(population["people"])
    measure(initial_total)
    try:
        photo = "data:image/png;base64," + base64.b64encode(_png(3000)).decode()
        heavy = {"documents": {"private": {"url": PRIVATE_MARKER + "x" * 65_536}},
                 "photo": photo, "_legacy": {"id": "scale-reference"}}
        # Bounded insertion batches keep fixture creation itself independent of
        # the endpoint's memory budget (which is measured only during reads).
        for start in range(0, 3000, 100):
            db.execute(insert(Employee), [{"code": f"{scale_prefix}{i:05d}", "first_name": "Scale", "last_name": f"Person{i:05d}",
                                          "society": SOCIETIES[i % 3], "status": "actif", "position": "Agent", "extra": heavy,
                                          "updated_at": datetime(2026, 1, 1)} for i in range(start, start + 100)])
        db.commit()
        measure(initial_total + 3000)
        assert len({row["selects"] for row in metrics}) == 1, f"query count grows with population: {metrics}"
        for size in (5, 100):
            before, after = [row for row in metrics if row["page_size"] == size]
            assert after["bytes"] < before["bytes"] * 1.1
        print("OPS_PHOTO_SCALE_PERF", json.dumps(metrics))
    finally:
        db.execute(delete(Employee).where(Employee.code.like(f"{scale_prefix}%")))
        db.commit()


def test_leave_blacklist_and_operational_modes_keep_photos_and_global_filters(client, db, auth_headers, population):
    from app.modules.drh.models import Leave
    content = _png(4010)
    employee = _new_employee(db, {"photo": "data:image/png;base64," + base64.b64encode(content).decode()})
    db.add(Assignment(employee_id=employee.id, site_id=population["sites"][0]["id"], active=1, start_date=date(2020, 1, 1)))
    leave = Leave(employee_id=employee.id, leave_type="Annuel", status="approuve",
                  start_date=date.today(), end_date=date.today() + timedelta(days=1))
    db.add(leave); db.commit()
    for mode, expected in (("conge", 1), ("maladie", 0)):
        _, page = _page(client, auth_headers, q=employee.code, mode=mode)
        assert page["total"] == expected
        if expected:
            _assert_identity(client, auth_headers, page["items"][0], {"id": employee.id, "photo": content})
    leave.leave_type = "Maladie"; db.commit()
    assert _page(client, auth_headers, q=employee.code, mode="maladie")[1]["total"] == 1
    assert _page(client, auth_headers, q=employee.code, mode="conge")[1]["total"] == 0
    _, operational = _page(client, auth_headers, q=employee.code, mode="operationnels",
                           operational_requires_dotation=False, operational_requires_pv=False)
    assert operational["total"] == 1
    _assert_identity(client, auth_headers, operational["items"][0], {"id": employee.id, "photo": content})
    assert _page(client, auth_headers, q=employee.code, mode="operationnels")[1]["total"] == 0
    employee.status = "blackliste"; db.commit()
    _, blacklisted = _page(client, auth_headers, q=employee.code, mode="blacklist")
    assert blacklisted["total"] == 1
    _assert_identity(client, auth_headers, blacklisted["items"][0], {"id": employee.id, "photo": content})


def test_code_sort_keeps_numeric_order_beyond_ninety_nine(client, db, auth_headers):
    prefix = f"NATURAL-{uuid.uuid4().hex[:8]}-K"
    employees = [_new_employee(db, {}, code=f"{prefix}{suffix}") for suffix in ("100", "09", "99", "101", "10")]
    _, page = _page(client, auth_headers, q=prefix, sort="mat_asc")
    assert [row["code"] for row in page["items"]] == [prefix + suffix for suffix in ("09", "10", "99", "100", "101")]
    assert len(page["items"]) == len(employees)
