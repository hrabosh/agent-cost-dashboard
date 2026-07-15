"""Central, dependency-free storage and reporting for agent work activity."""

from __future__ import annotations

import json
import sqlite3
from collections import defaultdict
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from typing import Iterable
from zoneinfo import ZoneInfo


SCHEMA = """
CREATE TABLE IF NOT EXISTS synced_sessions (
    machine_id TEXT NOT NULL,
    agent TEXT NOT NULL,
    session_uid TEXT NOT NULL,
    project_key TEXT NOT NULL,
    project_name TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT NOT NULL,
    activity_spans TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (machine_id, agent, session_uid)
);
CREATE INDEX IF NOT EXISTS synced_sessions_dates
    ON synced_sessions(started_at, ended_at);
CREATE INDEX IF NOT EXISTS synced_sessions_project
    ON synced_sessions(project_key);
"""


def utc_iso(value: datetime) -> str:
    """Return a stable, lexically sortable UTC timestamp."""
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def parse_iso(value: str) -> datetime:
    if not isinstance(value, str):
        raise ValueError("timestamp must be a string")
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def build_activity_spans(
    timestamps: Iterable[datetime], idle_seconds: int = 15 * 60
) -> list[list[str]]:
    """Turn event heartbeats into active wall-clock spans.

    Consecutive events at most ``idle_seconds`` apart are considered one active
    period. An isolated/final event contributes one minute, which avoids both a
    zero-duration session and a full idle-time charge.
    """
    points = sorted(
        {
            value.astimezone(timezone.utc)
            if value.tzinfo
            else value.replace(tzinfo=timezone.utc)
            for value in timestamps
        }
    )
    if not points:
        return []

    spans: list[tuple[datetime, datetime]] = []
    start = points[0]
    previous = points[0]
    cutoff = timedelta(seconds=max(60, idle_seconds))
    tail = timedelta(minutes=1)

    for current in points[1:]:
        if current - previous > cutoff:
            spans.append((start, previous + tail))
            start = current
        previous = current
    spans.append((start, previous + tail))

    return [[utc_iso(start), utc_iso(end)] for start, end in spans]


class WorklogStore:
    def __init__(self, path: str | Path):
        self.path = Path(path)

    def connect(self) -> sqlite3.Connection:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(self.path, timeout=15)
        connection.row_factory = sqlite3.Row
        connection.executescript(SCHEMA)
        return connection

    def upsert_sessions(self, machine_id: str, sessions: list[dict]) -> int:
        now = utc_iso(datetime.now(timezone.utc))
        rows = []
        for item in sessions:
            spans = item["activity_spans"]
            if not spans:
                continue
            rows.append(
                (
                    machine_id,
                    item["agent"],
                    item["session_uid"],
                    item["project_key"],
                    item.get("project_name") or item["project_key"],
                    spans[0][0],
                    spans[-1][1],
                    json.dumps(spans, separators=(",", ":")),
                    now,
                )
            )

        with self.connect() as connection:
            connection.executemany(
                """
                INSERT INTO synced_sessions (
                    machine_id, agent, session_uid, project_key, project_name,
                    started_at, ended_at, activity_spans, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(machine_id, agent, session_uid) DO UPDATE SET
                    project_key=excluded.project_key,
                    project_name=excluded.project_name,
                    started_at=excluded.started_at,
                    ended_at=excluded.ended_at,
                    activity_spans=excluded.activity_spans,
                    updated_at=excluded.updated_at
                """,
                rows,
            )
        return len(rows)

    def sync_status(self) -> list[dict]:
        """Return one freshness row per connected workstation."""
        with self.connect() as connection:
            rows = connection.execute(
                """
                SELECT machine_id, MAX(updated_at) AS last_sync,
                       COUNT(*) AS sessions
                FROM synced_sessions
                GROUP BY machine_id
                ORDER BY last_sync DESC, machine_id
                """
            ).fetchall()
        return [
            {
                "machine_id": row["machine_id"],
                "last_sync": row["last_sync"],
                "sessions": row["sessions"],
            }
            for row in rows
        ]

    def report(
        self,
        start_date: date | None = None,
        end_date: date | None = None,
        timezone_name: str = "Europe/Prague",
    ) -> list[dict]:
        tz = ZoneInfo(timezone_name)
        today = datetime.now(tz).date()
        start_date = start_date or today.replace(day=1)
        end_date = end_date or today
        if end_date < start_date:
            start_date, end_date = end_date, start_date

        range_start = datetime.combine(start_date, time.min, tzinfo=tz)
        range_end = datetime.combine(end_date + timedelta(days=1), time.min, tzinfo=tz)
        start_utc = range_start.astimezone(timezone.utc)
        end_utc = range_end.astimezone(timezone.utc)

        with self.connect() as connection:
            rows = connection.execute(
                """
                SELECT machine_id, session_uid, project_key, project_name,
                       activity_spans
                FROM synced_sessions
                WHERE ended_at > ? AND started_at < ?
                """,
                (utc_iso(start_utc), utc_iso(end_utc)),
            ).fetchall()

        spans_by_project: dict[str, list[tuple[datetime, datetime]]] = defaultdict(list)
        names: dict[str, str] = {}
        machines: dict[str, set[str]] = defaultdict(set)
        sessions: dict[str, set[str]] = defaultdict(set)
        for row in rows:
            key = row["project_key"]
            names[key] = row["project_name"]
            for raw_start, raw_end in json.loads(row["activity_spans"]):
                span_start = max(parse_iso(raw_start), start_utc)
                span_end = min(parse_iso(raw_end), end_utc)
                if span_end > span_start:
                    spans_by_project[key].append((span_start, span_end))
                    machines[key].add(row["machine_id"])
                    sessions[key].add(f'{row["machine_id"]}:{row["session_uid"]}')

        result = []
        for key, spans in spans_by_project.items():
            merged = merge_spans(spans)
            daily: dict[str, float] = defaultdict(float)
            for span_start, span_end in merged:
                cursor = span_start
                while cursor < span_end:
                    local_cursor = cursor.astimezone(tz)
                    next_day = datetime.combine(
                        local_cursor.date() + timedelta(days=1), time.min, tzinfo=tz
                    ).astimezone(timezone.utc)
                    segment_end = min(span_end, next_day)
                    daily[local_cursor.date().isoformat()] += (
                        segment_end - cursor
                    ).total_seconds()
                    cursor = segment_end

            total_seconds = sum(daily.values())
            result.append(
                {
                    "project_key": key,
                    "project_name": names.get(key, key),
                    "seconds": round(total_seconds),
                    "hours": round(total_seconds / 3600, 2),
                    "machines": len(machines[key]),
                    "sessions": len(sessions[key]),
                    "daily": [
                        {
                            "date": day,
                            "seconds": round(seconds),
                            "hours": round(seconds / 3600, 2),
                        }
                        for day, seconds in sorted(daily.items())
                    ],
                }
            )
        return sorted(result, key=lambda item: (-item["seconds"], item["project_name"]))


def merge_spans(
    spans: Iterable[tuple[datetime, datetime]],
) -> list[tuple[datetime, datetime]]:
    """Return the union of overlapping activity spans."""
    ordered = sorted(spans)
    if not ordered:
        return []
    merged = [ordered[0]]
    for start, end in ordered[1:]:
        previous_start, previous_end = merged[-1]
        if start <= previous_end:
            merged[-1] = (previous_start, max(previous_end, end))
        else:
            merged.append((start, end))
    return merged
