// Dashboard rendering and interactions.
// Data is injected by cost_dashboard.py as window.dashboardData.
const dashboardData = window.dashboardData || {};

(function() {
    const dailyStats = dashboardData.dailyStats || [];

    // Collect all model names ordered by total cost (highest first)
    const modelTotals = {};
    dailyStats.forEach(d => {
        Object.entries(d.models).forEach(([m, c]) => {
            modelTotals[m] = (modelTotals[m] || 0) + c;
        });
    });
    const allModels = Object.keys(modelTotals).sort(
        (a, b) => modelTotals[b] - modelTotals[a]
    );

    // Distinct colour palette — one colour per model.
    // We cycle through a fixed set so the same model always
    // gets the same colour across page reloads.
    const PALETTE = [
        '#3fb950', // green  (matches accent-green)
        '#58a6ff', // blue
        '#a371f7', // purple
        '#d29922', // yellow
        '#f85149', // red
        '#39d353', // bright green
        '#79c0ff', // light blue
        '#ff7b72', // salmon
        '#ffa657', // orange
        '#56d364', // lime
        '#bc8cff', // lavender
        '#e3b341', // amber
    ];
    function modelColor(model, idx) {
        return PALETTE[idx % PALETTE.length];
    }

    // Only show the last 14 days by default; full history is
    // accessible via a toggle.
    const RECENT_DAYS = 14;
    let showAll = false;

    function getVisibleDays() {
        return showAll ? dailyStats : dailyStats.slice(-RECENT_DAYS);
    }

    function render() {
        const visible = getVisibleDays();
        if (!visible.length) return;

        const maxCost = Math.max(...visible.map(d => d.cost), 0.0001);

        // Group days by YYYY-MM for monthly totals
        const monthTotals = {};
        visible.forEach(d => {
            const month = d.day.slice(0, 7);
            if (!monthTotals[month]) {
                monthTotals[month] = {cost: 0, models: {}};
            }
            monthTotals[month].cost += d.cost;
            Object.entries(d.models).forEach(([m, c]) => {
                monthTotals[month].models[m] =
                    (monthTotals[month].models[m] || 0) + c;
            });
        });

        let html = '';

        // Legend
        if (allModels.length > 0) {
            html += '<div class="daily-legend">';
            allModels.forEach((m, i) => {
                const color = modelColor(m, i);
                const shortName = m.length > 35
                    ? m.slice(0, 32) + '...' : m;
                html += `<span class="legend-item">
                    <span class="legend-dot" style="background:${color}"></span>
                    ${escapeHtml(shortName)}
                </span>`;
            });
            html += '</div>';
        }

        let prevMonth = null;

        visible.forEach(d => {
            const month = d.day.slice(0, 7);

            // Insert monthly total separator when month changes
            // (after we have seen all days of the previous month)
            if (prevMonth && month !== prevMonth) {
                html += renderMonthRow(prevMonth, monthTotals[prevMonth]);
            }
            prevMonth = month;

            // Stacked bar for this day
            let stackedSegments = '';
            allModels.forEach((m, i) => {
                const mCost = d.models[m] || 0;
                const mPct = (mCost / maxCost * 100);
                if (mPct < 0.01) return;
                stackedSegments += `<div class="bar-segment" style="width:${mPct.toFixed(2)}%;background:${modelColor(m, i)}" title="${escapeHtml(m)}: $${mCost.toFixed(4)}"></div>`;
            });

            html += `
                <div class="daily-bar">
                    <span class="date">${d.day}</span>
                    <div class="bar-wrapper">
                        <div class="bar-container stacked">
                            ${stackedSegments}
                        </div>
                    </div>
                    <span class="amount">$${d.cost.toFixed(2)}</span>
                </div>`;
        });

        // Monthly total for the last visible month
        if (prevMonth) {
            html += renderMonthRow(prevMonth, monthTotals[prevMonth]);
        }

        // Toggle button
        const totalDays = dailyStats.length;
        if (totalDays > RECENT_DAYS) {
            const label = showAll
                ? 'Show last 14 days'
                : `Show all ${totalDays} days`;
            html += `<div style="margin-top:12px;text-align:center">
                <button onclick="toggleDailyChart()" class="copy-btn">${label}</button>
            </div>`;
        }

        document.getElementById('daily-chart-content').innerHTML = html;
    }

    function renderMonthRow(month, mt) {
        const [year, mon] = month.split('-');
        const monthNames = [
            'January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December'
        ];
        const label = `${monthNames[Number(mon) - 1] || mon} ${year}`;
        let segments = '';
        allModels.forEach((m, i) => {
            const mCost = mt.models[m] || 0;
            const mPct = mt.cost > 0 ? (mCost / mt.cost * 100) : 0;
            if (mPct < 0.01) return;
            segments += `<div class="bar-segment" style="width:${mPct.toFixed(2)}%;background:${modelColor(m, i)};opacity:0.55" title="${escapeHtml(m)}: $${mCost.toFixed(4)}"></div>`;
        });
        return `
            <div class="monthly-total-row">
                <span class="date monthly-label">${label}</span>
                <div class="bar-wrapper">
                    <div class="bar-container stacked">
                        ${segments}
                    </div>
                </div>
                <span class="amount monthly-amount">$${mt.cost.toFixed(2)}</span>
            </div>`;
    }

    window.toggleDailyChart = function() {
        showAll = !showAll;
        render();
    };

    render();
})();

