#!/usr/bin/env python3
"""Aggregate Oura records and update the public weight log.

The page only needs daily totals. Minute-level series (MET, heart-rate
samples, sleep phases) and personal_info (email, id) are never written.
"""

from __future__ import annotations

import csv
import json
import os
import re
import subprocess
import sys
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

SGT = timezone(timedelta(hours=8))
TOKEN_URL = "https://moi.ouraring.com/oauth/v2/ext/oauth-token"
API_BASE = "https://api.ouraring.com/v2/usercollection/"

# personal_info is intentionally absent: it carries an email address.
ENDPOINTS = (
    "daily_activity",
    "daily_sleep",
    "sleep",
    "daily_readiness",
    "daily_stress",
    "workout",
)

GOALS = {
    "weight_start_kg": 92,
    "weight_start_date": "2026-11-18",
    "weight_target_kg": 80,
    "pace_kg_per_week": 0.5,
    "steps_per_day": 10000,
    "cardio_min_per_week": 150,
}

# Public JSON keeps a rolling inclusive window ending on as_of (SGT).
HISTORY_DAYS = 90

ROOT = Path(__file__).resolve().parents[2]
DAILY_PATH = ROOT / "health" / "data" / "daily.json"
WEIGHT_PATH = ROOT / "health" / "data" / "weight.csv"

# Fields replaced when that endpoint succeeds. cardio_min is derived.
ACTIVITY_FIELDS = ("steps", "active_cal", "total_cal", "activity_score", "medium_min", "high_min")
SLEEP_FIELDS = (
    "sleep_h",
    "deep_h",
    "rem_h",
    "light_h",
    "efficiency",
    "hrv",
    "resting_hr",
    "bedtime_start",
    "bedtime_end",
)
SLEEP_SCORE_FIELDS = ("sleep_score",)
READINESS_FIELDS = ("readiness",)
STRESS_FIELDS = ("stress", "stress_high_min", "recovery_high_min")

DAY_FIELDS = (
    "date",
    "steps",
    "active_cal",
    "total_cal",
    "activity_score",
    "medium_min",
    "high_min",
    "workout_min",
    "cardio_min",
    "sleep_score",
    "sleep_h",
    "deep_h",
    "rem_h",
    "light_h",
    "efficiency",
    "hrv",
    "resting_hr",
    "bedtime_start",
    "bedtime_end",
    "readiness",
    "stress",
    "stress_high_min",
    "recovery_high_min",
    "incomplete",
)


def today_sgt() -> date:
    return datetime.now(SGT).date()


def parse_dt(value: str | None) -> datetime | None:
    if not value or not isinstance(value, str):
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=SGT)
    return dt.astimezone(SGT)


def to_sgt_iso(value: str | None) -> str | None:
    dt = parse_dt(value)
    if dt is None:
        return None
    return dt.replace(microsecond=0).isoformat()


def hours(seconds: Any) -> float | None:
    if seconds is None:
        return None
    try:
        return round(float(seconds) / 3600, 2)
    except (TypeError, ValueError):
        return None


def whole_minutes(seconds: Any) -> int | None:
    if seconds is None:
        return None
    try:
        return int(round(float(seconds) / 60))
    except (TypeError, ValueError):
        return None


def as_int(value: Any) -> int | None:
    if value is None:
        return None
    try:
        return int(round(float(value)))
    except (TypeError, ValueError):
        return None


def blank_day(day: str) -> dict[str, Any]:
    row = {field: None for field in DAY_FIELDS}
    row["date"] = day
    row["incomplete"] = False
    return row


def _primary_sleep(periods: list[dict[str, Any]]) -> dict[str, Any] | None:
    if not periods:
        return None
    long_sleeps = [p for p in periods if p.get("type") == "long_sleep"]
    pool = long_sleeps or periods

    def length(period: dict[str, Any]) -> float:
        try:
            return float(period.get("total_sleep_duration") or 0)
        except (TypeError, ValueError):
            return 0

    return max(pool, key=length)


