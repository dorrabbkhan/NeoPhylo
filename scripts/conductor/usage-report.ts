/**
 * usage-report.ts — per-session and per-task Claude Code usage (conductor
 * efficiency plan Task 0a, evidence E1–E6).
 *
 *   scripts/conductor/usage-report.sh [--since YYYY-MM-DD] [--version vX.Y[,vX.Z…]]
 *                                     [--json] [--projects-dir <dir>]
 *
 * Reads ~/.claude/projects/<repo-slug>/*.jsonl where the slug is the repo's
 * absolute path with "/" → "-" (as Claude Code names it). Override with
 * --projects-dir or CLAUDE_PROJECTS_DIR — tests point it at synthetic
 * fixtures under scripts/conductor/fixtures/usage/; real session logs are
 * never copied into the repo (they contain prompt bodies).
 *
 * Output is aggregates only — counts, tokens, $, tool names. Never prompt
 * text, never tool inputs or outputs. Ported from Epiora's
 * usage-report.ts with NeoPhylo's attribution rules (E6). Parsing,
 * attribution and the tool-mix classifier live in usage-classify.ts; the
 * report tables in usage-render.ts — both split out to keep every file
 * under the ~400-line rule. This module re-exports the public surface so
 * callers keep importing "./usage-report.ts".
 */
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { loadSessions } from "./usage-classify.ts";
import { render, toJson, type RenderOpts } from "./usage-render.ts";

export {
  allTurns,
  attributeTask,
  firstTurnContext,
  loadSessions,
  meanCtx,
  median,
  parseSession,
  sessionCost,
  totalCost,
  turnCost,
  type Session,
  type Turn,
} from "./usage-classify.ts";
export { render, toJson, type RenderOpts } from "./usage-render.ts";

function repoSlug(): string {
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  return root.replaceAll("/", "-");
}

function main(argv: string[]): number {
  const opts: RenderOpts & { json?: boolean } = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") opts.json = true;
    else if (a === "--since") opts.since = argv[++i];
    else if (a === "--version") opts.version = argv[++i];
    else if (a === "--projects-dir") opts.projectsDir = argv[++i];
    else {
      process.stderr.write(
        "usage: usage-report.ts [--since YYYY-MM-DD] [--version vX.Y[,vX.Z…]] [--json] [--projects-dir <dir>]\n",
      );
      return 2;
    }
  }
  const dir =
    opts.projectsDir ??
    process.env.CLAUDE_PROJECTS_DIR ??
    join(homedir(), ".claude", "projects", repoSlug());
  const sessions = loadSessions(dir);
  const out = opts.json
    ? toJson(sessions, { ...opts, projectsDir: dir })
    : render(sessions, { ...opts, projectsDir: dir });
  process.stdout.write(out + "\n");
  return 0;
}

const invoked = process.argv[1] ? realpathSync(process.argv[1]) : "";
if (invoked && import.meta.url === pathToFileURL(invoked).href)
  process.exit(main(process.argv.slice(2)));
