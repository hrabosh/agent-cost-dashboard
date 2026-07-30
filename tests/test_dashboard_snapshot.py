import unittest
from collections import defaultdict
from unittest.mock import Mock, patch

import cost_dashboard


def empty_global_stats():
    return {
        "total_cost": 12.5,
        "total_tokens": 100,
        "total_input_tokens": 60,
        "total_output_tokens": 40,
        "total_cache_read_tokens": 10,
        "total_cache_write_tokens": 5,
        "total_reasoning_tokens": 2,
        "total_messages": 4,
        "total_prompts": 3,
        "total_execution_time": 90.0,
        "total_sessions": 2,
        "total_projects": 1,
        "total_llm_time": 30.0,
        "total_tool_time": 20.0,
        "models": defaultdict(cost_dashboard.create_model_stats),
        "tools": defaultdict(cost_dashboard.create_tool_stats),
        "daily_stats": defaultdict(cost_dashboard.create_daily_stats),
        "tps_samples": [(40, 2.0, "model")],
    }


class DashboardSnapshotTests(unittest.TestCase):
    def test_builds_shared_json_safe_summary(self):
        store = Mock()
        store.report.return_value = []
        store.sync_status.return_value = [
            {
                "machine_id": "workstation",
                "last_sync": "2026-07-30T10:00:00+00:00",
                "sessions": 2,
            }
        ]
        billing = {
            "currency": "EUR",
            "subscriptions": [],
            "monthly_subscription_cost": 25.0,
            "project_rates": {},
            "billing_increment_minutes": 1,
            "warnings": [],
        }
        jira = {"configured": False, "status": "disabled", "message": ""}

        with (
            patch.object(
                cost_dashboard,
                "collect_all_stats",
                return_value=([], empty_global_stats()),
            ),
            patch.object(cost_dashboard, "WORKLOG_STORE", store),
            patch.object(cost_dashboard, "load_billing_config", return_value=billing),
            patch.object(cost_dashboard, "get_jira_dashboard", return_value=jira),
        ):
            snapshot = cost_dashboard.build_dashboard_snapshot()
            legacy_html = cost_dashboard.generate_html()

        self.assertEqual(snapshot.data["summary"]["total_cost"], 12.5)
        self.assertEqual(snapshot.data["summary"]["avg_tps"], 20.0)
        self.assertEqual(snapshot.data["summary"]["synced_machines"], 1)
        self.assertEqual(snapshot.data["billing"], billing)
        self.assertEqual(snapshot.data["jira"], jira)
        self.assertIn("generatedAt", snapshot.data)
        self.assertIn("Agent Work &amp; Subscription Dashboard", legacy_html)


if __name__ == "__main__":
    unittest.main()
