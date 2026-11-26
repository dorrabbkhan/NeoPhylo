// assignment_flow.spec.ts (v1.5 plan Task 8, spec §5.6, §7.1–7.3):
// the student flow end to end — id normalisation (Review Focus 2),
// practice checks and retries, test mode's silence, the graded
// stepper gate, the numeric spoiler rule, locked bootstrap
// controls, the stored code on reopen, and the coarse-pointer
// touch targets (conductor note 4). Runs on all three engines.
//
// Codes and task keys are verified with the real wasm engine in
// the test process (e2e/assess.ts) — the browser's copy is never
// trusted, and no number is recomputed in TypeScript (conductor
// note 5).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, test, type Page } from "@playwright/test";

import {
  assignmentLink,
  decodeCodeOrThrow,
  makeVariantOrThrow,
  numericKeyText,
} from "./assess";
import { matrixLabels, minQCell, readStep, waitForApp } from "./helpers";

const NJ_BASICS = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL("../../exercises/nj-basics.json", import.meta.url),
    ),
    "utf8",
  ),
) as unknown;

const BOOTSTRAP_BASICS = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL("../../exercises/bootstrap-basics.json", import.meta.url),
    ),
    "utf8",
  ),
) as unknown;

function flowAssignment(mode: "practice" | "test") {
  return {
    schema_version: 1,
    kind: "assignment",
    id: `e2e-flow-${mode}`,
    title: `E2E ${mode} assignment`,
    instructions: "Work through the lesson and answer the graded tasks.",
    content: { exercise: NJ_BASICS },
    id_prompt: { label: "university email", rule: "trim_lower" },
    mode,
    variation: true,
    tasks: [
      { task: { kind: "predict_pair", step: 1 } },
      {
        task: {
          kind: "numeric",
          step: 2,
          quantity: "q_value",
          role: "chosen",
        },
      },
    ],
  };
}

const BRANCH_ASSIGNMENT = {
  schema_version: 1,
  kind: "assignment",
  id: "e2e-branch",
  title: "E2E branch assignment",
  content: { exercise: BOOTSTRAP_BASICS },
  id_prompt: { label: "university email", rule: "trim_lower" },
  mode: "practice",
  variation: true,
  tasks: [{ task: { kind: "predict_branch" } }],
};

/** Enter the assignment through the start page. */
async function start(
  page: Page,
  assignment: unknown,
  studentId: string,
): Promise<void> {
  await page.goto(assignmentLink(assignment));
  await page.getByLabel(/university email/i).fill(studentId);
  await page.getByRole("button", { name: "Start" }).click();
  await waitForApp(page);
}

/** The locator index of an off-diagonal cell other than `avoid` —
 *  a wrong pick for the predict_pair gate. */
async function otherCell(page: Page, avoid: number): Promise<number> {
  const cells = page.locator('[role="gridcell"]');
  const count = await cells.count();
  for (let c = 0; c < count; c++) {
    if (c === avoid) continue;
    const cell = cells.nth(c);
    const i = Number(await cell.getAttribute("data-i"));
    const j = Number(await cell.getAttribute("data-j"));
    if (j > i) return c;
  }
  throw new Error("no alternative off-diagonal cell found");
}

test("id normalisation: differently-typed and non-ASCII ids (Review Focus 2)", async ({
  page,
}) => {
  const a = flowAssignment("practice");
  await page.goto(assignmentLink(a));

  // Empty id refused at entry (Review Focus 2's empty case).
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page.getByRole("alert")).toContainText(
    /university email/i,
  );

  // "  Ana.Lopez@Uni.EDU " normalises like "ana.lopez@uni.edu" —
  // both land on the same variant.
  await page.getByLabel(/university email/i).fill("  Ana.Lopez@Uni.EDU ");
  await page.getByRole("button", { name: "Start" }).click();
  await waitForApp(page);
  const labelsA = await matrixLabels(page);
  await page.getByRole("button", { name: "Finish" }).click();
  const codeA = await page.locator(".assess-code").innerText();
  expect(decodeCodeOrThrow(codeA).student_id).toBe("ana.lopez@uni.edu");

  await page.getByRole("button", { name: "Use a different ID" }).click();
  await page.getByLabel(/university email/i).fill("ana.lopez@uni.edu");
  await page.getByRole("button", { name: "Start" }).click();
  await waitForApp(page);
  expect(await matrixLabels(page)).toEqual(labelsA);

  // Non-ASCII ids work and grade (Review Focus 2).
  await page.getByRole("button", { name: "Use a different ID" }).click();
  await page.getByLabel(/university email/i).fill("josé");
  await page.getByRole("button", { name: "Start" }).click();
  await waitForApp(page);
  await page.getByRole("button", { name: "Finish" }).click();
  const codeJ = await page.locator(".assess-code").innerText();
  expect(decodeCodeOrThrow(codeJ).student_id).toBe("josé");
});

