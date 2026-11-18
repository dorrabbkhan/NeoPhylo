import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * run-plan.sh, result.sh, wait-for.sh, devin.sh DEVIN_DETACH and the
 * wait-ci.sh deadline (conductor efficiency plan Task 0b). Everything
 * runs on stub `claude`/`gh`/`devin` binaries on PATH — no real sessions,
 * no network.
 */
const ROOT = join(import.meta.dirname, "..", "..");
const SCRIPTS = import.meta.dirname;
const FIX = join(import.meta.dirname, "fixtures", "run-plan");
const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));

function stubDir(bins: Record<string, string>): string {
  const dir = tmp("conductor-stub-");
  for (const [name, body] of Object.entries(bins))
    writeFileSync(join(dir, name), `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 });
  return dir;
}

function sh(script: string, args: string[], env: Record<string, string>, input?: string) {
  return spawnSync("bash", [join(SCRIPTS, script), ...args], {
    encoding: "utf8",
    cwd: ROOT,
    env: { ...process.env, ...env },
    input,
  });
}

const runPlan = (args: string[], env: Record<string, string>) =>
  sh("run-plan.sh", args, env);

describe("run-plan.sh (conductor efficiency plan Task 0b)", () => {
  it("dry run prints --model sonnet for a Sonnet row and --model opus for Opus", () => {
    const env = {
      PLAN_FILE: join(FIX, "v1.4d-index-with-conductor.md"),
      DRY_RUN: "1",
      RUN_PLAN_DIR: tmp("rp-"),
    };
    const sonnet = runPlan(["v1.4d", "5", "5"], env);
    assert.equal(sonnet.status, 0, sonnet.stderr);
    assert.match(
      sonnet.stdout,
      /claude -p "\/conduct v1\.4d 5" --model sonnet --allowedTools "/,
    );
    const opus = runPlan(["v1.4d", "2", "2"], env);
    assert.equal(opus.status, 0, opus.stderr);
    assert.match(opus.stdout, /--model opus/);
  });

  it("defaults to opus with a warning when the Task Index has no Conductor column", () => {
    const r = runPlan(["v1.4d", "5", "5"], {
      PLAN_FILE: join(FIX, "v1.4d-index-no-conductor.md"),
      DRY_RUN: "1",
      RUN_PLAN_DIR: tmp("rp-"),
    });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, /no Conductor column.*opus|defaulting.*opus/);
    assert.match(r.stdout, /--model opus/);
  });

  it("a stale RESULT: READY from an earlier run with no new line stops the run", () => {
    const dir = tmp("rp-");
    const taskdir = join(dir, "v1.4d-task5");
    mkdirSync(taskdir, { recursive: true });
    writeFileSync(
      join(taskdir, "conductor-log.md"),
      "notes from a previous run\nRESULT: READY 5\n",
    );
    const stubs = stubDir({ claude: "exit 0" });
    const r = runPlan(["v1.4d", "5", "5"], {
      PLAN_FILE: join(FIX, "v1.4d-index-with-conductor.md"),
      RUN_PLAN_DIR: dir,
      RUN_PLAN_POLL_S: "1",
      PATH: `${stubs}:${process.env.PATH}`,
    });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /no new RESULT: line/);
  });

  it("blank lines only after a stale RESULT stops", () => {
    const dir = tmp("rp-");
    const taskdir = join(dir, "v1.4d-task5");
    mkdirSync(taskdir, { recursive: true });
    writeFileSync(
      join(taskdir, "conductor-log.md"),
      "notes from a previous run\nRESULT: READY 5\n",
    );
    const stubs = stubDir({
      claude: `printf '\n\n' >> "$RUN_PLAN_DIR/v1.4d-task5/conductor-log.md"
exit 0`,
    });
    const r = runPlan(["v1.4d", "5", "5"], {
      PLAN_FILE: join(FIX, "v1.4d-index-with-conductor.md"),
      RUN_PLAN_DIR: dir,
      RUN_PLAN_POLL_S: "1",
      PATH: `${stubs}:${process.env.PATH}`,
    });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /no RESULT: line/);
  });

  it("RESULT: READY waits in bash until the PR is MERGED, then finishes", () => {
    const dir = tmp("rp-");
    const stubs = stubDir({
      // claude -p "/conduct v1.4d 5" … → append this session's RESULT line
      claude: `set -- $2
mkdir -p "$RUN_PLAN_DIR/$2-task$3"
echo "RESULT: READY 99" >> "$RUN_PLAN_DIR/$2-task$3/conductor-log.md"
exit 0`,
      gh: `if [[ " $* " == *" --json state "* ]]; then echo MERGED; fi
exit 0`,
    });
    const r = runPlan(["v1.4d", "5", "5"], {
      PLAN_FILE: join(FIX, "v1.4d-index-with-conductor.md"),
      RUN_PLAN_DIR: dir,
      RUN_PLAN_POLL_S: "1",
      PATH: `${stubs}:${process.env.PATH}`,
    });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /PR 99 merged/);
    assert.match(r.stdout, /tasks 5\.\.5 of v1\.4d done/);
  });

  it("runs /inbox on sonnet before the next task's session", () => {
    const dir = tmp("rp-");
    const stubs = stubDir({
      claude: `echo "$*" >> "$RUN_PLAN_DIR/claude-calls"
if [[ " $* " == *" /conduct "* ]]; then
  set -- $2
  mkdir -p "$RUN_PLAN_DIR/$2-task$3"
  echo "RESULT: READY 99" >> "$RUN_PLAN_DIR/$2-task$3/conductor-log.md"
fi
exit 0`,
      gh: `if [[ " $* " == *" --json state "* ]]; then echo MERGED; fi
exit 0`,
    });
    const r = runPlan(["v1.4d", "5", "6"], {
      PLAN_FILE: join(FIX, "v1.4d-index-with-conductor.md"),
      RUN_PLAN_DIR: dir,
      RUN_PLAN_POLL_S: "1",
      PATH: `${stubs}:${process.env.PATH}`,
    });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const calls = readFileSync(join(dir, "claude-calls"), "utf8").split("\n").filter(Boolean);
    assert.equal(calls.length, 3, calls.join("\n"));
    assert.match(calls[0], /\/conduct v1\.4d 5/);
    assert.match(calls[1], /-p \/inbox --model sonnet/);
    assert.match(calls[2], /\/conduct v1\.4d 6/);
  });

  it("a nonzero /inbox session stops the run before the next task", () => {
    const dir = tmp("rp-");
    const stubs = stubDir({
      claude: `if [[ " $* " == *" /inbox "* ]]; then exit 1; fi
set -- $2
mkdir -p "$RUN_PLAN_DIR/$2-task$3"
echo "RESULT: READY 99" >> "$RUN_PLAN_DIR/$2-task$3/conductor-log.md"
exit 0`,
      gh: `if [[ " $* " == *" --json state "* ]]; then echo MERGED; fi
exit 0`,
    });
    const r = runPlan(["v1.4d", "5", "6"], {
      PLAN_FILE: join(FIX, "v1.4d-index-with-conductor.md"),
      RUN_PLAN_DIR: dir,
      RUN_PLAN_POLL_S: "1",
      PATH: `${stubs}:${process.env.PATH}`,
    });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /inbox/i);
    assert.ok(!existsSync(join(dir, "v1.4d-task6")), "task 6 must not start");
  });

  it("a RESULT: ESCALATED line stops the run and notifies", () => {
    const dir = tmp("rp-");
    const stubs = stubDir({
      claude: `set -- $2
mkdir -p "$RUN_PLAN_DIR/$2-task$3"
echo "RESULT: ESCALATED" >> "$RUN_PLAN_DIR/$2-task$3/conductor-log.md"
exit 0`,
    });
    const r = runPlan(["v1.4d", "5", "5"], {
      PLAN_FILE: join(FIX, "v1.4d-index-with-conductor.md"),
      RUN_PLAN_DIR: dir,
      RUN_PLAN_POLL_S: "1",
      PATH: `${stubs}:${process.env.PATH}`,
    });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /escalated/i);
  });

  it("unknown PR state stops after three polls", () => {
    const dir = tmp("rp-");
    const stubs = stubDir({
      claude: `set -- $2
mkdir -p "$RUN_PLAN_DIR/$2-task$3"
echo "RESULT: READY 99" >> "$RUN_PLAN_DIR/$2-task$3/conductor-log.md"
exit 0`,
      gh: `echo x >> "$RUN_PLAN_DIR/polls"
echo UNKNOWN
exit 0`,
    });
    const r = runPlan(["v1.4d", "5", "5"], {
      PLAN_FILE: join(FIX, "v1.4d-index-with-conductor.md"),
      RUN_PLAN_DIR: dir,
      RUN_PLAN_POLL_S: "0",
      PATH: `${stubs}:${process.env.PATH}`,
    });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /'UNKNOWN' for 3 consecutive polls/);
    assert.equal(readFileSync(join(dir, "polls"), "utf8").trim().split("\n").length, 3);
  });

  it("bad Conductor value exits 2", () => {
    const r = runPlan(["v1.4d", "5", "5"], {
      PLAN_FILE: join(FIX, "v1.4d-index-bad-conductor.md"),
      DRY_RUN: "1",
      RUN_PLAN_DIR: tmp("rp-"),
    });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /Conductor column is 'Haiku'/);
  });

  it("an unknown id exits 2", () => {
    const env = {
      PLAN_FILE: join(FIX, "v1.4d-index-with-conductor.md"),
      DRY_RUN: "1",
      RUN_PLAN_DIR: tmp("rp-"),
    };
    assert.equal(runPlan(["v1.4d", "5", "99"], env).status, 2);
  });
});

describe("result.sh (conductor efficiency plan Task 0b)", () => {
  it("result.sh appends a valid READY line", () => {
    const dir = tmp("rs-");
    for (const args of [
      ["v1.4d", "5", "READY", "99"],
      ["v1.4d", "6", "READY 7"],
      ["v1.4d", "7", "ESCALATED"],
      ["v1.4d", "8", "GATE"],
      ["v1.4d", "9", "FAILED"],
    ]) {
      const r = sh("result.sh", args, { RUN_PLAN_DIR: dir });
      assert.equal(r.status, 0, `args ${args}: ${r.stderr}`);
    }
    const log = (id: string) =>
      readFileSync(join(dir, `v1.4d-task${id}`, "conductor-log.md"), "utf8");
    assert.equal(log("5"), "RESULT: READY 99\n");
    assert.equal(log("6"), "RESULT: READY 7\n");
    assert.equal(log("7"), "RESULT: ESCALATED\n");
    assert.equal(log("8"), "RESULT: GATE\n");
    assert.equal(log("9"), "RESULT: FAILED\n");
  });

  it("result.sh rejects an invalid value without writing", () => {
    const dir = tmp("rs-");
    const taskdir = join(dir, "v1.4d-task5");
    mkdirSync(taskdir, { recursive: true });
    const log = join(taskdir, "conductor-log.md");
    writeFileSync(log, "earlier notes\nRESULT: READY 5\n");
    for (const args of [
      ["v1.4d", "5", "MAYBE"],
      ["v1.4d", "5", "READY"],
      ["v1.4d", "5", "READY", "abc"],
      ["v1.4d", "5"],
    ]) {
      const r = sh("result.sh", args, { RUN_PLAN_DIR: dir });
      assert.equal(r.status, 2, `args ${args}: ${r.stderr}`);
    }
    assert.equal(readFileSync(log, "utf8"), "earlier notes\nRESULT: READY 5\n");
  });
});

describe("wait-for.sh / devin.sh detach (bounded waits)", () => {
  it("wait-for.sh prints PENDING + exit 4 before the .rc exists, then the trimmed tail and rc", () => {
    const dir = tmp("wf-");
    const out = join(dir, "task-1.out.md");
    writeFileSync(
      out,
      Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join("\n") +
        "\nPR_URL: https://example/pr/1\n",
    );
    const pending = sh("wait-for.sh", [out, "0"], {});
    assert.equal(pending.status, 4);
    assert.match(pending.stdout, /^PENDING 41 lines/);
    writeFileSync(`${out}.rc`, "3\n");
    const done = sh("wait-for.sh", [out, "5"], { WAIT_FOR_POLL_S: "0.1" });
    assert.equal(done.status, 3);
    // 0a trimming: tail -30 of the file + PR_URL:/STOP: lines, de-duplicated
    assert.match(done.stdout, /line 12\n/);
    assert.match(done.stdout, /PR_URL: https:\/\/example\/pr\/1/);
    assert.equal(
      done.stdout.split("\n").filter((l) => l.startsWith("PR_URL:")).length,
      1,
    );
  });

  it("wait-for.sh usage error exits 2", () => {
    assert.equal(sh("wait-for.sh", [], {}).status, 2);
  });

  it("DEVIN_DETACH=1 returns at once with the .out.md path; wait-for.sh joins it", () => {
    const dir = tmp("dd-");
    const home = join(dir, "home");
    const stubs = stubDir({
      devin: "sleep 3; echo session-done; echo 'PR_URL: https://example/pr/7'",
    });
    const t0 = Date.now();
    const r = sh(
      "devin.sh",
      ["task", "v1.4d", "0b"],
      {
        DEVIN_DETACH: "1",
        HOME: home,
        REPO: ROOT,
        PATH: `${stubs}:${process.env.PATH}`,
      },
      "the task prompt\n",
    );
    const elapsed = Date.now() - t0;
    assert.equal(r.status, 0, r.stderr);
    const out = r.stdout.trim();
    assert.match(out, /task-\d{8}-\d{6}\.out\.md$/);
    assert.ok(elapsed < 2000, `devin.sh blocked ${elapsed}ms on a detached session`);
    assert.ok(!existsSync(`${out}.rc`), "the detached session should still be running");
    const done = sh("wait-for.sh", [out, "15"], { WAIT_FOR_POLL_S: "0.1", HOME: home });
    assert.equal(done.status, 0, done.stdout + done.stderr);
    assert.match(done.stdout, /session-done/);
    assert.match(done.stdout, /PR_URL: https:\/\/example\/pr\/7/);
  });
});

describe("wait-ci.sh deadline (bounded waits)", () => {
  it("exits 4 at WAIT_CI_DEADLINE_S and kills the watch", () => {
    const stubs = stubDir({
      gh: `if [[ " $* " == *" headRefOid,state"* ]]; then echo "sha111 OPEN"; exit 0; fi
if [[ " $* " == *" --json name "* ]]; then echo 1; exit 0; fi
if [[ " $* " == *" --watch "* ]]; then sleep 60; exit 0; fi
echo "checks table"
exit 0`,
    });
    const t0 = Date.now();
    const r = sh("wait-ci.sh", ["123"], {
      PATH: `${stubs}:${process.env.PATH}`,
      WAIT_CI_POLL_S: "0.1",
      WAIT_CI_DEADLINE_S: "1",
    });
    assert.equal(r.status, 4, r.stdout + r.stderr);
    assert.ok(Date.now() - t0 < 20000, "deadline must return promptly");
    assert.match(r.stderr + r.stdout, /deadline/);
  });
});
