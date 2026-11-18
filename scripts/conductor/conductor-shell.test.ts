import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * conductor-shell.test.ts — the shell wrappers of Task 0a (wait-ci.sh,
 * build-prompt.sh, judge.sh, devin.sh). gh and devin are stubs on PATH;
 * no network, no real commands.
 */
const ROOT = join(import.meta.dirname, "..", "..");

// Stub gh for wait-ci tests: `pr checks --json` fails (gh < 2.50), the
// statusCheckRollup fallback answers from $GH_STUB_ANSWERS (comma list,
// repeating the last), `pr view ... headRefOid,state` answers from
// $GH_STUB_VIEWS the same way, `--watch` succeeds, a bare `pr checks`
// prints one passing row. Every call is logged to $GH_STUB_CALLS.
const GH_STUB = `#!/usr/bin/env bash
echo "$*" >> "$GH_STUB_CALLS"
seq_ans() { # $1 file, $2 comma-list var
  n=$(cat "$1" 2>/dev/null || echo 0); n=$((n+1)); echo "$n" > "$1"
  IFS=, read -ra a <<< "$2"; i=$((n-1)); [ "$i" -ge "\${#a[@]}" ] && i=$((\${#a[@]}-1))
  echo "\${a[$i]}"
}
if [[ " $* " == *" pr view "* && " $* " == *" headRefOid,state"* ]]; then
  seq_ans "$GH_STUB_VIEWCOUNT" "$GH_STUB_VIEWS"; exit 0
fi
if [[ " $* " == *" statusCheckRollup"* ]]; then
  seq_ans "$GH_STUB_COUNT" "$GH_STUB_ANSWERS"; exit 0
fi
if [[ " $* " == *" --json "* ]]; then echo "unknown flag: --json" >&2; exit 1; fi
if [[ " $* " == *" --watch "* ]]; then exit 0; fi
if [[ " $1 $2 " == " pr checks " ]]; then
  printf 'check\tpass\t1m31s\thttps://github.com/o/r/actions/runs/2/job/222\n'
  exit 0
fi
exit 0
`;

const GH_STUB_FAILING = `#!/usr/bin/env bash
echo "$*" >> "$GH_STUB_CALLS"
if [[ " $* " == *" headRefOid,state"* ]]; then echo "sha111 OPEN"; exit 0; fi
if [[ " $* " == *" statusCheckRollup"* ]]; then echo 2; exit 0; fi
if [[ " $* " == *" --json "* ]]; then echo "unknown flag: --json" >&2; exit 1; fi
if [[ " $* " == *" --watch "* ]]; then exit 1; fi
if [[ " $1 $2 " == " pr checks " ]]; then
  printf 'lint\tfail\t12s\thttps://github.com/o/r/actions/runs/1/job/111\n'
  printf 'check\tpass\t1m31s\thttps://github.com/o/r/actions/runs/2/job/222\n'
  exit 0
fi
if [[ " $1 $2 " == " run view " ]]; then seq 1 50; exit 0; fi
exit 0
`;

// head_state's `pr view` fails outright — the script must refuse to wait.
const GH_STUB_NOHEAD = `#!/usr/bin/env bash
echo "$*" >> "$GH_STUB_CALLS"
if [[ " $* " == *" headRefOid,state"* ]]; then echo "gh: not logged in" >&2; exit 1; fi
exit 0
`;

function runWaitCi(env: Record<string, string>, stub = GH_STUB) {
  const dir = mkdtempSync(join(tmpdir(), "wait-ci-"));
  writeFileSync(join(dir, "gh"), stub, { mode: 0o755 });
  return {
    dir,
    r: spawnSync("bash", ["scripts/conductor/wait-ci.sh", "123"], {
      encoding: "utf8",
      cwd: ROOT,
      env: {
        ...process.env,
        PATH: `${dir}:${process.env.PATH}`,
        GH_STUB_COUNT: join(dir, "count"),
        GH_STUB_VIEWCOUNT: join(dir, "viewcount"),
        GH_STUB_CALLS: join(dir, "calls"),
        GH_STUB_ANSWERS: "1",
        GH_STUB_VIEWS: "sha111 OPEN,sha111 OPEN",
        ...env,
      },
    }),
  };
}