test("practice: wrong check retries, right checks, the code records first/last/attempts", async ({
  page,
}) => {
  const a = flowAssignment("practice");
  await start(page, a, "sara");

  // Position 0: the graded predict_pair sits where the lesson's own
  // predict_pair prompt gates — the card is marked, Next is blocked.
  const gate = page.locator(".assess-gate");
  await expect(gate).toContainText("Graded task");
  await expect(gate).toContainText(
    "Predict the pair joined at step 1",
  );
  const next = page.getByRole("button", { name: "Next step" });
  await expect(next).toBeDisabled();

  // A wrong pick feeds the lesson prompt (verdict sealed — §7.2
  // "no answer-key links") and the graded draft.
  const right = await minQCell(page);
  const wrong = await otherCell(page, right);
  await page.locator('[role="gridcell"]').nth(wrong).click();
  await expect(page.locator(".prompt-verdict.wrong")).toHaveText(
    /Not quite\.?/,
  );
  // §7.2: nothing inside the assignment names an answer or offers
  // an instructor path — the prompt's verdict, its Show-pair
  // button and any "instructor" affordance all stay hidden.
  await expect(page.locator(".prompts")).not.toContainText(
    /the answer is/i,
  );
  await expect(page.locator(".prompt-show-pair")).toHaveCount(0);
  await expect(page.locator(".assess-page")).not.toContainText(
    /instructor/i,
  );

  const check = page.getByRole("button", { name: "Check" });
  await check.click();
  await expect(page.locator(".assess-verdict-bad")).toContainText(
    "Not quite",
  );

  // Retry with the genuinely correct pair — the Q-cell minimum.
  await page.locator('[role="gridcell"]').nth(right).click();
  await check.click();
  await expect(page.locator(".assess-verdict-good")).toContainText(
    "Correct",
  );
  await next.click();
  expect((await readStep(page)).k).toBe(1);

  // Position 1: the numeric gate. Type the engine's value and check.
  const variant = makeVariantOrThrow(a, "sara");
  const qText = numericKeyText(variant, a.tasks[1].task as never);
  await page.locator(".assess-gate-input").fill(qText);
  await check.click();
  await expect(page.locator(".assess-verdict-good")).toContainText(
    "Correct",
  );
  await next.click();

  // Finish → practice score + the code carries first/last/attempts.
  await page.getByRole("button", { name: "Finish" }).click();
  await expect(page.locator(".assess-finish")).toContainText(
    "Score: 2 of 2",
  );
  const code = await page.locator(".assess-code").innerText();
  const payload = decodeCodeOrThrow(code);
  expect(payload.student_id).toBe("sara");
  expect(payload.attempts).toHaveLength(2);
  const pairAttempt = payload.attempts[0];
  expect(pairAttempt.attempts).toBe(2);
  expect(pairAttempt.first.kind).toBe("pair");
  // last differs from first — the recorded retry.
  expect(pairAttempt.last?.kind).toBe("pair");
  if (pairAttempt.first.kind === "pair" && pairAttempt.last?.kind === "pair") {
    expect(pairAttempt.last.value).not.toEqual(pairAttempt.first.value);
  }
});

