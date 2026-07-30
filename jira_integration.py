"""Read-only Jira Cloud integration for dashboard reconciliation."""

from __future__ import annotations

import base64
import json
import os
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo


ISSUE_KEY_RE = re.compile(r"(?<![A-Z0-9])([A-Z][A-Z0-9]{1,19}-\d+)(?!\d)", re.I)
DEFAULT_JQL = "assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC"
_CACHE: dict[tuple, tuple[float, dict]] = {}
_CACHE_LOCK = threading.Lock()


class JiraError(RuntimeError):
    """A safe-to-display Jira integration error."""


def load_jira_config() -> dict:
    """Load Jira credentials and behavior without exposing the token."""
    url = os.environ.get("AGENT_DASHBOARD_JIRA_URL", "").strip().rstrip("/")
    email = os.environ.get("AGENT_DASHBOARD_JIRA_EMAIL", "").strip()
    token = os.environ.get("AGENT_DASHBOARD_JIRA_TOKEN", "").strip()
    cloud_id = os.environ.get("AGENT_DASHBOARD_JIRA_CLOUD_ID", "").strip()
    jql = os.environ.get("AGENT_DASHBOARD_JIRA_JQL", DEFAULT_JQL).strip() or DEFAULT_JQL
    try:
        lookback_days = max(
            1, min(365, int(os.environ.get("AGENT_DASHBOARD_JIRA_LOOKBACK_DAYS", "30")))
        )
        cache_seconds = max(
            30, min(3600, int(os.environ.get("AGENT_DASHBOARD_JIRA_CACHE_SECONDS", "300")))
        )
        max_issues = max(
            1, min(500, int(os.environ.get("AGENT_DASHBOARD_JIRA_MAX_ISSUES", "100")))
        )
    except ValueError as exc:
        raise JiraError(f"Invalid Jira numeric configuration: {exc}") from exc

    supplied = [bool(url), bool(email), bool(token)]
    if any(supplied) and not all(supplied):
        return {
            "configured": False,
            "incomplete": True,
            "message": (
                "Jira configuration is incomplete. Set AGENT_DASHBOARD_JIRA_URL, "
                "AGENT_DASHBOARD_JIRA_EMAIL, and AGENT_DASHBOARD_JIRA_TOKEN."
            ),
        }
    if not all(supplied):
        return {"configured": False, "incomplete": False}

    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https" or not parsed.netloc:
        raise JiraError("AGENT_DASHBOARD_JIRA_URL must be an HTTPS site URL")
    site_url = f"{parsed.scheme}://{parsed.netloc}"
    return {
        "configured": True,
        "incomplete": False,
        "site_url": site_url,
        "email": email,
        "token": token,
        "cloud_id": cloud_id,
        "jql": jql,
        "lookback_days": lookback_days,
        "cache_seconds": cache_seconds,
        "max_issues": max_issues,
    }


