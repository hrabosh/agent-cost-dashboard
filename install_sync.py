#!/usr/bin/env python3
"""Install and manage automatic agent-dashboard synchronization."""

from __future__ import annotations

import argparse
import getpass
import json
import os
import shlex
import socket
import subprocess
import sys
from pathlib import Path, PureWindowsPath


DEFAULT_URL = "https://work.hrabovskyjan.cz/api/v1/sessions"
APP_NAME = "agent-cost-dashboard"
TASK_NAME = "AgentCostDashboardSync"
CRON_MARKER = "# agent-cost-dashboard-sync"
SCRIPT_DIR = Path(__file__).resolve().parent
SYNC_SCRIPT = SCRIPT_DIR / "sync_agent_hours.py"


def is_wsl() -> bool:
    if os.environ.get("WSL_DISTRO_NAME"):
        return True
    try:
        return "microsoft" in Path("/proc/version").read_text(errors="ignore").lower()
    except OSError:
        return False


def config_path() -> Path:
    if os.name == "nt":
        base = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData/Local"))
    else:
        base = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config"))
    return base / APP_NAME / "sync.json"


def state_dir() -> Path:
    if os.name == "nt":
        base = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData/Local"))
    else:
        base = Path(os.environ.get("XDG_STATE_HOME", Path.home() / ".local/state"))
    return base / APP_NAME


def write_config(config: dict) -> Path:
    path = config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
    if os.name != "nt":
        path.chmod(0o600)
    return path


def load_config() -> dict:
    path = config_path()
    if not path.exists():
        raise RuntimeError(f"configuration not found: {path}; run install first")
    config = json.loads(path.read_text(encoding="utf-8"))
    if not config.get("token"):
        raise RuntimeError(f"dashboard token is missing from {path}")
    return config


def sync_command(config: dict, historical: bool = False) -> list[str]:
    command = [
        sys.executable,
        str(SYNC_SCRIPT),
        "--url",
        config.get("url", DEFAULT_URL),
        "--machine-id",
        config.get("machine", socket.gethostname()),
    ]
    for local, canonical in config.get("project_maps", {}).items():
        command.extend(["--project-map", f"{local}={canonical}"])
    if historical:
        command.append("--all")
    return command


