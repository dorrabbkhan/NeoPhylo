/**
 * usage-render.ts — the text and JSON report tables for usage-report.ts
 * (conductor efficiency plan Task 0a). Split out of usage-report.ts to
 * keep every file under the ~400-line rule; all session parsing,
 * attribution and pricing lives in usage-classify.ts. Ported from
 * Epiora's usage-render.ts.
 */
import {
  allTurns,
  firstTurnContext,
  meanCtx,
  median,
  totalCost,
  turnCost,
  type Session,
  type Turn,
} from "./usage-classify.ts";

const MILLION = 1_000_000;

interface Agg {
  sessions: number;
  turns: number;
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
  usd: number;
  ctxFirstMedian: number;
  ctxMeanMedian: number;
  tools: [string, number][];
}

function aggregate(sessions: Session[], opusOnly: boolean): Agg {
  const sums = { turns: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0, usd: 0 };
  const tools = new Map<string, number>();
  let used = 0;
  const firsts: number[] = [];
  const means: number[] = [];
  for (const s of sessions) {
    const turns = allTurns(s).filter((t) => !opusOnly || t.modelKey === "opus");
    if (!turns.length) continue;
    used++;
    firsts.push(turns[0].ctx);
    means.push(turns.reduce((a, t) => a + t.ctx, 0) / turns.length);
    for (const t of turns) {
      sums.turns++;
      sums.input += t.input;
      sums.cacheRead += t.cacheRead;
      sums.cacheWrite += t.cacheWrite;
      sums.output += t.output;
      sums.usd += turnCost(t);
    }
    for (const [k, n] of s.tools) tools.set(k, (tools.get(k) ?? 0) + n);
  }
  return {
    sessions: used,
    ...sums,
    ctxFirstMedian: median(firsts),
    ctxMeanMedian: median(means),
    tools: [...tools.entries()].sort((a, b) => b[1] - a[1]),
  };
}

interface SummaryRow {
  sessions: number;
  tasks: number;
  turns: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
  usd: number;
  usdOpus: number;
  usdPerTaskMedian: number;
  ctxFirstMedian: number;
  ctxMeanMedian: number;
}

/** The version a task rolls up to ("v1.4b-task3" → "v1.4b",
 * "conductor-task0a" → "conductor"); anything else (e.g. "unattributed")
 * is its own group so every session lands in a row. */
const versionKey = (task: string) => {
  const m = /^((?:v\d[\d.]*[a-z]?|conductor))-task\d/.exec(task);
  return m ? m[1] : task;
};

function summarize(sessions: Session[]): SummaryRow {
  const byTask = new Map<string, Session[]>();
  const sums = { turns: 0, cacheRead: 0, cacheWrite: 0, output: 0, usd: 0, usdOpus: 0 };
  for (const s of sessions) {
    const arr = byTask.get(s.task) ?? [];
    arr.push(s);
    byTask.set(s.task, arr);
    for (const t of allTurns(s)) {
      sums.turns++;
      sums.cacheRead += t.cacheRead;
      sums.cacheWrite += t.cacheWrite;
      sums.output += t.output;
      sums.usd += turnCost(t);
      if (t.modelKey === "opus") sums.usdOpus += turnCost(t);
    }
  }
  return {
    sessions: sessions.length,
    tasks: byTask.size,
    ...sums,
    usdPerTaskMedian: median(
      [...byTask.values()].map((ss) => ss.reduce((a, s) => a + totalCost(s), 0)),
    ),
    ctxFirstMedian: median(sessions.map(firstTurnContext)),
    ctxMeanMedian: median(sessions.map(meanCtx)),
  };
}

const fmt = (n: number) =>
  Math.abs(n) >= MILLION
    ? `${(n / MILLION).toFixed(2)}M`
    : Math.abs(n) >= 1000
      ? `${(n / 1000).toFixed(1)}k`
      : String(Math.round(n));
const usd = (n: number) => n.toFixed(3);
const toolsTop = (t: [string, number][], n = 5) =>
  t.slice(0, n)
    .map(([k, c]) => `${k}:${c}`)
    .join(" ");

const pad = (s: string | number, n: number) => String(s).padEnd(n).slice(0, n);
const rpad = (s: string | number, n: number) => String(s).padStart(n).slice(0, n);

export interface RenderOpts {
  since?: string;
  version?: string;
  projectsDir?: string;
}

/** The --since/--version filter shared by render() and toJson(). --version
 * takes a comma list: `v1.4,v1.4b` keeps tasks under either version. */