class JiraClient:
    """Small Jira Cloud REST client using a scoped API token."""

    def __init__(self, config: dict):
        self.config = config
        self.cloud_id = config.get("cloud_id", "")
        encoded = base64.b64encode(
            f"{config['email']}:{config['token']}".encode("utf-8")
        ).decode("ascii")
        self.authorization = f"Basic {encoded}"

    def _request(
        self,
        method: str,
        url: str,
        payload: dict | None = None,
        authenticated: bool = True,
    ) -> object:
        body = None if payload is None else json.dumps(payload).encode("utf-8")
        headers = {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "User-Agent": "agent-cost-dashboard/1",
        }
        if authenticated:
            headers["Authorization"] = self.authorization
        request = urllib.request.Request(
            url,
            data=body,
            method=method,
            headers=headers,
        )
        try:
            with urllib.request.urlopen(request, timeout=12) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            if exc.code == 401:
                message = "Jira rejected the token or API URL (HTTP 401)"
            elif exc.code == 403:
                message = "Jira denied access; check token scopes and project permissions (HTTP 403)"
            else:
                message = f"Jira API request failed (HTTP {exc.code})"
            raise JiraError(message) from exc
        except (urllib.error.URLError, TimeoutError) as exc:
            raise JiraError(f"Could not reach Jira: {exc.reason if hasattr(exc, 'reason') else exc}") from exc
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise JiraError("Jira returned an invalid JSON response") from exc

    def discover_cloud_id(self) -> str:
        if self.cloud_id:
            return self.cloud_id
        payload = self._request(
            "GET",
            f"{self.config['site_url']}/_edge/tenant_info",
            authenticated=False,
        )
        if not isinstance(payload, dict) or not payload.get("cloudId"):
            raise JiraError("Jira Cloud ID discovery returned no cloudId")
        self.cloud_id = str(payload["cloudId"])
        return self.cloud_id

    def api_url(self, path: str) -> str:
        cloud_id = urllib.parse.quote(self.discover_cloud_id(), safe="")
        return f"https://api.atlassian.com/ex/jira/{cloud_id}{path}"

    def current_user(self) -> dict:
        payload = self._request("GET", self.api_url("/rest/api/3/myself"))
        if not isinstance(payload, dict) or not payload.get("accountId"):
            raise JiraError("Jira did not return the current account ID")
        return payload

    def search(self, jql: str, limit: int) -> list[dict]:
        issues: list[dict] = []
        next_page_token = None
        while len(issues) < limit:
            body = {
                "jql": jql,
                "fields": [
                    "summary",
                    "status",
                    "assignee",
                    "project",
                    "updated",
                    "resolution",
                    "issuetype",
                ],
                "maxResults": min(100, limit - len(issues)),
            }
            if next_page_token:
                body["nextPageToken"] = next_page_token
            payload = self._request(
                "POST", self.api_url("/rest/api/3/search/jql"), body
            )
            if not isinstance(payload, dict):
                raise JiraError("Jira search returned an invalid response")
            page = payload.get("issues", [])
            if not isinstance(page, list):
                raise JiraError("Jira search returned an invalid issue list")
            issues.extend(item for item in page if isinstance(item, dict))
            next_page_token = payload.get("nextPageToken")
            if payload.get("isLast") is True or not next_page_token or not page:
                break
        return issues[:limit]

    def worklogs(self, issue_key: str) -> list[dict]:
        safe_key = urllib.parse.quote(issue_key, safe="")
        values: list[dict] = []
        start_at = 0
        while True:
            payload = self._request(
                "GET",
                self.api_url(
                    f"/rest/api/3/issue/{safe_key}/worklog"
                    f"?startAt={start_at}&maxResults=1000"
                ),
            )
            if not isinstance(payload, dict):
                return values
            page = payload.get("worklogs", [])
            if not isinstance(page, list):
                return values
            values.extend(item for item in page if isinstance(item, dict))
            start_at += len(page)
            if not page or start_at >= int(payload.get("total") or start_at):
                return values


def _issue_key_from_session(session: dict, project_name: str) -> str | None:
    """Prefer the most recently recorded branch, then session/project metadata."""
    family = [session, *(session.get("subagent_sessions") or [])]
    branches = [
        str(branch)
        for item in family
        for branch in (item.get("branches") or [])
        if branch
    ]
    for value in reversed(branches):
        matches = ISSUE_KEY_RE.findall(value)
        if matches:
            return matches[-1].upper()
    for value in [session.get("cwd"), session.get("file"), project_name]:
        matches = ISSUE_KEY_RE.findall(str(value or ""))
        if matches:
            return matches[-1].upper()
    return None


def collect_local_ticket_keys(projects: list[dict]) -> set[str]:
    keys = set()
    for project in projects:
        for session in project.get("sessions_list", []):
            key = _issue_key_from_session(session, str(project.get("name", "")))
            if key:
                keys.add(key)
    return keys


def _local_day(value: object, timezone: str) -> str:
    if not value:
        return ""
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if parsed.tzinfo is not None:
            parsed = parsed.astimezone(ZoneInfo(timezone))
        return parsed.date().isoformat()
    except (ValueError, ZoneInfoNotFoundError):
        return str(value)[:10]


