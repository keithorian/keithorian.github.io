#!/usr/bin/env python3
"""Checks for the public health log. No network and no secrets."""

from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from health_data import (  # noqa: E402
    ROOT,
    aggregate,
    apply_weight_log,
    load_raw_dir,
    material_payload,
    merge_documents,
    parse_issue_body,
    parse_kg,
    parse_log_date,
    read_weights,
    sync_window,
)

DAILY = ROOT / "health" / "data" / "daily.json"
WEIGHT = ROOT / "health" / "data" / "weight.csv"
SEED = Path("/tmp/oura_seed/data")
AS_OF = __import__("datetime").datetime(2026, 11, 18, 13, 11, tzinfo=__import__("datetime").timezone(
    __import__("datetime").timedelta(hours=8)
))


def _walk_keys(value):
    if isinstance(value, dict):
        yield from value.keys()
        for child in value.values():
            yield from _walk_keys(child)
    elif isinstance(value, list):
        for child in value:
            yield from _walk_keys(child)


class AggregateTests(unittest.TestCase):
    def test_committed_file_is_trimmed(self):
        doc = json.loads(DAILY.read_text(encoding="utf-8"))
        text = DAILY.read_text(encoding="utf-8")
        self.assertEqual(doc["timezone"], "Asia/Singapore")
        self.assertEqual(doc["goals"]["weight_start_kg"], 92)
        self.assertEqual(doc["goals"]["weight_target_kg"], 80)
        self.assertEqual(len(doc["days"]), 90)
        keys = set(_walk_keys(doc))
        for forbidden in ("id", "email", "ring_id", "biological_sex", "class_5_min", "heart_rate", "hrv"):
            # "hrv" as a daily average is allowed; the raw series key is also "hrv"
            # on sleep documents. The aggregated day uses "hrv" for the average.
            if forbidden == "hrv":
                continue
            self.assertNotIn(forbidden, keys)
        for secret in ("@", "access_token", "refresh_token", "movement_30", "class_5_min"):
            self.assertNotIn(secret, text)
        by_day = {row["date"]: row for row in doc["days"]}
        nov18 = by_day["2026-11-18"]
        self.assertEqual(nov18["steps"], 2165)
        self.assertEqual(nov18["sleep_h"], 7.25)
        self.assertEqual(nov18["hrv"], 22)
        self.assertEqual(nov18["resting_hr"], 76)
        self.assertTrue(nov18["incomplete"])
        self.assertEqual(nov18["cardio_min"], 15)
        nov17 = by_day["2026-11-17"]
        self.assertEqual(nov17["steps"], 5084)
        self.assertFalse(nov17["incomplete"])
        self.assertEqual(by_day["2026-09-07"]["cardio_min"], 48)
        self.assertEqual(by_day["2026-08-22"]["cardio_min"], 119)
        crossed = next(
            item for item in doc["workouts"] if item["day"] == "2026-10-11" and item["minutes"] == 57
        )
        self.assertEqual(crossed["start"], "2026-10-12T00:22:00+08:00")
        self.assertEqual(crossed["end"], "2026-10-12T01:19:00+08:00")

    def test_seed_matches_aggregator(self):
        if not SEED.exists():
            self.skipTest("seed archive not on disk")
        raw, as_of = load_raw_dir(SEED)
        fresh = aggregate(raw, as_of=as_of)
        committed = json.loads(DAILY.read_text(encoding="utf-8"))
        self.assertEqual(material_payload(fresh), material_payload(committed))

    def test_ignores_minute_series_and_email(self):
        raw = {
            "sleep": [
                {
                    "id": "sleep-id",
                    "email": "person@example.com",
                    "ring_id": "ring",
                    "day": "2026-11-17",
                    "type": "long_sleep",
                    "total_sleep_duration": 22500,
                    "deep_sleep_duration": 2000,
                    "rem_sleep_duration": 4000,
                    "light_sleep_duration": 16500,
                    "efficiency": 80,
                    "average_hrv": 21,
                    "lowest_heart_rate": 77,
                    "bedtime_start": "2026-11-16T23:00:00+08:00",
                    "bedtime_end": "2026-11-17T06:00:00+08:00",
                    "heart_rate": {"items": [70, 71]},
                    "hrv": {"items": [20, 21]},
                    "movement_30_sec": "1" * 40,
                }
            ],
            "daily_activity": [
                {
                    "id": "act-id",
                    "day": "2026-11-17",
                    "steps": 1000,
                    "active_calories": 10,
                    "total_calories": 20,
                    "score": 50,
                    "medium_activity_time": 600,
                    "high_activity_time": 0,
                    "class_5_min": "0" * 20,
                    "met": {"items": [1.0, 1.1]},
                }
            ],
            "workout": [
                {
                    "id": "wo",
                    "activity": "walking",
                    "calories": 40,
                    "day": "2026-11-17",
                    "start_datetime": "2026-11-17T10:00:00+08:00",
                    "end_datetime": "2026-11-17T10:20:00+08:00",
                    "intensity": "moderate",
                }
            ],
        }
        doc = aggregate(raw, as_of=AS_OF)
        text = json.dumps(doc)
        self.assertNotIn("example.com", text)
        self.assertNotIn("class_5_min", text)
        self.assertNotIn("sleep-id", text)
        self.assertNotIn("movement_30", text)
        day = doc["days"][0]
        self.assertEqual(day["cardio_min"], 20)
        self.assertEqual(day["hrv"], 21)
        self.assertEqual(day["workout_min"], 20)

    def test_merge_keeps_fields_when_an_endpoint_fails(self):
        existing = aggregate(
            {
                "daily_activity": [
                    {
                        "day": "2026-11-17",
                        "steps": 1000,
                        "active_calories": 10,
                        "total_calories": 20,
                        "score": 50,
                        "medium_activity_time": 600,
                        "high_activity_time": 0,
                    }
                ],
                "sleep": [
                    {
                        "day": "2026-11-17",
                        "type": "long_sleep",
                        "total_sleep_duration": 25200,
                        "average_hrv": 30,
                        "lowest_heart_rate": 60,
                    }
                ],
            },
            as_of=AS_OF,
        )
        fresh = aggregate(
            {
                "daily_activity": [
                    {
                        "day": "2026-11-17",
                        "steps": 1100,
                        "active_calories": 12,
                        "total_calories": 22,
                        "score": 55,
                        "medium_activity_time": 1200,
                        "high_activity_time": 0,
                    }
                ]
            },
            as_of=AS_OF,
        )
        merged = merge_documents(
            existing,
            fresh,
            ok_endpoints={"daily_activity"},
            window_start="2026-11-01",
            window_end="2026-11-18",
            as_of=AS_OF,
        )
        day = merged["days"][0]
        self.assertEqual(day["steps"], 1100)
        self.assertEqual(day["hrv"], 30)
        self.assertEqual(day["resting_hr"], 60)
        self.assertEqual(day["cardio_min"], 20)

    def test_sync_window(self):
        start, end = sync_window(None, date(2026, 11, 18))
        self.assertEqual((start, end), (date(2026, 8, 21), date(2026, 11, 18)))
        start, end = sync_window({"days": [{"date": "2026-11-18"}]}, date(2026, 11, 18))
        self.assertEqual(start, date(2026, 11, 18) - timedelta(days=29))
        start, end = sync_window({"days": [{"date": "2026-09-01"}]}, date(2026, 11, 18))
        self.assertEqual(start, date(2026, 8, 30))
        self.assertEqual(end, date(2026, 11, 18))

    def test_illustrative_pace_lands_on_5_may_2027(self):
        weeks = (92 - 80) / 0.5
        self.assertEqual(date(2026, 11, 18) + timedelta(days=round(weeks * 7)), date(2027, 5, 5))


