#!/usr/bin/env python3
"""Refresh the Oura token, pull a recent window, and update health/data/daily.json.

Reads OURA_CLIENT_ID, OURA_CLIENT_SECRET and OURA_REFRESH_TOKEN from the
environment. When Oura rotates the refresh token, writes it back with
`gh secret set` using GH_SECRETS_PAT. Never prints token values.

Offline seed rebuild (no network, no secrets):

    python health/scripts/sync_oura.py --from-dir /path/to/raw/data
"""

from __future__ import annotations

import argparse
import os
import sys
from datetime import datetime
from pathlib import Path

from health_data import (
    DAILY_PATH,
    SGT,
    aggregate,
    load_json,
    load_raw_dir,
    material_payload,
    merge_documents,
    persist_refresh_token,
    pull_window,
    refresh_access_token,
    require_env,
    sync_window,
    today_sgt,
    write_json,
)


def rebuild_from_dir(path: Path, dest: Path) -> int:
    raw, as_of = load_raw_dir(path)
    if not raw:
        print(f"No Oura JSON found in {path}", file=sys.stderr)
        return 1
    doc = aggregate(raw, as_of=as_of)
    write_json(dest, doc)
    print(f"Wrote {dest} ({len(doc['days'])} days, {len(doc['workouts'])} workouts)")
    return 0


def sync(dest: Path) -> int:
    client_id = require_env("OURA_CLIENT_ID")
    client_secret = require_env("OURA_CLIENT_SECRET")
    old_refresh = require_env("OURA_REFRESH_TOKEN")
    pat = os.environ.get("GH_SECRETS_PAT", "").strip()
    repo = os.environ.get("GITHUB_REPOSITORY", "").strip()
    secrets = [client_id, client_secret, old_refresh, pat]

    access, refresh_token = refresh_access_token(client_id, client_secret, old_refresh)
    secrets.append(refresh_token)
    # Store the rotated token before any later step can fail and lose it.
    persist_refresh_token(refresh_token, old_refresh, repo=repo, pat=pat, secrets=secrets)

    existing = load_json(dest)
    today = today_sgt()
    start, end = sync_window(existing, today)
    print(f"Pulling Oura data from {start.isoformat()} to {end.isoformat()}")

    raw, ok, notes = pull_window(access, start, end)
    if notes == ["unauthorized"]:
        access, rotated = refresh_access_token(client_id, client_secret, refresh_token)
        secrets.append(rotated)
        persist_refresh_token(rotated, refresh_token, repo=repo, pat=pat, secrets=secrets)
        refresh_token = rotated
        raw, ok, notes = pull_window(access, start, end)

    for note in notes:
        print(note)
    if not ok:
        print("No Oura endpoints succeeded. Stored data was left unchanged.", file=sys.stderr)
        return 1

    as_of = datetime.now(SGT)
    fresh = aggregate(raw, as_of=as_of)
    merged = merge_documents(
        existing,
        fresh,
        ok_endpoints=ok,
        window_start=start.isoformat(),
        window_end=end.isoformat(),
        as_of=as_of,
    )
    if existing and material_payload(existing) == material_payload(merged):
        print("Aggregated data unchanged.")
        return 0
    write_json(dest, merged)
    print(f"Wrote {dest} ({len(merged['days'])} days, {len(merged['workouts'])} workouts)")
    return 0


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Update the public Oura health JSON.")
    parser.add_argument("--from-dir", type=Path, help="Aggregate local raw JSON instead of calling Oura.")
    parser.add_argument("--out", type=Path, default=DAILY_PATH)
    args = parser.parse_args(argv)
    if args.from_dir:
        return rebuild_from_dir(args.from_dir, args.out)
    return sync(args.out)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
