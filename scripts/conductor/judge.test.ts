import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main, runJudge, type JudgeResult } from "./judge.ts";

/**
 * judge.ts — the mechanical half of CLAUDE.md "Judgment rules" (conductor
 * efficiency plan Task 0a). One seeded diff per case under fixtures/judge/;
 * --diff-file/--plan/--claimed/--events run fully offline (no gh, no network).
 */
const ROOT = join(import.meta.dirname, "..", "..");
const FIX = join(import.meta.dirname, "fixtures", "judge");
const PLAN = join(FIX, "plan.md");

function judge(diff: string, extra: Partial<Parameters<typeof runJudge>[0]> = {}): JudgeResult {
  return runJudge({
    version: "v9.9",
    task: "1",
    diffFile: join(FIX, diff),
    plan: PLAN,
    title: "chore(conductor): judge script, waits, prompt builder, usage report",
    reportDir: mkdtempSync(join(tmpdir(), "judge-test-")),
    ...extra,
  });
}

const line = (r: JudgeResult, id: string) =>
  r.stdout.split("\n").find((l) => l.includes(` ${id} `) || l.endsWith(` ${id}`));
const events = (name: string) => readFileSync(join(FIX, name), "utf8");

// The plan's 12 check ids in plan order — stdout carries exactly these.
const PLAN_ORDER = [
  "fixtures",
  "numbers",
  "assertions",
  "skips",
  "files-block",
  "engine-rules",
  "content-numbers",
  "protected-paths",
  "secrets",
  "diff-stat",
  "pr-events",
  "owner-gate",
];
const checkIds = (r: JudgeResult) =>
  r.stdout
    .split("\n")
    .filter((l) => /^(?:PASS|FLAG|N\/A) /.test(l))
    .map((l) => l.split(" ")[1]);

