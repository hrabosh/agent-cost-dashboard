import json
import os
import unittest
from datetime import datetime
from unittest.mock import patch
from zoneinfo import ZoneInfo

import jira_integration


def session(branches, seconds, started, project="client"):
    return {
        "cwd": project,
        "file": "session.jsonl",
        "branches": branches,
        "execution_time": seconds,
        "start": started,
        "subagent_sessions": [],
    }


class JiraConfigTests(unittest.TestCase):
    def test_scoped_token_config_uses_site_origin(self):
        values = {
            "AGENT_DASHBOARD_JIRA_URL": "https://uniportal.atlassian.net/jira/for-you",
            "AGENT_DASHBOARD_JIRA_EMAIL": "developer@example.com",
            "AGENT_DASHBOARD_JIRA_TOKEN": "secret",
        }
        with patch.dict(os.environ, values, clear=True):
            config = jira_integration.load_jira_config()
        self.assertTrue(config["configured"])
        self.assertEqual(config["site_url"], "https://uniportal.atlassian.net")
        self.assertEqual(config["jql"], jira_integration.DEFAULT_JQL)

    def test_partial_config_is_reported_without_exposing_values(self):
        with patch.dict(
            os.environ,
            {"AGENT_DASHBOARD_JIRA_URL": "https://example.atlassian.net"},
            clear=True,
        ):
            config = jira_integration.load_jira_config()
        self.assertFalse(config["configured"])
        self.assertTrue(config["incomplete"])
        self.assertNotIn("example.atlassian.net", config["message"])

    def test_browser_payload_does_not_expose_credentials(self):
        values = {
            "AGENT_DASHBOARD_JIRA_URL": "https://example.atlassian.net",
            "AGENT_DASHBOARD_JIRA_EMAIL": "private@example.com",
            "AGENT_DASHBOARD_JIRA_TOKEN": "super-secret-token",
        }
        snapshot = {
            "site_url": "https://example.atlassian.net",
            "jql": jira_integration.DEFAULT_JQL,
            "account_id": "account-1",
            "account_name": "Developer",
            "active_keys": [],
            "issues": [],
            "worklogs": {},
        }
        jira_integration._CACHE.clear()
        with (
            patch.dict(os.environ, values, clear=True),
            patch.object(jira_integration, "_fetch_snapshot", return_value=snapshot),
        ):
            payload = jira_integration.get_jira_dashboard([], "Europe/Prague")
        serialized = json.dumps(payload)
        self.assertNotIn("super-secret-token", serialized)
        self.assertNotIn("private@example.com", serialized)


class JiraReconciliationTests(unittest.TestCase):
    def test_prefers_latest_branch_ticket_key(self):
        projects = [
            {
                "name": "client",
                "sessions_list": [
                    session(["feature/OLD-12-start", "fix/NEW-34-done"], 60, "2026-07-30")
                ],
            }
        ]
        self.assertEqual(
            jira_integration.collect_local_ticket_keys(projects), {"NEW-34"}
        )

    def test_classifies_missing_underlogged_covered_and_unlinked_work(self):
        timezone = "Europe/Prague"
        today = datetime.now(ZoneInfo(timezone)).date().isoformat()
        projects = [
            {
                "name": "client",
                "sessions_list": [
                    session(["feature/ABC-1"], 3600, today),
                    session(["feature/ABC-2"], 3600, today),
                    session(["feature/ABC-3"], 600, today),
                    session(["misc/no-ticket"], 300, today),
                ],
            }
        ]
        issues = [
            {
                "key": key,
                "summary": f"Issue {key}",
                "status": "In Progress",
                "updated": f"{today}T08:00:00+00:00",
                "url": f"https://example.atlassian.net/browse/{key}",
            }
            for key in ["ABC-1", "ABC-2", "ABC-3", "ABC-4"]
        ]
        snapshot = {
            "site_url": "https://example.atlassian.net",
            "jql": jira_integration.DEFAULT_JQL,
            "account_id": "me",
            "account_name": "Developer",
            "active_keys": ["ABC-1", "ABC-2", "ABC-3", "ABC-4"],
            "issues": issues,
            "worklogs": {
                "ABC-1": [],
                "ABC-2": [
                    {
                        "author": {"accountId": "me"},
                        "started": f"{today}T10:00:00+02:00",
                        "timeSpentSeconds": 1800,
                    }
                ],
                "ABC-3": [
                    {
                        "author": {"accountId": "me"},
                        "started": f"{today}T10:00:00+02:00",
                        "timeSpentSeconds": 600,
                    }
                ],
            },
        }
        result = jira_integration.build_jira_insights(
            projects, snapshot, timezone, lookback_days=30
        )
        states = {row["key"]: row["state"] for row in result["activity"]}
        self.assertEqual(
            states, {"ABC-1": "missing", "ABC-2": "under", "ABC-3": "covered"}
        )
        self.assertEqual(result["unlinked_count"], 1)
        self.assertEqual([item["key"] for item in result["no_activity"]], ["ABC-4"])

    def test_ignores_other_users_worklogs(self):
        timezone = "Europe/Prague"
        today = datetime.now(ZoneInfo(timezone)).date().isoformat()
        projects = [
            {
                "name": "client",
                "sessions_list": [session(["ABC-8"], 900, today)],
            }
        ]
        snapshot = {
            "site_url": "https://example.atlassian.net",
            "jql": jira_integration.DEFAULT_JQL,
            "account_id": "me",
            "active_keys": ["ABC-8"],
            "issues": [{"key": "ABC-8", "summary": "Issue", "status": "Open"}],
            "worklogs": {
                "ABC-8": [
                    {
                        "author": {"accountId": "someone-else"},
                        "started": today,
                        "timeSpentSeconds": 900,
                    }
                ]
            },
        }
        result = jira_integration.build_jira_insights(
            projects, snapshot, timezone, lookback_days=30
        )
        self.assertEqual(result["activity"][0]["state"], "missing")

    def test_hides_local_ticket_keys_not_visible_to_jira_user(self):
        timezone = "Europe/Prague"
        today = datetime.now(ZoneInfo(timezone)).date().isoformat()
        projects = [
            {
                "name": "client",
                "sessions_list": [
                    session(["feature/VISIBLE-1"], 900, today),
                    session(["legacy/BB0A-66"], 780, today),
                    session(["legacy/A7D2-6"], 600, today),
                ],
            }
        ]
        snapshot = {
            "site_url": "https://example.atlassian.net",
            "jql": jira_integration.DEFAULT_JQL,
            "account_id": "me",
            "active_keys": ["VISIBLE-1"],
            "issues": [
                {
                    "key": "VISIBLE-1",
                    "summary": "Visible issue",
                    "status": "Open",
                }
            ],
            "worklogs": {"VISIBLE-1": []},
        }

        result = jira_integration.build_jira_insights(
            projects, snapshot, timezone, lookback_days=30
        )

        self.assertEqual(
            [row["key"] for row in result["activity"]], ["VISIBLE-1"]
        )
        serialized = json.dumps(result)
        self.assertNotIn("BB0A-66", serialized)
        self.assertNotIn("A7D2-6", serialized)


if __name__ == "__main__":
    unittest.main()
