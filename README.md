# Agent Cost Dashboard

Web dashboard to monitor API costs for [Pi](https://github.com/mariozechner/pi-coding-agent), [Oh My Pi](https://github.com/can1357/oh-my-pi), [Claude Code](https://github.com/anthropics/claude-code), [Codex CLI](https://github.com/openai/codex), and [Gemini CLI](https://github.com/google-gemini/gemini-cli) coding agents.

No external dependencies — pure Python stdlib.

It can also collect active agent working time from multiple computers into one
central SQLite database and produce project/date reports ready to copy into Jira.

![Main dashboard showing global stats, and daily spending](screenshots/dashboard-overview.png)

## Features

### Global Statistics
Track total spending across all projects and sessions:
- Total tokens broken down by input, output, cache-read, cache-write, and reasoning counts when exposed
- Detailed token usage across all models where source data exposes it
- Session count and project count
- LLM time vs tool execution time
- Average tokens per second across all API calls

### Daily Spending Chart
Timeline of API costs over time.

### Model Breakdown
Costs broken down by AI model (Claude, Gemini, GPT-5, O3, O4, GLM, etc.):
- Messages, input/output/cache-read/cache-write/reasoning token usage, and cost per model
- Average tokens per second

![Model Stats](screenshots/model-stats.png)

### Tool Usage
Track which tools your agent uses most:
- Call counts and execution time per tool
- Error rates

![Tool Stats](screenshots/tool-stats.png)

### Project View
All projects with expandable details:
- Per-project cost, model usage, tool usage, and session history
- Sortable by cost, tokens, LLM time, or date

![Projects](screenshots/projects.png)

### Session Browser
Browse every session with full details:
- Copy command to resume session to the clipboard
- Full transcript export (Pi via `pi --export`, Claude and Codex via built-in exporters)
- Session duration, LLM time, and tool time
- Subagent session support with expandable grouping
- Sortable by date, duration, cost, tokens, and more

![Sessions](screenshots/sessions.png)

### Central Work Reports

- Sync compact activity summaries from any number of workstations
- Filter working time by project and date range
- Copy daily durations in Jira-friendly `1h 25m` format
- Automatically exclude idle gaps longer than 15 minutes
- Union overlapping sessions, including sessions from different machines, so
  parallel work is not counted twice
- Keep prompts, transcripts, source code, and tool payloads on the workstation

## Installation

Requires **Python 3.12+**.

```bash
git clone https://github.com/user/pi-cost-dashboard
cd pi-cost-dashboard
```

## Usage

```bash
# Start the dashboard (defaults to localhost:8753)
./cost_dashboard.py

# Use a custom port
./cost_dashboard.py --port 3000

# Bind to all interfaces (accessible from network)
./cost_dashboard.py --host 0.0.0.0

# Custom host and port
./cost_dashboard.py -H 0.0.0.0 -p 3000
```

On Windows, you can also double-click `start.bat`.

Then open http://localhost:8753 in your browser.

## Central multi-machine setup

The website is the central server. Each workstation runs the same small sync
script every few minutes. A session is upserted by machine, agent, and session
ID, so repeated syncs are safe and an active session can keep growing.

### 1. Configure the website

Choose a long random token and persist the SQLite file outside a temporary
deployment directory:

```bash
export AGENT_DASHBOARD_TOKEN="replace-with-a-long-random-secret"
./cost_dashboard.py \
  --host 127.0.0.1 \
  --port 8753 \
  --db /var/lib/agent-cost-dashboard/worklog.sqlite3 \
  --timezone Europe/Prague
```

Keep the Python server behind the existing HTTPS reverse proxy for
`https://work.hrabovskyjan.cz`. The endpoint used by workstations is
`POST /api/v1/sessions`. The same authenticated data is available as JSON from
`GET /api/v1/worklogs?from=2026-07-01&to=2026-07-31`.

The API is disabled when `AGENT_DASHBOARD_TOKEN` is not configured. Do not put
the token in a public repository or pass it in a process argument in production.

### 2. Connect each workstation

Set the central URL and the same secret in that machine's environment:

```bash
export AGENT_DASHBOARD_URL="https://work.hrabovskyjan.cz/api/v1/sessions"
export AGENT_DASHBOARD_TOKEN="replace-with-a-long-random-secret"
export AGENT_DASHBOARD_MACHINE="desktop"
```

Run one historical import, then normal incremental syncs:

```bash
python3 sync_agent_hours.py --dry-run --all
python3 sync_agent_hours.py --all
python3 sync_agent_hours.py
```

By default, normal syncs re-read sessions modified in the last 30 days. The
server upserts them, so this is idempotent and does not create duplicates.

On Linux/macOS, schedule `python3 /path/to/sync_agent_hours.py` every five
minutes with cron, a systemd user timer, or launchd. On Windows, create a Task
Scheduler task that runs `py C:\path\to\sync_agent_hours.py` every five minutes.
Because the collector uses only Python's standard library, there are no packages
to install on workstations.

### Project names across computers

Folder basenames are the default shared project names. If the same project uses
different local names, map them to one canonical name:

```bash
python3 sync_agent_hours.py \
  --project-map agent-cost-dashboard=Work-Dashboard \
  --project-map C:\\src\\dashboard=Work-Dashboard
```

For scheduled runs, the equivalent environment value is a JSON object:

```bash
export AGENT_DASHBOARD_PROJECT_MAP='{"agent-cost-dashboard":"Work-Dashboard"}'
```

### How working time is calculated

Session event timestamps act as activity heartbeats. Events separated by no
more than 15 minutes form one work span; a longer gap starts a new span. A final
or isolated event contributes one minute. The report unions all spans for the
same project before totaling them, then splits them at midnight in the configured
timezone. Change the cutoff per workstation with `--idle-minutes`.

This deliberately measures active agent-session wall time, not only model
inference time. It is deterministic and auditable; an AI API is not required for
time accounting. An OpenAI-powered Jira summary can later be added on top of the
authenticated reporting API without changing the stored time data.

## Session Directories

The dashboard automatically reads session data from:

| Agent | Directory |
|---|---|
| Pi | `~/.pi/agent/sessions` |
| Oh My Pi | `~/.omp/agent/sessions` |
| Claude Code | `~/.claude/projects` |
| Codex CLI | `~/.codex/sessions` |
| Gemini CLI | `~/.gemini/tmp` |

## CLI Utilities

### claude_cost.py / gemini_cost.py

Calculate API costs for agent sessions:

```bash
python claude_cost.py /path/to/sessions
python gemini_cost.py ~/.gemini/tmp/project/chats
```

### claude_export.py / codex_export.py / gemini_export.py

Export a session JSONL file to a styled HTML transcript:

```bash
python claude_export.py input.jsonl output.html
python codex_export.py input.jsonl output.html
python gemini_export.py input.jsonl output.html
```

## Pricing

Costs are calculated using pricing reported by the agent. For models that don't report costs (e.g., Gemini via Google Cloud), estimated pricing is applied based on public API rates. Supported model families: Claude, Gemini, GPT-5, O3/O4, GLM.

## Credits

- **[Mario Zechner](https://github.com/mariozechner)** - For Pi and its session export feature
- **[can1357](https://github.com/can1357)** - For Oh My Pi