const projects = dashboardData.projects || [];

function buildResumeCmd(agentCmd, cwd, sessionPath, sessionUid) {
    if (agentCmd === 'claude') {
        return 'cd "' + cwd + '" && claude --resume "' + sessionUid + '"';
    } else if (agentCmd === 'codex') {
        return 'cd "' + cwd + '" && codex --resume "' + sessionUid + '"';
    } else {
        return 'cd "' + cwd + '" && ' + agentCmd + ' --session "' + sessionPath + '"';
    }
}

function formatDuration(seconds) {
    if (seconds < 60) {
        return Math.round(seconds) + 's';
    } else if (seconds < 3600) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.round(seconds % 60);
        return mins + 'm' + secs.toString().padStart(2, '0') + 's';
    } else {
        const hours = Math.floor(seconds / 3600);
        const mins = Math.round((seconds % 3600) / 60);
        return hours + 'h' + mins.toString().padStart(2, '0') + 'm';
    }
}

let projectSort = { field: 'last_activity', asc: false };
let sessionsSort = { field: 'start', asc: false };

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatFullNumber(value) {
    const n = Number(value) || 0;
    return String(Math.round(n));
}

function trimOneDecimal(value) {
    return value.toFixed(1).replace(/\.0$/, '');
}

function formatCompactNumber(value) {
    const n = Number(value) || 0;
    const sign = n < 0 ? '-' : '';
    const abs = Math.abs(n);
    const units = [
        [1_000_000_000_000, 'T'],
        [1_000_000_000, 'B'],
        [1_000_000, 'M'],
        [1_000, 'k'],
    ];

    for (const [size, suffix] of units) {
        if (abs >= size) {
            return sign + trimOneDecimal(abs / size) + suffix;
        }
    }
    return sign + formatFullNumber(abs);
}

function displayNameFromPath(path) {
    const text = String(path || 'unknown').replace(/[\\/]+$/, '');
    const parts = text.split(/[\\/]+/);
    return parts[parts.length - 1] || text || 'unknown';
}

const TOKEN_DETAIL_FIELDS = [
    ['In', 'input_tokens'],
    ['Out', 'output_tokens'],
    ['Cache read', 'cache_read_tokens'],
    ['Cache write', 'cache_write_tokens'],
    ['Reasoning', 'reasoning_tokens'],
];

function tokenValue(item, field) {
    return Number(item?.[field] || 0);
}

function tokenTitle(item) {
    return [
        `Total: ${formatFullNumber(tokenValue(item, 'tokens'))}`,
        ...TOKEN_DETAIL_FIELDS.map(
            ([label, field]) => `${label}: ${formatFullNumber(tokenValue(item, field))}`
        ),
    ].join('\n');
}

function tokenDetailText(item, compact = false) {
    const formatter = compact ? formatCompactNumber : formatFullNumber;
    return TOKEN_DETAIL_FIELDS
        .map(([label, field]) => [label, tokenValue(item, field)])
        .filter(([, value]) => value > 0)
        .map(([label, value]) => `${label} ${formatter(value)}`)
        .join(' · ');
}

function tokenCellHtml(item) {
    return `<span class="token-cell" title="${escapeHtml(tokenTitle(item))}">${formatCompactNumber(tokenValue(item, 'tokens'))}</span>`;
}

function aggregateTokenCounts(items) {
    const totals = {tokens: 0};
    TOKEN_DETAIL_FIELDS.forEach(([, field]) => { totals[field] = 0; });
    items.forEach(item => {
        totals.tokens += tokenValue(item, 'tokens');
        TOKEN_DETAIL_FIELDS.forEach(([, field]) => {
            totals[field] += tokenValue(item, field);
        });
    });
    return totals;
}

function sortData(data, sort) {
    return [...data].sort((a, b) => {
        let aVal = a[sort.field];
        let bVal = b[sort.field];

        if (typeof aVal === 'string') {
            aVal = aVal.toLowerCase();
            bVal = bVal.toLowerCase();
        }

        if (aVal < bVal) return sort.asc ? -1 : 1;
        if (aVal > bVal) return sort.asc ? 1 : -1;
        return 0;
    });
}