describe("judge.ts (conductor efficiency plan Task 0a)", () => {
  it("fixture change flags", () => {
    const r = judge("fixture-change.diff");
    assert.equal(r.exitCode, 1);
    assert.match(line(r, "fixtures")!, /^FLAG fixtures .*fixtures\/cytochrome-c\/dist\.json/);
  });

  it("snapshot baseline change flags", () => {
    const r = judge("screenshot-change.diff");
    assert.match(line(r, "fixtures")!, /^FLAG fixtures .*__screenshots__\/tree\.png/);
  });

  it("url corpus edit flags", () => {
    const r = judge("url-corpus.diff");
    assert.match(line(r, "fixtures")!, /^FLAG fixtures .*__fixtures__\/old-links\.json/);
  });

  it("tolerance number change flags", () => {
    const r = judge("tolerance.diff");
    assert.match(line(r, "numbers")!, /^FLAG numbers .*dist\.rs.*1e-9.*→.*1e-8/);
  });

  it("maxDiffPixelRatio change flags", () => {
    const r = judge("maxdiff-ratio.diff");
    assert.match(line(r, "numbers")!, /^FLAG numbers .*playwright\.config\.ts.*0\.001.*→.*0\.002/);
  });

  it("bundle budget change flags", () => {
    const r = judge("bundle-budget.diff");
    assert.match(line(r, "numbers")!, /^FLAG numbers .*check-bundle-size\.sh.*200.*→.*250/);
  });

  it("numbers prints file:line when removed/added counts differ", () => {
    const r = judge("numbers-unequal.diff");
    assert.match(
      line(r, "numbers")!,
      /^FLAG numbers .*limits\.ts:2 numbers changed \(300, 5 → 600\)/,
    );
  });

  it("removed assert flags", () => {
    const r = judge("removed-assert.diff");
    assert.match(line(r, "assertions")!, /^FLAG assertions .*removed.*added/);
  });

  it("assert_eq weakened to assert flags", () => {
    const r = judge("weakened-assert.diff");
    assert.match(line(r, "assertions")!, /^FLAG assertions .*assert_eq.*assert/);
  });

  it("exact matcher weakened flags", () => {
    const r = judge("weakened-matcher.diff");
    assert.match(line(r, "assertions")!, /^FLAG assertions .*toMatchObject/);
  });

  it("toBeCloseTo precision reduced flags", () => {
    const r = judge("close-precision.diff");
    assert.match(line(r, "assertions")!, /^FLAG assertions .*toBeCloseTo/);
  });

  it("added ignore attribute flags", () => {
    const r = judge("added-ignore.diff");
    assert.match(line(r, "skips")!, /^FLAG skips .*ignore/);
  });

  it("regen_golden ignore passes", () => {
    const r = judge("regen-ignore.diff");
    assert.match(line(r, "skips")!, /^PASS skips/);
  });

  it("added .only flags", () => {
    const r = judge("added-only.diff");
    assert.match(line(r, "skips")!, /^FLAG skips .*only/);
  });

  it("file outside Files block without decisions entry flags", () => {
    const r = judge("extra-file.diff");
    assert.match(line(r, "files-block")!, /^FLAG files-block .*src\/extra\.ts/);
  });

  it("file outside Files block with decisions entry passes", () => {
    const r = judge("extra-file-decisions.diff");
    assert.match(line(r, "files-block")!, /^PASS files-block/);
  });

  it("brace and bare names in Files block resolve", () => {
    const r = judge("brace-bare.diff");
    assert.match(line(r, "files-block")!, /^PASS files-block/);
  });

  it("glob question mark matches one char, dots are literal", () => {
    assert.match(line(judge("glob-question.diff"), "files-block")!, /^PASS files-block/);
    assert.match(
      line(judge("glob-question-two.diff"), "files-block")!,
      /^FLAG files-block .*src\/glob-ab\.ts/,
    );
    assert.match(
      line(judge("glob-dots.diff"), "files-block")!,
      /^FLAG files-block .*src\/foo1test2ts/,
    );
  });

  it("Math.random flags", () => {
    const r = judge("math-random.diff");
    assert.match(line(r, "engine-rules")!, /^FLAG engine-rules .*Math\.random/);
  });

  it("unwrap in engine src flags, in cfg(test) passes", () => {
    assert.match(line(judge("unwrap-engine.diff"), "engine-rules")!, /^FLAG engine-rules .*unwrap/);
    assert.match(line(judge("unwrap-test.diff"), "engine-rules")!, /^PASS engine-rules/);
  });

  it("generated types edited without crates change flags", () => {
    assert.match(
      line(judge("generated-edit.diff"), "engine-rules")!,
      /^FLAG engine-rules .*generated/,
    );
    assert.match(line(judge("generated-with-crates.diff"), "engine-rules")!, /^PASS engine-rules/);
  });

  it("edited existing proptest flags, new fn passes", () => {
    assert.match(
      line(judge("proptest-edit.diff"), "engine-rules")!,
      /^FLAG engine-rules .*proptest/,
    );
    assert.match(line(judge("proptest-new.diff"), "engine-rules")!, /^PASS engine-rules/);
  });

  it("digits added to lesson prompt text flag", () => {
    const r = judge("lesson-digits.diff");
    assert.match(line(r, "content-numbers")!, /^FLAG content-numbers .*bootstrap-basics\.json/);
  });

  it(".claude change flags, .devin named in Files block passes", () => {
    assert.match(
      line(judge("claude-change.diff"), "protected-paths")!,
      /^FLAG protected-paths .*\.claude\/settings\.json/,
    );
    assert.match(line(judge("devin-named.diff"), "protected-paths")!, /^PASS protected-paths/);
    const lic = line(judge("license-change.diff"), "protected-paths")!;
    assert.match(lic, /^FLAG protected-paths .*LICENSE-MIT/);
    assert.ok(lic.includes("LICENSES/THIRD-PARTY.md"), lic);
  });

  it("api key literal flags", () => {
    const r = judge("api-key.diff");
    assert.match(line(r, "secrets")!, /^FLAG secrets .*key\/token.*x\.sh:2/);
    assert.ok(!line(r, "secrets")!.includes("sk-ant"), "never echo the matched text");
  });

  it("diff stat mismatch with claimed files flags", () => {
    const r = judge("clean.diff", { claimed: join(FIX, "claimed-mismatch.out.md") });
    assert.match(line(r, "diff-stat")!, /^FLAG diff-stat .*other\.ts/);
  });

  it("diff stat flags a claimed file absent from the diff", () => {
    const r = judge("clean.diff", { claimed: join(FIX, "claimed-extra.out.md") });
    assert.match(
      line(r, "diff-stat")!,
      /^FLAG diff-stat claimed but absent from diff: src\/ghost\.ts$/,
    );
  });

  it("diff-stat unions all session stats (owner decision, PR #163 follow-up)", () => {
    const dir = mkdtempSync(join(tmpdir(), "judge-claimed-"));
    writeFileSync(
      join(dir, "task-20261101-000000.out.md"),
      "task output\n\n src/foo.ts | 3 ++-\n 1 file changed, 2 insertions(+), 1 deletion(-)\n",
    );
    writeFileSync(
      join(dir, "fix-20261102-000000.out.md"),
      "fix output\n\n src/foo.test.ts | 3 ++-\n docs/decisions.md | 3 ++-\n" +
        " 2 files changed, 4 insertions(+), 2 deletions(-)\n",
    );
    // a review's stat block never joins the union
    writeFileSync(
      join(dir, "review-20261103-000000.out.md"),
      "review output\n\n src/review-only.ts | 1 +\n 1 file changed, 1 insertion(+)\n",
    );
    const r = judge("clean.diff", { reportDir: dir });
    assert.match(line(r, "diff-stat")!, /^PASS diff-stat/);
    assert.ok(!r.report.includes("review-only"), r.report);
    // repeated --claimed unions the same way
    const r2 = judge("clean.diff", {
      claimed: [
        join(dir, "task-20261101-000000.out.md"),
        join(dir, "fix-20261102-000000.out.md"),
      ],
    });
    assert.match(line(r2, "diff-stat")!, /^PASS diff-stat/);
  });

  it("abbreviated stat block flags", () => {
    const r = judge("clean.diff", { claimed: join(FIX, "claimed-abbreviated.out.md") });
    assert.match(
      line(r, "diff-stat")!,
      /^FLAG diff-stat abbreviated git diff --stat path in claimed-abbreviated\.out\.md/,
    );
  });

  it("unparseable stat block flags naming the file", () => {
    const r = judge("clean.diff", { claimed: join(FIX, "claimed-unparseable.out.md") });
    assert.match(
      line(r, "diff-stat")!,
      /^FLAG diff-stat unparseable git diff --stat block in claimed-unparseable\.out\.md/,
    );
  });

  it("force push event flags", () => {
    const r = judge("clean.diff", {
      claimed: join(FIX, "claimed-clean.out.md"),
      events: events("events-force-push.json"),
    });
    assert.match(line(r, "pr-events")!, /^FLAG pr-events .*force/);
  });

  it("bot self-approval flags", () => {
    const r = judge("clean.diff", {
      claimed: join(FIX, "claimed-clean.out.md"),
      events: events("events-self-approve.json"),
    });
    assert.match(line(r, "pr-events")!, /^FLAG pr-events .*self-approval/);
    const clean = judge("clean.diff", {
      claimed: join(FIX, "claimed-clean.out.md"),
      events: events("events-clean.json"),
    });
    assert.match(line(clean, "pr-events")!, /^PASS pr-events/);
  });

  it("owner gate title, gate column or spec file flags owner-gate", () => {
    const byTitle = judge("clean.diff", {
      claimed: join(FIX, "claimed-clean.out.md"),
      title: "[OWNER REVIEW] chore(conductor): x",
    });
    assert.match(line(byTitle, "owner-gate")!, /^FLAG owner-gate .*title/);
    const byColumn = judge("clean.diff", {
      claimed: join(FIX, "claimed-clean.out.md"),
      task: "2",
    });
    assert.match(line(byColumn, "owner-gate")!, /^FLAG owner-gate .*[Gg]ate/);
    const byFile = judge("spec-change.diff");
    assert.match(line(byFile, "owner-gate")!, /^FLAG owner-gate .*specs\/lesson-design\.md/);
  });

  it("clean task diff passes all", () => {
    const r = judge("clean.diff", { claimed: join(FIX, "claimed-clean.out.md") });
    assert.equal(r.exitCode, 0, r.stdout);
    assert.match(r.stdout, /JUDGE: PASS/);
    assert.deepEqual(checkIds(r), PLAN_ORDER);
    assert.ok(r.stdout.split("\n").filter(Boolean).length <= 60);
  });

  it("unparseable diff flags, never passes", () => {
    const r = judge("unparseable.diff");
    assert.equal(r.exitCode, 1);
    assert.match(line(r, "secrets")!, /^FLAG secrets .*could not inspect/);
    assert.match(line(r, "assertions")!, /^FLAG assertions .*could not inspect/);
    assert.deepEqual(checkIds(r), PLAN_ORDER);
    assert.match(r.stdout, /^JUDGE: FLAG \(\d+\)$/m);
  });

  it("stdout lists at most five items per check", () => {
    const r = judge("many-files.diff", { claimed: join(FIX, "claimed-clean.out.md") });
    const fb = line(r, "files-block")!;
    const items = fb.replace(/^FLAG files-block /, "").split("; ");
    assert.equal(items.filter((i) => !i.startsWith("(+")).length, 5, fb);
    assert.match(items[items.length - 1], /^\(\+2 more in the report\)$/);
    assert.match(line(r, "diff-stat")!, /\(\+5 more in the report\)/);
    for (const p of ["src/extra6.ts", "src/extra7.ts"]) assert.ok(r.report.includes(p), p);
  });

  it("long reason is never cut mid-item", () => {
    const l = line(judge("long-reason.diff"), "numbers")!;
    assert.ok(l.includes("0.77777] };"), l);
    assert.ok(!l.includes("…"), l);
  });

  it("diff fetch failure flags every check; error goes to the report header", () => {
    const r = runJudge(
      {
        pr: "999999",
        version: "v9.9",
        task: "1",
        plan: PLAN,
        title: "chore(conductor): x",
        reportDir: mkdtempSync(join(tmpdir(), "judge-test-")),
      },
      {
        fetchDiff: () => {
          throw new Error("HTTP 406: diff too large\nresponse body");
        },
      },
    );
    assert.equal(r.exitCode, 1);
    assert.deepEqual(checkIds(r), PLAN_ORDER);
    for (const l of r.stdout.split("\n").filter((l) => l.startsWith("FLAG ")))
      assert.match(l, /could not run: could not fetch PR diff: HTTP 406: diff too large/);
    assert.match(r.report, /^diff: could not fetch PR diff: HTTP 406: diff too large$/m);
    assert.match(r.report, /^files: 0 parsed/m);
  });

  it("missing args exit 2", () => {
    assert.equal(main(["--pr", "1"]), 2);
    assert.equal(main(["--bogus", "x", "--task", "1"]), 2);
    assert.equal(main(["--task", "1", "--diff-file"]), 2);
  });
});

