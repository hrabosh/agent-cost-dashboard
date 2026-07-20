import unittest
from pathlib import Path
from unittest.mock import patch

import install_sync


class InstallerTests(unittest.TestCase):
    def test_sync_command_does_not_expose_token(self):
        config = {
            "url": "https://dashboard.test/api/v1/sessions",
            "token": "super-secret",
            "machine": "laptop",
            "project_maps": {"local": "Client"},
        }
        with patch.object(install_sync, "SYNC_SCRIPT", Path("/app/sync_agent_hours.py")):
            command = install_sync.sync_command(config, historical=True)
        self.assertNotIn("super-secret", command)
        self.assertIn("local=Client", command)
        self.assertIn("--all", command)

    def test_wsl_task_action_targets_distro(self):
        with patch.object(install_sync.sys, "executable", "/usr/bin/python3"):
            action = install_sync.wsl_task_action(
                "Debian", Path("/work/install_sync.py")
            )
        self.assertIn('wsl.exe -d "Debian"', action)
        self.assertIn('"/usr/bin/python3"', action)
        self.assertIn('"/work/install_sync.py" run', action)

    def test_windows_schedule_allows_running_on_battery(self):
        with patch.object(install_sync.subprocess, "run") as run:
            install_sync.allow_windows_task_on_battery()
        command = run.call_args.args[0]
        self.assertIn("powershell.exe", command)
        self.assertIn("DisallowStartIfOnBatteries = $false", command[-1])
        self.assertIn("StopIfGoingOnBatteries = $false", command[-1])
        self.assertTrue(run.call_args.kwargs["check"])

    def test_cron_entry_has_stable_marker(self):
        with patch.object(install_sync.sys, "executable", "/usr/bin/python3"):
            line = install_sync.cron_command()
        self.assertTrue(line.startswith("*/5 * * * *"))
        self.assertIn(install_sync.CRON_MARKER, line)

    def test_project_maps_are_validated(self):
        self.assertEqual(
            install_sync.parse_project_maps(["local=Client Project"]),
            {"local": "Client Project"},
        )
        with self.assertRaises(ValueError):
            install_sync.parse_project_maps(["missing-separator"])


if __name__ == "__main__":
    unittest.main()