def _issue_view(issue: dict, site_url: str) -> dict:
    fields = issue.get("fields") if isinstance(issue.get("fields"), dict) else {}
    status = fields.get("status") if isinstance(fields.get("status"), dict) else {}
    project = fields.get("project") if isinstance(fields.get("project"), dict) else {}
    issue_type = fields.get("issuetype") if isinstance(fields.get("issuetype"), dict) else {}
    key = str(issue.get("key", "")).upper()
    return {
        "key": key,
        "summary": str(fields.get("summary") or "Untitled issue"),
        "status": str(status.get("name") or "Unknown"),
        "status_category": str(
            (status.get("statusCategory") or {}).get("key", "")
            if isinstance(status.get("statusCategory"), dict)
            else ""
        ),
        "project": str(project.get("name") or project.get("key") or ""),
        "type": str(issue_type.get("name") or ""),
        "updated": str(fields.get("updated") or ""),
        "resolved": bool(fields.get("resolution")),
        "url": f"{site_url}/browse/{urllib.parse.quote(key, safe='-')}",
    }


def build_jira_insights(
    projects: list[dict],
    snapshot: dict,
    timezone: str,
    lookback_days: int,
) -> dict:
    """Reconcile local agent execution with the authenticated user's Jira worklogs."""
    today = datetime.now(ZoneInfo(timezone)).date()
    cutoff = (today - timedelta(days=max(1, lookback_days) - 1)).isoformat()
    issue_map = {
        str(item.get("key", "")).upper(): item
        for item in snapshot.get("issues", [])
        if item.get("key")
    }
    active_keys = {str(key).upper() for key in snapshot.get("active_keys", [])}
    activity: dict[tuple[str, str], dict] = {}
    unlinked = []

    for project in projects:
        project_name = str(project.get("name", "unknown"))
        for session in project.get("sessions_list", []):
            family = [session, *(session.get("subagent_sessions") or [])]
            seconds = round(
                sum(float(item.get("execution_time") or 0) for item in family)
            )
            day = _local_day(session.get("start"), timezone)
            if not day or day < cutoff or seconds <= 0:
                continue
            key = _issue_key_from_session(session, project_name)
            branches = sorted(
                {
                    str(branch)
                    for item in family
                    for branch in (item.get("branches") or [])
                    if branch
                }
            )
            if not key:
                unlinked.append(
                    {
                        "project": project_name,
                        "date": day,
                        "seconds": seconds,
                        "branches": branches,
                    }
                )
                continue
            # A Jira-looking branch name is not proof that the authenticated
            # user may browse that issue. The snapshot contains only issues
            # Jira returned through the user's permissions, so omit local keys
            # that are absent instead of rendering an unusable issue link.
            if key not in issue_map:
                continue
            row = activity.setdefault(
                (key, day),
                {
                    "key": key,
                    "date": day,
                    "dashboard_seconds": 0,
                    "jira_seconds": 0,
                    "projects": set(),
                    "branches": set(),
                },
            )
            row["dashboard_seconds"] += seconds
            row["projects"].add(project_name)
            row["branches"].update(branches)

    account_id = str(snapshot.get("account_id", ""))
    for key, worklogs in snapshot.get("worklogs", {}).items():
        for worklog in worklogs:
            author = worklog.get("author") if isinstance(worklog.get("author"), dict) else {}
            if account_id and str(author.get("accountId", "")) != account_id:
                continue
            day = _local_day(worklog.get("started"), timezone)
            row = activity.get((str(key).upper(), day))
            if row:
                row["jira_seconds"] += round(float(worklog.get("timeSpentSeconds") or 0))

    rows = []
    for row in activity.values():
        issue = issue_map[row["key"]]
        dashboard_seconds = row["dashboard_seconds"]
        jira_seconds = row["jira_seconds"]
        delta = dashboard_seconds - jira_seconds
        rows.append(
            {
                **{key: value for key, value in row.items() if key not in {"projects", "branches"}},
                "projects": sorted(row["projects"]),
                "branches": sorted(row["branches"]),
                "jira_seconds": jira_seconds,
                "delta_seconds": delta,
                "state": (
                    "missing"
                    if jira_seconds == 0
                    else ("under" if delta > 15 * 60 else "covered")
                ),
                "issue": issue,
            }
        )
    rows.sort(key=lambda item: (item["date"], item["key"]), reverse=True)

    recent_keys = {key for key, _ in activity}
    no_activity = [
        issue_map[key]
        for key in active_keys
        if key in issue_map and key not in recent_keys
    ]
    no_activity.sort(key=lambda issue: issue.get("updated", ""), reverse=True)
    unlinked.sort(key=lambda item: (item["date"], item["project"]), reverse=True)
    return {
        "configured": True,
        "status": "ok",
        "site_url": snapshot["site_url"],
        "jql": snapshot["jql"],
        "lookback_days": lookback_days,
        "account_name": snapshot.get("account_name", ""),
        "active_issue_count": len(active_keys),
        "missing_count": sum(row["state"] == "missing" for row in rows),
        "underlogged_count": sum(row["state"] == "under" for row in rows),
        "covered_count": sum(row["state"] == "covered" for row in rows),
        "unlinked_count": len(unlinked),
        "activity": rows,
        "unlinked": unlinked[:50],
        "no_activity": no_activity[:50],
    }


