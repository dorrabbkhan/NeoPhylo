/**
 * usage-classify.ts — session-log parsing, <version>-task<N> attribution
 * and the tool-mix classifier behind usage-report.ts (conductor
 * efficiency plan Task 0a, evidence E1–E6). Split out of usage-report.ts
 * to keep every file under the ~400-line rule. Ported from Epiora's
 * usage-classify.ts.
 *
 * Reads ~/.claude/projects/<repo-slug>/*.jsonl (see usage-report.ts for
 * the slug rule). Output is aggregates only — counts, tokens, $, tool
 * names. Never prompt text, never tool inputs or outputs.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, basename } from "node:path";

// USD per 1M tokens (conductor efficiency plan Task 0a price table).
const PRICES: Record<string, { in: number; out: number; cacheRead: number; cacheWrite1h: number }> = {
  opus: { in: 4, out: 20, cacheRead: 0.2, cacheWrite1h: 8 },
  sonnet: { in: 2, out: 10, cacheRead: 0.1, cacheWrite1h: 4 },
  haiku: { in: 0.1, out: 0.5, cacheRead: 0.01, cacheWrite1h: 0.2 },
};

export interface Turn {
  model: string;
  modelKey: keyof typeof PRICES | "other";
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
  ctx: number; // input + cacheRead + cacheWrite
  ts: string;
}

export interface Session {
  id: string;
  file: string;
  task: string;
  turns: Turn[]; // the session's own turns
  subagentTurns: Turn[]; // turns from <id>/subagents/*.jsonl, priced by their own model
  tools: Map<string, number>;
}

const modelKey = (m: unknown): Turn["modelKey"] => {
  const s = typeof m === "string" ? m : "";
  if (s.includes("opus")) return "opus";
  if (s.includes("sonnet")) return "sonnet";
  if (s.includes("haiku")) return "haiku";
  return "other";
};

/** Tool-call buckets: grep / diff reads / file reads / CI-Devin waits / Devin. */
function toolBucket(name: string, command: unknown): string {
  const cmd = typeof command === "string" ? command : "";
  if (name === "Grep" || /^(rg|grep|find|fd)\b/.test(cmd)) return "grep";
  if (/\b(git\s+diff|git\s+show|gh\s+pr\s+diff)\b/.test(cmd)) return "diff-read";
  if (name === "Read") return "file-read";
  if (/\b(gh\s+pr\s+checks|gh\s+run\s+(view|watch)|wait-ci)\b/.test(cmd)) return "ci-wait";
  if (/\b(devin|build-prompt)(\.sh)?\b/.test(cmd)) return "devin";
  if (name === "Bash") return "bash";
  return name;
}

interface LogEvent {
  type?: string;
  timestamp?: string;
  message?: {
    id?: string;
    role?: string;
    model?: string;
    content?: unknown;
    usage?: {
      input_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
      output_tokens?: number;
    };
  };
}

function userText(ev: LogEvent): string {
  const c = ev.message?.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c))
    return c
      .filter((b): b is { type: string; text: string } => !!b && b.type === "text")
      .map((b) => b.text)
      .join("\n");
  return "";
}

/** Bash commands a session ran, from its assistant tool_use blocks. */
function bashCommands(ev: LogEvent): string[] {
  if (ev.type !== "assistant") return [];
  const c = ev.message?.content;
  if (!Array.isArray(c)) return [];
  return c
    .filter(
      (b): b is { type: string; name: string; input?: { command?: string } } =>
        !!b && b.type === "tool_use" && b.name === "Bash",
    )
    .map((b) => b.input?.command ?? "")
    .filter(Boolean);
}

function readEvents(file: string): LogEvent[] {
  const out: LogEvent[] = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as LogEvent);
    } catch {
      // malformed log line — skip it, never fail the report on one bad event
    }
  }
  return out;
}

// Versions look like `v1.4b`, `v1.4c` (a lettered plan suffix) or the
// `conductor` build-process label. Task ids start with a digit (`0a`,
// `14`) — `<N>`/`$1` placeholders expanded into prompts ("v1.4 N",
// "v1.4-taskN") stay unattributed.
const VER = "(v\\d[\\d.]*[a-z]?|conductor)";
const CONDUCT_RE = new RegExp(`/conduct\\s+${VER}\\s+(\\d+[a-z]?)\\b`);
const DEVIN_SH_RE = new RegExp(
  `\\b(?:devin|build-prompt)\\.sh\\s+(?:task|review|fix)\\s+${VER}\\s+(\\d+[a-z]?)\\b`,
);
const CONDUCTOR_DIR_RE = new RegExp(`\\bneophylo-conductor\\/${VER}-task(\\d+[a-z]?)\\b`);
const TASK_TEXT_RE = new RegExp(`\\b${VER}-task(\\d+[a-z]?)\\b`);