def aggregate(raw: dict[str, list[dict[str, Any]]], *, as_of: datetime) -> dict[str, Any]:
    """Build a page document from raw Oura collections (already in memory)."""
    days: dict[str, dict[str, Any]] = {}

    def row(day: str) -> dict[str, Any]:
        if day not in days:
            days[day] = blank_day(day)
        return days[day]

    for item in raw.get("daily_activity") or []:
        day = item.get("day")
        if not day:
            continue
        rec = row(day)
        rec["steps"] = as_int(item.get("steps"))
        rec["active_cal"] = as_int(item.get("active_calories"))
        rec["total_cal"] = as_int(item.get("total_calories"))
        rec["activity_score"] = as_int(item.get("score"))
        rec["medium_min"] = whole_minutes(item.get("medium_activity_time"))
        rec["high_min"] = whole_minutes(item.get("high_activity_time"))

    sleep_by_day: dict[str, list[dict[str, Any]]] = {}
    for item in raw.get("sleep") or []:
        day = item.get("day")
        if day:
            sleep_by_day.setdefault(day, []).append(item)
    for day, periods in sleep_by_day.items():
        period = _primary_sleep(periods)
        if not period:
            continue
        rec = row(day)
        rec["sleep_h"] = hours(period.get("total_sleep_duration"))
        rec["deep_h"] = hours(period.get("deep_sleep_duration"))
        rec["rem_h"] = hours(period.get("rem_sleep_duration"))
        rec["light_h"] = hours(period.get("light_sleep_duration"))
        rec["efficiency"] = as_int(period.get("efficiency"))
        rec["hrv"] = as_int(period.get("average_hrv"))
        rec["resting_hr"] = as_int(period.get("lowest_heart_rate"))
        rec["bedtime_start"] = to_sgt_iso(period.get("bedtime_start"))
        rec["bedtime_end"] = to_sgt_iso(period.get("bedtime_end"))

    for item in raw.get("daily_sleep") or []:
        day = item.get("day")
        if not day:
            continue
        row(day)["sleep_score"] = as_int(item.get("score"))

    for item in raw.get("daily_readiness") or []:
        day = item.get("day")
        if not day:
            continue
        row(day)["readiness"] = as_int(item.get("score"))

    for item in raw.get("daily_stress") or []:
        day = item.get("day")
        if not day:
            continue
        rec = row(day)
        summary = item.get("day_summary")
        rec["stress"] = summary if isinstance(summary, str) else None
        rec["stress_high_min"] = whole_minutes(item.get("stress_high"))
        rec["recovery_high_min"] = whole_minutes(item.get("recovery_high"))

    workout_minutes: dict[str, int] = {}
    workouts: list[dict[str, Any]] = []
    for item in raw.get("workout") or []:
        start = parse_dt(item.get("start_datetime"))
        end = parse_dt(item.get("end_datetime"))
        if start is None or end is None:
            continue
        minutes = int(round((end - start).total_seconds() / 60))
        if minutes <= 0:
            continue
        day = item.get("day") or start.date().isoformat()
        workout_minutes[day] = workout_minutes.get(day, 0) + minutes
        row(day)
        workouts.append(
            {
                "day": day,
                "start": start.replace(microsecond=0).isoformat(),
                "end": end.replace(microsecond=0).isoformat(),
                "activity": item.get("activity") if isinstance(item.get("activity"), str) else "other",
                "minutes": minutes,
                "kcal": as_int(item.get("calories")),
                "intensity": item.get("intensity") if isinstance(item.get("intensity"), str) else None,
            }
        )

    as_of_day = as_of.astimezone(SGT).date().isoformat()
    for day, rec in days.items():
        rec["workout_min"] = workout_minutes.get(day, 0)
        medium = rec["medium_min"] or 0
        high = rec["high_min"] or 0
        # The longer of the two, so a logged workout is not added on top of
        # the medium/high minutes that already include it.
        rec["cardio_min"] = max(medium + high, rec["workout_min"])
        rec["incomplete"] = day == as_of_day

    ordered_days = [days[key] for key in sorted(days)]
    workouts.sort(key=lambda item: (item["start"], item["activity"]))
    return {
        "timezone": "Asia/Singapore",
        "generated_at": as_of.astimezone(SGT).replace(microsecond=0).isoformat(),
        "goals": dict(GOALS),
        "cardio_definition": (
            "Each day counts the longer of medium-plus-high activity minutes "
            "and logged workout minutes, so overlapping time is not added twice. "
            "Weekly cardio is the sum of those days."
        ),
        "days": ordered_days,
        "workouts": workouts,
    }


def _copy_fields(src: dict[str, Any], dest: dict[str, Any], fields: tuple[str, ...]) -> None:
    for field in fields:
        if field in src:
            dest[field] = src[field]


