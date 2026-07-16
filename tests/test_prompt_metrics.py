import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

import cost_dashboard
import sync_agent_hours


class PromptMetricsTests(unittest.TestCase):
    def write_jsonl(self, records):
        handle = tempfile.NamedTemporaryFile(mode="w", suffix=".jsonl", delete=False)
        with handle:
            for record in records:
                handle.write(json.dumps(record) + "\n")
        self.addCleanup(Path(handle.name).unlink, missing_ok=True)
        return Path(handle.name)

    def test_codex_counts_user_message_without_retaining_text(self):
        path = self.write_jsonl(
            [
                {
                    "timestamp": "2026-07-16T10:00:00Z",
                    "type": "event_msg",
                    "payload": {"type": "user_message", "message": "secret prompt"},
                },
                {
                    "timestamp": "2026-07-16T10:00:01Z",
                    "type": "event_msg",
                    "payload": {"type": "agent_message", "message": "secret reply"},
                },
            ]
        )
        stats = cost_dashboard.analyze_codex_jsonl_file(path)
        self.assertEqual(stats["prompts"], 1)
        self.assertNotIn("secret prompt", repr(stats))

    def test_claude_excludes_tool_results_from_prompt_count(self):
        path = self.write_jsonl(
            [
                {
                    "timestamp": "2026-07-16T10:00:00Z",
                    "type": "user",
                    "message": {"content": "implement this"},
                },
                {
                    "timestamp": "2026-07-16T10:00:01Z",
                    "type": "user",
                    "message": {
                        "content": [{"type": "tool_result", "content": "output"}]
                    },
                },
            ]
        )
        stats = cost_dashboard.analyze_claude_jsonl_file(path)
        self.assertEqual(stats["prompts"], 1)

    def test_sync_metrics_contain_counts_but_no_prompt_content(self):
        stats = cost_dashboard.create_session_stats()
        stats["prompts"] = 2
        stats["prompt_timestamps"] = [
            datetime(2026, 7, 16, 10, 0, tzinfo=timezone.utc),
            datetime(2026, 7, 16, 11, 0, tzinfo=timezone.utc),
        ]
        metrics = sync_agent_hours.build_metrics(stats)
        self.assertEqual(metrics["prompts"], 2)
        self.assertEqual(metrics["daily"]["2026-07-16"]["prompts"], 2)
        self.assertNotIn("prompt_timestamps", metrics)


if __name__ == "__main__":
    unittest.main()