function renderProjects() {
    const tbody = document.getElementById('projects-tbody');
    const sorted = sortData(projects, projectSort);
    tbody.innerHTML = sorted.map((p, idx) => {
        const displayName = displayNameFromPath(p.name);
        const shortName = displayName.length > 50 ? displayName.slice(0, 47) + '...' : displayName;
        const rowId = 'project-' + idx;

        // Build model breakdown HTML
        const modelRows = p.models.map(m => `
            <div class="model-item">
                <span class="model-name">${escapeHtml(m.name)}</span>
                <span class="model-stat" title="${formatFullNumber(m.messages)} msgs">${formatCompactNumber(m.messages)} msgs</span>
                <span class="model-stat token-wide" title="${escapeHtml(tokenTitle(m))}">${formatCompactNumber(m.tokens)} tok</span>
                <span class="model-stat token-detail-wide">${escapeHtml(tokenDetailText(m, true))}</span>
                <span class="model-stat" style="color: var(--accent-blue)">${(m.avg_tps || 0).toFixed(1)} tok/s</span>
                <span class="model-stat cost">$${m.cost.toFixed(2)}</span>
            </div>
        `).join('');

        // Build tool breakdown HTML
        const toolRows = (p.tools || []).map(t => `
            <div class="model-item">
                <span class="model-name" style="color: var(--accent-yellow)">${escapeHtml(t.name)}</span>
                <span class="model-stat" title="${formatFullNumber(t.calls)} calls">${formatCompactNumber(t.calls)} calls</span>
                <span class="model-stat" style="color: var(--accent-yellow)">${t.time_display}</span>
                <span class="model-stat">avg ${t.avg_time_display}</span>
                ${t.errors > 0 ? `<span class="model-stat" style="color: var(--accent-red)">${t.errors} errors</span>` : ''}
            </div>
        `).join('');

        return `
            <tr class="expandable-row" data-target="${rowId}" onclick="toggleProjectRow('${rowId}')">
                <td class="project-name" title="${escapeHtml(p.name)}"><span class="expand-icon">▶</span> ${escapeHtml(shortName)}</td>
                <td>${p.sessions}</td>
                <td>${escapeHtml(p.machine_display || 'local')}</td>
                <td title="${formatFullNumber(p.prompts || 0)}">${formatCompactNumber(p.prompts || 0)}</td>
                <td title="${formatFullNumber(p.messages)}">${formatCompactNumber(p.messages)}</td>
                <td class="tokens">${tokenCellHtml(p)}</td>
                <td style="color: var(--accent-green)">${p.execution_time_display || '0s'}</td>
                <td style="color: var(--accent-purple)">${p.llm_time_display}</td>
                <td style="color: var(--accent-yellow)">${p.tool_time_display}</td>
                <td style="color: var(--accent-blue)">${(p.avg_tps || 0).toFixed(1)}</td>
                <td class="cost">$${p.cost.toFixed(2)}</td>
                <td style="color: var(--text-secondary)">${p.last_activity_display}</td>
            </tr>
            <tr class="model-breakdown" id="${rowId}">
                <td colspan="12">
                    <div class="model-tree">
                        <div class="detail-line"><strong>Path:</strong> ${escapeHtml(p.name)}</div>
                        <div class="detail-line" title="${escapeHtml(tokenTitle(p))}"><strong>Tokens:</strong> ${formatCompactNumber(p.tokens)} ${tokenDetailText(p, true) ? `(${escapeHtml(tokenDetailText(p, true))})` : ''}</div>
                        <div style="font-weight: 600; margin-bottom: 8px; color: var(--text-secondary)">Models:</div>
                        ${modelRows || '<div style="color: var(--text-secondary)">No model data</div>'}
                        ${toolRows ? `<div style="font-weight: 600; margin: 12px 0 8px 0; color: var(--text-secondary)">Tools:</div>${toolRows}` : ''}
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

function toggleProjectRow(rowId) {
    const row = document.getElementById(rowId);
    const parentRow = document.querySelector('[data-target="' + rowId + '"]');
    row.classList.toggle('show');
    parentRow.classList.toggle('expanded');
}

function renderSessions() {
    const tbody = document.getElementById('sessions-tbody');

    function branchDisplay(session) {
        const branches = session.branches || [];
        return branches.length ? branches.join(' → ') : '—';
    }

    // Flatten sessions with subagent info
    const allSessionsWithSubs = [];
    projects.forEach(p => {
        p.sessions_list.forEach(s => {
            // Add agent_cmd from parent project for resume command
            allSessionsWithSubs.push({...s, agent_cmd: p.agent_cmd});
        });
    });

    // Helper to get aggregated value for a session (including subagents)
    function getAggregatedValue(s, field) {
        const subs = s.subagent_sessions || [];
        const all = [s, ...subs];

        switch(field) {
            case 'cost':
                return all.reduce((sum, session) => sum + session.cost, 0);
            case 'tokens':
                return all.reduce((sum, session) => sum + session.tokens, 0);
            case 'messages':
                return all.reduce((sum, session) => sum + session.messages, 0);
            case 'prompts':
                return all.reduce((sum, session) => sum + (session.prompts || 0), 0);
            case 'execution_time':
                return all.reduce((sum, session) => sum + (session.execution_time || 0), 0);
            case 'llm_time':
                return all.reduce((sum, session) => sum + (session.llm_time || 0), 0);
            case 'tool_time':
                return all.reduce((sum, session) => sum + (session.tool_time || 0), 0);
            case 'avg_tps':
                const tpsValues = all.map(session => session.avg_tps || 0).filter(v => v > 0);
                return tpsValues.length > 0 ? tpsValues.reduce((a, b) => a + b, 0) / tpsValues.length : 0;
            case 'duration':
                const starts = all.map(session => session.start).filter(Boolean);
                const ends = all.map(session => session.end).filter(Boolean);
                if (!starts.length || !ends.length) return 0;
                const earliest = Math.min(...starts.map(d => new Date(d)));
                const latest = Math.max(...ends.map(d => new Date(d)));
                return (latest - earliest) / 1000;
            case 'start':
                return s.start ? new Date(s.start).getTime() : 0;
            case 'project':
                return s.cwd.toLowerCase();
            case 'machine':
                return (s.machine || 'local').toLowerCase();
            case 'branch':
                return all.flatMap(session => session.branches || []).join(' → ').toLowerCase();
            default:
                return s[field] || 0;
        }
    }

    // Sort sessions using current sort state
    const sortedSessions = [...allSessionsWithSubs].sort((a, b) => {
        const aVal = getAggregatedValue(a, sessionsSort.field);
        const bVal = getAggregatedValue(b, sessionsSort.field);

        if (aVal < bVal) return sessionsSort.asc ? -1 : 1;
        if (aVal > bVal) return sessionsSort.asc ? 1 : -1;
        return 0;
    });

    const totalSessions = allSessionsWithSubs.reduce((sum, s) => sum + 1 + (s.subagent_sessions || []).length, 0);
    document.getElementById('sessions-count').textContent = totalSessions + ' sessions';

    let html = '';
    let rowIdx = 0;

    sortedSessions.forEach(s => {
        const subs = s.subagent_sessions || [];
        const hasSubs = subs.length > 0;

        // If no subagent sessions, just show the main session as a regular row
        if (!hasSubs) {
            const sessionUrl = '/session?uid=' + encodeURIComponent(s.uid);
            const resumePath = s.path.replace(/\\\\/g, '/');
            const resumeCmd = buildResumeCmd(s.agent_cmd, s.cwd, resumePath, s.uid);
            const actions = s.is_synced
                ? '<span style="color: var(--text-secondary)">Synced</span>'
                : `<button onclick="copyResumeCommand(event, this.dataset.resumeCmd)" data-resume-cmd="${escapeHtml(resumeCmd)}" class="icon-btn" title="Copy resume command">Copy</button>
                   <a href="${sessionUrl}" class="session-link" target="_blank" title="View full session">Open →</a>`;
            const sessionName = displayNameFromPath(s.cwd);
            const shortProject = sessionName.length > 40 ? sessionName.slice(0, 37) + '...' : sessionName;

            html += `
                <tr>
                    <td class="project-name" title="${escapeHtml(s.cwd)}">${escapeHtml(shortProject)}</td>
                    <td>${escapeHtml(s.machine || 'local')}</td>
                    <td title="${escapeHtml(branchDisplay(s))}">${escapeHtml(branchDisplay(s))}</td>
                    <td style="color: var(--text-secondary)">${s.start_display}</td>
                    <td style="color: var(--text-secondary)">${s.duration_display}</td>
                    <td style="color: var(--accent-green)">${s.execution_time_display || '0s'}</td>
                    <td style="color: var(--accent-purple)">${s.llm_time_display}</td>
                    <td style="color: var(--accent-yellow)">${s.tool_time_display || '0s'}</td>
                    <td style="color: var(--accent-blue)">${(s.avg_tps || 0).toFixed(1)}</td>
                    <td title="${formatFullNumber(s.prompts || 0)}">${formatCompactNumber(s.prompts || 0)}</td>
                    <td title="${formatFullNumber(s.messages)}">${formatCompactNumber(s.messages)}</td>
                    <td class="tokens">${tokenCellHtml(s)}</td>
                    <td class="cost">$${s.cost.toFixed(2)}</td>
                    <td>
                        ${actions}
                    </td>
                </tr>
            `;
            return;
        }

        // Has subagent sessions - show expandable summary
        const allSessionsInGroup = [s, ...subs];
        const projectId = 'session-group-' + rowIdx;
        rowIdx++;

        // Calculate aggregated totals
        const aggCost = allSessionsInGroup.reduce((sum, session) => sum + session.cost, 0);
        const aggTokenCounts = aggregateTokenCounts(allSessionsInGroup);
        const aggMessages = allSessionsInGroup.reduce((sum, session) => sum + session.messages, 0);
        const aggPrompts = allSessionsInGroup.reduce((sum, session) => sum + (session.prompts || 0), 0);
        const aggExecutionTime = allSessionsInGroup.reduce((sum, session) => sum + (session.execution_time || 0), 0);
        const aggLlmTime = allSessionsInGroup.reduce((sum, session) => sum + (session.llm_time || 0), 0);
        const aggToolTime = allSessionsInGroup.reduce((sum, session) => sum + (session.tool_time || 0), 0);
        const aggBranches = [...new Set(allSessionsInGroup.flatMap(session => session.branches || []))];

        // Get earliest start and latest end
        const starts = allSessionsInGroup.map(session => session.start).filter(Boolean);
        const ends = allSessionsInGroup.map(session => session.end).filter(Boolean);
        const earliestStart = starts.length ? new Date(Math.min(...starts.map(d => new Date(d)))) : null;
        const latestEnd = ends.length ? new Date(Math.max(...ends.map(d => new Date(d)))) : null;
        const totalDuration = earliestStart && latestEnd ? (latestEnd - earliestStart) / 1000 : 0;

        const sessionName = displayNameFromPath(s.cwd);
        const shortProject = sessionName.length > 40 ? sessionName.slice(0, 37) + '...' : sessionName;

        // Format date to match other sessions (YYYY-MM-DD HH:MM)
        const dateDisplay = s.start_display;

        // Summary row with resume/open buttons
        const sessionUrl = '/session?uid=' + encodeURIComponent(s.uid);
        const resumePath = s.path.replace(/\\\\/g, '/');
        const resumeCmd = buildResumeCmd(s.agent_cmd, s.cwd, resumePath, s.uid);

        // Calculate average tokens/sec for aggregated sessions
        const tpsValues = allSessionsInGroup.map(session => session.avg_tps || 0).filter(v => v > 0);
        const aggAvgTps = tpsValues.length > 0 ? tpsValues.reduce((a, b) => a + b, 0) / tpsValues.length : 0;

        html += `
            <tr class="expandable-row" data-target="${projectId}" onclick="toggleProjectRow('${projectId}')">
                <td class="project-name" title="${escapeHtml(s.cwd)}">
                    <span class="expand-icon">▶</span>
                    ${escapeHtml(shortProject)}
                </td>
                <td>${escapeHtml(s.machine || 'local')}</td>
                <td title="${escapeHtml(aggBranches.join(' → ') || '—')}">${escapeHtml(aggBranches.join(' → ') || '—')}</td>
                <td style="color: var(--text-secondary)">${dateDisplay}</td>
                <td style="color: var(--text-secondary)">${formatDuration(totalDuration)}</td>
                <td style="color: var(--accent-green)">${formatDuration(aggExecutionTime)}</td>
                <td style="color: var(--accent-purple)">${formatDuration(aggLlmTime)}</td>
                <td style="color: var(--accent-yellow)">${formatDuration(aggToolTime)}</td>
                <td style="color: var(--accent-blue)">${aggAvgTps.toFixed(1)}</td>
                <td title="${formatFullNumber(aggPrompts)}">${formatCompactNumber(aggPrompts)}</td>
                <td title="${formatFullNumber(aggMessages)}">${formatCompactNumber(aggMessages)}</td>
                <td class="tokens">${tokenCellHtml(aggTokenCounts)}</td>
                <td class="cost">$${aggCost.toFixed(2)}</td>
                <td>
                    <button onclick="event.stopPropagation(); copyResumeCommand(event, this.dataset.resumeCmd)" data-resume-cmd="${escapeHtml(resumeCmd)}" class="icon-btn" title="Copy resume command">Copy</button>
                    <a href="${sessionUrl}" class="session-link" target="_blank" title="View full session" onclick="event.stopPropagation()">Open →</a>
                </td>
            </tr>
            <tr class="model-breakdown" id="${projectId}">
                <td colspan="14" style="padding: 0">
                    <div class="model-tree">
                        <div class="detail-line"><strong>Path:</strong> ${escapeHtml(s.cwd)}</div>
                        <div class="detail-line"><strong>Branches:</strong> ${escapeHtml(aggBranches.join(' → ') || 'unknown')}</div>
                        <div class="detail-line"><strong>Tokens:</strong> ${formatFullNumber(aggTokenCounts.tokens)} ${tokenDetailText(aggTokenCounts) ? `(${escapeHtml(tokenDetailText(aggTokenCounts))})` : ''}</div>
        `;

        // Main session with buttons
        html += `
            <div class="model-item">
                <span class="model-name" title="${escapeHtml(s.file)}">
                    <strong>Main session:</strong> ${escapeHtml(s.file)}
                </span>
                <span class="model-stat">${s.start_display}</span>
                <span class="model-stat">${s.duration_display}</span>
                <span class="model-stat" style="color: var(--accent-green)">${s.execution_time_display || '0s'} execution</span>
                <span class="model-stat" style="color: var(--accent-purple)">${s.llm_time_display}</span>
                <span class="model-stat" style="color: var(--accent-yellow)">${s.tool_time_display || '0s'}</span>
                <span class="model-stat" style="color: var(--accent-blue)">${(s.avg_tps || 0).toFixed(1)} tok/s</span>
                <span class="model-stat">${formatFullNumber(s.prompts || 0)} prompts</span>
                <span class="model-stat">${formatFullNumber(s.messages)} msgs</span>
                <span class="model-stat token-wide" title="${escapeHtml(tokenTitle(s))}">${formatFullNumber(s.tokens)} tok</span>
                <span class="model-stat token-detail-wide">${escapeHtml(tokenDetailText(s))}</span>
                <span class="model-stat cost">$${s.cost.toFixed(2)}</span>
                <span style="margin-left: 8px">
                    <button onclick="copyResumeCommand(event, this.dataset.resumeCmd)" data-resume-cmd="${escapeHtml(resumeCmd)}" class="icon-btn" title="Copy resume command">Copy</button>
                    <a href="${sessionUrl}" class="session-link" target="_blank" title="View full session">Open →</a>
                </span>
            </div>
        `;

        // Subagent sessions with buttons
        subs.forEach(sub => {
            const subSessionUrl = '/session?uid=' + encodeURIComponent(sub.uid);
            const subResumePath = sub.path.replace(/\\\\/g, '/');
            // Use parent session's agent_cmd for subagent resume command
            const subResumeCmd = buildResumeCmd(s.agent_cmd, sub.cwd, subResumePath, sub.uid);

            // Just show the filename, not the full relative path
            const fileName = sub.file;

            html += `
                <div class="model-item">
                    <span class="model-name" title="${escapeHtml(sub.relative_path)}">
                        ${escapeHtml(fileName)}
                    </span>
                    <span class="model-stat">${sub.start_display}</span>
                    <span class="model-stat">${sub.duration_display}</span>
                    <span class="model-stat" style="color: var(--accent-green)">${sub.execution_time_display || '0s'} execution</span>
                    <span class="model-stat" style="color: var(--accent-purple)">${sub.llm_time_display}</span>
                    <span class="model-stat" style="color: var(--accent-yellow)">${sub.tool_time_display || '0s'}</span>
                    <span class="model-stat" style="color: var(--accent-blue)">${(sub.avg_tps || 0).toFixed(1)} tok/s</span>
                    <span class="model-stat">${formatFullNumber(sub.prompts || 0)} prompts</span>
                    <span class="model-stat">${formatFullNumber(sub.messages)} msgs</span>
                    <span class="model-stat token-wide" title="${escapeHtml(tokenTitle(sub))}">${formatFullNumber(sub.tokens)} tok</span>
                    <span class="model-stat token-detail-wide">${escapeHtml(tokenDetailText(sub))}</span>
                    <span class="model-stat cost">$${sub.cost.toFixed(2)}</span>
                    <span style="margin-left: 8px">
                        <button onclick="copyResumeCommand(event, this.dataset.resumeCmd)" data-resume-cmd="${escapeHtml(subResumeCmd)}" class="icon-btn" title="Copy resume command">Copy</button>
                        <a href="${subSessionUrl}" class="session-link" target="_blank" title="View full session">Open →</a>
                    </span>
                </div>
            `;
        });

        html += `
                    </div>
                </td>
            </tr>
        `;
    });

    tbody.innerHTML = html;
}

function copyResumeCommand(event, cmd) {
    const btn = event.target;

    function showSuccess() {
        const originalText = btn.textContent;
        btn.textContent = '✓';
        btn.style.color = 'var(--accent-green)';
        setTimeout(() => {
            btn.textContent = originalText;
            btn.style.color = '';
        }, 1500);
    }

    // Use clipboard API if available (HTTPS or localhost)
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(cmd).then(showSuccess).catch(err => {
            console.error('Failed to copy:', err);
        });
    } else {
        // Fallback for HTTP contexts
        const textArea = document.createElement('textarea');
        textArea.value = cmd;
        textArea.style.position = 'fixed';
        textArea.style.left = '-9999px';
        textArea.setAttribute('readonly', '');
        document.body.appendChild(textArea);
        textArea.select();
        try {
            document.execCommand('copy');
            showSuccess();
        } catch (err) {
            console.error('Fallback copy failed:', err);
        }
        document.body.removeChild(textArea);
    }
}

function setupSorting(tableId, sortState, renderFn) {
    document.querySelectorAll(`#${tableId} th[data-sort]`).forEach(th => {
        th.addEventListener('click', () => {
            const field = th.dataset.sort;
            if (sortState.field === field) {
                sortState.asc = !sortState.asc;
            } else {
                sortState.field = field;
                sortState.asc = field === 'name' || field === 'project' || field === 'start';
            }
            updateSortIcons(tableId, sortState);
            renderFn();
        });
    });
}

