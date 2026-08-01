import {
  type MouseEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  Bot,
  ChartNoAxesCombined,
  Check,
  ChevronDown,
  CircleAlert,
  Clock3,
  FolderKanban,
  Gauge,
  Menu,
  RefreshCw,
  Search,
  Server,
  Sparkles,
  TicketCheck,
  X,
} from "lucide-react";
import { fetchDashboard } from "./api";
import { compact, displayProject, duration, money, shortDate } from "./format";
import type {
  DailyCostPoint,
  DashboardResponse,
  JiraActivity,
  ProjectSummary,
  SessionSummary,
} from "./types";

const nav = [
  { to: "/", label: "Overview", icon: Gauge },
  { to: "/projects", label: "Projects & sessions", icon: FolderKanban },
  { to: "/time", label: "Time accounting", icon: Clock3 },
  { to: "/jira", label: "Jira reconciliation", icon: TicketCheck },
  { to: "/models", label: "Models & tools", icon: Bot },
];

function navigate(to: string) {
  window.history.pushState({}, "", to);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function AppLink({
  to,
  className,
  children,
  onClick,
}: {
  to: string;
  className?: string;
  children: ReactNode;
  onClick?: () => void;
}) {
  function follow(event: MouseEvent<HTMLAnchorElement>) {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    event.preventDefault();
    navigate(to);
    onClick?.();
  }
  return (
    <a href={to} className={className} onClick={follow}>
      {children}
    </a>
  );
}

function CostChart({ data }: { data: DailyCostPoint[] }) {
  const chart = useMemo(() => {
    const modelTotals = new Map<string, number>();
    data.forEach((point) =>
      Object.entries(point.models).forEach(([model, cost]) =>
        modelTotals.set(model, (modelTotals.get(model) ?? 0) + cost),
      ),
    );
    const topModels = [...modelTotals.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name]) => name);
    const palette = ["#166534", "#3f6212", "#0f766e", "#a16207", "#64748b"];
    const totals = data.map((point) =>
      topModels.reduce((sum, model) => sum + (point.models[model] ?? 0), 0),
    );
    return {
      topModels,
      palette,
      totals,
      max: Math.max(...totals, 1),
    };
  }, [data]);

  const width = 840;
  const height = 270;
  const left = 42;
  const top = 10;
  const bottom = 30;
  const plotHeight = height - top - bottom;
  const plotWidth = width - left - 8;
  const step = plotWidth / Math.max(data.length, 1);
  const barWidth = Math.min(22, step * 0.66);
  const labelEvery = Math.max(1, Math.ceil(data.length / 8));

  return (
    <div className="chart-canvas" aria-label="Daily model cost chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img">
        {[0, 0.5, 1].map((ratio) => {
          const y = top + plotHeight * (1 - ratio);
          return (
            <g key={ratio}>
              <line x1={left} x2={width} y1={y} y2={y} stroke="#e7e6e1" />
              <text x={left - 7} y={y + 3} textAnchor="end">
                ${Math.round(chart.max * ratio)}
              </text>
            </g>
          );
        })}
        {data.map((point, index) => {
          const x = left + index * step + (step - barWidth) / 2;
          let accumulated = 0;
          return (
            <g key={point.day}>
              <title>{`${point.day}: ${money(chart.totals[index])}`}</title>
              {chart.topModels.map((model, modelIndex) => {
                const value = point.models[model] ?? 0;
                const rectHeight = (value / chart.max) * plotHeight;
                accumulated += rectHeight;
                return (
                  <rect
                    key={model}
                    x={x}
                    y={top + plotHeight - accumulated}
                    width={barWidth}
                    height={Math.max(0, rectHeight)}
                    fill={chart.palette[modelIndex]}
                    rx={modelIndex === chart.topModels.length - 1 ? 2 : 0}
                  />
                );
              })}
              {index % labelEvery === 0 && (
                <text x={x + barWidth / 2} y={height - 8} textAnchor="middle">
                  {point.day.slice(5)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div className="chart-legend">
        {chart.topModels.map((model, index) => (
          <span key={model}>
            <i style={{ background: chart.palette[index] }} />
            {model}
          </span>
        ))}
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note: string;
  tone?: "green" | "amber" | "slate";
}) {
  return (
    <article className={`metric ${tone ?? ""}`}>
      <div className="metric-label">{label}</div>
      <strong>{value}</strong>
      <span>{note}</span>
    </article>
  );
}

function SectionHead({
  eyebrow,
  title,
  detail,
}: {
  eyebrow: string;
  title: string;
  detail?: string;
}) {
  return (
    <div className="section-head">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h2>{title}</h2>
      </div>
      {detail && <p>{detail}</p>}
    </div>
  );
}

function JiraState({ state }: { state: JiraActivity["state"] }) {
  const labels = { missing: "Missing", under: "Time gap", covered: "Covered" };
  return <span className={`state state-${state}`}>{labels[state]}</span>;
}

function Overview({ data }: { data: DashboardResponse }) {
  const { summary, jira } = data;
  const attention = jira.activity
    .filter((row) => row.state !== "covered")
    .sort((a, b) => b.delta_seconds - a.delta_seconds)
    .slice(0, 5);
  const topProjects = [...data.projects].sort((a, b) => b.cost - a.cost).slice(0, 6);

  return (
    <>
      <SectionHead
        eyebrow="Operating picture"
        title="Where the work and spend went"
        detail={`${data.worklog_defaults.from_date} — ${data.worklog_defaults.to_date}`}
      />
      <div className="metric-grid">
        <Metric
          label="API-equivalent value"
          value={money(summary.total_cost)}
          note={`${compact(summary.tokens)} total tokens`}
          tone="green"
        />
        <Metric
          label="Working time this month"
          value={duration(summary.month_wall_seconds)}
          note={`${duration(summary.month_agent_seconds)} agent · ${duration(summary.month_execution_seconds)} execution`}
        />
        <Metric
          label="Active footprint"
          value={`${summary.projects} projects`}
          note={`${summary.sessions} sessions · ${summary.synced_machines} devices`}
          tone="slate"
        />
        <Metric
          label="Needs reconciliation"
          value={`${jira.missing_count + jira.underlogged_count}`}
          note={`${jira.missing_count} missing · ${jira.underlogged_count} time gaps`}
          tone="amber"
        />
      </div>

      <div className="time-summary-link">
        <Clock3 size={15} />
        <span>
          The headline is wall-clock time. Agent and execution time measure the same
          work differently and should not be added together.
        </span>
        <AppLink to="/time" className="text-link">
          See how time is measured
        </AppLink>
      </div>

      <div className="overview-grid">
        <section className="panel chart-panel">
          <div className="panel-title-row">
            <div>
              <span className="eyebrow">Cost trend</span>
              <h3>Daily value by model</h3>
            </div>
            <span className="quiet-badge">Stacked model cost</span>
          </div>
          <CostChart data={data.daily_stats.slice(-45)} />
        </section>

        <section className="panel attention-panel">
          <div className="panel-title-row">
            <div>
              <span className="eyebrow">Focus queue</span>
              <h3>Worklog gaps</h3>
            </div>
            <AppLink to="/jira" className="text-link">
              Open all
            </AppLink>
          </div>
          {!jira.configured ? (
            <div className="empty">
              <TicketCheck size={22} />
              <strong>Jira is not connected</strong>
              <span>The API stays useful; reconciliation appears after server setup.</span>
            </div>
          ) : attention.length ? (
            <div className="queue">
              {attention.map((row) => (
                <a
                  className="queue-row"
                  href={row.issue.url}
                  target="_blank"
                  rel="noreferrer"
                  key={`${row.key}-${row.date}`}
                >
                  <div>
                    <strong>{row.key}</strong>
                    <span>{row.issue.summary}</span>
                  </div>
                  <div className="queue-meta">
                    <JiraState state={row.state} />
                    <span>{duration(Math.abs(row.delta_seconds))}</span>
                  </div>
                </a>
              ))}
            </div>
          ) : (
            <div className="empty">
              <Check size={22} />
              <strong>No open worklog gaps</strong>
              <span>Visible ticket activity is reconciled.</span>
            </div>
          )}
        </section>
      </div>

      <section className="panel">
        <div className="panel-title-row">
          <div>
            <span className="eyebrow">Portfolio</span>
            <h3>Highest-value projects</h3>
          </div>
          <AppLink to="/projects" className="text-link">
            Explore projects
          </AppLink>
        </div>
        <div className="project-strip">
          {topProjects.map((project) => (
            <article className="project-mini" key={`${project.agent}-${project.name}`}>
              <div className="project-mini-top">
                <span className="agent-tag">{project.agent}</span>
                <span>{shortDate(project.last_activity)}</span>
              </div>
              <h4>{displayProject(project.name)}</h4>
              <div className="project-mini-values">
                <strong>{money(project.cost)}</strong>
                <span>{duration(project.execution_time)}</span>
              </div>
              <div className="meter">
                <i style={{ width: `${Math.max(4, (project.cost / topProjects[0].cost) * 100)}%` }} />
              </div>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}

type ProjectGroup = "none" | "project" | "branch" | "agent" | "machine";

type TimedProjectSummary = ProjectSummary & {
  wall_time: number | null;
  agent_time: number | null;
  accounted_execution_time: number | null;
};

function projectIdentity(project: ProjectSummary): string {
  return JSON.stringify([project.agent, project.name]);
}

function sessionBranches(session: SessionSummary): string[] {
  return [
    ...session.branches,
    ...session.subagent_sessions.flatMap(sessionBranches),
  ].filter(Boolean);
}

function primaryBranch(session: SessionSummary): string {
  return sessionBranches(session).at(-1) || "No branch";
}

function normalizedProjectKey(value: string): string {
  return value.replaceAll("\\", "/").replace(/\/$/, "");
}

type TimestampSpan = [string, string];
type SessionTiming = DashboardResponse["worklogs"][number]["session_timings"][number];

function mergedSpanSeconds(spans: TimestampSpan[]): number {
  const ordered = spans
    .map(([start, end]) => [Date.parse(start), Date.parse(end)] as const)
    .filter(
      ([start, end]) =>
        Number.isFinite(start) && Number.isFinite(end) && end > start,
    )
    .sort(([left], [right]) => left - right);
  const first = ordered[0];
  if (!first) return 0;

  let [currentStart, currentEnd] = first;
  let total = 0;
  ordered.slice(1).forEach(([start, end]) => {
    if (start <= currentEnd) {
      currentEnd = Math.max(currentEnd, end);
      return;
    }
    total += currentEnd - currentStart;
    currentStart = start;
    currentEnd = end;
  });
  return (total + currentEnd - currentStart) / 1000;
}

function timingKey(agent: string, uid: string): string {
  return JSON.stringify([agent, uid]);
}

function dateMatchesRange(date: string, dateFrom: string, dateTo: string): boolean {
  return (!dateFrom || date >= dateFrom) && (!dateTo || date <= dateTo);
}

function projectTimingMap(
  project: ProjectSummary,
  worklogs: DashboardResponse["worklogs"],
): Map<string, SessionTiming> {
  const identity = normalizedProjectKey(project.name);
  const timings = new Map<string, SessionTiming>();
  worklogs
    .filter(
      (worklog) =>
        normalizedProjectKey(worklog.project_name) === identity ||
        normalizedProjectKey(worklog.project_key) === identity,
    )
    .flatMap((worklog) => worklog.session_timings)
    .forEach((timing) => timings.set(timingKey(timing.agent, timing.uid), timing));
  return timings;
}

function scopedTimingSpans(
  timing: SessionTiming,
  dateFrom: string,
  dateTo: string,
): { activitySpans: TimestampSpan[]; executionSpans: TimestampSpan[] } | null {
  if (!dateFrom && !dateTo) {
    return {
      activitySpans: timing.activity_spans,
      executionSpans: timing.execution_spans,
    };
  }
  if (!timing.daily.length) return null;
  const days = timing.daily.filter((day) =>
    dateMatchesRange(day.date, dateFrom, dateTo),
  );
  return {
    activitySpans: days.flatMap((day) => day.activity_spans),
    executionSpans: days.flatMap((day) => day.execution_spans),
  };
}

function localDate(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function sessionOverlapsDateRange(
  session: SessionSummary,
  dateFrom: string,
  dateTo: string,
): boolean {
  if (!dateFrom && !dateTo) return true;
  const startDay = localDate(session.start || session.end);
  const endDay = localDate(session.end || session.start);
  if (!startDay || !endDay) return false;
  return (!dateFrom || endDay >= dateFrom) && (!dateTo || startDay <= dateTo);
}

function latestSpanEnd(spans: TimestampSpan[]): string | null {
  const latest = spans.reduce((result, [, end]) => {
    const timestamp = Date.parse(end);
    return Number.isFinite(timestamp) ? Math.max(result, timestamp) : result;
  }, Number.NEGATIVE_INFINITY);
  return Number.isFinite(latest) ? new Date(latest - 1).toISOString() : null;
}

function sessionDateRange(session: SessionSummary): string {
  const start = session.start ? shortDate(session.start) : "";
  const end = session.end ? shortDate(session.end) : "";
  if (start && end && start !== end) return `${start} → ${end}`;
  return end || start || "No activity";
}

function attachProjectTiming(
  project: ProjectSummary,
  worklogs: DashboardResponse["worklogs"],
  dateFrom: string,
  dateTo: string,
): TimedProjectSummary {
  const selectedSessions = project.session_items;
  if (
    !selectedSessions.length ||
    selectedSessions.some((session) => !session.is_synced)
  ) {
    return {
      ...project,
      wall_time: null,
      agent_time: null,
      accounted_execution_time: null,
    };
  }

  const timings = projectTimingMap(project, worklogs);
  const selectedTimings: SessionTiming[] = [];
  for (const session of selectedSessions) {
    const timing = timings.get(timingKey(project.agent, session.uid));
    if (!timing) {
      return {
        ...project,
        wall_time: null,
        agent_time: null,
        accounted_execution_time: null,
      };
    }
    selectedTimings.push(timing);
  }

  const scopedTimings: Array<{
    activitySpans: TimestampSpan[];
    executionSpans: TimestampSpan[];
  }> = [];
  for (const timing of selectedTimings) {
    const scoped = scopedTimingSpans(timing, dateFrom, dateTo);
    if (!scoped) {
      return {
        ...project,
        wall_time: null,
        agent_time: null,
        accounted_execution_time: null,
      };
    }
    scopedTimings.push(scoped);
  }

  const activitySpans = scopedTimings.flatMap((timing) => timing.activitySpans);
  return {
    ...project,
    last_activity: latestSpanEnd(activitySpans) ?? project.last_activity,
    wall_time: mergedSpanSeconds(activitySpans),
    agent_time: scopedTimings.reduce(
      (total, timing) => total + mergedSpanSeconds(timing.activitySpans),
      0,
    ),
    accounted_execution_time: scopedTimings.reduce(
      (total, timing) => total + mergedSpanSeconds(timing.executionSpans),
      0,
    ),
  };
}

function summarizeProjectSessions(
  project: ProjectSummary,
  sessions: SessionSummary[],
): ProjectSummary {
  const sum = (field: keyof SessionSummary) =>
    sessions.reduce((total, session) => total + Number(session[field] || 0), 0);
  const activity = sessions
    .map((session) => session.end || session.start)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);
  const llmTime = sum("llm_time");
  const outputTokens = sum("output_tokens");
  return {
    ...project,
    sessions: sessions.length,
    session_items: sessions,
    machines: [...new Set(sessions.map((session) => session.machine).filter(Boolean))].sort(),
    messages: sum("messages"),
    prompts: sum("prompts"),
    execution_time: sum("execution_time"),
    tokens: sum("tokens"),
    cost: sum("cost"),
    llm_time: llmTime,
    tool_time: sum("tool_time"),
    avg_tps: llmTime > 0 ? outputTokens / llmTime : 0,
    last_activity: activity || null,
  };
}

function Projects({ data }: { data: DashboardResponse }) {
  const [query, setQuery] = useState("");
  const [agent, setAgent] = useState("all");
  const [machine, setMachine] = useState("all");
  const [projectFilter, setProjectFilter] = useState("all");
  const [branch, setBranch] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [group, setGroup] = useState<ProjectGroup>("none");
  const [minCost, setMinCost] = useState(0);
  const agents = [...new Set(data.projects.map((project) => project.agent))].sort();
  const machines = [...new Set(data.projects.flatMap((project) => project.machines))].sort();
  const projects = [...data.projects].sort((a, b) =>
    displayProject(a.name).localeCompare(displayProject(b.name)),
  );
  const branches = [
    ...new Set(
      data.projects.flatMap((project) =>
        project.session_items.map(primaryBranch).filter((item) => item !== "No branch"),
      ),
    ),
  ].sort((a, b) => a.localeCompare(b));
  const hasSessionFilters =
    machine !== "all" || branch !== "all" || Boolean(dateFrom) || Boolean(dateTo);
  const filtered = useMemo(
    () =>
      data.projects
        .map((project) => {
          const haystack = [
            project.name,
            project.agent,
            ...project.machines,
            ...project.session_items.flatMap(sessionBranches),
          ]
            .join(" ")
            .toLowerCase();
          if (
            (query && !haystack.includes(query.toLowerCase())) ||
            (agent !== "all" && project.agent !== agent) ||
            (projectFilter !== "all" && projectIdentity(project) !== projectFilter)
          ) {
            return null;
          }
          const timings = projectTimingMap(project, data.worklogs);
          const sessions = project.session_items.filter((session) => {
            const timing = timings.get(timingKey(project.agent, session.uid));
            const matchesDate =
              !dateFrom && !dateTo
                ? true
                : timing?.daily.length
                  ? timing.daily.some(
                      (day) =>
                        dateMatchesRange(day.date, dateFrom, dateTo) &&
                        (day.activity_spans.length > 0 ||
                          day.execution_spans.length > 0),
                    )
                  : sessionOverlapsDateRange(session, dateFrom, dateTo);
            return (
              (machine === "all" || session.machine === machine) &&
              (branch === "all" || primaryBranch(session) === branch) &&
              matchesDate
            );
          });
          if (hasSessionFilters && sessions.length === 0) return null;
          const visibleProject = hasSessionFilters
            ? summarizeProjectSessions(project, sessions)
            : project;
          return visibleProject.cost >= minCost ? visibleProject : null;
        })
        .filter((project): project is ProjectSummary => project !== null)
        .sort((a, b) => b.cost - a.cost),
    [
      agent,
      branch,
      data.projects,
      dateFrom,
      dateTo,
      hasSessionFilters,
      machine,
      minCost,
      projectFilter,
      query,
    ],
  );
  const groups = useMemo(() => {
    if (group === "none") {
      return [{ id: "all", label: "All projects", projects: filtered }];
    }
    if (group === "project") {
      return filtered.map((project) => ({
        id: `project-${projectIdentity(project)}`,
        label: `${displayProject(project.name)} · ${project.agent}`,
        projects: [project],
      }));
    }
    const result = new Map<string, ProjectSummary[]>();
    filtered.forEach((project) => {
      if (group === "branch") {
        const sessionsByBranch = new Map<string, SessionSummary[]>();
        project.session_items.forEach((session) => {
          const key = primaryBranch(session);
          sessionsByBranch.set(key, [...(sessionsByBranch.get(key) ?? []), session]);
        });
        sessionsByBranch.forEach((sessions, key) => {
          result.set(key, [
            ...(result.get(key) ?? []),
            summarizeProjectSessions(project, sessions),
          ]);
        });
        return;
      }
      if (group === "machine") {
        const keys = project.machines.length ? project.machines : ["Unknown device"];
        keys.forEach((key) => {
          const sessions = project.session_items.filter(
            (session) => session.machine === key,
          );
          result.set(key, [
            ...(result.get(key) ?? []),
            sessions.length ? summarizeProjectSessions(project, sessions) : project,
          ]);
        });
        return;
      }
      result.set(project.agent || "Unknown agent", [
        ...(result.get(project.agent || "Unknown agent") ?? []),
        project,
      ]);
    });
    return [...result.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([label, groupProjects]) => ({
        id: `${group}-${label}`,
        label,
        projects: groupProjects.sort((a, b) => b.cost - a.cost),
      }));
  }, [filtered, group]);
  const timedGroups = useMemo(
    () =>
      groups.map((item) => ({
        ...item,
        projects: item.projects.map((project) =>
          attachProjectTiming(project, data.worklogs, dateFrom, dateTo),
        ),
      })),
    [data.worklogs, dateFrom, dateTo, groups],
  );
  const visibleSessions = filtered.reduce(
    (total, project) => total + project.sessions,
    0,
  );
  const activeFilters = [
    query,
    agent !== "all",
    machine !== "all",
    projectFilter !== "all",
    branch !== "all",
    dateFrom,
    dateTo,
    minCost > 0,
  ].filter(Boolean).length;

  function resetFilters() {
    setQuery("");
    setAgent("all");
    setMachine("all");
    setProjectFilter("all");
    setBranch("all");
    setDateFrom("");
    setDateTo("");
    setMinCost(0);
  }

  return (
    <>
      <SectionHead
        eyebrow="Work explorer"
        title="Projects and session activity"
        detail={`${filtered.length} of ${data.projects.length} projects · ${visibleSessions} visible sessions`}
      />
      <div className="filter-bar">
        <label className="search-field">
          <Search size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search project, branch, device…"
          />
          {query && (
            <button onClick={() => setQuery("")} aria-label="Clear search">
              <X size={15} />
            </button>
          )}
        </label>
        <label>
          <span>Project</span>
          <select
            value={projectFilter}
            onChange={(event) => setProjectFilter(event.target.value)}
          >
            <option value="all">All projects</option>
            {projects.map((item) => (
              <option value={projectIdentity(item)} key={projectIdentity(item)}>
                {displayProject(item.name)} · {item.agent}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Branch</span>
          <select value={branch} onChange={(event) => setBranch(event.target.value)}>
            <option value="all">All branches</option>
            {branches.map((item) => (
              <option value={item} key={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Agent</span>
          <select value={agent} onChange={(event) => setAgent(event.target.value)}>
            <option value="all">All agents</option>
            {agents.map((item) => (
              <option value={item} key={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Device</span>
          <select value={machine} onChange={(event) => setMachine(event.target.value)}>
            <option value="all">All devices</option>
            {machines.map((item) => (
              <option value={item} key={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>From</span>
          <input
            type="date"
            value={dateFrom}
            max={dateTo || undefined}
            onChange={(event) => setDateFrom(event.target.value)}
          />
        </label>
        <label>
          <span>To</span>
          <input
            type="date"
            value={dateTo}
            min={dateFrom || undefined}
            onChange={(event) => setDateTo(event.target.value)}
          />
        </label>
        <label>
          <span>Minimum value</span>
          <select value={minCost} onChange={(event) => setMinCost(Number(event.target.value))}>
            <option value="0">Any value</option>
            <option value="1">$1+</option>
            <option value="10">$10+</option>
            <option value="50">$50+</option>
          </select>
        </label>
        <label>
          <span>Group by</span>
          <select value={group} onChange={(event) => setGroup(event.target.value as ProjectGroup)}>
            <option value="none">No grouping</option>
            <option value="project">Project</option>
            <option value="branch">Branch</option>
            <option value="agent">Agent</option>
            <option value="machine">Device</option>
          </select>
        </label>
        {activeFilters > 0 && (
          <button className="reset-filters" onClick={resetFilters}>
            <X size={14} />
            Reset {activeFilters}
          </button>
        )}
      </div>

      <p className="project-time-note">
        Date filters include sessions that overlap the selected local days and clip
        Wall-clock, Agent, Execution, and Last activity to that range. Prompts, LLM,
        tools, tokens, and value remain whole-session totals. Session window in the
        expanded details is the full first-to-last session envelope, includes idle
        gaps, and is not intended for billing.
      </p>

      <div className="group-stack">
        {timedGroups.map((item) => (
          <section className="panel project-group" key={item.id}>
            {group !== "none" && (
              <div className="group-heading">
                <h3>{item.label}</h3>
                <span>
                  {item.projects.length} {item.projects.length === 1 ? "project" : "projects"} ·{" "}
                  {item.projects.reduce((total, project) => total + project.sessions, 0)} sessions
                </span>
              </div>
            )}
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Project</th>
                    <th>Agent / devices</th>
                    <th>Last activity</th>
                    <th className="numeric">Sessions</th>
                    <th className="numeric" title="Elapsed active project time with overlap removed">Wall-clock</th>
                    <th className="numeric" title="Active session time; parallel agents add up">Agent</th>
                    <th className="numeric" title="Completed prompt processing">Execution</th>
                    <th className="numeric" title="Time waiting for model responses">LLM</th>
                    <th className="numeric" title="Elapsed time inside tool calls">Tools</th>
                    <th className="numeric">Tokens</th>
                    <th className="numeric">Value</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {item.projects.map((project) => (
                    <ProjectRow project={project} key={`${item.id}-${project.agent}-${project.name}`} />
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
        {!filtered.length && (
          <div className="panel empty">
            <Search size={22} />
            <strong>No projects match these filters</strong>
            <span>Try broadening the date, branch, project, or minimum value.</span>
          </div>
        )}
      </div>
    </>
  );
}

function ProjectRow({ project }: { project: TimedProjectSummary }) {
  const [open, setOpen] = useState(false);
  const latestSessions = [...project.session_items]
    .sort((a, b) => (b.start ?? "").localeCompare(a.start ?? ""))
    .slice(0, 5);
  return (
    <>
      <tr className={open ? "row-open" : ""}>
        <td>
          <button
            className="project-name"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
          >
            {displayProject(project.name)}
          </button>
          <span className="muted-line">{project.prompts} human prompts</span>
        </td>
        <td>
          <span className="agent-tag">{project.agent}</span>
          <span className="muted-line">{project.machines.join(", ") || "Local only"}</span>
        </td>
        <td>{shortDate(project.last_activity)}</td>
        <td className="numeric">{project.sessions}</td>
        <td className="numeric">{project.wall_time === null ? "—" : duration(project.wall_time)}</td>
        <td className="numeric">{project.agent_time === null ? "—" : duration(project.agent_time)}</td>
        <td className="numeric">
          {duration(project.accounted_execution_time ?? project.execution_time)}
        </td>
        <td className="numeric">{duration(project.llm_time)}</td>
        <td className="numeric">{duration(project.tool_time)}</td>
        <td className="numeric">{compact(project.tokens)}</td>
        <td className="numeric strong-number">{money(project.cost)}</td>
        <td>
          <button className="icon-button" onClick={() => setOpen((value) => !value)} aria-label="Toggle sessions">
            <ChevronDown className={open ? "rotated" : ""} size={17} />
          </button>
        </td>
      </tr>
      {open && (
        <tr className="detail-row">
          <td colSpan={12}>
            <div className="session-detail">
              <div className="detail-summary">
                <span>
                  <Clock3 size={15} /> {duration(project.llm_time)} LLM
                </span>
                <span>
                  <Activity size={15} /> {duration(project.tool_time)} tools
                </span>
                <span>
                  <ChartNoAxesCombined size={15} /> {project.avg_tps.toFixed(1)} tok/s
                </span>
              </div>
              {latestSessions.map((session) => (
                <div className="session-line" key={session.uid}>
                  <span>{sessionDateRange(session)}</span>
                  <strong>{primaryBranch(session)}</strong>
                  <span>{session.machine}</span>
                  <span
                    title="Execution excludes idle time; session window is the full first-to-last session envelope and includes idle gaps."
                  >
                    {duration(session.execution_time)} exec · {duration(session.duration)} window
                  </span>
                  <span>{money(session.cost)}</span>
                </div>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

type WorklogDisplayRow = {
  projectKey: string;
  project: string;
  date: string;
  seconds: number;
  agentSeconds: number;
  executionSeconds: number;
  prompts: number;
  machineIds: string[];
  branches: string[];
};

type TimeGroup = "none" | "project" | "branch" | "date" | "device";

function TimeRowsTable({ rows }: { rows: WorklogDisplayRow[] }) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Project</th>
            <th>Branches</th>
            <th>Devices</th>
            <th className="numeric">Prompts</th>
            <th className="numeric">Wall-clock</th>
            <th className="numeric">Agent time</th>
            <th className="numeric">Execution</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.projectKey}-${row.date}`}>
              <td>{row.date}</td>
              <td><strong>{displayProject(row.project)}</strong></td>
              <td>{row.branches.join(", ") || "No branch"}</td>
              <td>{row.machineIds.join(", ") || "Unknown"}</td>
              <td className="numeric">{row.prompts}</td>
              <td className="numeric">{duration(row.seconds)}</td>
              <td className="numeric">{duration(row.agentSeconds)}</td>
              <td className="numeric strong-number">{duration(row.executionSeconds)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TimeAccounting({ data }: { data: DashboardResponse }) {
  const [query, setQuery] = useState("");
  const [dateFrom, setDateFrom] = useState(data.worklog_defaults.from_date);
  const [dateTo, setDateTo] = useState(data.worklog_defaults.to_date);
  const [projectKey, setProjectKey] = useState("all");
  const [branch, setBranch] = useState("all");
  const [machine, setMachine] = useState("all");
  const [group, setGroup] = useState<TimeGroup>("none");
  const projects = [...data.worklogs].sort((a, b) =>
    displayProject(a.project_name).localeCompare(displayProject(b.project_name)),
  );
  const machines = [...new Set(data.worklogs.flatMap((item) => item.machine_ids))].sort();
  const branches = [...new Set(data.worklogs.flatMap((item) => item.branches))].sort(
    (a, b) => a.localeCompare(b),
  );
  const rows = useMemo(() => {
    const visible: WorklogDisplayRow[] = [];
    data.worklogs.forEach((project) => {
      if (projectKey !== "all" && project.project_key !== projectKey) return;
      project.daily.forEach((day) => {
        const machineIds = day.machine_ids.length
          ? day.machine_ids
          : project.machine_ids;
        const dayBranches = day.branches.length ? day.branches : project.branches;
        if (
          (dateFrom && day.date < dateFrom) ||
          (dateTo && day.date > dateTo) ||
          (branch !== "all" && !dayBranches.includes(branch)) ||
          (machine !== "all" && !machineIds.includes(machine)) ||
          (query &&
            ![
              project.project_name,
              project.project_key,
              day.date,
              ...dayBranches,
              ...machineIds,
            ]
              .join(" ")
              .toLowerCase()
              .includes(query.toLowerCase()))
        ) {
          return;
        }
        visible.push({
          projectKey: project.project_key,
          project: project.project_name,
          date: day.date,
          seconds: day.seconds,
          agentSeconds: day.agent_seconds,
          executionSeconds: day.execution_seconds,
          prompts: day.prompts,
          machineIds,
          branches: dayBranches,
        });
      });
    });
    return visible.sort(
      (a, b) => b.date.localeCompare(a.date) || a.project.localeCompare(b.project),
    );
  }, [branch, data.worklogs, dateFrom, dateTo, machine, projectKey, query]);
  const totals = rows.reduce(
    (result, row) => ({
      wall: result.wall + row.seconds,
      agent: result.agent + row.agentSeconds,
      execution: result.execution + row.executionSeconds,
      prompts: result.prompts + row.prompts,
    }),
    { wall: 0, agent: 0, execution: 0, prompts: 0 },
  );
  const uncoveredRows = rows.filter(
    (row) => row.seconds > 0 && row.executionSeconds === 0,
  ).length;
  const groups = useMemo(() => {
    if (group === "none") {
      return [{ id: "all", label: "All time records", rows }];
    }
    const grouped = new Map<string, WorklogDisplayRow[]>();
    rows.forEach((row) => {
      const key =
        group === "project"
          ? row.projectKey
          : group === "branch"
            ? row.branches.join(" + ") || "No branch"
          : group === "date"
            ? row.date
            : row.machineIds.join(" + ") || "Unknown device";
      grouped.set(key, [...(grouped.get(key) ?? []), row]);
    });
    return [...grouped.entries()]
      .sort(([a], [b]) =>
        group === "date" ? b.localeCompare(a) : a.localeCompare(b),
      )
      .map(([key, groupRows]) => ({
        id: `${group}-${key}`,
        label:
          group === "project"
            ? displayProject(groupRows[0].project)
            : key,
        rows: groupRows,
      }));
  }, [group, rows]);
  const activeFilters = [
    query,
    dateFrom !== data.worklog_defaults.from_date,
    dateTo !== data.worklog_defaults.to_date,
    projectKey !== "all",
    branch !== "all",
    machine !== "all",
  ].filter(Boolean).length;

  function resetFilters() {
    setQuery("");
    setDateFrom(data.worklog_defaults.from_date);
    setDateTo(data.worklog_defaults.to_date);
    setProjectKey("all");
    setBranch("all");
    setMachine("all");
  }

  return (
    <>
      <SectionHead
        eyebrow="Time accounting"
        title="What the time numbers mean"
        detail={`${rows.length} visible records · ${dateFrom || "First activity"} — ${dateTo || "Today"}`}
      />

      <div className="filter-bar time-filters">
        <label className="search-field">
          <Search size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search project, device, date…"
          />
          {query && (
            <button onClick={() => setQuery("")} aria-label="Clear search">
              <X size={15} />
            </button>
          )}
        </label>
        <label>
          <span>Project</span>
          <select value={projectKey} onChange={(event) => setProjectKey(event.target.value)}>
            <option value="all">All projects</option>
            {projects.map((project) => (
              <option value={project.project_key} key={project.project_key}>
                {displayProject(project.project_name)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Device</span>
          <select value={machine} onChange={(event) => setMachine(event.target.value)}>
            <option value="all">All devices</option>
            {machines.map((item) => (
              <option value={item} key={item}>{item}</option>
            ))}
          </select>
        </label>
        <label>
          <span>From</span>
          <input
            type="date"
            value={dateFrom}
            max={dateTo || undefined}
            onChange={(event) => setDateFrom(event.target.value)}
          />
        </label>
        <label>
          <span>To</span>
          <input
            type="date"
            value={dateTo}
            min={dateFrom || undefined}
            onChange={(event) => setDateTo(event.target.value)}
          />
        </label>
        <label>
          <span>Group by</span>
          <select value={group} onChange={(event) => setGroup(event.target.value as TimeGroup)}>
            <option value="none">No grouping</option>
            <option value="project">Project</option>
            <option value="branch">Branch</option>
            <option value="date">Date</option>
            <option value="device">Device</option>
          </select>
        </label>
        {activeFilters > 0 && (
          <button className="reset-filters" onClick={resetFilters}>
            <X size={14} />
            Reset {activeFilters}
          </button>
        )}
      </div>

      {machine !== "all" && (
        <p className="time-filter-note">
          Device filtering selects complete project-day records involving {machine};
          the API does not split those durations between devices.
        </p>
      )}

      <div className="metric-grid time-metric-grid">
        <Metric
          label="Wall-clock time"
          value={duration(totals.wall)}
          note="Elapsed active work, overlap removed"
          tone="green"
        />
        <Metric
          label="Agent time"
          value={duration(totals.agent)}
          note="Session activity; parallel agents add up"
          tone="slate"
        />
        <Metric
          label="Execution time"
          value={duration(totals.execution)}
          note={`${totals.prompts} human prompts recorded`}
          tone="amber"
        />
      </div>

      <section className="panel timing-panel">
        <div className="panel-title-row">
          <div>
            <span className="eyebrow">Measurement guide</span>
            <h3>Five views of the same activity</h3>
          </div>
          <span className="quiet-badge">Do not add these together</span>
        </div>
        <div className="timing-definition-grid">
          <article>
            <i className="time-dot wall" />
            <div>
              <strong>Wall-clock time</strong>
              <p>
                Active heartbeat spans merged per project. Overlapping sessions and
                devices count once, making this the closest elapsed-work measure.
              </p>
            </div>
          </article>
          <article>
            <i className="time-dot agent" />
            <div>
              <strong>Agent time</strong>
              <p>
                Activity spans counted per session. Gaps up to 10 minutes remain in
                the span, and parallel sessions count separately.
              </p>
            </div>
          </article>
          <article>
            <i className="time-dot execution" />
            <div>
              <strong>Execution time</strong>
              <p>
                Completed prompt processing. Codex uses <code>task_started</code> and
                <code> task_complete</code>; Claude measures a human prompt through
                <code> end_turn</code> or <code>stop_sequence</code>. Waiting between
                prompts is excluded.
              </p>
            </div>
          </article>
          <article>
            <i className="time-dot llm" />
            <div>
              <strong>LLM time · {duration(data.summary.llm_time)} all data</strong>
              <p>
                Time waiting for model responses when reliable request timestamps
                exist. This is part of execution, not additional time.
              </p>
            </div>
          </article>
          <article>
            <i className="time-dot tool" />
            <div>
              <strong>Tool time · {duration(data.summary.tool_time)} all data</strong>
              <p>
                Elapsed time in shell commands, searches, and other tools. Parallel
                or nested calls can overlap other measurements.
              </p>
            </div>
          </article>
        </div>
        <p className="timing-caveat">
          Wall-clock, agent, and execution totals above use the selected worklog
          period. LLM and tool totals are diagnostic components across all collected
          sessions because v2 does not yet store them per worklog day.
        </p>
      </section>

      {uncoveredRows > 0 && (
        <div className="notice">
          <CircleAlert size={16} />
          {uncoveredRows} {uncoveredRows === 1 ? "row has" : "rows have"} activity
          but no completed execution marker. Wall-clock and agent time are still
          available for those rows.
        </div>
      )}

      <div className="group-stack">
        {groups.map((item) => {
          const groupTotals = item.rows.reduce(
            (result, row) => ({
              wall: result.wall + row.seconds,
              agent: result.agent + row.agentSeconds,
              execution: result.execution + row.executionSeconds,
            }),
            { wall: 0, agent: 0, execution: 0 },
          );
          return (
            <section className="panel time-table time-group" key={item.id}>
              {group !== "none" && (
                <div className="group-heading">
                  <h3>{item.label}</h3>
                  <span>
                    {item.rows.length} {item.rows.length === 1 ? "record" : "records"} ·{" "}
                    {duration(groupTotals.wall)} wall · {duration(groupTotals.agent)} agent ·{" "}
                    {duration(groupTotals.execution)} execution
                  </span>
                </div>
              )}
              <TimeRowsTable rows={item.rows} />
            </section>
          );
        })}
        {!rows.length && (
          <div className="panel empty table-empty">
            <Clock3 size={22} />
            <strong>No time records match these filters</strong>
            <span>Reset filters, widen the date range, or check workstation sync.</span>
          </div>
        )}
      </div>
    </>
  );
}

type JiraGroup = "ticket" | "project" | "date" | "state" | "none";

type JiraDisplayRow = JiraActivity & {
  date_end: string;
  records: JiraActivity[];
};

function aggregateJiraRows(rows: JiraActivity[]): JiraDisplayRow {
  const ordered = [...rows].sort((a, b) => b.date.localeCompare(a.date));
  const dates = ordered.map((row) => row.date).sort();
  const dashboardSeconds = ordered.reduce(
    (total, row) => total + row.dashboard_seconds,
    0,
  );
  const jiraSeconds = ordered.reduce(
    (total, row) => total + row.jira_seconds,
    0,
  );
  const state: JiraActivity["state"] = ordered.some((row) => row.state === "missing")
    ? "missing"
    : ordered.some((row) => row.state === "under")
      ? "under"
      : "covered";
  return {
    ...ordered[0],
    date: dates[0],
    date_end: dates.at(-1) || dates[0],
    dashboard_seconds: dashboardSeconds,
    jira_seconds: jiraSeconds,
    delta_seconds: dashboardSeconds - jiraSeconds,
    projects: [...new Set(ordered.flatMap((row) => row.projects))].sort(),
    branches: [...new Set(ordered.flatMap((row) => row.branches))].sort(),
    state,
    records: ordered,
  };
}

function groupJiraByTicket(rows: JiraActivity[]): JiraDisplayRow[] {
  const byTicket = new Map<string, JiraActivity[]>();
  rows.forEach((row) =>
    byTicket.set(row.key, [...(byTicket.get(row.key) ?? []), row]),
  );
  return [...byTicket.values()]
    .map(aggregateJiraRows)
    .sort((a, b) => {
      const severity = { missing: 0, under: 1, covered: 2 };
      return severity[a.state] - severity[b.state] || b.date_end.localeCompare(a.date_end);
    });
}

function JiraRow({ row }: { row: JiraDisplayRow }) {
  const [open, setOpen] = useState(false);
  const period =
    row.date === row.date_end ? row.date : `${row.date} — ${row.date_end}`;
  return (
    <>
      <tr className={open ? "row-open" : ""}>
        <td>
          <a
            className="ticket-key"
            href={row.issue.url}
            target="_blank"
            rel="noreferrer"
          >
            {row.key}
          </a>
          <span className="muted-line">
            {period}
            {row.records.length > 1 ? ` · ${row.records.length} days` : ""}
          </span>
        </td>
        <td>
          <strong>{row.issue.summary}</strong>
          <span className="muted-line">{row.issue.status}</span>
        </td>
        <td>{row.projects.map(displayProject).join(", ") || "No agent project"}</td>
        <td className="numeric">{duration(row.dashboard_seconds)}</td>
        <td className="numeric">{duration(row.jira_seconds)}</td>
        <td className="numeric strong-number">
          {row.delta_seconds < 0 ? "−" : row.delta_seconds > 0 ? "+" : ""}
          {duration(Math.abs(row.delta_seconds))}
        </td>
        <td>
          <JiraState state={row.state} />
        </td>
        <td>
          {row.records.length > 1 && (
            <button
              className="icon-button"
              onClick={() => setOpen((value) => !value)}
              aria-label={`Toggle daily records for ${row.key}`}
              aria-expanded={open}
            >
              <ChevronDown className={open ? "rotated" : ""} size={17} />
            </button>
          )}
        </td>
      </tr>
      {open && (
        <tr className="detail-row jira-detail-row">
          <td colSpan={8}>
            <div className="jira-day-list">
              <div className="jira-day-header">
                <span>Date</span>
                <span>Projects / branches</span>
                <span>Agent</span>
                <span>Jira</span>
                <span>Gap</span>
                <span>Status</span>
              </div>
              {row.records.map((record) => (
                <div className="jira-day-line" key={`${record.key}-${record.date}`}>
                  <span>{record.date}</span>
                  <span>
                    <strong>
                      {record.projects.map(displayProject).join(", ") ||
                        "No agent project"}
                    </strong>
                    <small>{record.branches.join(", ") || "No branch recorded"}</small>
                  </span>
                  <span>{duration(record.dashboard_seconds)}</span>
                  <span>{duration(record.jira_seconds)}</span>
                  <span>
                    {record.delta_seconds < 0
                      ? "−"
                      : record.delta_seconds > 0
                        ? "+"
                        : ""}
                    {duration(Math.abs(record.delta_seconds))}
                  </span>
                  <span>
                    <JiraState state={record.state} />
                  </span>
                </div>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function Jira({ data }: { data: DashboardResponse }) {
  const jira = data.jira;
  const [state, setState] = useState("attention");
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<JiraGroup>("ticket");
  if (jira.status !== "ok") {
    return (
      <>
        <SectionHead eyebrow="Reconciliation" title="Jira worklog review" />
        <section className="panel setup-panel">
          <TicketCheck size={26} />
          <div>
            <h3>{jira.status === "disabled" ? "Jira is not configured" : "Jira needs attention"}</h3>
            <p>{jira.message || "Configure the read-only Jira credentials on the API server."}</p>
          </div>
        </section>
      </>
    );
  }
  const matchesState = (row: JiraActivity | JiraDisplayRow) =>
    state === "all" ||
    (state === "attention" ? row.state !== "covered" : row.state === state);
  const searchedRows = jira.activity.filter((row) => {
    const haystack = [
      row.key,
      row.issue.summary,
      row.issue.status,
      ...row.projects,
      ...row.branches,
    ]
      .join(" ")
      .toLowerCase();
    return !query || haystack.includes(query.toLowerCase());
  });
  const groups = (() => {
    if (group === "ticket") {
      return [
        {
          id: "tickets",
          label: "Tickets",
          rows: groupJiraByTicket(searchedRows).filter(matchesState),
        },
      ];
    }
    if (group === "none") {
      return [
        {
          id: "records",
          label: "Ticket-days",
          rows: searchedRows
            .filter(matchesState)
            .map((row) => aggregateJiraRows([row]))
            .sort((a, b) => b.date.localeCompare(a.date)),
        },
      ];
    }
    const result = new Map<string, JiraActivity[]>();
    searchedRows.forEach((row) => {
      const keys =
        group === "project"
          ? row.projects.map(displayProject)
          : group === "date"
            ? [row.date]
            : [row.state];
      (keys.length ? keys : ["No agent project"]).forEach((key) =>
        result.set(key, [...(result.get(key) ?? []), row]),
      );
    });
    const stateLabels = {
      missing: "Missing worklog",
      under: "Time gap",
      covered: "Covered",
    };
    return [...result.entries()]
      .sort(([a], [b]) =>
        group === "date" ? b.localeCompare(a) : a.localeCompare(b),
      )
      .map(([key, groupRows]) => ({
        id: `${group}-${key}`,
        label:
          group === "state"
            ? stateLabels[key as keyof typeof stateLabels] || key
            : key,
        rows: group === "date"
          ? groupRows
              .filter(matchesState)
              .map((row) => aggregateJiraRows([row]))
          : group === "state"
            ? groupJiraByTicket(groupRows.filter(matchesState))
            : groupJiraByTicket(groupRows).filter(matchesState),
      }))
      .filter((item) => item.rows.length > 0);
  })();
  const visibleRecords = new Map(
    groups.flatMap((item) =>
      item.rows.flatMap((row) =>
        row.records.map((record) => [`${record.key}-${record.date}`, record] as const),
      ),
    ),
  );
  const visibleTasks = new Set(
    [...visibleRecords.values()].map((row) => row.key),
  ).size;
  return (
    <>
      <SectionHead
        eyebrow="Reconciliation"
        title="Jira worklog review"
        detail={`Connected as ${jira.account_name} · ${visibleTasks} tasks · ${visibleRecords.size} ticket-days`}
      />
      <div className="metric-grid jira-metrics">
        <Metric label="Visible active tickets" value={`${jira.active_issue_count}`} note="Assigned and unresolved" />
        <Metric label="Missing worklogs" value={`${jira.missing_count}`} note="No Jira time logged" tone="amber" />
        <Metric label="Time gaps" value={`${jira.underlogged_count}`} note="Difference above 15m" />
        <Metric label="Covered" value={`${jira.covered_count}`} note="Within tolerance" tone="green" />
      </div>
      <div className="filter-bar compact-filters">
        <label className="search-field">
          <Search size={16} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search ticket, project, branch…" />
        </label>
        <label>
          <span>Status</span>
          <select value={state} onChange={(event) => setState(event.target.value)}>
            <option value="attention">Needs attention</option>
            <option value="missing">Missing worklog</option>
            <option value="under">Time gap</option>
            <option value="covered">Covered</option>
            <option value="all">All states</option>
          </select>
        </label>
        <label>
          <span>Group by</span>
          <select
            value={group}
            onChange={(event) => setGroup(event.target.value as JiraGroup)}
          >
            <option value="ticket">Ticket</option>
            <option value="project">Project</option>
            <option value="date">Day</option>
            <option value="state">Reconciliation state</option>
            <option value="none">No grouping</option>
          </select>
        </label>
      </div>
      <div className="group-stack">
        {groups.map((item) => (
          <section className="panel jira-group" key={item.id}>
            {!["ticket", "none"].includes(group) && (
              <div className="group-heading">
                <h3>{item.label}</h3>
                <span>
                  {item.rows.length} {item.rows.length === 1 ? "task" : "tasks"} ·{" "}
                  {item.rows.reduce(
                    (total, row) => total + row.records.length,
                    0,
                  )}{" "}
                  ticket-days
                </span>
              </div>
            )}
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Task / period</th>
                    <th>Issue</th>
                    <th>Projects</th>
                    <th className="numeric">Agent</th>
                    <th className="numeric">Jira</th>
                    <th className="numeric">Gap</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {item.rows.map((row) => (
                    <JiraRow row={row} key={`${item.id}-${row.key}`} />
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
        {!visibleRecords.size && (
          <div className="panel empty table-empty">
            <Check size={21} />
            <strong>No matching ticket-days</strong>
          </div>
        )}
      </div>
    </>
  );
}

function Models({ data }: { data: DashboardResponse }) {
  return (
    <>
      <SectionHead
        eyebrow="Performance"
        title="Models and tool behavior"
        detail={`${data.models.length} models · ${data.tools.length} tools`}
      />
      {data.unpriced_models.length > 0 && (
        <div className="notice">
          <CircleAlert size={18} />
          <span>Unpriced usage: {data.unpriced_models.join(", ")}</span>
        </div>
      )}
      <div className="two-column">
        <section className="panel">
          <div className="panel-title-row">
            <div><span className="eyebrow">Economics</span><h3>Model mix</h3></div>
          </div>
          <div className="rank-list">
            {[...data.models].sort((a, b) => b.cost - a.cost).map((model) => (
              <div className="rank-row" key={model.name}>
                <div className="rank-main">
                  <strong>{model.name}</strong>
                  <span>{compact(model.tokens)} tokens · {model.avg_tps.toFixed(1)} tok/s</span>
                </div>
                <div className="rank-value">
                  <strong>{money(model.cost)}</strong>
                  <span>{(model.cost_share * 100).toFixed(1)}%</span>
                </div>
                <div className="meter"><i style={{ width: `${Math.max(1, model.cost_share * 100)}%` }} /></div>
              </div>
            ))}
          </div>
        </section>
        <section className="panel">
          <div className="panel-title-row">
            <div><span className="eyebrow">Execution</span><h3>Tool time</h3></div>
          </div>
          <div className="rank-list">
            {[...data.tools].sort((a, b) => b.time - a.time).slice(0, 12).map((tool) => (
              <div className="rank-row" key={tool.name}>
                <div className="rank-main">
                  <strong>{tool.name}</strong>
                  <span>{tool.calls} calls · {tool.errors} errors</span>
                </div>
                <div className="rank-value">
                  <strong>{duration(tool.time)}</strong>
                  <span>{duration(tool.avg_time)} avg</span>
                </div>
                <div className="meter amber-meter"><i style={{ width: `${Math.max(1, tool.time_share * 100)}%` }} /></div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}

function Shell({
  data,
  refreshing,
  onRefresh,
}: {
  data: DashboardResponse;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [route, setRoute] = useState(window.location.pathname);
  useEffect(() => {
    const updateRoute = () => setRoute(window.location.pathname);
    window.addEventListener("popstate", updateRoute);
    return () => window.removeEventListener("popstate", updateRoute);
  }, []);
  return (
    <div className="app-shell">
      <aside className={menuOpen ? "sidebar sidebar-open" : "sidebar"}>
        <div className="brand">
          <div className="brand-mark"><Activity size={19} /></div>
          <div><strong>Agent Workbench</strong><span>Cost & delivery control</span></div>
        </div>
        <nav>
          {nav.map(({ to, label, icon: Icon }) => (
            <AppLink
              to={to}
              className={route === to ? "active" : ""}
              key={to}
              onClick={() => setMenuOpen(false)}
            >
              <Icon size={17} />
              <span>{label}</span>
            </AppLink>
          ))}
        </nav>
        <div className="sidebar-spacer" />
        <div className="ai-preview">
          <Sparkles size={18} />
          <strong>Ask your dashboard</strong>
          <span>Read-only AI analysis is planned after the data views are proven.</span>
        </div>
        <div className="connection">
          <i />
          <div><strong>API connected</strong><span>{data.summary.synced_machines} synced devices</span></div>
        </div>
      </aside>
      {menuOpen && <button className="scrim" onClick={() => setMenuOpen(false)} aria-label="Close menu" />}
      <main>
        <header className="topbar">
          <button className="mobile-menu" onClick={() => setMenuOpen(true)} aria-label="Open menu"><Menu size={20} /></button>
          <div className="freshness">
            <Server size={15} />
            <span>Updated {new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" }).format(new Date(data.generated_at))}</span>
          </div>
          <button className="refresh-button" onClick={onRefresh} disabled={refreshing}>
            <RefreshCw size={15} className={refreshing ? "spinning" : ""} />
            Refresh data
          </button>
        </header>
        <div className="page">
          {route === "/projects" ? (
            <Projects data={data} />
          ) : route === "/time" ? (
            <TimeAccounting data={data} />
          ) : route === "/jira" ? (
            <Jira data={data} />
          ) : route === "/models" ? (
            <Models data={data} />
          ) : (
            <Overview data={data} />
          )}
        </div>
      </main>
    </div>
  );
}

export function App() {
  const query = useQuery({ queryKey: ["dashboard"], queryFn: fetchDashboard });
  if (query.isLoading) {
    return (
      <div className="center-state">
        <div className="loader" />
        <strong>Building the operating picture</strong>
        <span>Collecting projects, sessions, worklogs, and Jira.</span>
      </div>
    );
  }
  if (query.isError || !query.data) {
    return (
      <div className="center-state error-state">
        <CircleAlert size={25} />
        <strong>The dashboard API is unavailable</strong>
        <span>{query.error instanceof Error ? query.error.message : "Start the API service on port 8754."}</span>
        <button onClick={() => void query.refetch()}>Try again</button>
      </div>
    );
  }
  return (
    <Shell
      data={query.data}
      refreshing={query.isFetching}
      onRefresh={() => void query.refetch()}
    />
  );
}
