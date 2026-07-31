"""Typed public contract for dashboard API v2."""

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class ApiModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class HealthResponse(ApiModel):
    status: Literal["ok"] = "ok"
    service: Literal["agent-cost-dashboard-api"] = "agent-cost-dashboard-api"


class DashboardSummary(ApiModel):
    total_cost: float
    monthly_subscription_cost: float
    currency: str
    projects: int
    sessions: int
    messages: int
    prompts: int
    tokens: int
    input_tokens: int
    output_tokens: int
    cache_read_tokens: int
    cache_write_tokens: int
    reasoning_tokens: int
    execution_time: float
    llm_time: float
    tool_time: float
    avg_tps: float
    month_agent_seconds: float
    month_execution_seconds: float
    month_wall_seconds: float
    synced_machines: int


class SessionSummary(ApiModel):
    uid: str
    machine: str
    branches: list[str]
    messages: int
    prompts: int
    execution_time: float
    tokens: int
    input_tokens: int
    output_tokens: int
    cache_read_tokens: int
    cache_write_tokens: int
    reasoning_tokens: int
    cost: float
    start: datetime | None
    end: datetime | None
    duration: float
    llm_time: float
    tool_time: float
    avg_tps: float
    is_synced: bool
    subagent_sessions: list["SessionSummary"] = Field(default_factory=list)


class NamedModelSummary(ApiModel):
    name: str
    messages: int
    tokens: int
    input_tokens: int
    output_tokens: int
    cache_read_tokens: int
    cache_write_tokens: int
    reasoning_tokens: int
    cost: float
    avg_tps: float


class NamedToolSummary(ApiModel):
    name: str
    calls: int
    time: float
    errors: int
    avg_time: float


class ProjectSummary(ApiModel):
    name: str
    agent: str
    sessions: int
    machines: list[str]
    messages: int
    prompts: int
    execution_time: float
    tokens: int
    input_tokens: int
    output_tokens: int
    cache_read_tokens: int
    cache_write_tokens: int
    reasoning_tokens: int
    cost: float
    llm_time: float
    tool_time: float
    avg_tps: float
    last_activity: datetime | None
    models: list[NamedModelSummary]
    tools: list[NamedToolSummary]
    session_items: list[SessionSummary]


class DailyCostPoint(ApiModel):
    day: date
    prompts: int
    cost: float
    models: dict[str, float]


class ModelSummary(NamedModelSummary):
    llm_time: float
    cost_share: float
    priced: bool


class ToolSummary(NamedToolSummary):
    time_share: float


class WorklogDay(ApiModel):
    date: date
    seconds: int
    hours: float
    agent_seconds: int
    agent_hours: float
    execution_seconds: int
    execution_hours: float
    prompts: int
    machine_ids: list[str]
    branches: list[str]


class WorklogProject(ApiModel):
    project_key: str
    project_name: str
    seconds: int
    hours: float
    agent_seconds: int
    agent_hours: float
    execution_seconds: int
    execution_hours: float
    prompts: int
    machines: int
    machine_ids: list[str]
    branches: list[str]
    sessions: int
    daily: list[WorklogDay]


class Subscription(ApiModel):
    provider: str
    name: str
    monthly_cost: float


class Billing(ApiModel):
    currency: str
    subscriptions: list[Subscription]
    monthly_subscription_cost: float
    project_rates: dict[str, float]
    billing_increment_minutes: int
    warnings: list[str]


class JiraIssue(ApiModel):
    key: str
    summary: str
    status: str
    status_category: str = ""
    project: str = ""
    type: str = ""
    updated: str = ""
    resolved: bool = False
    url: str = ""


class JiraActivity(ApiModel):
    key: str
    date: date
    dashboard_seconds: int
    jira_seconds: int
    delta_seconds: int
    projects: list[str]
    branches: list[str]
    state: Literal["missing", "under", "covered"]
    issue: JiraIssue


class JiraUnlinkedActivity(ApiModel):
    project: str
    date: date
    seconds: int
    branches: list[str]


class JiraDashboard(ApiModel):
    configured: bool
    status: Literal["ok", "disabled", "incomplete", "error"]
    message: str = ""
    site_url: str = ""
    jql: str = ""
    lookback_days: int = 0
    account_name: str = ""
    active_issue_count: int = 0
    missing_count: int = 0
    underlogged_count: int = 0
    covered_count: int = 0
    unlinked_count: int = 0
    activity: list[JiraActivity] = Field(default_factory=list)
    unlinked: list[JiraUnlinkedActivity] = Field(default_factory=list)
    no_activity: list[JiraIssue] = Field(default_factory=list)


class SyncMachine(ApiModel):
    machine_id: str
    last_sync: datetime
    sessions: int


class DateRange(ApiModel):
    from_date: date
    to_date: date


class DashboardResponse(ApiModel):
    generated_at: datetime
    summary: DashboardSummary
    projects: list[ProjectSummary]
    daily_stats: list[DailyCostPoint]
    models: list[ModelSummary]
    tools: list[ToolSummary]
    worklogs: list[WorklogProject]
    billing: Billing
    jira: JiraDashboard
    sync_machines: list[SyncMachine]
    worklog_defaults: DateRange
    unpriced_models: list[str]
