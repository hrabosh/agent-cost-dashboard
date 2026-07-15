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