function updateSortIcons(tableId, sortState) {
    document.querySelectorAll(`#${tableId} th`).forEach(th => {
        const field = th.dataset.sort;
        const icon = th.querySelector('.sort-icon');
        if (!icon) return;
        if (field === sortState.field) {
            th.classList.add('sorted');
            icon.textContent = sortState.asc ? '▲' : '▼';
        } else {
            th.classList.remove('sorted');
            icon.textContent = '▼';
        }
    });
}

// ── Models table sorting ──────────────────────────────────────────────
const models = dashboardData.models || [];
const totalCost = dashboardData.totalCost || 1;
let modelSort = { field: 'cost', asc: false };

function renderModels() {
    const tbody = document.getElementById('models-tbody');
    const sorted = sortData(models, modelSort);

    tbody.innerHTML = sorted.map(m => {
        const modelClass = m.name.toLowerCase().includes('claude') ? 'model-claude' : 'model-other';
        const tokenDetail = [
            ['In', m.input_tokens],
            ['Out', m.output_tokens],
            ['Cache read', m.cache_read_tokens],
            ['Cache write', m.cache_write_tokens],
            ['Reasoning', m.reasoning_tokens],
        ].filter(([, v]) => v > 0).map(([l, v]) => `${l} ${formatCompactNumber(v)}`).join(' · ');
        const tokenTitle = [
            `Total: ${formatFullNumber(m.tokens)}`,
            `In: ${formatFullNumber(m.input_tokens)}`,
            `Out: ${formatFullNumber(m.output_tokens)}`,
            `Cache read: ${formatFullNumber(m.cache_read_tokens)}`,
            `Cache write: ${formatFullNumber(m.cache_write_tokens)}`,
            `Reasoning: ${formatFullNumber(m.reasoning_tokens)}`,
        ].join('\n');

        return `
            <tr>
                <td><span class="model-tag ${modelClass}">${escapeHtml(m.name)}</span></td>
                <td title="${formatFullNumber(m.messages)}">${formatCompactNumber(m.messages)}</td>
                <td class="tokens" title="${escapeHtml(tokenTitle)}">${formatCompactNumber(m.tokens)}</td>
                <td class="tokens" title="${formatFullNumber(m.input_tokens)}">${formatCompactNumber(m.input_tokens)}</td>
                <td class="tokens" title="${formatFullNumber(m.output_tokens)}">${formatCompactNumber(m.output_tokens)}</td>
                <td class="tokens" title="${formatFullNumber(m.cache_read_tokens)}">${formatCompactNumber(m.cache_read_tokens)}</td>
                <td class="tokens" title="${formatFullNumber(m.cache_write_tokens)}">${formatCompactNumber(m.cache_write_tokens)}</td>
                <td class="tokens" title="${formatFullNumber(m.reasoning_tokens)}">${formatCompactNumber(m.reasoning_tokens)}</td>
                <td style="color: var(--accent-blue)">${(m.avg_tps || 0).toFixed(1)}</td>
                <td class="cost">${m.priced ? '$' + m.cost.toFixed(2) : '<span class="unpriced">Unpriced</span>'}</td>
                <td>
                    ${m.priced ? `<div class="bar-container" style="width: 100px; display: inline-block; vertical-align: middle;">
                        <div class="bar" style="width: ${m.pct}%"></div>
                    </div>
                    ${m.pct.toFixed(1)}%` : '—'}
                </td>
            </tr>
        `;
    }).join('');
}

