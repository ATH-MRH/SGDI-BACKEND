#!/usr/bin/env python3
"""Validate and compare the three before/three after browser profiles."""
import argparse
import importlib.util
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--before", nargs=3, required=True)
    parser.add_argument("--after", nargs=3, required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    spec = importlib.util.spec_from_file_location("frontend_summary", Path(__file__).with_name("frontend-summarize.py"))
    summary = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(summary)
    before = summary.summarize(args.before)
    after = summary.summarize(args.after)
    paths = args.before + args.after
    reports = [json.loads(Path(path).read_text()) for path in paths]
    metadata = {}
    for key in ("schemaVersion", "observerVersion", "observerSha256", "runtime", "backendCachePolicy", "methodology"):
        values = {json.dumps(report.get(key), sort_keys=True) for report in reports}
        if len(values) != 1 or reports[0].get(key) is None:
            raise ValueError(f"Missing or different metadata: {key}")
        metadata[key] = reports[0][key]
    expected_names = [phase["name"] for phase in reports[0]["phases"]]
    expected_rows = {phase["name"]: phase["visibleRows"] for phase in reports[0]["phases"]}
    expected_state = {"employeeCount": 1000, "candidateCount": 500, "fullDataReady": True, "hydrated": True}
    for path, report in zip(paths, reports):
        if [phase["name"] for phase in report["phases"]] != expected_names:
            raise ValueError(f"Different navigation phases: {path}")
        for phase in report["phases"]:
            if phase["state"] != expected_state:
                raise ValueError(f"Unexpected population/readiness: {path}: {phase['name']}: {phase['state']}")
            if phase["visibleRows"] != expected_rows[phase["name"]]:
                raise ValueError(f"Different row count: {path}: {phase['name']}")
    phases = {}
    keys = ("firstReadyMs", "settledMs", "fetchCount", "apiBytes", "jsonParseMs", "scriptDownloadBytes",
            "moduleDownloadMs", "scriptEvalMs", "moduleInitMs", "domWriteMs", "domWrites", "domElementsCreated",
            "domRowsCreated", "visibleRows", "visibleElements", "layoutReadMs", "timersStarted")
    for name in expected_names:
        phases[name] = {}
        for key in keys:
            initial = before["phases"][name][key]
            final = after["phases"][name][key]
            phases[name][key] = {"before": initial, "after": final,
                                 "changePct": round((final["median"] - initial["median"]) / initial["median"] * 100, 2)
                                 if initial["median"] else None}
    result = {"validation": "passed", "profileCount": 6, "metadata": metadata,
              "expectedState": expected_state, "visibleRows": expected_rows,
              "beforeReports": args.before, "afterReports": args.after, "phases": phases,
              "limitations": "Controlled synthetic loopback, not production. Function and layout timings overlap; do not add them. Row counts do not prove full content equivalence."}
    Path(args.out).write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps({"validation": "passed", "profiles": 6, "output": args.out}))


if __name__ == "__main__":
    main()
