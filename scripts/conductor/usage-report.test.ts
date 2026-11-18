import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import {
  loadSessions,
  sessionCost,
  totalCost,
  firstTurnContext,
  attributeTask,
  render,
  toJson,
} from "./usage-report.ts";

/**
 * usage-report.ts (conductor efficiency plan Task 0a): synthetic session
 * logs under fixtures/usage/ — never real ~/.claude logs (they contain
 * prompt bodies). The report prints aggregates only.
 */
const DIR = join(import.meta.dirname, "fixtures", "usage");

describe("usage-report.ts", () => {
  it("attributes a session by /conduct", () => {
    assert.equal(attributeTask(join(DIR, "sess-conduct.jsonl")), "v1.4c-task3");
    assert.equal(attributeTask(join(DIR, "sess-split.jsonl")), "v1.4-task0a");
  });

  it("attributes a session by devin.sh call", () => {
    assert.equal(attributeTask(join(DIR, "sess-devinsh.jsonl")), "v1.4b-task4");
    assert.equal(attributeTask(join(DIR, "sess-unattr.jsonl")), "unattributed");
  });

  it("attributes a session by neophylo-conductor path", () => {
    assert.equal(attributeTask(join(DIR, "sess-path.jsonl")), "v1.4-task7");
  });

  it("placeholder task ids are not attributed", () => {
    // "<N>" placeholders expanded into prompts ("v1.4 N", "v1.4-taskN")
    // are not task ids — the id must start with a digit.
    assert.equal(attributeTask(join(DIR, "sess-placeholder.jsonl")), "unattributed");
  });

  it("prices a session", () => {
    const [s] = loadSessions(DIR).filter((x) => x.id === "sess-conduct");
    // turn 1 opus: 1k in, 1M cache-read, 500k cache-write, 2k out
    //   = 0.004 + 0.20 + 4.00 + 0.04 = 4.244
    // turn 2 opus: 500 in, 2M cache-read, 0 cache-write, 1k out
    //   = 0.002 + 0.40 + 0.02 = 0.422
    assert.ok(Math.abs(sessionCost(s) - 4.666) < 1e-6);
    assert.equal(s.turns.length, 2);
  });

  it("dedups content blocks by message id", () => {
    const [s] = loadSessions(DIR).filter((x) => x.id === "sess-split");
    // msg_A is split over 3 lines (thinking/text/tool_use), each repeating
    // the same usage — count it once, the tool_use once.
    assert.equal(s.turns.length, 1);
    assert.equal(s.turns[0].input, 100);
    assert.equal(s.turns[0].output, 10);
    assert.ok(Math.abs(sessionCost(s) - 0.0006) < 1e-9); // (100×4 + 10×20)/1e6
    assert.equal(s.tools.get("bash"), 1);
    assert.equal([...s.tools.values()].reduce((a, b) => a + b, 0), 1);
  });

  it("first-turn context is the first assistant turn's input+cache", () => {
    const [s] = loadSessions(DIR).filter((x) => x.id === "sess-conduct");
    assert.equal(firstTurnContext(s), 1_501_000); // 1000 + 1M + 500k
  });

  it("subagent turns count toward the parent session by their own model", () => {
    const [s] = loadSessions(DIR).filter((x) => x.id === "sess-conduct");
    assert.equal(s.subagentTurns.length, 1);
    assert.equal(s.subagentTurns[0].modelKey, "haiku");
    // 4.666 + (1000×0.10 + 100×0.50)/1e6 = 4.66615; opus-only excludes it.
    assert.ok(Math.abs(totalCost(s) - 4.66615) < 1e-6);
    assert.ok(Math.abs(totalCost(s, true) - 4.666) < 1e-6);
  });

  it("prints aggregates only — no prompt or tool text", () => {
    const out = render(loadSessions(DIR), {});
    assert.ok(!out.includes("PROMPT_SENTINEL_A"));
    assert.ok(!out.includes("gh pr checks 12"));
    assert.ok(out.includes("v1.4c-task3"));
  });

  it("json output honours --version", () => {
    const parsed = JSON.parse(toJson(loadSessions(DIR), { version: "v1.4b" }));
    assert.deepEqual(
      parsed.sessions.map((s: { task: string }) => s.task),
      ["v1.4b-task4"],
    );
  });
});
