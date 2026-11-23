import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * plan-index.sh `devin` (the plan's Devin model column) and the devin.sh
 * --model plumbing (v1.5 plan Task 1). Everything runs on stub `devin`
 * binaries on PATH or on temp plan files via PLAN_FILE — no real
 * sessions, no network.
 */
const ROOT = join(import.meta.dirname, "..", "..");
const SCRIPTS = import.meta.dirname;
const V15_PLAN = join(
  ROOT,
  "docs/superpowers/plans/2026-11-23-neophylo-v1.5-plan.md",
);
const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));

function stubDir(bins: Record<string, string>): string {
  const dir = tmp("conductor-stub-");
  for (const [name, body] of Object.entries(bins))
    writeFileSync(join(dir, name), `#!/usr/bin/env bash\n${body}\n`, {
      mode: 0o755,
    });
  return dir;
}

function sh(
  script: string,
  args: string[],
  env: Record<string, string>,
  input?: string,
) {
  return spawnSync("bash", [join(SCRIPTS, script), ...args], {
    encoding: "utf8",
    cwd: ROOT,
    env: { ...process.env, ...env },
    input,
  });
}

const planIndex = (args: string[], env: Record<string, string>) =>
  sh("plan-index.sh", args, env);
const runPlan = (args: string[], env: Record<string, string>) =>
  sh("run-plan.sh", args, env);

function tempPlan(index: string): string {
  const dir = tmp("plan-");
  const file = join(dir, "temp-plan.md");
  writeFileSync(file, `# temp plan fixture\n\n## Task Index\n\n${index}\n`);
  return file;
}

const WITH_DEVIN = `| # | Task | Depends on | Conductor | Devin |
|---|---|---|---|---|
| 1 | Setup | — | Sonnet | swe-2-max |
| 4 | Engine | 1 | Opus | swe-2-max |`;

describe("plan-index.sh devin (v1.5 Task 1)", () => {
  it("prints the Devin column for the task's row", () => {
    const r = planIndex(["devin", "v1.5", "4"], {
      PLAN_FILE: tempPlan(WITH_DEVIN),
    });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), "swe-2-max");
  });

  it("prints an empty string when the plan has no Devin column", () => {
    const plan = tempPlan(`| # | Task | Depends on | Conductor |
|---|---|---|---|
| 5 | Wasm | 4 | Sonnet |`);
    const r = planIndex(["devin", "v1.4d", "5"], { PLAN_FILE: plan });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), "");
  });

  it("exits 2 with 'no task 99' for a task outside the index", () => {
    const r = planIndex(["devin", "v1.5", "99"], {
      PLAN_FILE: tempPlan(WITH_DEVIN),
    });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /no task 99/);
  });
});

describe("run-plan.sh on the five-column v1.5 Task Index", () => {
  const env = () => ({
    PLAN_FILE: V15_PLAN,
    DRY_RUN: "1",
    RUN_PLAN_DIR: tmp("rp-"),
  });

  it("the Devin column never shifts the Conductor value (4→Opus, 1→Sonnet)", () => {
    const t4 = runPlan(["v1.5", "4", "4"], env());
    assert.equal(t4.status, 0, t4.stderr);
    assert.match(t4.stdout, /\/conduct v1\.5 4" --model opus /);
    const t1 = runPlan(["v1.5", "1", "1"], env());
    assert.equal(t1.status, 0, t1.stderr);
    assert.match(t1.stdout, /\/conduct v1\.5 1" --model sonnet /);
  });

  it("'Devin' stays an invalid Conductor value (exit 2)", () => {
    const plan = tempPlan(`| # | Task | Depends on | Conductor | Devin |
|---|---|---|---|---|
| 6 | Links | 5 | Devin | swe-2-max |`);
    const r = runPlan(["v1.5", "6", "6"], {
      PLAN_FILE: plan,
      DRY_RUN: "1",
      RUN_PLAN_DIR: tmp("rp-"),
    });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /Conductor column is 'Devin', expected Opus or Sonnet/);
  });
});

describe("devin.sh --model plumbing (v1.5 Task 1)", () => {
  const envFor = (
    home: string,
    stubs: string,
    extra: Record<string, string> = {},
  ) => ({
    HOME: home,
    REPO: ROOT,
    // A conductor shell may carry these; they must not leak into tests.
    DEVIN_DETACH: "",
    DEVIN_MODEL: "",
    PATH: `${stubs}:${process.env.PATH}`,
    ...extra,
  });
  const calls = (dir: string) =>
    readFileSync(join(dir, "calls"), "utf8").split("\n").filter(Boolean);

  it("passes --model swe-2-max from the v1.5 plan's Devin column", () => {
    const dir = tmp("dm-");
    const stubs = stubDir({
      devin: `echo "$*" >> "$CALLS"; exit 0`,
    });
    const r = sh(
      "devin.sh",
      ["task", "v1.5", "4"],
      envFor(dir, stubs, { CALLS: join(dir, "calls") }),
      "the task prompt\n",
    );
    assert.equal(r.status, 0, r.stderr);
    const devinCalls = calls(dir).filter((c) => c.includes("--prompt-file"));
    assert.equal(devinCalls.length, 1);
    assert.match(devinCalls[0], /--model swe-2-max/);
    assert.match(r.stderr, /model: swe-2-max/);
  });

  it("an explicit DEVIN_MODEL env wins over the plan's value", () => {
    const dir = tmp("dm-");
    const stubs = stubDir({
      devin: `echo "$*" >> "$CALLS"; exit 0`,
    });
    const r = sh(
      "devin.sh",
      ["task", "v1.5", "4"],
      envFor(dir, stubs, {
        CALLS: join(dir, "calls"),
        DEVIN_MODEL: "claude-opus-5-5-high",
      }),
      "the fix prompt\n",
    );
    assert.equal(r.status, 0, r.stderr);
    const devinCalls = calls(dir).filter((c) => c.includes("--prompt-file"));
    assert.match(devinCalls[0], /--model claude-opus-5-5-high/);
    assert.ok(!devinCalls[0].includes("swe-2-max"));
  });

  it("passes no --model for a plan without a Devin column", () => {
    const dir = tmp("dm-");
    const stubs = stubDir({
      devin: `echo "$*" >> "$CALLS"; exit 0`,
    });
    const r = sh(
      "devin.sh",
      ["task", "v1.4d", "5"],
      envFor(dir, stubs, {
        CALLS: join(dir, "calls"),
        PLAN_FILE: tempPlan(`| # | Task | Conductor |
|---|---|---|
| 5 | Wasm | Sonnet |`),
      }),
      "the task prompt\n",
    );
    assert.equal(r.status, 0, r.stderr);
    const devinCalls = calls(dir).filter((c) => c.includes("--prompt-file"));
    assert.equal(devinCalls.length, 1);
    assert.ok(!devinCalls[0].includes("--model"), devinCalls[0]);
    assert.match(r.stderr, /no --model flag/);
  });
});