def _fetch_snapshot(config: dict, local_keys: set[str]) -> dict:
    client = JiraClient(config)
    user = client.current_user()
    active_issues = client.search(config["jql"], config["max_issues"])
    active_keys = {
        str(issue.get("key", "")).upper() for issue in active_issues if issue.get("key")
    }
    missing_keys = sorted(local_keys - active_keys)
    referenced_issues = []
    for offset in range(0, len(missing_keys), 50):
        chunk = missing_keys[offset : offset + 50]
        if not chunk:
            continue
        referenced_issues.extend(
            client.search(f"key in ({', '.join(chunk)})", len(chunk))
        )
    all_issues_by_key = {}
    for raw in [*active_issues, *referenced_issues]:
        view = _issue_view(raw, config["site_url"])
        if view["key"]:
            all_issues_by_key[view["key"]] = view

    worklog_keys = sorted(set(all_issues_by_key) & (local_keys | active_keys))
    worklogs: dict[str, list[dict]] = {}
    with ThreadPoolExecutor(max_workers=min(6, max(1, len(worklog_keys)))) as pool:
        futures = {pool.submit(client.worklogs, key): key for key in worklog_keys}
        for future in as_completed(futures):
            key = futures[future]
            worklogs[key] = future.result()
    return {
        "site_url": config["site_url"],
        "jql": config["jql"],
        "account_id": str(user.get("accountId", "")),
        "account_name": str(user.get("displayName", "")),
        "active_keys": sorted(active_keys),
        "issues": list(all_issues_by_key.values()),
        "worklogs": worklogs,
    }


def get_jira_dashboard(projects: list[dict], timezone: str) -> dict:
    """Return a browser-safe Jira dashboard payload, using a short-lived cache."""
    try:
        config = load_jira_config()
    except JiraError as exc:
        return {"configured": False, "status": "error", "message": str(exc)}
    if not config.get("configured"):
        return {
            "configured": False,
            "status": "incomplete" if config.get("incomplete") else "disabled",
            "message": config.get("message", ""),
        }

    local_keys = collect_local_ticket_keys(projects)
    cache_key = (
        config["site_url"],
        config["email"],
        config["jql"],
        tuple(sorted(local_keys)),
    )
    with _CACHE_LOCK:
        cached = _CACHE.get(cache_key)
        if cached and time.monotonic() - cached[0] < config["cache_seconds"]:
            snapshot = cached[1]
        else:
            snapshot = None
    try:
        if snapshot is None:
            snapshot = _fetch_snapshot(config, local_keys)
            with _CACHE_LOCK:
                _CACHE[cache_key] = (time.monotonic(), snapshot)
        return build_jira_insights(
            projects, snapshot, timezone, config["lookback_days"]
        )
    except JiraError as exc:
        return {
            "configured": True,
            "status": "error",
            "site_url": config["site_url"],
            "message": str(exc),
        }
