#!/usr/bin/env python3
"""Append a weight to health/data/weight.csv.

Accepts WEIGHT_KG plus an optional WEIGHT_DATE, or an ISSUE_BODY from the
Log weight issue form. Writes status JSON for the workflow. The only line it
prints is the public confirmation (no secrets are involved).
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

from health_data import WEIGHT_PATH, apply_weight_log, parse_issue_body


def _result_from_env() -> dict:
    kg = os.environ.get("WEIGHT_KG", "").strip()
    date_text = os.environ.get("WEIGHT_DATE", "").strip()
    body = os.environ.get("ISSUE_BODY", "")
    path = Path(os.environ.get("WEIGHT_CSV") or WEIGHT_PATH)
    if kg:
        return apply_weight_log(path, kg_text=kg, date_text=date_text or None)
    if "### Weight (kg)" in body:
        parsed_date, parsed_kg = parse_issue_body(body)
        return apply_weight_log(path, kg_text=parsed_kg, date_text=parsed_date)
    return {
        "ok": True,
        "commit": False,
        "message": "Not a weight log; nothing to do.",
        "commit_message": "",
    }


def main() -> int:
    try:
        result = _result_from_env()
    except ValueError as exc:
        result = {
            "ok": False,
            "commit": False,
            "message": f"{exc} Open a new weight issue to try again.",
            "commit_message": "",
        }
    dest = os.environ.get("WEIGHT_RESULT", "/tmp/weight_status.json")
    Path(dest).write_text(json.dumps(result) + "\n", encoding="utf-8")
    github_output = os.environ.get("GITHUB_OUTPUT")
    if github_output:
        with open(github_output, "a", encoding="utf-8") as handle:
            commit = "true" if result.get("commit") else "false"
            message = str(result.get("message") or "").replace("\n", " ")
            commit_message = str(result.get("commit_message") or message).replace("\n", " ")
            handle.write(f"commit={commit}\n")
            handle.write(f"message={message}\n")
            handle.write(f"commit_message={commit_message}\n")
    print(result.get("message") or "")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
