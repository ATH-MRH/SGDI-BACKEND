#!/usr/bin/env python3
"""Local synthetic DRH benchmark; never loads a repository .env or runs lifespan.

python3 scripts/perf/drh_backend_bench.py profile --agents 1000 --out /tmp/atlas-drh-1000
python3 scripts/perf/drh_backend_bench.py serve --agents 1000 --out /tmp/atlas-drh-1000 --port 8765

Uses a private SQLite database, real routes/auth/SQL, and deterministic fake rows.
This measures local SQLite and Python costs, not production PostgreSQL latency.
"""
from __future__ import annotations

import argparse
import contextvars
import gzip
import hashlib
import json
import os
from pathlib import Path
import statistics
import subprocess
import sys
import tempfile
import threading
import time
from collections import Counter
from datetime import date, datetime, timedelta
from urllib.parse import quote

REPO = Path(__file__).resolve().parents[2]
SOCIETIES = ("PERF ALPHA", "PERF BETA")
USERNAME = "perfadmin"
PASSWORD = "Perf-local-2026!"
SEED_VERSION = 2
FIXED_DAY = date(2026, 9, 13)


def configure(out: Path):
    out.mkdir(parents=True, exist_ok=True)
    marker = out / "synthetic-benchmark.json"
    db_path = out / "synthetic.sqlite"
    if db_path.exists() and not marker.exists():
        raise SystemExit("Refusing an existing database without a synthetic benchmark marker")
    # Settings reads .env relative to cwd. This new empty directory cannot contain
    # the user's configuration, and environment values are imposed before imports.
    config_dir = Path(tempfile.mkdtemp(prefix="atlas-perf-config-", dir=out))
    os.chdir(config_dir)
    for key in list(os.environ):
        if key.startswith(("SMTP_", "CONVOCATION_SMTP_", "ANTHROPIC_", "FAC_INITIAL_", "ADMIN_")):
            os.environ.pop(key)
    os.environ.update({
        "DATABASE_URL": f"sqlite:///{db_path}", "APP_ENV": "test",
        "JWT_SECRET": "local-synthetic-benchmark-secret-2026-only",
        "LOG_LEVEL": "ERROR", "STARTUP_MAINTENANCE_ENABLED": "false",
        "CONTRACT_EMAIL_ALERTS_ENABLED": "false", "ASSISTANT_AGENT_ENABLED": "false",
        "ASSISTANT_PAID_AI_ENABLED": "false", "ASSISTANT_FALLBACK_ENABLED": "false",
        "SGDI_UPLOADS_DIR": str(out / "uploads"), "LOGIN_MAX_ATTEMPTS": "1000000",
    })
    sys.path.insert(0, str(REPO))
    import app.main as main
    from sqlalchemy import event
    @event.listens_for(main.engine, "connect")
    def sqlite_pragmas(conn, _):
        conn.execute("PRAGMA foreign_keys=ON")
        conn.execute("PRAGMA busy_timeout=30000")
    return main, marker


