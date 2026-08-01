export interface DashboardSummary {
  total_cost: number;
  monthly_subscription_cost: number;
  currency: string;
  projects: number;
  sessions: number;
  messages: number;
  prompts: number;
  tokens: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  reasoning_tokens: number;
  execution_time: number;
  llm_time: number;
  tool_time: number;
  avg_tps: number;
  month_agent_seconds: number;
  month_execution_seconds: number;
  month_wall_seconds: number;
  synced_machines: number;
}

export interface SessionSummary {
  uid: string;
  machine: string;
  branches: string[];
  messages: number;
  prompts: number;
  execution_time: number;
  tokens: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  reasoning_tokens: number;
  cost: number;
  start: string | null;
  end: string | null;
  duration: number;
  llm_time: number;
  tool_time: number;
  avg_tps: number;
  is_synced: boolean;
  subagent_sessions: SessionSummary[];
}

export interface NamedModel {
  name: string;
  messages: number;
  tokens: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  reasoning_tokens: number;
  cost: number;
  avg_tps: number;
}

export interface NamedTool {
  name: string;
  calls: number;
  time: number;
  errors: number;
  avg_time: number;
}

export interface ProjectSummary {
  name: string;
  agent: string;
  sessions: number;
  machines: string[];
  messages: number;
  prompts: number;
  execution_time: number;
  tokens: number;
  cost: number;
  llm_time: number;
  tool_time: number;
  avg_tps: number;
  last_activity: string | null;
  models: NamedModel[];
  tools: NamedTool[];
  session_items: SessionSummary[];
}

export interface DailyCostPoint {
  day: string;
  prompts: number;
  cost: number;
  models: Record<string, number>;
}

export interface ModelSummary extends NamedModel {
  llm_time: number;
  cost_share: number;
  priced: boolean;
}

export interface ToolSummary extends NamedTool {
  time_share: number;
}

export interface WorklogDay {
  date: string;
  seconds: number;
  hours: number;
  agent_seconds: number;
  agent_hours: number;
  execution_seconds: number;
  execution_hours: number;
  prompts: number;
  machine_ids: string[];
  branches: string[];
}

export interface WorklogSessionTiming {
  uid: string;
  machine_id: string;
  agent: string;
  branches: string[];
  activity_spans: Array<[string, string]>;
  execution_spans: Array<[string, string]>;
}

export interface WorklogProject {
  project_key: string;
  project_name: string;
  seconds: number;
  hours: number;
  agent_seconds: number;
  agent_hours: number;
  execution_seconds: number;
  execution_hours: number;
  prompts: number;
  machines: number;
  machine_ids: string[];
  branches: string[];
  sessions: number;
  session_timings: WorklogSessionTiming[];
  daily: WorklogDay[];
}

export interface JiraIssue {
  key: string;
  summary: string;
  status: string;
  project: string;
  type: string;
  updated: string;
  url: string;
}

export interface JiraActivity {
  key: string;
  date: string;
  dashboard_seconds: number;
  jira_seconds: number;
  delta_seconds: number;
  projects: string[];
  branches: string[];
  state: "missing" | "under" | "covered";
  issue: JiraIssue;
}

export interface JiraDashboard {
  configured: boolean;
  status: "ok" | "disabled" | "incomplete" | "error";
  message: string;
  site_url: string;
  account_name: string;
  active_issue_count: number;
  missing_count: number;
  underlogged_count: number;
  covered_count: number;
  unlinked_count: number;
  activity: JiraActivity[];
  unlinked: Array<{
    project: string;
    date: string;
    seconds: number;
    branches: string[];
  }>;
  no_activity: JiraIssue[];
}

export interface DashboardResponse {
  generated_at: string;
  summary: DashboardSummary;
  projects: ProjectSummary[];
  daily_stats: DailyCostPoint[];
  models: ModelSummary[];
  tools: ToolSummary[];
  worklogs: WorklogProject[];
  jira: JiraDashboard;
  worklog_defaults: { from_date: string; to_date: string };
  unpriced_models: string[];
}