// ── Tools table sorting ───────────────────────────────────────────────
const tools = dashboardData.tools || [];
const totalToolTime = dashboardData.totalToolTime || 1;
let toolSort = { field: 'time', asc: false };

function renderTools() {
    const tbody = document.getElementById('tools-tbody');
    const sorted = sortData(tools, toolSort);

    tbody.innerHTML = sorted.map(t => {
        const errorStyle = t.errors > 0 ? 'color: var(--accent-red)' : 'color: var(--text-secondary)';
        return `
            <tr>
                <td><span class="model-tag model-other">${escapeHtml(t.name)}</span></td>
                <td title="${formatFullNumber(t.calls)}">${formatCompactNumber(t.calls)}</td>
                <td style="color: var(--accent-yellow)">${t.time_display}</td>
                <td style="color: var(--text-secondary)">${t.avg_time_display}</td>
                <td style="${errorStyle}">${t.errors}</td>
                <td>
                    <div class="bar-container" style="width: 100px; display: inline-block; vertical-align: middle;">
                        <div class="bar" style="width: ${t.pct}%; background: var(--accent-yellow)"></div>
                    </div>
                    ${t.pct.toFixed(1)}%
                </td>
            </tr>
        `;
    }).join('');
}

// ── Central worklog / Jira report ───────────────────────────────────
const worklogs = dashboardData.worklogs || [];
const billing = dashboardData.billing || {};
const projectRates = billing.project_rates || {};
const billingCurrency = billing.currency || 'USD';
const billingIncrement = Math.max(1, Number(billing.billing_increment_minutes || 1));
let visibleWorklogRows = [];