test("test mode: no right/wrong marks before Finish, a summary after", async ({
  page,
}) => {
  const a = flowAssignment("test");
  await start(page, a, "sam");

  // Test mode: the gate takes the answer but offers no Check and
  // no verdict (spec §5.6).
  const gate = page.locator(".assess-gate");
  await expect(gate).toContainText(
    "Predict the pair joined at step 1",
  );
  await expect(page.getByRole("button", { name: "Check" })).toHaveCount(0);
  const right = await minQCell(page);
  await page.locator('[role="gridcell"]').nth(right).click();
  await expect(gate).toContainText("Your answer:");
  await expect(page.locator(".assess-verdict-good")).toHaveCount(0);
  await expect(page.locator(".assess-verdict-bad")).toHaveCount(0);
  // §7.2: the pick also feeds the lesson's own prompt at this step —
  // in test mode even that card renders no verdict element at all:
  // no class, no text, nothing announced through an aria-live region.
  // ("Correct" is word-bounded — the Controls' "Correction" distance
  // model is real text that stays on the page.)
  await expect(page.locator(".prompt-verdict")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(
    /\bcorrect\b|\bnot quite\b/i,
  );
  await expect(
    page.locator("[aria-live]", {
      hasText: /\bcorrect\b|\bnot quite\b/i,
    }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Next step" }).click();

  const variant = makeVariantOrThrow(a, "sam");
  const qText = numericKeyText(variant, a.tasks[1].task as never);
  await page.locator(".assess-gate-input").fill(qText);
  await page.getByRole("button", { name: "Next step" }).click();

  await page.getByRole("button", { name: "Finish" }).click();
  await expect(page.locator(".assess-finish")).toContainText(
    "answers are recorded",
  );
  await expect(page.locator(".assess-finish")).not.toContainText(
    /Score:/,
  );
  await expect(
    page.getByRole("button", { name: /Copy/ }),
  ).toBeVisible();
  const payload = decodeCodeOrThrow(
    await page.locator(".assess-code").innerText(),
  );
  expect(payload.student_id).toBe("sam");
});

test("a committed answer cannot be changed after advancing", async ({
  page,
}) => {
  const a = flowAssignment("practice");
  await start(page, a, "sam");

  const right = await minQCell(page);
  await page.locator('[role="gridcell"]').nth(right).click();
  await page.getByRole("button", { name: "Next step" }).click();
  expect((await readStep(page)).k).toBe(1);

  // Back at position 0 the gate is sealed — no Check, no input,
  // and the committed answer is shown read-only (spec §5.6).
  await page.getByRole("button", { name: "Previous step" }).click();
  const gate = page.locator(".assess-gate");
  await expect(gate).toContainText("Answer locked in.");
  await expect(gate).toContainText("Your answer:");
  await expect(page.getByRole("button", { name: "Check" })).toHaveCount(0);
  await expect(page.locator(".assess-gate-input")).toHaveCount(0);
});

test("an open numeric task hides its quantity while the distance matrix stays visible", async ({
  page,
}) => {
  const a = flowAssignment("practice");
  await start(page, a, "sara");

  // Answer the position-0 pair gate, then land on the numeric task.
  await page.locator('[role="gridcell"]').nth(await minQCell(page)).click();
  await page.getByRole("button", { name: "Next step" }).click();
  expect((await readStep(page)).k).toBe(1);
  const gate = page.locator(".assess-gate");
  await expect(gate).toContainText("Work out the Q-value");

  // The hidden quantity (the engine's accepted answer at display
  // precision) appears in no DOM text, tooltip or aria attribute —
  // not only in what is visible (conductor note 7).
  const variant = makeVariantOrThrow(a, "sara");
  const hidden = numericKeyText(variant, a.tasks[1].task as never);
  const leaks = await page
    .locator("body")
    .evaluateAll((els, needle) => {
      const found: string[] = [];
      const re = /[-+]?\d+\.\d+/;
      void re;
      for (const root of els) {
        for (const el of root.querySelectorAll("*")) {
          const label = el.getAttribute("aria-label") ?? "";
          const title = el.getAttribute("title") ?? "";
          for (const s of [label, title]) {
            if (s.includes(needle)) {
              found.push(`${el.tagName.toLowerCase()}: ${s.slice(0, 80)}`);
            }
          }
          if (el.childElementCount === 0) {
            const t = el.textContent ?? "";
            if (t.includes(needle)) {
              found.push(`${el.tagName.toLowerCase()}: ${t.slice(0, 80)}`);
            }
          }
        }
      }
      return found;
    }, hidden);
  expect(
    leaks,
    `hidden quantity ${hidden} leaked in: ${leaks.join(" | ")}`,
  ).toEqual([]);

  // The inputs stay visible: the distance matrix is on screen and
  // the Distance/Q switch is disabled while the task is open.
  await expect(page.locator('[role="gridcell"]').first()).toBeVisible();
  await expect(
    page.getByRole("switch", { name: "Distance / Q" }),
  ).toBeDisabled();
});

test("a predict_branch task locks the bootstrap controls at ≤200 replicates", async ({
  page,
}) => {
  await start(page, BRANCH_ASSIGNMENT, "sara");
  // The sim section carries its own "Seed" field — scope to the
  // bootstrap panel so the label resolves to one control.
  const panel = page.getByRole("region", { name: "How sure are we?" });
  const replicates = panel.getByLabel("Replicates");
  await expect(replicates).toBeDisabled();
  const n = Number(await replicates.inputValue());
  expect(n).toBeGreaterThan(0);
  expect(n).toBeLessThanOrEqual(200);
  await expect(panel.getByLabel("Seed")).toBeDisabled();
  // The run stays gated until a branch is picked — the graded
  // task's draft is what unlocks it.
  await expect(page.locator(".assess-gate")).toContainText(
    "Predict the least-supported grouping",
  );
});

test("reopening the link after Finish shows the same stored code", async ({
  page,
}) => {
  const a = flowAssignment("practice");
  await start(page, a, "sara");
  await page.getByRole("button", { name: "Finish" }).click();
  const code = await page.locator(".assess-code").innerText();
  await expect(
    page.getByRole("button", { name: /Copy/ }),
  ).toBeVisible();

  await page.reload();
  // Exactly one stored student → the flow resumes straight to the
  // finished page with the same code (spec §7.3).
  await expect(page.locator(".assess-finish")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.locator(".assess-code")).toHaveText(code);
  await expect(
    page.getByRole("button", { name: /Copy/ }),
  ).toBeVisible();
});

test.describe("coarse-pointer touch targets", () => {
  test.use({
    hasTouch: true,
    viewport: { width: 375, height: 812 },
  });

  /** Every listed control ≥40×40 (Gecko tolerance 39.95 — the same
   *  unit-conversion slack narrow.spec.ts allows). */
  async function expectBig(page: Page, what: string): Promise<void> {
    const box = await page.locator(what).first().boundingBox();
    expect(box, `${what} renders`).not.toBeNull();
    expect(
      box!.width,
      `${what} at least 40 px wide (got ${box!.width}×${box!.height})`,
    ).toBeGreaterThanOrEqual(39.95);
    expect(
      box!.height,
      `${what} at least 40 px tall (got ${box!.width}×${box!.height})`,
    ).toBeGreaterThanOrEqual(39.95);
  }

  test("every new assignment control is ≥40×40 under a coarse pointer", async ({
    page,
  }) => {
    const a = flowAssignment("practice");
    await page.goto(`${assignmentLink(a)}`.replace("/#", "/?embed#"));
    // Start page: the id input, Start and the embed's new-tab link.
    await expectBig(page, ".assess-id-input");
    await expectBig(page, ".assess-start-btn");
    await expectBig(page, ".assess-page a[target='_blank'], .assess-start a[target='_blank']");

    await page.getByLabel(/university email/i).fill("sara");
    await page.getByRole("button", { name: "Start" }).click();
    await waitForApp(page);

    // Working: Finish, the gate's Check, the numeric input and the
    // stepper's gated Next all meet the floor.
    await expectBig(page, ".assess-finish-btn");
    await page.locator('[role="gridcell"]').nth(await minQCell(page)).click();
    await expectBig(page, ".assess-check");
    await expectBig(page, '[aria-label="Next step"]');
    await page.getByRole("button", { name: "Next step" }).click();
    await expectBig(page, ".assess-gate-input");

    await page.getByRole("button", { name: "Finish" }).click();
    await expectBig(page, ".assess-copy");
  });

  test("the library copy-assignment-text control and its LMS choices are ≥40×40", async ({
    page,
  }) => {
    await page.goto("/?library");
    const toggle = page.locator(".lib-copy-toggle").first();
    await expect(toggle).toBeVisible({ timeout: 30_000 });
    await expectBig(page, ".lib-copy-toggle");
    // The paper-worksheet pass lands asynchronously and adds the
    // "Paper worksheet"/"Answer key" links to every card's action row
    // at once — the reflow moves the toggle under a real click (the
    // Firefox flake at this line: the dispatched click missed, so no
    // panel ever mounted). The "Answer key" link exists only once
    // `paper` has resolved — wait for it, and for the fonts that
    // settle the same text metrics.
    await expect(
      page
        .locator(".lib-card")
        .first()
        .getByRole("link", { name: "Answer key" }),
    ).toBeVisible({ timeout: 30_000 });
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await toggle.click();
    const choices = page.locator(".lib-copy-choice");
    // The panel mounts on the toggle's React update — wait for the
    // first choice rather than racing the render (Gecko was slower).
    await expect(choices.first()).toBeVisible();
    const count = await choices.count();
    expect(count).toBeGreaterThanOrEqual(4);
    for (let i = 0; i < count; i++) {
      const box = await choices.nth(i).boundingBox();
      expect(box, "LMS choice renders").not.toBeNull();
      expect(
        box!.width,
        `LMS choice ${i} ≥40 wide (got ${box!.width}×${box!.height})`,
      ).toBeGreaterThanOrEqual(39.95);
      expect(
        box!.height,
        `LMS choice ${i} ≥40 tall (got ${box!.width}×${box!.height})`,
      ).toBeGreaterThanOrEqual(39.95);
    }
  });
});

// The working view is viewport-locked like the plain lesson view
// (fix round 1, spec §6.1/§7.4): the stepper footer pins to the
// viewport bottom instead of sitting below the fold of a scrolling
// page — checked framed and unframed at the two fold-prone sizes.
test.describe("the stepper footer pins inside the viewport", () => {
  for (const embed of [false, true] as const) {
    for (const vp of [
      { width: 1024, height: 768 },
      { width: 768, height: 1024 },
    ]) {
      test(`${vp.width}×${vp.height}${embed ? " (embed)" : ""}`, async ({
        page,
      }) => {
        await page.setViewportSize(vp);
        const a = flowAssignment("practice");
        const link = assignmentLink(a);
        await page.goto(
          embed ? `${link}`.replace("/#", "/?embed#") : link,
        );
        await page.getByLabel(/university email/i).fill("sara");
        await page.getByRole("button", { name: "Start" }).click();
        await waitForApp(page);

        const next = page.getByRole("button", { name: "Next step" });
        const box = await next.boundingBox();
        expect(box, "the Next step button renders").not.toBeNull();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.y).toBeGreaterThanOrEqual(0);
        expect(
          box!.x + box!.width,
          "Next step's right edge inside the viewport",
        ).toBeLessThanOrEqual(vp.width);
        expect(
          box!.y + box!.height,
          "Next step's bottom edge inside the viewport",
        ).toBeLessThanOrEqual(vp.height);

        // No page scrolling: the document is viewport-locked — it
        // neither overflows nor can it be scrolled.
        const metrics = await page.evaluate(() => ({
          y: window.scrollY,
          scrollHeight: document.documentElement.scrollHeight,
        }));
        expect(metrics.y, "the document is not scrolled").toBe(0);
        expect(
          metrics.scrollHeight,
          `the document fits ${vp.height}px (got ${metrics.scrollHeight})`,
        ).toBeLessThanOrEqual(vp.height);
      });
    }
  }
});