function filterSessions(sessions: Session[], opts: RenderOpts): Session[] {
  const since = opts.since ? new Date(`${opts.since}T00:00:00Z`).getTime() : -Infinity;
  const after = (t: Turn) => !t.ts || new Date(t.ts).getTime() >= since;
  const versions = (opts.version ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  return sessions
    .map((s) => ({
      ...s,
      turns: s.turns.filter(after),
      subagentTurns: s.subagentTurns.filter(after),
    }))
    .filter(
      (s) =>
        (s.turns.length || s.subagentTurns.length) &&
        (!versions.length || versions.some((v) => s.task === v || s.task.startsWith(`${v}-`))),
    );
}

export function render(sessions: Session[], opts: RenderOpts): string {
  const kept = filterSessions(sessions, opts);

  const out: string[] = [];
  out.push(
    `usage report · projects ${opts.projectsDir ?? "?"} · ${kept.length} session(s)` +
      ` · since ${opts.since ?? "all"} · version ${opts.version ?? "all"}`,
  );
  out.push("");
  out.push("sessions");
  out.push(
    `${pad("session", 9)}${pad("task", 16)}${rpad("turns", 6)}${rpad("$", 9)}` +
      `${rpad("ctx-first", 10)}${rpad("ctx-mean", 10)}  tool mix`,
  );
  for (const s of kept)
    out.push(
      `${pad(s.id.slice(0, 8), 9)}${pad(s.task, 16)}${rpad(allTurns(s).length, 6)}` +
        `${rpad(usd(totalCost(s)), 9)}` +
        `${rpad(fmt(firstTurnContext(s)), 10)}${rpad(fmt(meanCtx(s)), 10)}  ` +
        toolsTop([...s.tools.entries()].sort((a, b) => b[1] - a[1])),
    );

  const byTask = new Map<string, Session[]>();
  for (const s of kept) {
    const arr = byTask.get(s.task) ?? [];
    arr.push(s);
    byTask.set(s.task, arr);
  }
  for (const [label, opus] of [
    ["per task (all models)", false],
    ["per task (opus only)", true],
  ] as const) {
    out.push("");
    out.push(label);
    out.push(
      `${pad("task", 18)}${rpad("sess", 5)}${rpad("turns", 7)}${rpad("input", 8)}` +
        `${rpad("cache-rd", 10)}${rpad("cache-wr", 10)}${rpad("output", 9)}${rpad("$", 9)}` +
        `${rpad("ctx1~", 9)}${rpad("ctxμ~", 9)}  tool mix`,
    );
    for (const [task, ss] of [...byTask.entries()].sort()) {
      const a = aggregate(ss, opus);
      if (!a.sessions) continue;
      out.push(
        `${pad(task, 18)}${rpad(a.sessions, 5)}${rpad(a.turns, 7)}${rpad(fmt(a.input), 8)}` +
          `${rpad(fmt(a.cacheRead), 10)}${rpad(fmt(a.cacheWrite), 10)}${rpad(fmt(a.output), 9)}` +
          `${rpad(usd(a.usd), 9)}${rpad(fmt(a.ctxFirstMedian), 9)}${rpad(fmt(a.ctxMeanMedian), 9)}  ` +
          toolsTop(a.tools),
      );
    }
  }

  const byVersion = new Map<string, Session[]>();
  for (const s of kept) {
    const k = versionKey(s.task);
    const arr = byVersion.get(k) ?? [];
    arr.push(s);
    byVersion.set(k, arr);
  }
  out.push("");
  out.push("summary");
  out.push(
    `${pad("version", 14)}${rpad("sess", 5)}${rpad("tasks", 6)}${rpad("turns", 7)}` +
      `${rpad("cache-rd", 10)}${rpad("cache-wr", 10)}${rpad("output", 9)}${rpad("$", 9)}` +
      `${rpad("$opus", 9)}${rpad("$/task~", 9)}${rpad("ctx1~", 9)}${rpad("ctxμ~", 9)}`,
  );
  const groups: [string, Session[]][] = [...byVersion.entries()].sort();
  groups.push(["total", kept]);
  for (const [v, ss] of groups) {
    const r = summarize(ss);
    out.push(
      `${pad(v, 14)}${rpad(r.sessions, 5)}${rpad(r.tasks, 6)}${rpad(r.turns, 7)}` +
        `${rpad(fmt(r.cacheRead), 10)}${rpad(fmt(r.cacheWrite), 10)}${rpad(fmt(r.output), 9)}` +
        `${rpad(usd(r.usd), 9)}${rpad(usd(r.usdOpus), 9)}${rpad(usd(r.usdPerTaskMedian), 9)}` +
        `${rpad(fmt(r.ctxFirstMedian), 9)}${rpad(fmt(r.ctxMeanMedian), 9)}`,
    );
  }
  return out.join("\n");
}

export function toJson(sessions: Session[], opts: RenderOpts): string {
  const kept = filterSessions(sessions, opts);
  const byTask = new Map<string, Session[]>();
  const byVersion = new Map<string, Session[]>();
  for (const s of kept) {
    const arr = byTask.get(s.task) ?? [];
    arr.push(s);
    byTask.set(s.task, arr);
    const k = versionKey(s.task);
    const varr = byVersion.get(k) ?? [];
    varr.push(s);
    byVersion.set(k, varr);
  }
  const summary: Record<string, SummaryRow> = Object.fromEntries(
    [...byVersion.entries()].sort().map(([v, ss]) => [v, summarize(ss)]),
  );
  summary.total = summarize(kept);
  return JSON.stringify(
    {
      projectsDir: opts.projectsDir,
      since: opts.since ?? null,
      version: opts.version ?? null,
      sessions: kept.map((s) => ({
        id: s.id,
        task: s.task,
        turns: allTurns(s).length,
        usd: totalCost(s),
        usdOpus: totalCost(s, true),
        ctxFirst: firstTurnContext(s),
        ctxMean: meanCtx(s),
        tools: Object.fromEntries(s.tools),
      })),
      tasks: Object.fromEntries(
        [...byTask.entries()].map(([t, ss]) => [
          t,
          { total: aggregate(ss, false), opus: aggregate(ss, true) },
        ]),
      ),
      summary,
    },
    null,
    2,
  );
}