function jiraDuration(seconds) {
    const totalMinutes = Math.max(0, Math.round(seconds / 60));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return [hours ? `${hours}h` : '', minutes ? `${minutes}m` : '']
        .filter(Boolean).join(' ') || '0m';
}

function formatMoney(value) {
    return `${billingCurrency} ${Number(value || 0).toFixed(2)}`;
}

function roundedBillableHours(seconds) {
    const minutes = Math.ceil(Math.max(0, seconds) / 60 / billingIncrement) * billingIncrement;
    return minutes / 60;
}

function renderWorklogs() {
    const from = document.getElementById('worklog-from').value;
    const to = document.getElementById('worklog-to').value;
    const selectedProject = document.getElementById('worklog-project').value;
    const selectedDevice = document.getElementById('worklog-device').value;
    const basis = document.getElementById('worklog-basis').value;
    visibleWorklogRows = [];
    worklogs.forEach(project => {
        if (selectedProject && project.project_key !== selectedProject) return;
        project.daily.forEach(day => {
            if (from && day.date < from) return;
            if (to && day.date > to) return;
            const machineIds = day.machine_ids || project.machine_ids || [];
            if (selectedDevice && !machineIds.includes(selectedDevice)) return;
            visibleWorklogRows.push({
                projectKey: project.project_key,
                project: project.project_name,
                machineIds,
                date: day.date,
                seconds: day.seconds,
                agentSeconds: day.agent_seconds || day.seconds,
                executionSeconds: day.execution_seconds || 0,
                prompts: day.prompts || 0,
            });
        });
    });
    visibleWorklogRows.sort((a, b) =>
        a.date.localeCompare(b.date) || a.project.localeCompare(b.project)
    );

    visibleWorklogRows.forEach(row => {
        row.selectedSeconds = basis === 'execution'
            ? row.executionSeconds
            : (basis === 'agent' ? row.agentSeconds : row.seconds);
        row.billableHours = roundedBillableHours(row.selectedSeconds);
        const configuredRate = projectRates[row.projectKey] ?? projectRates[row.project];
        row.rate = configuredRate === undefined ? null : Number(configuredRate);
        row.amount = row.rate === null ? null : row.billableHours * row.rate;
    });
    const total = visibleWorklogRows.reduce((sum, row) => sum + row.selectedSeconds, 0);
    const totalBillable = visibleWorklogRows.reduce((sum, row) => sum + row.billableHours, 0);
    const pricedRows = visibleWorklogRows.filter(row => row.amount !== null);
    const missingRateRows = visibleWorklogRows.length - pricedRows.length;
    const totalAmount = pricedRows.reduce((sum, row) => sum + row.amount, 0);
    let amountSummary = ' · rates not configured';
    if (pricedRows.length && !missingRateRows) {
        amountSummary = ` · ${formatMoney(totalAmount)}`;
    } else if (pricedRows.length) {
        amountSummary = ` · partial ${formatMoney(totalAmount)} · ${missingRateRows} row${missingRateRows === 1 ? '' : 's'} missing rates`;
    }
    document.getElementById('worklog-total').textContent =
        `${jiraDuration(total)} · ${totalBillable.toFixed(2)} billable h` +
        amountSummary;
    document.getElementById('worklog-tbody').innerHTML = visibleWorklogRows.map(row => `
        <tr>
            <td class="project-name">${escapeHtml(row.project)}</td>
            <td>${escapeHtml(row.machineIds.join(', ') || 'unknown')}</td>
            <td>${row.date}</td>
            <td style="color: var(--accent-blue)">${jiraDuration(row.seconds)}</td>
            <td style="color: var(--accent-purple)">${jiraDuration(row.agentSeconds)}</td>
            <td style="color: var(--accent-green)">${row.executionSeconds ? jiraDuration(row.executionSeconds) : '—'}</td>
            <td style="color: var(--accent-green)">${formatFullNumber(row.prompts)}</td>
            <td>${row.billableHours.toFixed(2)}h</td>
            <td>${row.rate === null ? '—' : formatMoney(row.rate) + '/h'}</td>
            <td class="cost">${row.amount === null ? '—' : formatMoney(row.amount)}</td>
        </tr>
    `).join('');
    document.getElementById('worklog-empty').style.display =
        visibleWorklogRows.length ? 'none' : 'block';
}