def merge_documents(
    existing: dict[str, Any] | None,
    fresh: dict[str, Any],
    *,
    ok_endpoints: set[str],
    window_start: str,
    window_end: str,
    as_of: datetime,
) -> dict[str, Any]:
    """Overlay a successful pull onto the stored document.

    A failed endpoint leaves the previous values for its fields in place.
    """
    old_days = {row["date"]: row for row in (existing or {}).get("days") or [] if row.get("date")}
    new_days = {row["date"]: row for row in fresh.get("days") or []}
    as_of_day = as_of.astimezone(SGT).date().isoformat()

    dates = set(old_days) | set(new_days)
    merged: list[dict[str, Any]] = []
    for day in sorted(dates):
        base = blank_day(day)
        if day in old_days:
            _copy_fields(old_days[day], base, DAY_FIELDS)
        incoming = new_days.get(day)
        in_window = window_start <= day <= window_end
        if incoming and in_window:
            if "daily_activity" in ok_endpoints:
                _copy_fields(incoming, base, ACTIVITY_FIELDS)
            if "sleep" in ok_endpoints:
                _copy_fields(incoming, base, SLEEP_FIELDS)
            if "daily_sleep" in ok_endpoints:
                _copy_fields(incoming, base, SLEEP_SCORE_FIELDS)
            if "daily_readiness" in ok_endpoints:
                _copy_fields(incoming, base, READINESS_FIELDS)
            if "daily_stress" in ok_endpoints:
                _copy_fields(incoming, base, STRESS_FIELDS)
            if "workout" in ok_endpoints:
                base["workout_min"] = incoming.get("workout_min") or 0
        elif incoming and day not in old_days:
            _copy_fields(incoming, base, DAY_FIELDS)
        medium = base["medium_min"] or 0
        high = base["high_min"] or 0
        base["workout_min"] = base["workout_min"] or 0
        base["cardio_min"] = max(medium + high, base["workout_min"])
        base["incomplete"] = day == as_of_day
        merged.append(base)

    if "workout" in ok_endpoints:
        kept = [
            item
            for item in (existing or {}).get("workouts") or []
            if not (window_start <= str(item.get("day")) <= window_end)
        ]
        incoming = [
            item
            for item in fresh.get("workouts") or []
            if window_start <= str(item.get("day")) <= window_end
        ]
        workouts = kept + incoming
    else:
        workouts = list((existing or {}).get("workouts") or fresh.get("workouts") or [])
    workouts.sort(key=lambda item: (item.get("start") or "", item.get("activity") or ""))

    # Drop days older than the rolling window so daily.json does not grow
    # by one entry on every successful sync.
    cutoff = (as_of.astimezone(SGT).date() - timedelta(days=HISTORY_DAYS - 1)).isoformat()
    merged = [row for row in merged if row["date"] >= cutoff]
    workouts = [item for item in workouts if str(item.get("day") or "") >= cutoff]

    return {
        "timezone": "Asia/Singapore",
        "generated_at": as_of.astimezone(SGT).replace(microsecond=0).isoformat(),
        "goals": dict(GOALS),
        "cardio_definition": fresh.get("cardio_definition"),
        "days": merged,
        "workouts": workouts,
    }


def material_payload(doc: dict[str, Any]) -> dict[str, Any]:
    return {
        "goals": doc.get("goals"),
        "cardio_definition": doc.get("cardio_definition"),
        "days": doc.get("days"),
        "workouts": doc.get("workouts"),
    }


def write_json(path: Path, doc: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(doc, indent=2, ensure_ascii=False) + "\n"
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)


