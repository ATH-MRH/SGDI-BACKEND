#!/usr/bin/env python3
"""Summarize sequential browser reports without changing their measurements."""
import argparse
import collections
import json
import statistics
from pathlib import Path


def summarize(paths):
    reports = [json.loads(Path(p).read_text()) for p in paths]
    if not reports:
        raise ValueError("At least one browser report is required")
    versions = {p.get("observerSha256", p.get("observerVersion", p.get("schemaVersion"))) for p in reports}
    if len(versions) != 1:
        raise ValueError("Do not compare mixed observer versions")
    for path, report in zip(paths, reports):
        if report.get("failure") or report.get("errors"):
            raise ValueError(f"Unsuccessful browser profile: {path}")
        failures = [r for r in report["requests"] if not 200 <= r.get("status", 0) < 300]
        if failures:
            raise ValueError(f"Unsuccessful API calls: {path}: {failures}")
    phase_names = [p["name"] for p in reports[0]["phases"]]
    phases = {}
    for name in phase_names:
        values = [next(p for p in report["phases"] if p["name"] == name) for report in reports]
        keys = {key for value in values for key, number in value.items() if isinstance(number, (int, float))}
        summary = {}
        for key in sorted(keys):
            numbers = [value[key] for value in values if isinstance(value.get(key), (int, float))]
            summary[key] = {"median": round(statistics.median(numbers), 3), "min": min(numbers), "max": max(numbers)}
        summary["state"] = [value["state"] for value in values]
        summary["duplicateEndpoints"] = [value["duplicateEndpoints"] for value in values]
        phases[name] = summary
    requests = collections.defaultdict(list)
    functions = collections.defaultdict(list)
    for report in reports:
        for row in report["requests"]:
            requests[(row["phase"], row["endpoint"])].append(row)
        per_run = collections.defaultdict(lambda: {"count": 0, "syncMs": 0})
        for row in report["functions"]:
            value = per_run[(row["phase"], row["name"])]
            value["count"] += 1
            value["syncMs"] += row.get("syncDurationMs", 0)
        for key, value in per_run.items():
            functions[key].append(value)
    endpoints = []
    for (phase, endpoint), rows in requests.items():
        endpoints.append({"phase": phase, "endpoint": endpoint, "calls": len(rows),
                          "statuses": sorted({r["status"] for r in rows}),
                          "medianDurationMs": round(statistics.median(r["durationMs"] for r in rows), 3),
                          "bodyBytes": sorted({r["bytes"] for r in rows}),
                          "medianParseMs": round(statistics.median(r.get("parseMs", 0) for r in rows), 3),
                          "blockingValues": sorted({r.get("blocking") for r in rows}, key=str),
                          "callers": sorted({r["caller"] for r in rows})})
    costs = [{"phase": phase, "name": name,
              "medianCount": statistics.median(r["count"] for r in rows),
              "medianSyncMs": round(statistics.median(r["syncMs"] for r in rows), 3)}
             for (phase, name), rows in functions.items()]
    return {"reports": [str(p) for p in paths], "observerVersion": versions.pop(), "count": len(reports),
            "methodology": reports[0]["methodology"], "phases": phases,
            "endpoints": endpoints,
            "functionCosts": sorted(costs, key=lambda x: (x["phase"], -x["medianSyncMs"]))}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("reports", nargs="+")
    parser.add_argument("--out")
    args = parser.parse_args()
    result = summarize(args.reports)
    text = json.dumps(result, indent=2, ensure_ascii=False) + "\n"
    if args.out:
        Path(args.out).write_text(text)
    else:
        print(text, end="")


if __name__ == "__main__":
    main()