function setupWorklogs() {
    const defaults = dashboardData.worklogDefaults || {};
    const fromInput = document.getElementById('worklog-from');
    const toInput = document.getElementById('worklog-to');
    const projectSelect = document.getElementById('worklog-project');
    const deviceSelect = document.getElementById('worklog-device');
    const basisSelect = document.getElementById('worklog-basis');
    fromInput.value = defaults.from || '';
    toInput.value = defaults.to || '';
    worklogs
        .slice()
        .sort((a, b) => a.project_name.localeCompare(b.project_name))
        .forEach(project => {
            const option = document.createElement('option');
            option.value = project.project_key;
            option.textContent = project.project_name;
            projectSelect.appendChild(option);
        });
    const deviceNames = new Set();
    worklogs.forEach(project =>
        (project.machine_ids || []).forEach(machine => deviceNames.add(machine))
    );
    (dashboardData.syncMachines || []).forEach(item => deviceNames.add(item.machine_id));
    [...deviceNames].sort().forEach(machine => {
        const option = document.createElement('option');
        option.value = machine;
        option.textContent = machine;
        deviceSelect.appendChild(option);
    });
    [fromInput, toInput, projectSelect, deviceSelect, basisSelect].forEach(element =>
        element.addEventListener('change', renderWorklogs)
    );
    document.getElementById('copy-worklog').addEventListener('click', async event => {
        if (!visibleWorklogRows.length) return;
        const header = ['Date', 'Project', 'Device', 'Wall-clock', 'Agent time', 'Execution time', 'Prompts', 'Billable hours', 'Rate', 'Amount'];
        const lines = visibleWorklogRows.map(row => [
            row.date,
            row.project,
            row.machineIds.join(', '),
            (row.seconds / 3600).toFixed(2),
            (row.agentSeconds / 3600).toFixed(2),
            (row.executionSeconds / 3600).toFixed(2),
            row.prompts,
            row.billableHours.toFixed(2),
            row.rate === null ? '' : row.rate.toFixed(2),
            row.amount === null ? '' : row.amount.toFixed(2),
        ].join('\t'));
        const text = [header.join('\t'), ...lines].join('\n');
        await navigator.clipboard.writeText(text);
        const button = event.currentTarget;
        const previous = button.textContent;
        button.textContent = 'Copied';
        setTimeout(() => { button.textContent = previous; }, 1200);
    });
    renderWorklogs();
}