def load_json(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def load_raw_dir(path: Path) -> tuple[dict[str, list[dict[str, Any]]], datetime]:
    raw: dict[str, list[dict[str, Any]]] = {}
    for name in ENDPOINTS:
        file = path / f"{name}.json"
        if not file.exists():
            continue
        payload = json.loads(file.read_text(encoding="utf-8"))
        if isinstance(payload, list):
            raw[name] = payload
    as_of = datetime.now(SGT)
    summary = path / "_pull_summary.json"
    if summary.exists():
        meta = json.loads(summary.read_text(encoding="utf-8"))
        pulled = meta.get("pulled_at")
        if isinstance(pulled, str):
            parsed = parse_dt(pulled)
            if parsed is not None:
                as_of = parsed
    return raw, as_of


# --- weight log -----------------------------------------------------------

_DATE_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")


def format_kg(kg: float) -> str:
    return f"{kg:.2f}".rstrip("0").rstrip(".")


def parse_kg(value: str) -> float:
    text = value.strip().replace(",", ".")
    if not re.fullmatch(r"\d+(\.\d+)?", text):
        raise ValueError("Enter a weight in kilograms, for example 91.4.")
    kg = round(float(text), 2)
    if kg < 30 or kg > 250:
        raise ValueError("Enter a weight between 30 and 250 kg.")
    return kg


def parse_log_date(value: str | None, *, today: date) -> date:
    if value is None:
        return today
    text = value.strip()
    if text in {"", "_No response_", "No response"}:
        return today
    match = _DATE_RE.fullmatch(text)
    if not match:
        raise ValueError("Enter the date as YYYY-MM-DD, or leave it blank for today.")
    year, month, day = (int(match.group(i)) for i in (1, 2, 3))
    try:
        parsed = date(year, month, day)
    except ValueError as exc:
        raise ValueError("That date is not a real calendar day.") from exc
    if parsed > today:
        raise ValueError("The date is in the future in Singapore. Leave it blank to use today.")
    if parsed.year < 2010:
        raise ValueError("Enter a date from 2010 onwards.")
    return parsed


def parse_issue_body(body: str) -> tuple[str | None, str]:
    def field(label: str) -> str | None:
        match = re.search(rf"### {re.escape(label)}\s*\n+([^\n]*)", body)
        if not match:
            return None
        value = match.group(1).strip()
        if value in {"", "_No response_", "No response"}:
            return None
        return value

    kg = field("Weight (kg)")
    if kg is None:
        raise ValueError("Enter a weight in kilograms, for example 91.4.")
    return field("Date"), kg


def read_weights(path: Path) -> list[tuple[date, float]]:
    if not path.exists():
        return []
    rows: list[tuple[date, float]] = []
    with path.open(encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        for record in reader:
            if not record:
                continue
            raw_date = (record.get("date") or "").strip()
            raw_kg = (record.get("kg") or "").strip()
            if not raw_date or not raw_kg:
                continue
            rows.append((date.fromisoformat(raw_date), float(raw_kg)))
    return rows


def write_weights(path: Path, rows: list[tuple[date, float]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    ordered = sorted(rows, key=lambda item: item[0])
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle, lineterminator="\n")
        writer.writerow(["date", "kg"])
        for logged, kg in ordered:
            writer.writerow([logged.isoformat(), format_kg(kg)])
    os.replace(tmp, path)


def apply_weight_log(path: Path, *, kg_text: str, date_text: str | None, today: date | None = None) -> dict[str, Any]:
    current = today or today_sgt()
    kg = parse_kg(kg_text)
    logged = parse_log_date(date_text, today=current)
    previous = read_weights(path)
    replaced = any(day == logged for day, _weight in previous)
    rows = [(day, weight) for day, weight in previous if day != logged]
    rows.append((logged, kg))
    write_weights(path, rows)
    verb = "Updated" if replaced else "Logged"
    message = f"{verb} {format_kg(kg)} kg for {logged.isoformat()}."
    commit = f"{'Update' if replaced else 'Log'} weight for {logged.isoformat()}"
    return {
        "ok": True,
        "commit": True,
        "message": message,
        "commit_message": commit,
        "date": logged.isoformat(),
        "kg": format_kg(kg),
    }


# --- Oura HTTP ------------------------------------------------------------

def redact(text: str, secrets: list[str]) -> str:
    out = text or ""
    for secret in secrets:
        if secret and len(secret) >= 4:
            out = out.replace(secret, "[redacted]")
    return out


def safe_api_error(body: Any) -> str:
    if not isinstance(body, dict):
        return ""
    msg = body.get("error") or body.get("message") or body.get("detail") or ""
    if not isinstance(msg, str):
        return ""
    if not re.fullmatch(r"[A-Za-z0-9 _.:-]{1,80}", msg):
        return ""
    if "token" in msg.lower() or "secret" in msg.lower():
        return ""
    return msg


def http_json(
    method: str,
    url: str,
    *,
    headers: dict[str, str] | None = None,
    form: dict[str, str] | None = None,
    timeout: int = 60,
) -> tuple[int, Any]:
    data = None
    req_headers = dict(headers or {})
    if form is not None:
        data = urlencode(form).encode("utf-8")
        req_headers.setdefault("Content-Type", "application/x-www-form-urlencoded")
    req = Request(url, data=data, headers=req_headers, method=method)
    try:
        with urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8")
            return resp.status, json.loads(raw) if raw else None
    except HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            body = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            body = {}
        return exc.code, body
    except URLError:
        return 0, {}


def refresh_access_token(client_id: str, client_secret: str, refresh_token: str) -> tuple[str, str]:
    status, body = http_json(
        "POST",
        TOKEN_URL,
        form={
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "client_id": client_id,
            "client_secret": client_secret,
        },
    )
    if status != 200 or not isinstance(body, dict) or "access_token" not in body:
        detail = safe_api_error(body)
        extra = f": {detail}" if detail else ""
        raise SystemExit(f"Token refresh failed (HTTP {status}){extra}")
    access = str(body["access_token"])
    rotated = body.get("refresh_token")
    new_refresh = str(rotated) if isinstance(rotated, str) and rotated else refresh_token
    return access, new_refresh


def persist_refresh_token(new_token: str, old_token: str, *, repo: str, pat: str, secrets: list[str]) -> None:
    if new_token == old_token:
        print("Refresh token unchanged; repository secret left as it is.")
        return
    if not pat:
        raise SystemExit(
            "Oura rotated the refresh token but GH_SECRETS_PAT is not set, so it could not be saved."
        )
    if not repo:
        raise SystemExit("GITHUB_REPOSITORY is not set; cannot store the rotated refresh token.")
    env = os.environ.copy()
    env["GH_TOKEN"] = pat
    env["GITHUB_TOKEN"] = pat
    env["GH_PROMPT_DISABLED"] = "1"
    env["GH_NO_UPDATE_NOTIFIER"] = "1"
    last_status = 1
    for attempt in range(1, 5):
        proc = subprocess.run(
            ["gh", "secret", "set", "OURA_REFRESH_TOKEN", "--repo", repo],
            input=new_token + "\n",
            text=True,
            env=env,
            capture_output=True,
            check=False,
        )
        last_status = proc.returncode
        if proc.returncode == 0:
            print("Saved the rotated Oura refresh token to the OURA_REFRESH_TOKEN secret.")
            return
        print(f"Saving the rotated refresh token failed (attempt {attempt}, exit {proc.returncode}).")
        detail = redact((proc.stderr or "") + (proc.stdout or ""), secrets + [new_token, pat])
        if detail.strip():
            print(detail.strip()[:300])
        time.sleep(2 ** (attempt - 1))
    raise SystemExit(
        "Could not store the rotated refresh token "
        f"(gh exit {last_status}). The previous OURA_REFRESH_TOKEN secret is no longer valid. "
        "Check that GH_SECRETS_PAT is a fine-grained token with Secrets: Read and write "
        "on this repository, then authorise Oura again and update OURA_REFRESH_TOKEN."
    )


def fetch_collection(endpoint: str, token: str, params: dict[str, str]) -> tuple[str, list[dict[str, Any]] | None, str]:
    collected: list[dict[str, Any]] = []
    next_token: str | None = None
    pages = 0
    while True:
        query = dict(params)
        if next_token:
            query["next_token"] = next_token
        url = API_BASE + endpoint + "?" + urlencode(query)
        status, body = http_json(
            "GET",
            url,
            headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
        )
        if status == 401:
            return "unauthorized", None, "HTTP 401"
        if status != 200:
            detail = safe_api_error(body)
            note = f"HTTP {status}" + (f": {detail}" if detail else "")
            return "error", None, note
        if not isinstance(body, dict):
            return "error", None, "Unexpected response shape"
        rows = body.get("data")
        if isinstance(rows, list):
            collected.extend(row for row in rows if isinstance(row, dict))
        pages += 1
        next_token = body.get("next_token") or None
        if not next_token or pages > 100:
            break
        time.sleep(0.05)
    return "ok", collected, f"{len(collected)} records"


def pull_window(token: str, start: date, end: date) -> tuple[dict[str, list[dict[str, Any]]], set[str], list[str]]:
    params = {"start_date": start.isoformat(), "end_date": end.isoformat()}
    raw: dict[str, list[dict[str, Any]]] = {}
    ok: set[str] = set()
    notes: list[str] = []
    current = token
    for endpoint in ENDPOINTS:
        status, rows, note = fetch_collection(endpoint, current, params)
        if status == "unauthorized":
            return raw, ok, ["unauthorized"]
        if status != "ok" or rows is None:
            notes.append(f"{endpoint}: {note}")
            continue
        raw[endpoint] = rows
        ok.add(endpoint)
        notes.append(f"{endpoint}: {note}")
    return raw, ok, notes


def sync_window(existing: dict[str, Any] | None, today: date) -> tuple[date, date]:
    """Recent overlap, widened when stored days stop before today."""
    full_start = today - timedelta(days=HISTORY_DAYS - 1)
    start = today - timedelta(days=29)
    if not existing or not existing.get("days"):
        return full_start, today
    dates = [row["date"] for row in existing["days"] if row.get("date")]
    if not dates:
        return full_start, today
    last = date.fromisoformat(max(dates))
    catchup = last - timedelta(days=2)
    if catchup < start:
        start = catchup
    earliest = today - timedelta(days=120)
    if start < earliest:
        start = earliest
    if start > today:
        start = today
    return start, today


def require_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise SystemExit(f"{name} is not set")
    return value
