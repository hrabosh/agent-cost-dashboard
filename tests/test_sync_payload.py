import unittest

from cost_dashboard import validate_sync_payload


class SyncPayloadValidationTests(unittest.TestCase):
    def test_normalizes_timestamps_and_drops_unknown_fields(self):
        machine, sessions = validate_sync_payload(
            {
                "machine_id": " laptop ",
                "sessions": [
                    {
                        "agent": "codex",
                        "session_uid": "abc",
                        "project_key": "dashboard",
                        "project_name": "Dashboard",
                        "cwd": "/not/stored/centrally",
                        "activity_spans": [
                            ["2026-07-15T11:00:00+02:00", "2026-07-15T12:00:00+02:00"]
                        ],
                        "execution_spans": [
                            ["2026-07-15T11:05:00+02:00", "2026-07-15T11:10:00+02:00"]
                        ],
                        "metrics": {
                            "messages": 2,
                            "prompts": 1,
                            "tokens": 30,
                            "input_tokens": 10,
                            "output_tokens": 5,
                            "cache_read_tokens": 15,
                            "cost": 0.25,
                            "models": {
                                "gpt-test": {
                                    "messages": 2,
                                    "tokens": 30,
                                    "input_tokens": 10,
                                    "output_tokens": 5,
                                    "cache_read_tokens": 15,
                                    "cost": 0.25,
                                }
                            },
                            "tools": {
                                "exec": {"calls": 1, "time": 0.5, "errors": 0}
                            },
                            "daily": {
                                "2026-07-15": {
                                    "messages": 2,
                                    "prompts": 1,
                                    "cost": 0.25,
                                    "models": {"gpt-test": 0.25},
                                }
                            },
                        },
                    }
                ],
            }
        )
        self.assertEqual(machine, "laptop")
        self.assertNotIn("cwd", sessions[0])
        self.assertEqual(
            sessions[0]["activity_spans"],
            [["2026-07-15T09:00:00Z", "2026-07-15T10:00:00Z"]],
        )
        self.assertEqual(
            sessions[0]["execution_spans"],
            [["2026-07-15T09:05:00Z", "2026-07-15T09:10:00Z"]],
        )
        self.assertEqual(sessions[0]["metrics"]["tokens"], 30)
        self.assertEqual(sessions[0]["metrics"]["prompts"], 1)
        self.assertEqual(sessions[0]["metrics"]["daily"]["2026-07-15"]["prompts"], 1)
        self.assertEqual(sessions[0]["metrics"]["models"]["gpt-test"]["cost"], 0.25)

    def test_rejects_negative_metrics(self):
        with self.assertRaisesRegex(ValueError, "metrics.cost"):
            validate_sync_payload(
                {
                    "machine_id": "desktop",
                    "sessions": [
                        {
                            "agent": "codex",
                            "session_uid": "abc",
                            "project_key": "dashboard",
                            "activity_spans": [
                                ["2026-07-15T10:00:00Z", "2026-07-15T11:00:00Z"]
                            ],
                            "metrics": {"cost": -1},
                        }
                    ],
                }
            )

    def test_rejects_reversed_span(self):
        with self.assertRaisesRegex(ValueError, "ends before"):
            validate_sync_payload(
                {
                    "machine_id": "desktop",
                    "sessions": [
                        {
                            "agent": "codex",
                            "session_uid": "abc",
                            "project_key": "dashboard",
                            "activity_spans": [
                                ["2026-07-15T11:00:00Z", "2026-07-15T10:00:00Z"]
                            ],
                        }
                    ],
                }
            )


if __name__ == "__main__":
    unittest.main()
