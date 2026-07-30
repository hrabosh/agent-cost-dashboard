import unittest
from unittest.mock import patch

try:
    import pydantic  # noqa: F401
except ModuleNotFoundError:
    raise unittest.SkipTest("optional API dependencies are not installed")

import cost_dashboard
from dashboard_api.app import app
from dashboard_api.service import DashboardService


def empty_dashboard_data():
    return {
        "generatedAt": "2026-07-30T12:00:00+02:00",
        "summary": {
            "total_cost": 0,
            "monthly_subscription_cost": 0,
            "currency": "EUR",
            "projects": 0,
            "sessions": 0,
            "messages": 0,
            "prompts": 0,
            "tokens": 0,
            "input_tokens": 0,
            "output_tokens": 0,
            "cache_read_tokens": 0,
            "cache_write_tokens": 0,
            "reasoning_tokens": 0,
            "execution_time": 0,
            "llm_time": 0,
            "tool_time": 0,
            "avg_tps": 0,
            "month_agent_seconds": 0,
            "month_execution_seconds": 0,
            "month_wall_seconds": 0,
            "synced_machines": 0,
        },
        "projects": [],
        "dailyStats": [],
        "models": [],
        "tools": [],
        "worklogs": [],
        "billing": {
            "currency": "EUR",
            "subscriptions": [],
            "monthly_subscription_cost": 0,
            "project_rates": {},
            "billing_increment_minutes": 1,
            "warnings": [],
        },
        "jira": {
            "configured": False,
            "status": "disabled",
            "message": "",
        },
        "syncMachines": [],
        "worklogDefaults": {"from": "2026-07-01", "to": "2026-07-30"},
        "unpricedModels": [],
    }


class DashboardApiTests(unittest.TestCase):
    def test_openapi_exposes_read_only_v2_routes(self):
        paths = app.openapi()["paths"]
        self.assertEqual(set(paths), {"/api/v2/health", "/api/v2/dashboard"})
        self.assertEqual(set(paths["/api/v2/dashboard"]), {"get"})

    def test_service_caches_shared_snapshot(self):
        snapshot = cost_dashboard.DashboardSnapshot(
            data=empty_dashboard_data(),
            global_stats={},
            month_seconds=0,
            month_agent_seconds=0,
            month_execution_seconds=0,
            billing={},
            sync_status=[],
            unpriced_models=[],
        )
        service = DashboardService(cache_seconds=60)
        with patch.object(
            cost_dashboard, "build_dashboard_snapshot", return_value=snapshot
        ) as build:
            first = service.dashboard()
            second = service.dashboard()

        self.assertIs(first, second)
        build.assert_called_once_with()
        self.assertEqual(first.summary.currency, "EUR")

    def test_public_session_shape_excludes_local_paths(self):
        legacy = {
            "uid": "session-1",
            "path": "/home/private/session.jsonl",
            "cwd": "/home/private/client",
            "machine": "workstation",
            "branches": ["feature/ABC-1"],
            "messages": 1,
            "prompts": 1,
            "execution_time": 10,
            "tokens": 100,
            "input_tokens": 70,
            "output_tokens": 30,
            "cache_read_tokens": 0,
            "cache_write_tokens": 0,
            "reasoning_tokens": 0,
            "cost": 0.01,
            "start": "2026-07-30T10:00:00+02:00",
            "end": "2026-07-30T10:01:00+02:00",
            "duration": 60,
            "llm_time": 5,
            "tool_time": 2,
            "avg_tps": 6,
            "is_synced": False,
            "subagent_sessions": [],
        }

        public = DashboardService._session(legacy)

        self.assertNotIn("path", public)
        self.assertNotIn("cwd", public)
        self.assertEqual(public["branches"], ["feature/ABC-1"])


if __name__ == "__main__":
    unittest.main()

