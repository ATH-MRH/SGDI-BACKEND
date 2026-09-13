# DRH local performance harness

All business fields are fictitious and deterministic; seeding timestamps vary.
No production connection or exported production data is used. Run from the
repository root with its Python dependencies. Fixture dates are fixed to 2026-09-13;
date-dependent counters can change when rerun on a different day.

```sh
python3 scripts/perf/drh_backend_bench.py profile --agents 100 --out /tmp/atlas-drh-100 --repeats 5
python3 scripts/perf/drh_backend_bench.py profile --agents 1000 --out /tmp/atlas-drh-1000 --repeats 5
python3 scripts/perf/drh_backend_bench.py profile-support --agents 1000 --out /tmp/atlas-drh-support --repeats 5
python3 scripts/perf/drh_backend_bench.py probe --agents 1000 --out /tmp/atlas-drh-1000 --repeats 9
python3 scripts/perf/drh_backend_bench.py sidebar-probe --agents 1000 --out /tmp/atlas-drh-1000 --repeats 9
python3 scripts/perf/drh_backend_bench.py serve --agents 1000 --out /tmp/atlas-drh-server --port 8767
```

The loopback server serves the real UI at `/`, the real static files and API routes.
Log in through `/api/auth/login` with `perfadmin` / `Perf-local-2026!`; this account
only exists in the disposable synthetic database. `--out` must be a new directory
or one created by the same seed version and dataset size. A pre-existing database
without the harness marker is refused. Choose a new output directory when changing
seed versions. Do not run two profiling campaigns concurrently.

Before each cold browser run, close the previous browser context and POST to
`http://127.0.0.1:8767/__perf__/reset-caches` (replace the port as needed). This
harness-only loopback endpoint clears snapshot, sidebar, event-signature and trace
memory without SQL or database writes. It returns 409 while any previous request,
including an SSE stream, is active; wait for that context to finish before retrying.
GET returns 405. Do not reset between transitions within one warm navigation run.

The harness changes cwd to a new empty directory before importing application
settings, imposes a SQLite URL and fake JWT secret, removes mail/provider/admin
environment variables, disables scheduled email/AI/maintenance, and runs ASGI with
lifespan off. Schema creation and synthetic seeding affect only the explicitly
chosen disposable SQLite database. No Alembic migrations or application startup
callbacks execute. Audit writes from real GET routes remain enabled in that database.

Fixture v2 includes an empty synthetic `prospects` table solely to exercise the
event-signature UNION query's nominal path. The repository ORM does not declare
that watched table. Its existence in production is unknown; ORM-only fixture v1
exercised the per-table fallback instead. This is a measurement fixture choice,
not a product schema correction.

`profile` records cold and warm application caches, with five requests by default.
`profile-support` uses the same protocol for the five auxiliary endpoints observed
at DRH startup (version, auth users/access rules, SSE ticket and positions).
Cold means snapshot/sidebar/event-signature caches are cleared; SQLite and OS page
caches remain warm. Warm means one priming request, and the signature's real TTL
still applies. Payloads use `Accept-Encoding: identity`; gzip sizes are computed
separately at level 9. Reports include every sample, SQL statement shape (no bind
values), errors, cursor execution duration, ORM result rows, instance loading,
fetch/JSON decode/materialization duration, and serialization spans. `probe` compares
the original snapshot query against an equivalent SQL exclusion, in alternating
order and fresh sessions, without replacing any product function; it verifies all
retained IDs, collection names and JSON via a SHA-256 digest.
`sidebar-probe` estimates avoidable repeated legacy reads by temporarily wrapping
the loader with a dictionary lasting one uncached builder call, in the harness
process only. It alternates original and wrapped calls and verifies complete JSON
equality excluding the dynamic `generated_at` field. It does not measure HTTP,
authentication or cross-request caches.

Cursor execution time excludes result fetching. ORM result-row counts include
repeated reads, whereas instance counts can be reduced by identity-map reuse.
Snapshot SQL collections run in parallel: cumulative query/ORM durations may exceed
HTTP duration and must not be subtracted from it. Serialization spans distinguish
orjson, FastAPI validation/serialization, and JSONResponse encoding; they do not
represent every Python allocation or the explicit EmployeeOut model-validation
loop. Instrumentation itself adds overhead.

Per-request traces are exact for the sequential ASGI profile. In concurrent server
traffic, SQL from the snapshot's internal threads lacks context propagation; the
harness deliberately leaves it unattributed if multiple requests are active.
These are SQLite/Python/ASGI observations. They do not establish PostgreSQL query
plans, network latency, browser layout costs or production performance.
