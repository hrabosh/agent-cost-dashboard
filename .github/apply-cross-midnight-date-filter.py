from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file_path = Path(path)
    content = file_path.read_text(encoding="utf-8")
    count = content.count(old)
    if count != 1:
        raise RuntimeError(f"expected one match in {path}, found {count}")
    file_path.write_text(content.replace(old, new, 1), encoding="utf-8")
    print(f"updated {path}")


replace_once(
    "worklog_store.py",
    r'''            if session_activity_spans:
                session_timings[key].append(
                    {
                        "uid": f'{row["machine_id"]}:{row["session_uid"]}',
                        "machine_id": row["machine_id"],
                        "agent": row["agent"],
                        "branches": sorted(row_branches),
                        "activity_spans": [
                            [utc_iso(start), utc_iso(end)]
                            for start, end in merge_spans(session_activity_spans)
                        ],
                        "execution_spans": [
                            [utc_iso(start), utc_iso(end)]
                            for start, end in merge_spans(session_execution_spans)
                        ],
                    }
                )
''',
    r'''            if session_activity_spans:
                merged_activity_spans = merge_spans(session_activity_spans)
                merged_execution_spans = merge_spans(session_execution_spans)
                activity_by_day = split_spans_into_days(merged_activity_spans, tz)
                execution_by_day = split_spans_into_days(merged_execution_spans, tz)
                session_timings[key].append(
                    {
                        "uid": f'{row["machine_id"]}:{row["session_uid"]}',
                        "machine_id": row["machine_id"],
                        "agent": row["agent"],
                        "branches": sorted(row_branches),
                        "activity_spans": [
                            [utc_iso(start), utc_iso(end)]
                            for start, end in merged_activity_spans
                        ],
                        "execution_spans": [
                            [utc_iso(start), utc_iso(end)]
                            for start, end in merged_execution_spans
                        ],
                        "daily": [
                            {
                                "date": day,
                                "activity_spans": [
                                    [utc_iso(start), utc_iso(end)]
                                    for start, end in activity_by_day.get(day, [])
                                ],
                                "execution_spans": [
                                    [utc_iso(start), utc_iso(end)]
                                    for start, end in execution_by_day.get(day, [])
                                ],
                            }
                            for day in sorted(activity_by_day.keys() | execution_by_day.keys())
                        ],
                    }
                )
''',
)

replace_once(
    "worklog_store.py",
    r'''def split_spans_by_day(
    spans: Iterable[tuple[datetime, datetime]], tz: ZoneInfo
) -> dict[str, float]:
''',
    r'''def split_spans_into_days(
    spans: Iterable[tuple[datetime, datetime]], tz: ZoneInfo
) -> dict[str, list[tuple[datetime, datetime]]]:
    """Split UTC spans at local midnight while preserving exact boundaries."""
    daily: dict[str, list[tuple[datetime, datetime]]] = defaultdict(list)
    for span_start, span_end in spans:
        cursor = span_start
        while cursor < span_end:
            local_cursor = cursor.astimezone(tz)
            next_day = datetime.combine(
                local_cursor.date() + timedelta(days=1), time.min, tzinfo=tz
            ).astimezone(timezone.utc)
            segment_end = min(span_end, next_day)
            daily[local_cursor.date().isoformat()].append((cursor, segment_end))
            cursor = segment_end
    return {day: merge_spans(day_spans) for day, day_spans in daily.items()}


def split_spans_by_day(
    spans: Iterable[tuple[datetime, datetime]], tz: ZoneInfo
) -> dict[str, float]:
''',
)

replace_once(
    "dashboard_api/schemas.py",
    r'''class WorklogSessionTiming(ApiModel):
    uid: str
    machine_id: str
    agent: str
    branches: list[str]
    activity_spans: list[tuple[str, str]]
    execution_spans: list[tuple[str, str]]
''',
    r'''class WorklogSessionDayTiming(ApiModel):
    date: date
    activity_spans: list[tuple[str, str]]
    execution_spans: list[tuple[str, str]]


class WorklogSessionTiming(ApiModel):
    uid: str
    machine_id: str
    agent: str
    branches: list[str]
    activity_spans: list[tuple[str, str]]
    execution_spans: list[tuple[str, str]]
    daily: list[WorklogSessionDayTiming] = Field(default_factory=list)
''',
)

replace_once(
    "frontend/src/types.ts",
    r'''export interface WorklogSessionTiming {
  uid: string;
  machine_id: string;
  agent: string;
  branches: string[];
  activity_spans: Array<[string, string]>;
  execution_spans: Array<[string, string]>;
}
''',
    r'''export interface WorklogSessionDayTiming {
  date: string;
  activity_spans: Array<[string, string]>;
  execution_spans: Array<[string, string]>;
}

export interface WorklogSessionTiming {
  uid: string;
  machine_id: string;
  agent: string;
  branches: string[];
  activity_spans: Array<[string, string]>;
  execution_spans: Array<[string, string]>;
  daily: WorklogSessionDayTiming[];
}
''',
)

