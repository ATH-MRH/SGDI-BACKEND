# DRH frontend profile (local synthetic data only)

Use `frontend-browser-server.js` for reported browser timings. It serves a loopback-only proxy that adds development observations to responses; it does not alter application source files. The backend must be the synthetic server from `drh_backend_bench.py`, not a production service.

```sh
python3 scripts/perf/drh_backend_bench.py serve --agents 1000 --out /private/tmp/atlas-drh-bench-1000-v2 --port 8768
node scripts/perf/frontend-browser-server.js --base http://127.0.0.1:8768 --port 8772 --reset-caches --out /private/tmp/drh-browser-before
```

Open `http://127.0.0.1:8772/` in an actual browser. Each full navigation creates a fresh synthetic session, clears only this benchmark origin's storage, runs DRH → active employees → DRH, and saves `/private/tmp/drh-browser-before-N.json`. The tab title becomes `DRH benchmark complete`. Run three full navigations sequentially and compare medians using the same browser and fixture. The server logs output filenames. With `--reset-caches`, the synthetic server clears its Python memory caches before each cold navigation, without writing database rows. A concurrent API request makes the reset fail with 409: close the previous browser context and retry; never accept that attempt as a measurement. Reports include the cache policy and observer SHA-256. Avoid parallel benchmarks during measurements.

The collector records:

- navigation start to first dashboard (two animation frames after its DOM appears);
- all real fetch response statuses, body bytes, duration, callers, and JSON parse time;
- script Resource Timing, module download/start, script evaluation and module initialization;
- synchronous function costs and `innerHTML` construction, created element/row counts, visible rows;
- actual image and document Resource Timing entries;
- timers started, duplicate endpoint requests, cold/employee/warm phases;
- postprocessing functions, native layout-read time, and Long Tasks / Long Animation Frames where the browser supports them.

`blocking` is a source-based classification of awaited bootstrap dependencies, reconstructed from the caller stack; `beforeFirstReady` is an independent timing observation. A forced employee refresh can be nonblocking even when it finishes before first paint. `settledMs` is the last observed application activity; the 750 ms observation window is not counted. It can be less than `firstReadyMs`, which also waits for frame presentation.

The proxy refuses business POST/PUT/PATCH/DELETE requests. The only POSTs it performs are synthetic authentication against the loopback fixture and the local metrics sink. External font stylesheets and persistent EventSource streams are excluded identically before/after. Service workers are inactive too: the generic instrumented script wrapper refers to `window`, unavailable in a worker; the application silently ignores registration failure. PWA precache/network behavior is therefore outside these measurements. This is a limitation of the frozen benchmark protocol, not a product behavior claim. Native layout-getter timing records the existing read only; it performs no extra layout read. Function timings are inclusive (do not sum nested functions). The metrics include observer overhead; they are controlled local measurements, not production network or capacity guarantees. The standalone global JavaScript asset still belongs in downloaded-byte totals.

Before accepting a run, verify that API requests succeeded, `state.employeeCount` matches the expected loading policy and fixture, and `errors`/`failure` contain no unexpected failure. A failed bootstrap showing an empty dashboard is not a successful performance result.