def run_sync(historical: bool = False) -> int:
    config = load_config()
    state = state_dir()
    state.mkdir(parents=True, exist_ok=True)
    log_path = state / "sync.log"
    lock_path = state / "sync.lock"

    with lock_path.open("a+") as lock_file:
        if os.name != "nt":
            import fcntl

            try:
                fcntl.flock(lock_file, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                return 0
        with log_path.open("a", encoding="utf-8") as log:
            environment = os.environ.copy()
            environment["AGENT_DASHBOARD_TOKEN"] = config["token"]
            result = subprocess.run(
                sync_command(config, historical),
                stdout=log,
                stderr=log,
                env=environment,
                check=False,
            )
    return result.returncode


def windows_local_appdata() -> tuple[Path, PureWindowsPath]:
    result = subprocess.run(
        ["cmd.exe", "/C", "echo", "%LOCALAPPDATA%"],
        capture_output=True,
        text=True,
        check=True,
    )
    windows_path = (
        PureWindowsPath(result.stdout.strip().replace("\r", ""))
        / "AgentCostDashboard"
    )
    converted = subprocess.run(
        ["wslpath", "-u", str(windows_path)],
        capture_output=True,
        text=True,
        check=True,
    )
    return Path(converted.stdout.strip()), windows_path


def powershell_single_quote(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def wsl_launcher_script(distro: str, script_path: Path) -> str:
    return (
        '& "$env:SystemRoot\\System32\\wsl.exe" '
        f"-d {powershell_single_quote(distro)} --exec "
        f"{powershell_single_quote(sys.executable)} "
        f"{powershell_single_quote(str(script_path))} run\n"
        "exit $LASTEXITCODE\n"
    )


def allow_windows_task_on_battery() -> None:
    command = (
        f"$task = Get-ScheduledTask -TaskName '{TASK_NAME}'; "
        "$task.Settings.DisallowStartIfOnBatteries = $false; "
        "$task.Settings.StopIfGoingOnBatteries = $false; "
        "Set-ScheduledTask -InputObject $task | Out-Null"
    )
    subprocess.run(
        ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", command],
        check=True,
    )


def install_wsl_schedule() -> str:
    distro = os.environ.get("WSL_DISTRO_NAME")
    if not distro:
        raise RuntimeError("WSL_DISTRO_NAME is unavailable; cannot identify this distro")
    linux_dir, windows_dir = windows_local_appdata()
    linux_dir.mkdir(parents=True, exist_ok=True)
    launcher_linux = linux_dir / "sync.ps1"
    launcher_linux.write_text(
        wsl_launcher_script(distro, Path(__file__).resolve()), encoding="utf-8"
    )
    launcher_windows = windows_dir / "sync.ps1"
    task_action = (
        "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass "
        f'-WindowStyle Hidden -File "{launcher_windows}"'
    )
    subprocess.run(
        [
            "schtasks.exe",
            "/Create",
            "/F",
            "/TN",
            TASK_NAME,
            "/SC",
            "MINUTE",
            "/MO",
            "5",
            "/TR",
            task_action,
        ],
        check=True,
    )
    allow_windows_task_on_battery()
    return f"Windows Task Scheduler task {TASK_NAME} (hidden WSL launcher)"


def install_windows_schedule() -> str:
    app_dir = config_path().parent
    app_dir.mkdir(parents=True, exist_ok=True)
    pythonw = Path(sys.executable).with_name("pythonw.exe")
    interpreter = pythonw if pythonw.exists() else Path(sys.executable)
    command = f'"{interpreter}" "{Path(__file__).resolve()}" run'
    escaped = command.replace('"', '""')
    vbs_path = app_dir / "sync.vbs"
    vbs_path.write_text(
        'Set shell = CreateObject("WScript.Shell")\n'
        f'shell.Run "{escaped}", 0, False\n',
        encoding="utf-8",
    )
    subprocess.run(
        [
            "schtasks.exe",
            "/Create",
            "/F",
            "/TN",
            TASK_NAME,
            "/SC",
            "MINUTE",
            "/MO",
            "5",
            "/TR",
            f'wscript.exe "{vbs_path}"',
        ],
        check=True,
    )
    allow_windows_task_on_battery()
    return f"Windows Task Scheduler task {TASK_NAME} (hidden launcher)"


def cron_command() -> str:
    command = " ".join(
        shlex.quote(value)
        for value in (sys.executable, str(Path(__file__).resolve()), "run")
    )
    return f"*/5 * * * * {command} {CRON_MARKER}"


def read_crontab() -> str:
    result = subprocess.run(["crontab", "-l"], capture_output=True, text=True)
    if result.returncode not in (0, 1):
        raise RuntimeError(result.stderr.strip() or "could not read crontab")
    return result.stdout if result.returncode == 0 else ""


def install_cron_schedule() -> str:
    lines = [line for line in read_crontab().splitlines() if CRON_MARKER not in line]
    lines.append(cron_command())
    subprocess.run(["crontab", "-"], input="\n".join(lines) + "\n", text=True, check=True)
    return "user crontab entry (every five minutes)"


def remove_schedule() -> None:
    if is_wsl() or os.name == "nt":
        subprocess.run(
            ["schtasks.exe", "/Delete", "/F", "/TN", TASK_NAME], check=False
        )
        return
    lines = [line for line in read_crontab().splitlines() if CRON_MARKER not in line]
    subprocess.run(["crontab", "-"], input="\n".join(lines) + "\n", text=True, check=True)


def parse_project_maps(values: list[str]) -> dict[str, str]:
    mappings = {}
    for value in values:
        if "=" not in value:
            raise ValueError(f"invalid project map {value!r}; expected LOCAL=CANONICAL")
        local, canonical = value.split("=", 1)
        if not local or not canonical:
            raise ValueError(f"invalid project map {value!r}; both names are required")
        mappings[local] = canonical
    return mappings


def install(args: argparse.Namespace) -> int:
    if not SYNC_SCRIPT.exists():
        raise RuntimeError(f"sync client not found beside installer: {SYNC_SCRIPT}")
    url = args.url or DEFAULT_URL
    machine = args.machine or socket.gethostname()
    token = args.token or getpass.getpass("Dashboard bearer token: ").strip()
    if not token:
        raise RuntimeError("dashboard token is required")
    config = {
        "url": url,
        "token": token,
        "machine": machine,
        "project_maps": parse_project_maps(args.project_map),
    }
    path = write_config(config)
    if is_wsl():
        schedule = install_wsl_schedule()
    elif os.name == "nt":
        schedule = install_windows_schedule()
    else:
        schedule = install_cron_schedule()
    print(f"Configuration: {path}")
    print(f"Scheduler: {schedule}")
    print("Running initial historical synchronization...")
    result = run_sync(historical=not args.no_history)
    if result:
        print(f"Initial sync failed; inspect {state_dir() / 'sync.log'}", file=sys.stderr)
        return result
    print(f"Installed successfully. Log: {state_dir() / 'sync.log'}")
    return 0


def status() -> int:
    path = config_path()
    print(f"Configuration: {'OK' if path.exists() else 'MISSING'} ({path})")
    if path.exists():
        config = load_config()
        print(f"Dashboard: {config.get('url', DEFAULT_URL)}")
        print(f"Machine: {config.get('machine', socket.gethostname())}")
    if is_wsl() or os.name == "nt":
        result = subprocess.run(
            ["schtasks.exe", "/Query", "/TN", TASK_NAME],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        print(f"Scheduler: {'OK' if result.returncode == 0 else 'MISSING'} ({TASK_NAME})")
    else:
        installed = CRON_MARKER in read_crontab()
        print(f"Scheduler: {'OK' if installed else 'MISSING'} (crontab)")
    print(f"Log: {state_dir() / 'sync.log'}")
    return 0


def uninstall(keep_config: bool) -> int:
    remove_schedule()
    if not keep_config:
        config_path().unlink(missing_ok=True)
    print("Automatic synchronization removed.")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    install_parser = subparsers.add_parser("install", help="configure and schedule sync")
    install_parser.add_argument("--url")
    install_parser.add_argument("--token", help="omit to enter it without shell history")
    install_parser.add_argument("--machine")
    install_parser.add_argument("--project-map", action="append", default=[], metavar="LOCAL=CANONICAL")
    install_parser.add_argument("--no-history", action="store_true")
    run_parser = subparsers.add_parser("run", help="run one scheduled sync")
    run_parser.add_argument("--all", action="store_true", help="sync all history")
    subparsers.add_parser("status", help="show configuration and scheduler status")
    uninstall_parser = subparsers.add_parser("uninstall", help="remove automatic sync")
    uninstall_parser.add_argument("--keep-config", action="store_true")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    try:
        if args.command == "install":
            return install(args)
        if args.command == "run":
            return run_sync(historical=args.all)
        if args.command == "status":
            return status()
        return uninstall(args.keep_config)
    except (OSError, RuntimeError, ValueError, json.JSONDecodeError, subprocess.SubprocessError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