replace_once(
    "frontend/src/App.tsx",
    r'''type TimestampSpan = [string, string];

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

function attachProjectTiming(
  project: ProjectSummary,
  worklogs: DashboardResponse["worklogs"],
): TimedProjectSummary {
  const identity = normalizedProjectKey(project.name);
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

  const selectedKeys = new Set(
    selectedSessions.map((session) =>
      JSON.stringify([project.agent, session.uid]),
    ),
  );
  const timings = new Map<
    string,
    DashboardResponse["worklogs"][number]["session_timings"][number]
  >();
  worklogs
    .filter(
      (worklog) =>
        normalizedProjectKey(worklog.project_name) === identity ||
        normalizedProjectKey(worklog.project_key) === identity,
    )
    .flatMap((worklog) => worklog.session_timings)
    .forEach((timing) => {
      const key = JSON.stringify([timing.agent, timing.uid]);
      if (selectedKeys.has(key)) timings.set(key, timing);
    });

  if (timings.size !== selectedKeys.size) {
    return {
      ...project,
      wall_time: null,
      agent_time: null,
      accounted_execution_time: null,
    };
  }

  const selectedTimings = [...timings.values()];
  return {
    ...project,
    wall_time: mergedSpanSeconds(
      selectedTimings.flatMap((timing) => timing.activity_spans),
    ),
    agent_time: selectedTimings.reduce(
      (total, timing) => total + mergedSpanSeconds(timing.activity_spans),
      0,
    ),
    accounted_execution_time: selectedTimings.reduce(
      (total, timing) => total + mergedSpanSeconds(timing.execution_spans),
      0,
    ),
  };
}
''',
    r'''type TimestampSpan = [string, string];
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
  return Number.isFinite(latest) ? new Date(latest).toISOString() : null;
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
''',
)

replace_once(
    "frontend/src/App.tsx",
    r'''  const activity = sessions
    .map((session) => session.start || session.end)
''',
    r'''  const activity = sessions
    .map((session) => session.end || session.start)
''',
)

replace_once(
    "frontend/src/App.tsx",
    r'''          const sessions = project.session_items.filter((session) => {
            const startDay = session.start?.slice(0, 10) || "";
            return (
              (machine === "all" || session.machine === machine) &&
              (branch === "all" || primaryBranch(session) === branch) &&
              (!dateFrom || (startDay && startDay >= dateFrom)) &&
              (!dateTo || (startDay && startDay <= dateTo))
            );
          });
''',
    r'''          const timings = projectTimingMap(project, data.worklogs);
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
''',
)

replace_once(
    "frontend/src/App.tsx",
    r'''        projects: item.projects.map((project) =>
          attachProjectTiming(project, data.worklogs),
        ),
      })),
    [data.worklogs, groups],
''',
    r'''        projects: item.projects.map((project) =>
          attachProjectTiming(project, data.worklogs, dateFrom, dateTo),
        ),
      })),
    [data.worklogs, dateFrom, dateTo, groups],
''',
)

replace_once(
    "frontend/src/App.tsx",
    r'''      <p className="project-time-note">
        Wall-clock, agent, and execution are rebuilt from the exact synced sessions
        visible in each row. LLM and tool time follow the same session selection; a
        dash means exact synced spans are unavailable.
      </p>
''',
    r'''      <p className="project-time-note">
        Date filters include sessions that overlap the selected local days and clip
        Wall-clock, Agent, Execution, and Last activity to that range. Prompts, LLM,
        tools, tokens, and value remain whole-session totals. Session window in the
        expanded details is first-to-last recorded activity, includes idle gaps, and
        is not intended for billing.
      </p>
''',
)

replace_once(
    "frontend/src/App.tsx",
    r'''              {latestSessions.map((session) => (
                <div className="session-line" key={session.uid}>
                  <span>{shortDate(session.start)}</span>
                  <strong>{primaryBranch(session)}</strong>
                  <span>{session.machine}</span>
                  <span>{duration(session.execution_time)}</span>
                  <span>{money(session.cost)}</span>
                </div>
              ))}
''',
    r'''              {latestSessions.map((session) => (
                <div className="session-line" key={session.uid}>
                  <span>{sessionDateRange(session)}</span>
                  <strong>{primaryBranch(session)}</strong>
                  <span>{session.machine}</span>
                  <span
                    title="Execution excludes idle time; session window is first to last recorded activity and includes idle gaps."
                  >
                    {duration(session.execution_time)} exec · {duration(session.duration)} window
                  </span>
                  <span>{money(session.cost)}</span>
                </div>
              ))}
''',
)

replace_once(
    "tests/test_worklog_store.py",
    r'''        self.assertEqual(
            timings["laptop:laptop-session"]["execution_spans"],
            [["2026-07-31T10:01:00Z", "2026-07-31T10:15:20Z"]],
        )

    def test_synced_statistics_populate_dashboard_aggregates(self):
''',
    r'''        self.assertEqual(
            timings["laptop:laptop-session"]["execution_spans"],
            [["2026-07-31T10:01:00Z", "2026-07-31T10:15:20Z"]],
        )

    def test_session_timing_splits_at_local_midnight(self):
        session = self.session(
            "cross-midnight",
            "2026-07-31T21:50:00Z",
            "2026-07-31T22:10:00Z",
        )
        session["execution_spans"] = [
            ["2026-07-31T21:55:00Z", "2026-07-31T22:05:00Z"]
        ]
        self.store.upsert_sessions("laptop", [session])

        report = self.store.report(
            date(2026, 7, 31), date(2026, 8, 1), "Europe/Prague"
        )
        timing = report[0]["session_timings"][0]

        self.assertEqual(
            timing["daily"],
            [
                {
                    "date": "2026-07-31",
                    "activity_spans": [
                        ["2026-07-31T21:50:00Z", "2026-07-31T22:00:00Z"]
                    ],
                    "execution_spans": [
                        ["2026-07-31T21:55:00Z", "2026-07-31T22:00:00Z"]
                    ],
                },
                {
                    "date": "2026-08-01",
                    "activity_spans": [
                        ["2026-07-31T22:00:00Z", "2026-07-31T22:10:00Z"]
                    ],
                    "execution_spans": [
                        ["2026-07-31T22:00:00Z", "2026-07-31T22:05:00Z"]
                    ],
                },
            ],
        )

    def test_synced_statistics_populate_dashboard_aggregates(self):
''',
)
