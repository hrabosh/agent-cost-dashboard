import tempfile
import unittest
from datetime import date, datetime, timezone
from pathlib import Path

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
        }

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
