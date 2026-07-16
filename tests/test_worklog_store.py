import tempfile
import unittest
from datetime import date, datetime, timezone
from pathlib import Path

import cost_dashboard
from worklog_store import WorklogStore, build_activity_spans, merge_spans


class ActivitySpanTests(unittest.TestCase):
    def test_idle_gap_starts_a_new_span(self):
        points = [
            datetime(2026, 7, 15, 10, 0, tzinfo=timezone.utc),
            datetime(2026, 7, 15, 10, 10, tzinfo=timezone.utc),
            datetime(2026, 7, 15, 10, 40, tzinfo=timezone.utc),
        ]
        spans = build_activity_spans(points, idle_seconds=15 * 60)
        self.assertEqual(
            spans,
            [
                ["2026-07-15T10:00:00Z", "2026-07-15T10:11:00Z"],
                ["2026-07-15T10:40:00Z", "2026-07-15T10:41:00Z"],
            ],
        )

    def test_merge_spans_unions_overlaps(self):
        at = lambda hour, minute=0: datetime(
            2026, 7, 15, hour, minute, tzinfo=timezone.utc
        )
        self.assertEqual(
            merge_spans([(at(10), at(11)), (at(10, 30), at(11, 30))]),
            [(at(10), at(11, 30))],
        )


class WorklogStoreTests(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.store = WorklogStore(Path(self.tempdir.name) / "work.sqlite3")

    def tearDown(self):
        self.tempdir.cleanup()

    def session(self, uid, start, end):
        return {
            "agent": "codex",
            "session_uid": uid,
            "project_key": "dashboard",
            "project_name": "Dashboard",
            "cwd": "/work/dashboard",
            "activity_spans": [[start, end]],
            "metrics": {
                "messages": 1,
                "tokens": 42,
                "cost": 0.125,
                "models": {},
                "tools": {},
                "daily": {},
            },
        }

    def test_stores_synced_statistics(self):
        self.store.upsert_sessions(
            "desktop",
            [self.session("one", "2026-07-15T10:00:00Z", "2026-07-15T11:00:00Z")],
        )
        rows = self.store.synced_statistics()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["machine_id"], "desktop")
        self.assertEqual(rows[0]["metrics"]["tokens"], 42)

    def test_synced_statistics_populate_dashboard_aggregates(self):
        session = self.session(
            "one", "2026-07-15T10:00:00Z", "2026-07-15T11:00:00Z"
        )
        session["metrics"] = {
            "messages": 2,
            "tokens": 42,
            "input_tokens": 20,
            "output_tokens": 12,
            "cache_read_tokens": 10,
            "cache_write_tokens": 0,
            "reasoning_tokens": 0,
            "cost": 0.125,
            "llm_time": 1.5,
            "tool_time": 0.5,
            "avg_tps": 8.0,
            "models": {
                "gpt-test": {
                    "messages": 2,
                    "tokens": 42,
                    "input_tokens": 20,
                    "output_tokens": 12,
                    "cache_read_tokens": 10,
                    "cache_write_tokens": 0,
                    "reasoning_tokens": 0,
                    "cost": 0.125,
                    "llm_time": 1.5,
                }
            },
            "tools": {"exec": {"calls": 1, "time": 0.5, "errors": 0}},
            "daily": {
                "2026-07-15": {
                    "messages": 2,
                    "cost": 0.125,
                    "models": {"gpt-test": 0.125},
                }
            },
        }
        self.store.upsert_sessions("desktop", [session])
        previous = cost_dashboard.WORKLOG_STORE
        cost_dashboard.WORKLOG_STORE = self.store
        try:
            projects = cost_dashboard._collect_synced_projects()
        finally:
            cost_dashboard.WORKLOG_STORE = previous
        self.assertEqual(projects[0]["total_tokens"], 42)
        self.assertEqual(projects[0]["models"]["gpt-test"]["cost"], 0.125)
        self.assertEqual(projects[0]["tools"]["exec"]["calls"], 1)

    def test_report_does_not_double_count_overlapping_machines(self):
        self.store.upsert_sessions(
            "desktop",
            [self.session("one", "2026-07-15T10:00:00Z", "2026-07-15T11:00:00Z")],
        )
        self.store.upsert_sessions(
            "laptop",
            [self.session("two", "2026-07-15T10:30:00Z", "2026-07-15T11:30:00Z")],
        )
        report = self.store.report(
            date(2026, 7, 15), date(2026, 7, 15), "UTC"
        )
        self.assertEqual(report[0]["seconds"], 90 * 60)
        self.assertEqual(report[0]["machines"], 2)
        self.assertEqual(report[0]["sessions"], 2)
        self.assertEqual(
            {item["machine_id"] for item in self.store.sync_status()},
            {"desktop", "laptop"},
        )

    def test_upsert_replaces_a_growing_session(self):
        self.store.upsert_sessions(
            "desktop",
            [self.session("same", "2026-07-15T10:00:00Z", "2026-07-15T10:30:00Z")],
        )
        self.store.upsert_sessions(
            "desktop",
            [self.session("same", "2026-07-15T10:00:00Z", "2026-07-15T11:00:00Z")],
        )
        report = self.store.report(
            date(2026, 7, 15), date(2026, 7, 15), "UTC"
        )
        self.assertEqual(report[0]["seconds"], 60 * 60)
        self.assertEqual(report[0]["sessions"], 1)

    def test_report_splits_at_local_midnight(self):
        self.store.upsert_sessions(
            "desktop",
            [self.session("night", "2026-07-15T21:30:00Z", "2026-07-15T22:30:00Z")],
        )
        report = self.store.report(
            date(2026, 7, 15), date(2026, 7, 16), "Europe/Prague"
        )
        self.assertEqual(
            report[0]["daily"],
            [
                {"date": "2026-07-15", "seconds": 1800, "hours": 0.5},
                {"date": "2026-07-16", "seconds": 1800, "hours": 0.5},
            ],
        )


if __name__ == "__main__":
    unittest.main()