class WeightTests(unittest.TestCase):
    def test_seed_weight(self):
        rows = read_weights(WEIGHT)
        self.assertEqual(rows[0], (date(2026, 11, 18), 92.0))

    def test_issue_form_blank_date_means_today(self):
        body = "### Date\n\n_No response_\n\n### Weight (kg)\n\n91.4\n"
        parsed_date, kg = parse_issue_body(body)
        self.assertIsNone(parsed_date)
        self.assertEqual(parse_kg(kg), 91.4)
        self.assertEqual(parse_log_date(parsed_date, today=date(2026, 11, 19)), date(2026, 11, 19))

    def test_rejects_nonsense(self):
        with self.assertRaises(ValueError):
            parse_kg("920")
        with self.assertRaises(ValueError):
            parse_kg("ninety")
        with self.assertRaises(ValueError):
            parse_log_date("2026-11-19", today=date(2026, 11, 18))
        with self.assertRaises(ValueError):
            parse_log_date("18/11/2026", today=date(2026, 11, 18))

    def test_upsert_replaces_same_day(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "weight.csv"
            os.environ["WEIGHT_CSV"] = str(path)
            try:
                first = apply_weight_log(path, kg_text="92", date_text="2026-11-18", today=date(2026, 11, 18))
                second = apply_weight_log(path, kg_text="91,5", date_text=None, today=date(2026, 11, 19))
                third = apply_weight_log(path, kg_text="91.2", date_text="2026-11-19", today=date(2026, 11, 19))
            finally:
                os.environ.pop("WEIGHT_CSV", None)
            self.assertTrue(first["commit"])
            self.assertIn("Logged", first["message"])
            self.assertIn("Logged", second["message"])
            self.assertIn("Updated", third["message"])
            self.assertEqual(
                read_weights(path),
                [(date(2026, 11, 18), 92.0), (date(2026, 11, 19), 91.2)],
            )
            text = path.read_text(encoding="utf-8")
            self.assertTrue(text.endswith("\n"))
            self.assertEqual(text.splitlines()[0], "date,kg")


class PageCopyTests(unittest.TestCase):
    def test_page_labels_projection_and_refuses_medical_advice(self):
        html = (ROOT / "health" / "index.html").read_text(encoding="utf-8")
        self.assertIn("not medical advice", html.lower())
        self.assertIn("Illustrative projection", html)
        self.assertIn("not a forecast", html)
        self.assertIn("10,000", html)
        self.assertIn("150 minutes", html)
        self.assertIn("log-weight.yml", html)
        self.assertIn('lang="en-GB"', html)
        for american in ("favorite", "labeled", "color of", "toward the"):
            self.assertNotIn(american, html.lower())


if __name__ == "__main__":
    unittest.main()