describe("conductor shell scripts", () => {
  it("wait-ci waits for checks to appear", () => {
    const { dir, r } = runWaitCi({ WAIT_CI_POLL_S: "0", GH_STUB_ANSWERS: "0,0,2" });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.equal(readFileSync(join(dir, "count"), "utf8").trim(), "3");
    assert.match(r.stdout, /waiting on sha111/);
  });

  it("wait-ci exits 5 NO CHECKS when none register", () => {
    const { r } = runWaitCi({ WAIT_CI_POLL_S: "0", WAIT_CI_MAX_S: "0", GH_STUB_ANSWERS: "0" });
    assert.equal(r.status, 5);
    assert.match(r.stderr, /wait-ci: NO CHECKS/);
  });

  it("wait-ci exits 3 HEAD UNKNOWN when the head cannot be read at the start", () => {
    const { r } = runWaitCi({ WAIT_CI_POLL_S: "0" }, GH_STUB_NOHEAD);
    assert.equal(r.status, 3, r.stdout + r.stderr);
    assert.match(r.stdout, /wait-ci: HEAD UNKNOWN/);
    assert.doesNotMatch(r.stdout, /waiting on/);
  });

  it("wait-ci exits 3 HEAD UNKNOWN when the head read fails at the end", () => {
    const { r } = runWaitCi({ WAIT_CI_POLL_S: "0", GH_STUB_VIEWS: "sha111 OPEN,?" });
    assert.equal(r.status, 3, r.stdout + r.stderr);
    assert.match(r.stdout, /wait-ci: HEAD UNKNOWN/);
  });

  it("wait-ci exits 3 HEAD MOVED when the head changes", () => {
    const { r } = runWaitCi({
      WAIT_CI_POLL_S: "0",
      GH_STUB_VIEWS: "sha111 OPEN,sha222 OPEN",
    });
    assert.equal(r.status, 3, r.stdout + r.stderr);
    assert.match(r.stdout, /HEAD MOVED.*sha111.*sha222/);
  });

  it("wait-ci exits 3 HEAD MOVED when the PR merged mid-wait", () => {
    const { r } = runWaitCi({
      WAIT_CI_POLL_S: "0",
      GH_STUB_VIEWS: "sha111 OPEN,sha111 MERGED",
    });
    assert.equal(r.status, 3, r.stdout + r.stderr);
    assert.match(r.stdout, /HEAD MOVED.*merged/i);
  });

  it("wait-ci prints failing jobs from plain gh output", () => {
    const { dir, r } = runWaitCi({ WAIT_CI_POLL_S: "0" }, GH_STUB_FAILING);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /--- failing checks:\nlint\n/);
    const tail40 = Array.from({ length: 40 }, (_, i) => `${i + 11}`).join("\n");
    assert.ok(r.stdout.includes("--- job 111: last 40 failed-log lines\n" + tail40 + "\n"));
    const calls = readFileSync(join(dir, "calls"), "utf8");
    assert.match(calls, /run view --job 111 --log-failed/);
    assert.doesNotMatch(calls, /--job 222/);
  });

  it("argc guards exit 2", () => {
    for (const s of ["judge.sh", "wait-ci.sh", "build-prompt.sh"]) {
      const r = spawnSync("bash", [`scripts/conductor/${s}`], { encoding: "utf8", cwd: ROOT });
      assert.equal(r.status, 2, s);
      assert.match(r.stderr, /usage:/);
    }
  });

  it("build-prompt.sh unknown task exits 2", () => {
    const r = spawnSync("bash", ["scripts/conductor/build-prompt.sh", "task", "conductor", "99"], {
      encoding: "utf8",
      cwd: ROOT,
    });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /build-prompt\.sh:/);
  });

  it("build-prompt.sh emits the prohibitions block for task, review and fix", () => {
    for (const args of [
      ["task", "conductor", "0a"],
      ["review", "conductor", "0a", "1"],
      ["fix", "conductor", "0a", "1"],
    ]) {
      const r = spawnSync("bash", ["scripts/conductor/build-prompt.sh", ...args], {
        encoding: "utf8",
        cwd: ROOT,
      });
      assert.equal(r.status, 0, args.join(" ") + " stderr: " + r.stderr);
      for (const phrase of ["force-push", ".claude/", "review", "browsers", "baseline"])
        assert.ok(r.stdout.toLowerCase().includes(phrase.toLowerCase()), phrase);
      if (args[0] !== "fix") assert.match(r.stdout, /neophylo-(task|review)\/SKILL\.md/);
    }
  });

  it("build-prompt.sh review ends with a VERDICT contract", () => {
    const r = spawnSync(
      "bash",
      ["scripts/conductor/build-prompt.sh", "review", "conductor", "0a", "1"],
      { encoding: "utf8", cwd: ROOT },
    );
    assert.equal(r.status, 0);
    assert.match(r.stdout, /VERDICT: <APPROVE\|CHANGES REQUIRED>/);
  });

  it("build-prompt.sh fix names the plan path for an unmapped version", () => {
    const r = spawnSync(
      "bash",
      ["scripts/conductor/build-prompt.sh", "fix", "conductor", "0a", "163"],
      { encoding: "utf8", cwd: ROOT },
    );
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /docs\/superpowers\/plans\/2026-11-18-neophylo-conductor-efficiency\.md/);
    assert.match(r.stdout, /not in the skill's plan mapping/);
  });

  it("build-prompt.sh task and fix prompts ask for an unabbreviated git diff --stat", () => {
    for (const args of [
      ["task", "conductor", "0a"],
      ["fix", "conductor", "0a", "1"],
    ]) {
      const r = spawnSync("bash", ["scripts/conductor/build-prompt.sh", ...args], {
        encoding: "utf8",
        cwd: ROOT,
      });
      assert.equal(r.status, 0, args.join(" ") + " stderr: " + r.stderr);
      assert.match(r.stdout, /git diff --stat=400 --stat-name-width=400/);
    }
  });

  it("build-prompt.sh review inspects the PR without a worktree", () => {
    const r = spawnSync(
      "bash",
      ["scripts/conductor/build-prompt.sh", "review", "conductor", "0a", "1"],
      { encoding: "utf8", cwd: ROOT },
    );
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /gh pr diff/);
    assert.match(r.stdout, /git archive origin\//);
    assert.match(r.stdout, /tar -x -C target\/scratch\/rev1/);
    assert.doesNotMatch(r.stdout, /git worktree/);
  });

  it("devin.sh empty prompt exits 2 without calling devin", () => {
    const dir = mkdtempSync(join(tmpdir(), "devin-stub-"));
    const marker = join(dir, "devin-called");
    writeFileSync(join(dir, "devin"), `#!/usr/bin/env bash\ntouch "${marker}"\nexit 0\n`, {
      mode: 0o755,
    });
    const r = spawnSync("bash", ["scripts/conductor/devin.sh", "task", "conductor", "0a"], {
      encoding: "utf8",
      cwd: ROOT,
      input: "",
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, HOME: dir },
    });
    assert.equal(r.status, 2);
    assert.ok(!existsSync(marker), "devin must not be called on an empty prompt");
    assert.match(r.stderr, /empty prompt/);
  });
});