/**
 * The <version>-task<N> a session belongs to, else "unattributed". First
 * match wins, in this order (E6): `/conduct <v> <N>` in a user message; a
 * Bash call `devin.sh|build-prompt.sh <kind> <v> <N>`; a path
 * `neophylo-conductor/<v>-task<N>`; `<v>-task<N>` text.
 */
export function attributeTask(file: string): string {
  const events = readEvents(file);
  const userTexts = events.filter((e) => e.type === "user").map(userText);
  const commands = events.flatMap(bashCommands);
  const all = userTexts.concat(commands);
  for (const re of [CONDUCT_RE, DEVIN_SH_RE, CONDUCTOR_DIR_RE, TASK_TEXT_RE])
    for (const text of all) {
      const m = re.exec(text);
      if (m) return `${m[1]}-task${m[2]}`;
    }
  return "unattributed";
}

export function parseSession(file: string): Session {
  const turns: Turn[] = [];
  const byId = new Map<string, Turn>();
  const tools = new Map<string, number>();
  for (const ev of readEvents(file)) {
    if (ev.type !== "assistant" || !ev.message?.usage) continue;
    const u = ev.message.usage;
    const input = u.input_tokens ?? 0;
    const cacheRead = u.cache_read_input_tokens ?? 0;
    const cacheWrite = u.cache_creation_input_tokens ?? 0;
    const turn: Turn = {
      model: ev.message.model ?? "?",
      modelKey: modelKey(ev.message.model),
      input,
      cacheRead,
      cacheWrite,
      output: u.output_tokens ?? 0,
      ctx: input + cacheRead + cacheWrite,
      ts: ev.timestamp ?? "",
    };
    // Claude Code writes one JSONL line per assistant content block, all
    // repeating the same message.id and usage — count usage once per
    // message.id (the last line's), tool_use blocks from every line.
    const msgId = ev.message.id;
    if (msgId) {
      const seen = byId.get(msgId);
      if (seen) Object.assign(seen, turn);
      else {
        byId.set(msgId, turn);
        turns.push(turn);
      }
    } else {
      turns.push(turn);
    }
    const content = ev.message.content;
    if (Array.isArray(content))
      for (const b of content)
        if (b && b.type === "tool_use") {
          const k = toolBucket(String(b.name ?? "?"), b.input?.command);
          tools.set(k, (tools.get(k) ?? 0) + 1);
        }
  }
  return {
    id: basename(file).replace(/\.jsonl$/, ""),
    file,
    task: attributeTask(file),
    turns,
    subagentTurns: [],
    tools,
  };
}

/** The session's own turns plus its subagent sidechain turns. */
export const allTurns = (s: Session): Turn[] => s.turns.concat(s.subagentTurns);

export function loadSessions(dir: string): Session[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .sort()
    .map((f) => {
      const s = parseSession(join(dir, f));
      // Sidechain logs: <projects-dir>/<sessionId>/subagents/*.jsonl — their
      // turns belong to this session (priced by their own model).
      const sub = join(dir, f.replace(/\.jsonl$/, ""), "subagents");
      if (existsSync(sub))
        for (const g of readdirSync(sub).filter((x) => x.endsWith(".jsonl")).sort()) {
          const t = parseSession(join(sub, g));
          s.subagentTurns.push(...t.turns);
          for (const [k, n] of t.tools) s.tools.set(k, (s.tools.get(k) ?? 0) + n);
        }
      return s;
    });
}

const MILLION = 1_000_000;

export function turnCost(t: Turn): number {
  const p = PRICES[t.modelKey as keyof typeof PRICES];
  if (!p) return 0;
  return (
    (t.input * p.in + t.cacheRead * p.cacheRead + t.cacheWrite * p.cacheWrite1h + t.output * p.out) /
    MILLION
  );
}

/** Cost of the session's own turns — subagent turns via totalCost. */
export function sessionCost(s: Session, opusOnly = false): number {
  return s.turns
    .filter((t) => !opusOnly || t.modelKey === "opus")
    .reduce((a, t) => a + turnCost(t), 0);
}

/** Cost of all turns including subagent sidechains. */
export function totalCost(s: Session, opusOnly = false): number {
  return allTurns(s)
    .filter((t) => !opusOnly || t.modelKey === "opus")
    .reduce((a, t) => a + turnCost(t), 0);
}

export function firstTurnContext(s: Session): number {
  return s.turns.length ? s.turns[0].ctx : 0;
}

export const meanCtx = (s: Session) => {
  const turns = allTurns(s);
  return turns.length ? turns.reduce((a, t) => a + t.ctx, 0) / turns.length : 0;
};

export const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const a = [...xs].sort((p, q) => p - q);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};
