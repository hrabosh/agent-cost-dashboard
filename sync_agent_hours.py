#!/usr/bin/env python3
"""Sync local coding-agent activity summaries to a central dashboard."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import socket
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

import cost_dashboard
from worklog_store import build_activity_spans


DEFAULT_URL = "https://work.hrabovskyjan.cz/api/v1/sessions"


def build_metrics(stats: cost_dashboard.SessionStats) -> dict:
    """Build a privacy-safe, pre-calculated summary for the central dashboard."""
    daily: dict[str, dict] = {}
    for timestamp, model, cost in stats["cost_events"]:
        day = timestamp.date().isoformat()
        row = daily.setdefault(
            day, {"messages": 0, "prompts": 0, "cost": 0.0, "models": {}}
        )
        row["messages"] += 1
        row["cost"] += cost
        row["models"][model] = row["models"].get(model, 0.0) + cost

    for timestamp in stats["prompt_timestamps"]:
        day = timestamp.date().isoformat()
        row = daily.setdefault(
            day, {"messages": 0, "prompts": 0, "cost": 0.0, "models": {}}
        )
        row["prompts"] += 1

    return {
        "messages": stats["messages"],
        "prompts": stats["prompts"],
        "execution_time": sum(
            max(0.0, (end - start).total_seconds())
            for start, end in stats["execution_spans"]
        ),
        "tokens": stats["total_tokens"],
        "input_tokens": stats["input_tokens"],
        "output_tokens": stats["output_tokens"],
        "cache_read_tokens": stats["cache_read_tokens"],
        "cache_write_tokens": stats["cache_write_tokens"],
        "reasoning_tokens": stats["reasoning_tokens"],
        "cost": stats["cost_total"],
        "llm_time": stats["llm_time"],
        "tool_time": stats["tool_time"],
        "avg_tps": cost_dashboard.calc_avg_tokens_per_sec(stats["tps_samples"]),
        "models": dict(stats["models"]),
        "tools": dict(stats["tools"]),
        "daily": daily,
    }


def project_name_from_path(value: str) -> str:
    clean = value.rstrip("/\\")
    return re.split(r"[/\\]", clean)[-1] if clean else "unknown"


def parse_project_maps(values: list[str]) -> dict[str, str]:
    mappings: dict[str, str] = {}
    env_value = os.environ.get("AGENT_DASHBOARD_PROJECT_MAP", "")
    if env_value:
        loaded = json.loads(env_value)
        if not isinstance(loaded, dict):
            raise ValueError("AGENT_DASHBOARD_PROJECT_MAP must be a JSON object")
        mappings.update({str(key): str(value) for key, value in loaded.items()})
    for value in values:
        if "=" not in value:
            raise ValueError(f"Invalid project map {value!r}; expected LOCAL=CANONICAL")
        local, canonical = value.split("=", 1)
        mappings[local] = canonical
    return mappings


def iter_session_files(since: datetime | None):
    seen: set[tuple[str, str]] = set()
    for sessions_dir, agent, source_type in cost_dashboard.SESSIONS_DIRS:
        if not sessions_dir.exists():
            continue
        for path in sessions_dir.rglob("*.jsonl"):
            key = (source_type, str(path.resolve()))
            if key in seen:
                continue
            seen.add(key)
            if since is not None:
                modified = datetime.fromtimestamp(path.stat().st_mtime, timezone.utc)
                if modified < since:
                    continue
            yield path, agent, source_type, sessions_dir


def collect_sessions(
    since: datetime | None,
    idle_minutes: int,
    project_maps: dict[str, str],
) -> list[dict]:
    sessions = []
    for path, agent, source_type, root in iter_session_files(since):
        try:
            stats = cost_dashboard.analyze_session_file(path, source_type)
        except (OSError, ValueError, json.JSONDecodeError) as exc:
            print(f"Skipping {path}: {exc}", file=sys.stderr)
            continue
        if stats["messages"] == 0 or not stats["timestamps"]:
            continue

        cwd = stats.get("cwd") or cost_dashboard.get_session_cwd(
            str(path), source_type
        )
        local_name = project_name_from_path(cwd or path.parent.name)
        canonical = project_maps.get(cwd, project_maps.get(local_name, local_name))
        uid = cost_dashboard.get_session_id_from_file(str(path), source_type)
        if not uid:
            try:
                relative = str(path.relative_to(root))
            except ValueError:
                relative = str(path)
            uid = hashlib.sha256(
                f"{source_type}:{relative}".encode("utf-8")
            ).hexdigest()[:32]

        spans = build_activity_spans(
            stats["timestamps"], idle_seconds=idle_minutes * 60
        )
        if not spans:
            continue
        sessions.append(
            {
                "agent": agent,
                "session_uid": uid,
                "project_key": canonical,
                "project_name": canonical,
                "activity_spans": spans,
                "execution_spans": [
                    [
                        cost_dashboard.utc_iso(start),
                        cost_dashboard.utc_iso(end),
                    ]
                    for start, end in stats["execution_spans"]
                ],
                "metrics": build_metrics(stats),
            }
        )
    return sessions


def upload(url: str, token: str, machine_id: str, sessions: list[dict]) -> int:
    uploaded = 0
    for offset in range(0, len(sessions), 100):
        batch = sessions[offset : offset + 100]
        body = json.dumps(
            {"machine_id": machine_id, "sessions": batch},
            separators=(",", ":"),
        ).encode("utf-8")
        request = urllib.request.Request(
            url,
            data=body,
            method="POST",
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
                "User-Agent": "agent-cost-dashboard-sync/1",
            },
        )
        with urllib.request.urlopen(request, timeout=30) as response:
            result = json.load(response)
        uploaded += int(result.get("upserted", 0))
    return uploaded


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Sync local agent working time to the central dashboard"
    )
    parser.add_argument(
        "--url",
        default=os.environ.get("AGENT_DASHBOARD_URL", DEFAULT_URL),
        help=f"Ingestion endpoint (default: {DEFAULT_URL})",
    )
    parser.add_argument(
        "--token",
        default=os.environ.get("AGENT_DASHBOARD_TOKEN", ""),
        help="API token (prefer AGENT_DASHBOARD_TOKEN)",
    )
    parser.add_argument(
        "--machine-id",
        default=os.environ.get("AGENT_DASHBOARD_MACHINE", socket.gethostname()),
        help="Stable name for this machine",
    )
    parser.add_argument(
        "--days",
        type=int,
        default=30,
        help="Scan sessions modified in the last N days (default: 30)",
    )
    parser.add_argument(
        "--all", action="store_true", help="Scan all historical sessions"
    )
    parser.add_argument(
        "--idle-minutes",
        type=int,
        default=10,
        help="Start a new work span after this idle gap (default: 10)",
    )
    parser.add_argument(
        "--project-map",
        action="append",
        default=[],
        metavar="LOCAL=CANONICAL",
        help="Map a local folder name/path to a shared project name",
    )
    parser.add_argument(
        "--dry-run", action="store_true", help="Collect and print without uploading"
    )
    args = parser.parse_args()

    try:
        project_maps = parse_project_maps(args.project_map)
    except (ValueError, json.JSONDecodeError) as exc:
        parser.error(str(exc))

    since = None
    if not args.all:
        since = datetime.now(timezone.utc) - timedelta(days=max(1, args.days))
    sessions = collect_sessions(since, max(1, args.idle_minutes), project_maps)

    if args.dry_run:
        total_spans = sum(len(item["activity_spans"]) for item in sessions)
        print(
            f"Collected {len(sessions)} sessions / {total_spans} activity spans "
            f"from {args.machine_id}; no data uploaded."
        )
        for project in sorted({item["project_name"] for item in sessions}):
            print(f"  {project}")
        return 0

    if not args.token:
        parser.error("set AGENT_DASHBOARD_TOKEN or pass --token")
    if not sessions:
        print("No recently changed agent sessions found.")
        return 0

    try:
        uploaded = upload(args.url, args.token, args.machine_id, sessions)
    except urllib.error.HTTPError as exc:
        details = exc.read().decode("utf-8", errors="replace")
        print(f"Upload failed: HTTP {exc.code}: {details}", file=sys.stderr)
        return 1
    except urllib.error.URLError as exc:
        print(f"Upload failed: {exc.reason}", file=sys.stderr)
        return 1

    print(f"Synced {uploaded} sessions from {args.machine_id}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
