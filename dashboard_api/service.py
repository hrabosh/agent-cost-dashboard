"""Cached adapter between the legacy collectors and API v2."""

from __future__ import annotations

import os
import threading
import time

import cost_dashboard

from .schemas import DashboardResponse


class DashboardService:
    """Build one shared snapshot at most once per configured cache interval."""

    def __init__(self, cache_seconds: float | None = None):
        configured = (
            cache_seconds
            if cache_seconds is not None
            else float(os.environ.get("AGENT_DASHBOARD_API_CACHE_SECONDS", "30"))
        )
        self.cache_seconds = max(0.0, configured)
        self._lock = threading.Lock()
        self._cached_at = 0.0
        self._cached: DashboardResponse | None = None

    def dashboard(self) -> DashboardResponse:
        now = time.monotonic()
        with self._lock:
            if (
                self._cached is not None
                and now - self._cached_at < self.cache_seconds
            ):
                return self._cached
            result = self._serialize(cost_dashboard.build_dashboard_snapshot().data)
            self._cached = result
            self._cached_at = time.monotonic()
            return result

    @staticmethod
    def _session(item: dict) -> dict:
        return {
            "uid": item["uid"],
            "machine": item["machine"],
            "branches": item["branches"],
            "messages": item["messages"],
            "prompts": item["prompts"],
            "execution_time": item["execution_time"],
            "tokens": item["tokens"],
            "input_tokens": item["input_tokens"],
            "output_tokens": item["output_tokens"],
            "cache_read_tokens": item["cache_read_tokens"],
            "cache_write_tokens": item["cache_write_tokens"],
            "reasoning_tokens": item["reasoning_tokens"],
            "cost": item["cost"],
            "start": item["start"] or None,
            "end": item["end"] or None,
            "duration": item["duration"],
            "llm_time": item["llm_time"],
            "tool_time": item["tool_time"],
            "avg_tps": item["avg_tps"],
            "is_synced": item.get("is_synced", not bool(item.get("path"))),
            "subagent_sessions": [
                DashboardService._session(sub)
                for sub in item.get("subagent_sessions", [])
            ],
        }

    @classmethod
    def _serialize(cls, data: dict) -> DashboardResponse:
        projects = []
        for item in data["projects"]:
            projects.append(
                {
                    "name": item["name"],
                    "agent": item["agent_cmd"],
                    "sessions": item["sessions"],
                    "machines": item["machines"],
                    "messages": item["messages"],
                    "prompts": item["prompts"],
                    "execution_time": item["execution_time"],
                    "tokens": item["tokens"],
                    "input_tokens": item["input_tokens"],
                    "output_tokens": item["output_tokens"],
                    "cache_read_tokens": item["cache_read_tokens"],
                    "cache_write_tokens": item["cache_write_tokens"],
                    "reasoning_tokens": item["reasoning_tokens"],
                    "cost": item["cost"],
                    "llm_time": item["llm_time"],
                    "tool_time": item["tool_time"],
                    "avg_tps": item["avg_tps"],
                    "last_activity": item["last_activity"] or None,
                    "models": [
                        {
                            key: model[key]
                            for key in (
                                "name",
                                "messages",
                                "tokens",
                                "input_tokens",
                                "output_tokens",
                                "cache_read_tokens",
                                "cache_write_tokens",
                                "reasoning_tokens",
                                "cost",
                                "avg_tps",
                            )
                        }
                        for model in item["models"]
                    ],
                    "tools": [
                        {
                            key: tool[key]
                            for key in ("name", "calls", "time", "errors", "avg_time")
                        }
                        for tool in item["tools"]
                    ],
                    "session_items": [
                        cls._session(session) for session in item["sessions_list"]
                    ],
                }
            )

        models = []
        for item in data["models"]:
            models.append(
                {
                    "name": item["name"],
                    "messages": item["messages"],
                    "tokens": item["tokens"],
                    "input_tokens": item["input_tokens"],
                    "output_tokens": item["output_tokens"],
                    "cache_read_tokens": item["cache_read_tokens"],
                    "cache_write_tokens": item["cache_write_tokens"],
                    "reasoning_tokens": item["reasoning_tokens"],
                    "cost": item["cost"],
                    "avg_tps": item["avg_tps"],
                    "llm_time": item["llm_time"],
                    "cost_share": item["pct"] / 100,
                    "priced": item["priced"],
                }
            )

        tools = []
        for item in data["tools"]:
            tools.append(
                {
                    "name": item["name"],
                    "calls": item["calls"],
                    "time": item["time"],
                    "errors": item["errors"],
                    "avg_time": item["avg_time"],
                    "time_share": item["pct"] / 100,
                }
            )

        return DashboardResponse.model_validate(
            {
                "generated_at": data["generatedAt"],
                "summary": data["summary"],
                "projects": projects,
                "daily_stats": data["dailyStats"],
                "models": models,
                "tools": tools,
                "worklogs": data["worklogs"],
                "billing": data["billing"],
                "jira": data["jira"],
                "sync_machines": data["syncMachines"],
                "worklog_defaults": {
                    "from_date": data["worklogDefaults"]["from"],
                    "to_date": data["worklogDefaults"]["to"],
                },
                "unpriced_models": data["unpricedModels"],
            }
        )


dashboard_service = DashboardService()

