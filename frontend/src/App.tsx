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
} from "./types";

const nav = [
  { to: "/", label: "Overview", icon: Gauge },
  { to: "/projects", label: "Projects & sessions", icon: FolderKanban },
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
          label="Agent time this month"
          value={duration(summary.month_agent_seconds)}
          note={`${duration(summary.month_execution_seconds)} active execution`}
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

type ProjectGroup = "project" | "agent" | "machine";

function Projects({ data }: { data: DashboardResponse }) {
  const [query, setQuery] = useState("");
  const [agent, setAgent] = useState("all");
  const [machine, setMachine] = useState("all");
  const [group, setGroup] = useState<ProjectGroup>("project");
  const [minCost, setMinCost] = useState(0);
  const agents = [...new Set(data.projects.map((project) => project.agent))].sort();
  const machines = [...new Set(data.projects.flatMap((project) => project.machines))].sort();
  const filtered = useMemo(
    () =>
      data.projects
        .filter((project) => {
          const haystack = [
            project.name,
            project.agent,
            ...project.machines,
            ...project.session_items.flatMap((session) => session.branches),
          ]
            .join(" ")
            .toLowerCase();
          return (
            (!query || haystack.includes(query.toLowerCase())) &&
            (agent === "all" || project.agent === agent) &&
            (machine === "all" || project.machines.includes(machine)) &&
            project.cost >= minCost
          );
        })
        .sort((a, b) => b.cost - a.cost),
    [agent, data.projects, machine, minCost, query],
  );
  const groups = useMemo(() => {
    if (group === "project") return [["All projects", filtered]] as Array<[string, ProjectSummary[]]>;
    const result = new Map<string, ProjectSummary[]>();
    filtered.forEach((project) => {
      const keys = group === "agent" ? [project.agent] : project.machines;
      (keys.length ? keys : ["Unknown"]).forEach((key) =>
        result.set(key, [...(result.get(key) ?? []), project]),
      );
    });
    return [...result.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [filtered, group]);

  return (
    <>
      <SectionHead
        eyebrow="Work explorer"
        title="Projects and session activity"
        detail={`${filtered.length} of ${data.projects.length} projects`}
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
            <option value="project">No grouping</option>
            <option value="agent">Agent</option>
            <option value="machine">Device</option>
          </select>
        </label>
      </div>

      <div className="group-stack">
        {groups.map(([label, projects]) => (
          <section className="panel project-group" key={label}>
            {group !== "project" && (
              <div className="group-heading">
                <h3>{label}</h3>
                <span>{projects.length} projects</span>
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
                    <th className="numeric">Execution</th>
                    <th className="numeric">Tokens</th>
                    <th className="numeric">Value</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {projects.map((project) => (
                    <ProjectRow project={project} key={`${label}-${project.agent}-${project.name}`} />
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
            <span>Try broadening the search or minimum value.</span>
          </div>
        )}
      </div>
    </>
  );
}

function ProjectRow({ project }: { project: ProjectSummary }) {
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
        <td className="numeric">{duration(project.execution_time)}</td>
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
          <td colSpan={8}>
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
                  <span>{shortDate(session.start)}</span>
                  <strong>{session.branches.at(-1) || "No branch recorded"}</strong>
                  <span>{session.machine}</span>
                  <span>{duration(session.execution_time)}</span>
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

function Jira({ data }: { data: DashboardResponse }) {
  const jira = data.jira;
  const [state, setState] = useState("attention");
  const [query, setQuery] = useState("");
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
  const rows = jira.activity.filter((row) => {
    const matchesState =
      state === "all" ||
      (state === "attention" ? row.state !== "covered" : row.state === state);
    const haystack = [row.key, row.issue.summary, row.issue.status, ...row.projects, ...row.branches]
      .join(" ")
      .toLowerCase();
    return matchesState && (!query || haystack.includes(query.toLowerCase()));
  });
  return (
    <>
      <SectionHead
        eyebrow="Reconciliation"
        title="Jira worklog review"
        detail={`Connected as ${jira.account_name}`}
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
      </div>
      <section className="panel">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Date / ticket</th>
                <th>Issue</th>
                <th>Projects</th>
                <th className="numeric">Agent</th>
                <th className="numeric">Jira</th>
                <th className="numeric">Gap</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.key}-${row.date}`}>
                  <td>
                    <a className="ticket-key" href={row.issue.url} target="_blank" rel="noreferrer">
                      {row.key}
                    </a>
                    <span className="muted-line">{row.date}</span>
                  </td>
                  <td>
                    <strong>{row.issue.summary}</strong>
                    <span className="muted-line">{row.issue.status}</span>
                  </td>
                  <td>{row.projects.map(displayProject).join(", ")}</td>
                  <td className="numeric">{duration(row.dashboard_seconds)}</td>
                  <td className="numeric">{duration(row.jira_seconds)}</td>
                  <td className="numeric strong-number">{duration(Math.abs(row.delta_seconds))}</td>
                  <td>
                    <JiraState state={row.state} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.length && <div className="empty table-empty"><Check size={21} /><strong>No matching ticket-days</strong></div>}
      </section>
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