def seed(main, marker: Path, n: int):
    if marker.exists():
        metadata = json.loads(marker.read_text())
        if metadata.get("agents") != n or metadata.get("seed_version") != SEED_VERSION:
            raise SystemExit("Dataset differs: choose a new --out directory")
        return metadata
    from app.modules.auth.models import User
    from app.core.security import hash_password
    from app.modules.drh.models import Employee, Candidate, Contract, GeneratedContract, Leave
    from app.modules.ops.models import Site, Assignment, DailyPresence
    from app.modules.irongs.models import SgdiRecord, Position
    from app.modules.materiel.models import Store, StockArticle, EmployeeEquipment
    from app.modules.commercial.models import Client
    from sqlalchemy import select, func
    main.Base.metadata.create_all(main.engine)
    # The event signature watches prospects although the current ORM declares no
    # such table. Supply a deliberately empty synthetic table to exercise UNION's
    # nominal path. No claim is made about whether production has this old table.
    from sqlalchemy import text
    with main.engine.begin() as conn:
        conn.execute(text("CREATE TABLE prospects (id INTEGER PRIMARY KEY, created_at DATETIME, updated_at DATETIME)"))
    with main.SessionLocal() as db:
        db.add(User(username=USERNAME, full_name="Performance Synthétique", role="admin",
                    access_level="H5", is_active=True, global_society_access=True,
                    authorized_societies=[], authorized_structures=["admin"],
                    password_hash=hash_password(PASSWORD)))
        for name in ("Agent de sécurité", "Chef de poste"):
            db.add(Position(name=name))
        sites = []
        for i in range(max(4, n // 20)):
            society = SOCIETIES[i % 2]
            client = Client(name=f"Client fictif {i:04d}", society=society, status="actif",
                            data={"tech_nbrSite": 1, "totalEffectif": 20})
            db.add(client)
            db.flush()
            site = Site(name=f"Site fictif {i:04d}", client_id=client.id, client_name=client.name,
                        indicatif=f"PF{i:04d}", active=1, equipment_plan={"societe": society},
                        contractual_staff=20, day_staff=10, night_staff=10)
            db.add(site)
            db.flush()
            sites.append(site)
        stores = []
        for i, society in enumerate(SOCIETIES):
            store = Store(name=f"Magasin fictif {i}", code=f"PFM{i}", society=society)
            db.add(store)
            db.flush()
            article = StockArticle(code=f"PFA{i}", designation="Tenue de sécurité fictive",
                                   society=society, store_id=store.id, quantity=500, active=1)
            db.add(article)
            db.flush()
            stores.append(article)
        for i in range(n):
            site = sites[i % len(sites)]
            society = SOCIETIES[i % 2]
            status = ("actif", "actif", "actif", "actif", "absent", "sortant", "suspendu")[i % 7]
            legacy = {"id": str(i + 1), "nom": f"FICTIF{i:05d}", "prenom": f"Agent{i:05d}",
                      "societe": society, "statut": status, "matricule": f"PERF{i:05d}",
                      "poste": "Agent de sécurité", "documents": {},
                      "affectationCourante": {"siteId": f"st_{site.id}", "siteName": site.name},
                      "notes": (f"Observation synthétique du dossier {i}. " * 16)}
            employee = Employee(code=f"PERF{i:05d}", first_name=f"Agent{i:05d}", last_name=f"FICTIF{i:05d}",
                                society=society, position="Agent de sécurité", status=status,
                                contract_type="CDD", recruit_date=FIXED_DAY - timedelta(days=120),
                                salary_net=40000 + i % 5 * 1000, extra={"_legacy": legacy})
            db.add(employee)
            db.flush()
            contract = Contract(employee_id=employee.id, contract_type="CDD", position="Agent de sécurité",
                                start_date=FIXED_DAY - timedelta(days=120), end_date=FIXED_DAY + timedelta(days=180),
                                salary_net=40000, status="actif")
            db.add(contract)
            db.flush()
            db.add(GeneratedContract(employee_id=employee.id, contract_id=contract.id,
                                     reference=f"PF-{i:05d}", title="Contrat fictif", contract_type="CDD",
                                     output_format="docx", file_name="fictif.docx", mime_type="application/octet-stream",
                                     file_content=b"synthetic-not-a-real-document\n" * 80,
                                     values={"NOM": legacy["nom"]}, status="genere"))
            for active in (0, 1):
                db.add(Assignment(employee_id=employee.id, site_id=site.id, active=active, group_code="A",
                                  position="Agent de sécurité", start_date=FIXED_DAY - timedelta(days=90),
                                  end_date=None if active else FIXED_DAY - timedelta(days=30)))
            db.add(EmployeeEquipment(employee_id=employee.id, article_id=stores[i % 2].id,
                                     dotation_date=FIXED_DAY - timedelta(days=90), status="attribue"))
            if i % 10 == 0:
                db.add(Leave(employee_id=employee.id, start_date=FIXED_DAY - timedelta(days=1),
                             end_date=FIXED_DAY + timedelta(days=3), status="approuve", leave_type="conge"))
            for day_offset in range(7):
                db.add(DailyPresence(employee_id=employee.id, site_id=site.id,
                                     presence_date=FIXED_DAY - timedelta(days=day_offset), status="present",
                                     data={"societe": society, "code": "P", "synthetic": True}))
            # Residual legacy duplicates are deliberate: migration fallback overhead.
            db.add(SgdiRecord(collection="agents", item_id=str(employee.id), position=i, kind="item", data=legacy))
            if i < n // 2:
                candidate_status = ("nouvelle", "reserve", "a_contractualiser", "archive", "embauche")[i % 5]
                data = {"nom": f"CANDIDAT{i:05d}", "prenom": "Fictif", "statut": candidate_status,
                        "societe": society, "fichePositionValidee": candidate_status == "reserve",
                        "wilaya": "Alger", "avisDecision": "Favorable", "notes": "Fiche synthétique. " * 30}
                db.add(Candidate(first_name="Fictif", last_name=f"CANDIDAT{i:05d}", desired_position="Agent de sécurité",
                                 society=society, status=candidate_status, data=data))
                db.add(SgdiRecord(collection="candidats", item_id=str(i + 1), position=i, kind="item", data=data))
            for collection in ("pointages", "missions", "workflowTasks", "messages", "secretariatNotes", "devis"):
                data = {"id": f"{collection}-{i}", "agentId": str(employee.id), "societe": society,
                        "statut": "actif", "libelle": f"Donnée synthétique {i}", "periode": "2026-09"}
                if collection == "pointages":
                    data["jours"] = {str(day): "P" for day in range(1, 14)}
                db.add(SgdiRecord(collection=collection, item_id=data["id"], position=i, kind="item", data=data))
        db.commit()
        counts = {table.name: int(db.scalar(select(func.count()).select_from(table)) or 0)
                  for table in main.Base.metadata.sorted_tables}
    metadata = {"synthetic": True, "seed_version": SEED_VERSION, "agents": n,
                "signature_schema": "ORM tables plus empty synthetic prospects (nominal UNION path)",
                "fixture_date": FIXED_DAY.isoformat(), "societies": SOCIETIES, "rows_by_table": counts}
    marker.write_text(json.dumps(metadata, indent=2, ensure_ascii=False) + "\n")
    return metadata


class Recorder:
    def __init__(self, main):
        self.main = main
        self.current = contextvars.ContextVar("perf_trace", default=None)
        self.active = {}
        self.done = []
        self.lock = threading.RLock()
        self.counter = 0
        from sqlalchemy import event
        from sqlalchemy.orm import Session
        @event.listens_for(main.engine, "before_cursor_execute")
        def before(conn, cursor, statement, parameters, context, executemany):
            context._perf_start = time.perf_counter()
            context._perf_trace = self.trace()
            trace = context._perf_trace
            context._perf_query = {"statement": " ".join(statement.split()), "execute_ms": 0.,
                                   "cursor_rowcount": None, "error": None}
            if trace is not None:
                with self.lock:
                    trace["sql"].append(context._perf_query)
        @event.listens_for(main.engine, "after_cursor_execute")
        def after(conn, cursor, statement, parameters, context, executemany):
            trace = getattr(context, "_perf_trace", None)
            if trace is not None:
                with self.lock:
                    context._perf_query.update(execute_ms=(time.perf_counter() - context._perf_start) * 1000,
                                               cursor_rowcount=cursor.rowcount)
        @event.listens_for(main.engine, "handle_error")
        def error(exception_context):
            context = exception_context.execution_context
            if context is not None and getattr(context, "_perf_trace", None) is not None:
                with self.lock:
                    context._perf_query.update(execute_ms=(time.perf_counter() - context._perf_start) * 1000,
                                               error=str(exception_context.original_exception))
        @event.listens_for(Session, "loaded_as_persistent")
        def loaded(session, instance):
            trace = self.trace()
            if trace is not None:
                with self.lock:
                    trace["orm_instances_loaded"][type(instance).__name__] += 1
        import orjson
        original_dumps = orjson.dumps
        def dumps(*args, **kwargs):
            start = time.perf_counter()
            try:
                return original_dumps(*args, **kwargs)
            finally:
                self.timing("orjson_ms", start)
        orjson.dumps = dumps
        import fastapi.routing
        original_serialize = fastapi.routing.serialize_response
        async def serialize(*args, **kwargs):
            start = time.perf_counter()
            try:
                return await original_serialize(*args, **kwargs)
            finally:
                self.timing("fastapi_serialize_ms", start)
        fastapi.routing.serialize_response = serialize
        from starlette.responses import JSONResponse
        original_render = JSONResponse.render
        def render(response, content):
            start = time.perf_counter()
            try:
                return original_render(response, content)
            finally:
                self.timing("json_response_render_ms", start)
        JSONResponse.render = render
        from sqlalchemy.engine.result import ChunkedIteratorResult
        original_fetchall = ChunkedIteratorResult._fetchall_impl
        def fetchall(result):
            start = time.perf_counter()
            try:
                rows = original_fetchall(result)
                trace = self.trace()
                if trace is not None:
                    with self.lock:
                        trace["orm_result_rows"] += len(rows)
                return rows
            finally:
                self.timing("orm_fetch_materialize_ms", start)
        ChunkedIteratorResult._fetchall_impl = fetchall

    def trace(self):
        direct = self.current.get()
        if direct is not None:
            return direct
        # Snapshot uses an internal ThreadPoolExecutor without context propagation.
        # Serial profile has exactly one active request; concurrent serve requests
        # cannot safely attribute such SQL and deliberately leave it unassigned.
        with self.lock:
            return next(iter(self.active.values())) if len(self.active) == 1 else None

    def timing(self, name, start):
        trace = self.trace()
        if trace is not None:
            with self.lock:
                trace[name] += (time.perf_counter() - start) * 1000

    def wrap(self, app):
        recorder = self
        async def instrumented(scope, receive, send):
            if scope["type"] != "http":
                return await app(scope, receive, send)
            # Harness-only loopback control; deliberately outside app routing and
            # the measurement trace. No SQL, authentication or lifespan executes.
            if scope["path"] == "/__perf__/reset-caches":
                peer = (scope.get("client") or ("",))[0]
                status = 200
                if peer not in {"127.0.0.1", "::1", "testclient"}:
                    status, payload = 403, {"ok": False, "reason": "loopback only"}
                elif scope["method"] != "POST":
                    status, payload = 405, {"ok": False, "reason": "POST required"}
                else:
                    with recorder.lock:
                        if recorder.active:
                            status, payload = 409, {"ok": False, "reason": "close previous browser context and wait for in-flight requests",
                                                    "active_paths": [t["path"] for t in recorder.active.values()]}
                        else:
                            clear_caches(recorder.main)
                            recorder.done.clear()
                            recorder.counter = 0
                            payload = {"ok": True, "reset": ["snapshot", "sidebar", "events_signature", "collector"]}
                body = json.dumps(payload).encode()
                await send({"type": "http.response.start", "status": status,
                            "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())]})
                await send({"type": "http.response.body", "body": body})
                return
            with recorder.lock:
                recorder.counter += 1
                trace_id = recorder.counter
                trace = {"id": trace_id, "path": scope["path"], "sql": [],
                         "orm_instances_loaded": Counter(), "orjson_ms": 0.,
                         "fastapi_serialize_ms": 0., "json_response_render_ms": 0., "wire_bytes": 0,
                         "orm_fetch_materialize_ms": 0., "orm_result_rows": 0}
                recorder.active[trace_id] = trace
            token = recorder.current.set(trace)
            start = time.perf_counter()
            async def capture(message):
                if message["type"] == "http.response.start":
                    trace["status"] = message["status"]
                    trace["response_start_ms"] = (time.perf_counter() - start) * 1000
                elif message["type"] == "http.response.body":
                    trace["wire_bytes"] += len(message.get("body", b""))
                await send(message)
            try:
                await app(scope, receive, capture)
            finally:
                trace["app_total_ms"] = (time.perf_counter() - start) * 1000
                trace["sql_count"] = len(trace["sql"])
                trace["sql_execute_ms"] = sum(q["execute_ms"] for q in trace["sql"])
                with recorder.lock:
                    recorder.active.pop(trace_id, None)
                    recorder.done.append(trace)
                recorder.current.reset(token)
        return instrumented


def clear_caches(main):
    from app.modules.irongs import service as irongs
    from app.modules.ui import service as ui
    irongs._snapshot_cache_invalidate()
    with ui._SIDEBAR_STATS_CACHE_LOCK:
        ui._SIDEBAR_STATS_CACHE.clear()
    main._EVENTS_SIGNATURE_CACHE.update(value="", at=0.)


def profile(main, app, recorder, metadata, out, repeats):
    from fastapi.testclient import TestClient
    # No context manager: TestClient does not enter the application's lifespan.
    client = TestClient(app)
    response = client.post("/api/auth/login", json={"username": USERNAME, "password": PASSWORD})
    response.raise_for_status()
    headers = {"Authorization": "Bearer " + response.json()["access_token"], "Accept-Encoding": "identity"}
    endpoints = [
        "/api/irongs/db?light=true", "/api/irongs/db", "/api/ui/sidebar-stats",
        "/api/ui/sidebar-stats?society=" + quote(SOCIETIES[0]),
        "/api/drh/employees", "/api/drh/employees/page?mode=all&page_size=25",
        "/api/drh/employees/page?mode=all&page_size=25&q=Agent",
        "/api/drh/candidates/page?mode=recrutement&page_size=25", "/api/drh/candidates",
        "/api/drh/contracts", "/api/drh/generated-contracts", "/api/drh/leaves", "/api/drh/dashboard",
    ]
    results = []
    for endpoint in endpoints:
        for cache_state in ("cold", "warm"):
            clear_caches(main)
            if cache_state == "warm":
                client.get(endpoint, headers=headers).raise_for_status()
            samples = []
            for _ in range(repeats):
                if cache_state == "cold":
                    clear_caches(main)
                start = time.perf_counter()
                response = client.get(endpoint, headers=headers)
                elapsed = (time.perf_counter() - start) * 1000
                response.raise_for_status()
                trace = recorder.done[-1].copy()
                trace.update(client_total_ms=elapsed, raw_bytes=len(response.content),
                             gzip_bytes=len(gzip.compress(response.content, compresslevel=9, mtime=0)))
                samples.append(trace)
            summary = {key: statistics.median(sample[key] for sample in samples)
                       for key in ("client_total_ms", "app_total_ms", "response_start_ms", "sql_count",
                                   "sql_execute_ms", "raw_bytes", "gzip_bytes", "orjson_ms",
                                   "fastapi_serialize_ms", "json_response_render_ms", "orm_fetch_materialize_ms", "orm_result_rows")}
            results.append({"endpoint": endpoint, "cache": cache_state, "median": summary, "samples": samples})
            print(f"{cache_state:4} {endpoint}: {summary['client_total_ms']:.1f} ms / {summary['sql_count']:.0f} SQL / {summary['raw_bytes']:.0f} bytes", flush=True)
    try:
        revision = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=REPO, text=True).strip()
    except Exception:
        revision = "unknown"
    result = {"revision": revision, "fixture": metadata, "repeats": repeats, "results": results,
              "method": {"transport": "in-process ASGI TestClient; lifespan disabled", "database": "SQLite file",
                         "compression": "raw identity response; gzip bytes recomputed at level 9 outside timer",
                         "cold": "application snapshot/sidebar/signature caches cleared, SQLite/OS page cache retained",
                         "warm": "one priming call; signature TTL can expire during a long sample",
                         "sql": "cursor execute time only, excludes fetch/materialization; SELECT rowcount may be -1",
                         "rows": "ORM loaded_as_persistent counts instances; identity-map reuse may undercount repeated SQL rows",
                         "orm_fetch": "ChunkedIteratorResult._fetchall_impl: DB cursor fetching + JSON decoding + ORM materialization; rows are result entries, including repeated reads",
                         "serialization": "separate orjson, FastAPI response validation/serialization and JSONResponse render spans",
                         "limitations": "No network/production PostgreSQL timings, EXPLAIN, browser layout or production-data claim. Instrumentation adds overhead."}}
    (out / "backend-profile.json").write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n")
    client.close()


def snapshot_probe(main, metadata, out, repeats):
    """Read-only A/B query probe; does not replace the product function."""
    import orjson
    from sqlalchemy import select
    from app.modules.irongs.models import SgdiRecord
    from app.modules.irongs.sql_bridge import SQL_COLLECTIONS
    from app.modules.irongs.service import SERVER_ONLY_COLLECTIONS
    excluded = SQL_COLLECTIONS | SERVER_ONLY_COLLECTIONS
    samples = {"original": [], "filtered_sql": []}
    digests = set()
    for iteration in range(repeats):
        # Alternating order limits systematic hot-page bias.
        for variant in (("original", "filtered_sql") if iteration % 2 == 0 else ("filtered_sql", "original")):
            with main.SessionLocal() as db:
                stmt = select(SgdiRecord)
                if variant == "filtered_sql":
                    stmt = stmt.where(SgdiRecord.collection.not_in(excluded))
                stmt = stmt.order_by(SgdiRecord.collection.asc(), SgdiRecord.position.asc(), SgdiRecord.id.asc())
                start = time.perf_counter()
                fetched = db.execute(stmt).scalars().all()
                loaded_ms = (time.perf_counter() - start) * 1000
                retained = [row for row in fetched if row.collection not in excluded]
                total_ms = (time.perf_counter() - start) * 1000
                retained_bytes = orjson.dumps([(row.id, row.collection, row.data) for row in retained])
                digests.add(hashlib.sha256(retained_bytes).hexdigest())
                samples[variant].append({"load_ms": loaded_ms, "load_and_filter_ms": total_ms,
                                         "fetched_rows": len(fetched), "retained_rows": len(retained),
                                         "fetched_json_bytes": sum(len(orjson.dumps(row.data)) for row in fetched),
                                         "retained_json_bytes": len(retained_bytes)})
    report = {"fixture": metadata, "repeats": repeats, "retained_data_identical": len(digests) == 1,
              "retained_sha256": sorted(digests), "samples": samples,
              "medians": {variant: {key: statistics.median(sample[key] for sample in rows)
                                    for key in rows[0]} for variant, rows in samples.items()},
              "method": "fresh session each query; alternating A/B; same DB; SQL execute/fetch/ORM/JSON decode timed together; digest/byte counting outside timer"}
    (out / "snapshot-query-probe.json").write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps({"equivalent": report["retained_data_identical"], "medians": report["medians"]}, indent=2))


def sidebar_probe(main, metadata, out, repeats):
    """Temporarily wrap reads in this process only to estimate avoidable work."""
    import orjson
    from sqlalchemy import select
    from app.modules.auth.models import User
    from app.modules.ui import service as ui
    original = ui._legacy_rows
    results = []
    for society in (None, SOCIETIES[0]):
        samples = {"original": [], "memoized_this_call": []}
        digests = set()
        for iteration in range(repeats):
            for variant in (("original", "memoized_this_call") if iteration % 2 == 0 else ("memoized_this_call", "original")):
                memo = {}
                stats = {"legacy_reads": 0, "legacy_rows": 0}
                def read(db, name):
                    if variant == "memoized_this_call" and name in memo:
                        return memo[name]
                    rows = original(db, name)
                    stats["legacy_reads"] += 1
                    stats["legacy_rows"] += len(rows)
                    memo[name] = rows
                    return rows
                ui._legacy_rows = read
                try:
                    with main.SessionLocal() as db:
                        user = db.execute(select(User).where(User.username == USERNAME)).scalar_one()
                        start = time.perf_counter()
                        response = ui._build_sidebar_stats_uncached(db, user, society)
                        elapsed = (time.perf_counter() - start) * 1000
                        response.pop("generated_at", None)
                        digests.add(hashlib.sha256(orjson.dumps(response, option=orjson.OPT_SORT_KEYS)).hexdigest())
                        samples[variant].append({"build_ms": elapsed, **stats})
                finally:
                    ui._legacy_rows = original
        results.append({"society": society, "equivalent_without_generated_at": len(digests) == 1,
                        "digests": sorted(digests), "samples": samples,
                        "medians": {variant: {key: statistics.median(sample[key] for sample in rows)
                                              for key in rows[0]} for variant, rows in samples.items()}})
    report = {"fixture": metadata, "repeats": repeats, "results": results,
              "method": "same uncached product builder, original legacy loader temporarily wrapped within one process and one call; alternating A/B, fresh session; HTTP/auth/cache costs excluded"}
    (out / "sidebar-read-probe.json").write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps([{key: value for key, value in row.items() if key != "samples"} for row in results], indent=2))


def main_cli():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("seed", "profile", "serve", "probe", "sidebar-probe"))
    parser.add_argument("--agents", type=int, choices=(100, 1000), default=1000)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--repeats", type=int, default=5)
    args = parser.parse_args()
    out = args.out.expanduser().resolve()
    main, marker = configure(out)
    metadata = seed(main, marker, args.agents)
    if args.mode == "seed":
        print(marker)
        return
    if args.mode == "probe":
        snapshot_probe(main, metadata, out, args.repeats)
        return
    if args.mode == "sidebar-probe":
        sidebar_probe(main, metadata, out, args.repeats)
        return
    recorder = Recorder(main)
    app = recorder.wrap(main.app)
    if args.mode == "profile":
        profile(main, app, recorder, metadata, out, args.repeats)
    else:
        import uvicorn
        print(f"Synthetic only: http://127.0.0.1:{args.port} login {USERNAME} / {PASSWORD}", flush=True)
        uvicorn.run(app, host="127.0.0.1", port=args.port, lifespan="off", log_level="warning")


if __name__ == "__main__":
    main_cli()