function renderDevices() {
    const devices = dashboardData.syncMachines || [];
    document.getElementById('devices-tbody').innerHTML = devices.map(device => {
        const parsed = device.last_sync ? new Date(device.last_sync) : null;
        const lastSync = parsed && !Number.isNaN(parsed.getTime())
            ? parsed.toLocaleString()
            : 'Never';
        return `
            <tr>
                <td class="project-name">${escapeHtml(device.machine_id)}</td>
                <td style="color: var(--text-secondary)">${escapeHtml(lastSync)}</td>
                <td>${formatFullNumber(device.sessions || 0)}</td>
            </tr>
        `;
    }).join('') || '<tr><td colspan="3" style="color: var(--text-secondary)">No devices synchronized yet.</td></tr>';
}

// Setup
setupSorting('projects-table', projectSort, renderProjects);
setupSorting('sessions-table', sessionsSort, renderSessions);
setupSorting('models-table', modelSort, renderModels);
setupSorting('tools-table', toolSort, renderTools);
setupWorklogs();
renderDevices();

// Initial render
renderProjects();
renderSessions();
renderModels();
renderTools();
updateSortIcons('projects-table', projectSort);
updateSortIcons('sessions-table', sessionsSort);
updateSortIcons('models-table', modelSort);
updateSortIcons('tools-table', toolSort);
