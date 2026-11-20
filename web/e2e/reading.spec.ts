// Reading-area e2e (v1.4d plan Task 8, spec §4.3–§4.5, §6.5, §7):
// every question type in exercises/reading/trees-demo.json answered
// wrong then right — once by mouse and once by keyboard — so the
// retry-after-wrong path is covered along with the controls. The
// rotate tool runs on a which_differs item (and on an answered MRCA
// item, pinning selection stability across rotation, Review Focus
// 4); a test-mode set driven through #r= reaches the summary without
// ever showing a verdict before Finish; the page is axe-clean and
// never scrolls sideways at 360 px. Touch coverage is real CDP
// taps resolved through elementFromPoint, never a drag (§6.5).
//
// Verdicts and explanations are always the engine's — these tests
// assert the strings readingCheck returns, never recompute answers.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { test, expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";
import lzstring from "lz-string";

const DEMO_URL = "/?read=trees-demo";

const demoSet = JSON.parse(
  readFileSync(
    resolve("..", "exercises", "reading", "trees-demo.json"),
    "utf8",
  ),
) as { items: unknown[]; mode: string; id: string; title: string };

/* ---- navigation --------------------------------------------------------- */

/** Deep-link straight to an item by clicking Next index times. */
async function gotoItem(page: Page, index: number): Promise<void> {
  await page.goto(DEMO_URL);
  await expect(
    page.getByText(/Question 1 of \d+/),
    "the reading area loads the demo set",
  ).toBeVisible();
  for (let i = 0; i < index; i += 1) {
    await page.getByRole("button", { name: "Next" }).click();
  }
  await expect(
    page.getByText(`Question ${index + 1} of`),
  ).toBeVisible();
}

const verdict = (page: Page) =>
  page.getByRole("status", { name: "Verdict" });

/** Check, then assert the engine's verdict — the retry path keeps
 * the Check button live after a wrong answer. */
async function checkExpect(
  page: Page,
  ok: boolean,
  how: Input,
): Promise<void> {
  await act(page.getByRole("button", { name: "Check" }), how);
  await expect(verdict(page)).toBeVisible();
  if (ok) {
    await expect(verdict(page)).toContainText("Correct.");
    await expect(verdict(page)).not.toContainText("Not correct");
  } else {
    await expect(verdict(page)).toContainText("Not correct");
  }
}

/* ---- input drivers ------------------------------------------------------- */

type Input = "mouse" | "keyboard";
type Driver = (page: Page, how: Input) => Promise<void>;

/** Pointer click, or focus + the element's activation key: Space on
 * radios/checkboxes, Enter everywhere else. */
async function act(
  loc: Locator,
  how: Input,
  toggle = false,
): Promise<void> {
  if (how === "mouse") await loc.click();
  else await loc.press(toggle ? " " : "Enter");
}

const firstFig = (page: Page) => page.locator(".rt-figure").first();
const tip = (page: Page, t: string) =>
  firstFig(page).locator(
    `.rt-hit[data-kind="tip"][data-clade='${JSON.stringify([t])}']`,
  );
const node = (page: Page, clade: string[]) =>
  firstFig(page).locator(
    `.rt-hit[data-kind="node"][data-clade='${JSON.stringify(
      [...clade].sort(),
    )}']`,
  );
const point = (page: Page, letter: string) =>
  firstFig(page).locator(`.rt-point-hit[data-letter="${letter}"]`);

const pickRadio =
  (name: string | RegExp): Driver =>
  async (page, how) => {
    await act(page.getByRole("radio", { name }), how, true);
  };

const tapTip =
  (t: string): Driver =>
  async (page, how) => {
    await act(tip(page, t), how);
  };
const tapNode =
  (clade: string[]): Driver =>
  async (page, how) => {
    await act(node(page, clade), how);
  };
const tapPoint =
  (letter: string): Driver =>
  async (page, how) => {
    await act(point(page, letter), how);
  };

/** Compose drivers (e.g. several tip taps or a radio plus a reason). */
const seq =
  (...drivers: Driver[]): Driver =>
  async (page, how) => {
    for (const d of drivers) await d(page, how);
  };

const checkBoxes =
  (names: (string | RegExp)[]): Driver =>
  async (page, how) => {
    for (const name of names) {
      const c = page.getByRole("checkbox", { name });
      if (!(await c.isChecked())) await act(c, how, true);
    }
  };
const uncheckBoxes =
  (names: (string | RegExp)[]): Driver =>
  async (page, how) => {
    for (const name of names) {
      const c = page.getByRole("checkbox", { name });
      if (await c.isChecked()) await act(c, how, true);
    }
  };

const addOrder =
  (letters: string[]): Driver =>
  async (page, how) => {
    for (const l of letters) {
      await act(
        page.getByRole("button", { name: new RegExp(`^Add node ${l}`) }),
        how,
      );
    }
  };
const clearOrder =
  (): Driver =>
  async (page, how) => {
    const rm = page.locator(
      '.read-order-row button[aria-label^="Remove "]',
    );
    while ((await rm.count()) > 0) {
      await act(rm.first(), how);
    }
  };

/** The count_clades stepper: mouse steps the buttons; keyboard types
 * into the spinbutton after select-all. */
const numberTo =
  (v: number): Driver =>
  async (page, how) => {
    const input = page.getByRole("spinbutton", { name: "Answer" });
    if (how === "keyboard") {
      await input.focus();
      await input.press("ControlOrMeta+A");
      await input.pressSequentially(String(v));
      return;
    }
    const raw = await input.inputValue();
    const cur = raw === "" ? 0 : parseInt(raw, 10);
    const diff = v - cur;
    if (diff === 0) return;
    const btn = page.getByRole("button", {
      name: diff > 0 ? "Increase" : "Decrease",
    });
    for (let i = 0; i < Math.abs(diff); i += 1) await btn.click();
  };

/* ---- the demo items ------------------------------------------------------- */

const MAMMALS = ["bear", "cat", "chimp", "dog", "gibbon", "gorilla", "human", "seal"];
const HOMINOID = ["chimp", "gibbon", "gorilla", "human"]; // node P

const ITEMS: {
  id: string;
  index: number;
  wrong: Driver;
  right: Driver;
}[] = [
  {
    id: "q-differs",
    index: 0,
    wrong: pickRadio("Tree 1"),
    right: pickRadio("Tree 3"),
  },
  {
    id: "q-same",
    index: 1,
    wrong: pickRadio("Tree 1"),
    right: pickRadio("All show the same relationships"),
  },
  {
    id: "q-fits",
    index: 2,
    wrong: pickRadio("Tree 2"),
    right: pickRadio("Tree 1"),
  },
  {
    id: "q-mrca",
    index: 3,
    wrong: tapNode(["gibbon", "gorilla"]),
    right: tapNode(HOMINOID),
  },
  {
    id: "q-mrca-points",
    index: 4,
    wrong: tapPoint("X"),
    right: tapPoint("W"),
  },
  {
    id: "q-place",
    index: 5,
    wrong: tapPoint("Z"),
    right: tapPoint("Y"),
  },
  {
    id: "q-clade",
    index: 6,
    wrong: pickRadio("No — not a clade"),
    right: pickRadio("Yes — a clade"),
  },
  {
    id: "q-smallest",
    index: 7,
    wrong: tapNode(MAMMALS),
    right: tapNode(HOMINOID),
  },
  {
    id: "q-closest",
    index: 8,
    // A wrong tip toggles on; the right pass toggles it off first.
    wrong: tapTip("seal"),
    right: seq(tapTip("seal"), tapTip("chimp")),
  },
  {
    id: "q-distant",
    index: 9,
    wrong: tapTip("chimp"),
    right: seq(tapTip("chimp"), tapTip("seal")),
  },
  {
    id: "q-pair",
    index: 10,
    wrong: pickRadio("Closer to gorilla"),
    right: pickRadio("Closer to chimp"),
  },
  {
    id: "q-count",
    index: 11,
    wrong: numberTo(3),
    right: numberTo(7),
  },
  {
    id: "q-order",
    index: 12,
    wrong: seq(addOrder(["P", "Q", "R"])),
    right: seq(clearOrder(), addOrder(["R", "P", "Q"])),
  },
  {
    id: "q-select",
    index: 13,
    wrong: checkBoxes([/^cat and human form/]),
    right: seq(
      uncheckBoxes([/^cat and human form/]),
      checkBoxes([
        /^human and chimp share/,
        /^cat and dog form/,
        /^The first and second/,
      ]),
    ),
  },
  {
    id: "q-trait-have",
    index: 14,
    wrong: tapTip("bat"),
    right: seq(tapTip("cat"), tapTip("dog")),
  },
  {
    id: "q-trait-shared",
    index: 15,
    wrong: pickRadio("fur"),
    right: pickRadio("hair"),
  },
  {
    id: "q-trait-changes",
    index: 16,
    wrong: numberTo(1),
    right: numberTo(2),
  },
  {
    id: "q-trait-profile",
    index: 17,
    wrong: checkBoxes([/^hair/]),
    right: checkBoxes([/^nails/]),
  },
  {
    id: "q-trait-ancder",
    index: 18,
    wrong: pickRadio(/^derived/),
    right: pickRadio(/^ancestral/),
  },
  {
    id: "q-trait-hasnot",
    index: 19,
    wrong: tapTip("bat"),
    right: seq(tapTip("bat"), tapTip("cat")),
  },
  {
    id: "q-trait-homo",
    index: 20,
    wrong: pickRadio("Homologous — one shared origin"),
    right: pickRadio("Arose independently"),
  },
  {
    id: "q-clade-trait",
    index: 21,
    wrong: pickRadio("Monophyletic"),
    right: pickRadio("Paraphyletic"),
  },
  {
    id: "q-concept",
    index: 22,
    wrong: checkBoxes(["A single living species"]),
    right: seq(
      uncheckBoxes(["A single living species"]),
      checkBoxes(["A hypothetical common ancestor"]),
    ),
  },
  {
    id: "q-two",
    index: 23,
    wrong: seq(
      pickRadio("No — not a clade"),
      async (page, how) =>
        act(
          page
            .getByRole("radiogroup", { name: "Why?" })
            .getByRole("radio")
            .first(),
          how,
          true,
        ),
    ),
    right: seq(pickRadio("Yes — a clade")),
  },
  {
    id: "q-longnames",
    index: 24,
    wrong: pickRadio("No — not a clade"),
    right: pickRadio("Yes — a clade"),
  },
];

for (const item of ITEMS) {
  for (const how of ["mouse", "keyboard"] as const) {
    test(`${item.id}: wrong then right verdict by ${how}`, async ({
      page,
    }) => {
      await gotoItem(page, item.index);
      await item.wrong(page, how);
      await checkExpect(page, false, how);
      await item.right(page, how);
      await checkExpect(page, true, how);
    });
  }
}

/* ---- rotation -------------------------------------------------------------- */

test("the rotate tool on a which_differs item swaps children and keeps the same relationships", async ({
  page,
}) => {
  await gotoItem(page, 0);
  const fig = firstFig(page);
  const human = tip(page, "human");
  const seal = tip(page, "seal");
  const before = {
    human: await human.boundingBox(),
    seal: await seal.boundingBox(),
  };
  expect(before.human).not.toBeNull();
  expect(before.seal).not.toBeNull();
  expect(before.human!.y).toBeLessThan(before.seal!.y);

  // "Rotate here" acts on the focused node — the root initially, so
  // its two halves swap and the human/seal order flips. The swap
  // animates at 300 ms; poll until it lands.
  await fig.getByRole("button", { name: "Rotate here" }).click();
  await expect
    .poll(async () => {
      const h = await human.boundingBox();
      const s = await seal.boundingBox();
      return h !== null && s !== null && h.y > s.y;
    })
    .toBe(true);

  // Rotation never changes relationships: Tree 3 is still the odd one.
  await pickRadio("Tree 3")(page, "mouse");
  await checkExpect(page, true, "mouse");
});

test("rotating a selected node keeps the selection on the same clade", async ({
  page,
}) => {
  await gotoItem(page, 3); // q-mrca, node-selectable
  const p = node(page, HOMINOID);
  await p.click();
  await expect(p).toHaveAttribute("aria-selected", "true");

  await p.press("r"); // R rotates the hit under the keys
  await expect(p).toHaveAttribute("aria-selected", "true");
  await expect(p).toHaveAttribute(
    "data-clade",
    JSON.stringify(HOMINOID),
  );

  await checkExpect(page, true, "mouse");
});

/* ---- test mode --------------------------------------------------------------- */

test("a test-mode set hides verdicts until Finish, then shows the summary", async ({
  page,
}) => {
  // Two radio items make a short test; the shared-link payload is the
  // same { v: 1, set } envelope the editor's Share button writes.
  const testSet = {
    ...demoSet,
    id: "trees-demo-test",
    title: "Reading trees — test demo",
    mode: "test",
    items: [demoSet.items[6], demoSet.items[22]], // q-clade, q-concept
  };
  const link =
    "/#r=" +
    lzstring.compressToEncodedURIComponent(
      JSON.stringify({ v: 1, set: testSet }),
    );
  await page.goto(link);
  await expect(page.getByText("Question 1 of 2")).toBeVisible();

  // Test mode has no Check button and no verdict, ever.
  await expect(
    page.getByRole("button", { name: "Check" }),
  ).toHaveCount(0);

  // Item 1: right answer.
  await pickRadio("Yes — a clade")(page, "mouse");
  await expect(verdict(page)).toHaveCount(0);
  await expect(page.getByText(/Correct\./)).toHaveCount(0);
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByText("Question 2 of 2")).toBeVisible();

  // Item 2: wrong answer — still no feedback.
  await checkBoxes(["A single living species"])(page, "mouse");
  await expect(verdict(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Finish" }).click();

  const summary = page.getByRole("region", { name: "Results" });
  await expect(summary).toBeVisible();
  await expect(
    summary.getByText("You answered 1 of 2 correctly."),
  ).toBeVisible();
  // Engine explanations ride each row; note_after would show too.
  // The trailing period keeps this off the item's own question text
  // ("…form a clade?").
  await expect(
    summary.getByText(/gibbon and gorilla form a clade\./),
  ).toBeVisible();
});

/* ---- accessibility & layout -------------------------------------------------- */

test("the reading area has no serious axe violations", async ({
  page,
}) => {
  await gotoItem(page, 0);
  const results = await new AxeBuilder({ page }).analyze();
  const bad = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(
    bad.map(
      (v) =>
        `${v.id} (${v.impact}): ${v.nodes
          .map((n) => n.target.join(" "))
          .join(", ")}`,
    ),
    "the reading area must be axe-clean",
  ).toEqual([]);

  // An open text description stays clean too.
  await page
    .getByRole("button", { name: "Show as text" })
    .first()
    .click();
  const open = await new AxeBuilder({ page }).analyze();
  const bad2 = open.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(bad2, "with the text description open").toEqual([]);
});

test("no sideways page scroll at 360 px, including the long-name tips-up figure", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 740 });
  const noScroll = async (what: string) => {
    const w = await page.evaluate(
      () => document.documentElement.scrollWidth,
    );
    expect(
      w,
      `${what}: no sideways page scroll (scrollWidth ${w})`,
    ).toBeLessThanOrEqual(360);
  };

  await gotoItem(page, 0); // three trees, stacked at this width
  await noScroll("a three-tree item");

  // The tips-up 12-tip tree's figure may scroll INSIDE .rt-canvas —
  // the inset shadow cue is how the student sees that — but the page
  // itself must never scroll sideways.
  await gotoItem(page, 24);
  await noScroll("the tips-up long-name item");
  const canvas = firstFig(page).locator(".rt-canvas");
  const scrolls = await canvas.evaluate(
    (el) => el.scrollWidth > el.clientWidth,
  );
  if (scrolls) {
    await expect(canvas).toHaveAttribute("data-cue", "right");
  }
});

/* ---- scroll cue -------------------------------------------------------------- */

// Owner-requested follow-up (2026-11-20): the inset shadow marks only
// the side that still hides part of the drawing — at the scroll end a
// right-edge cue would sit over the last labels pointing at nothing.
// The cue reads the canvas's real scrollLeft/scrollWidth/clientWidth:
// "right" at scroll 0, "left" at the end, "both" between, absent when
// the figure fits.
test("the scroll cue marks only the side with hidden content", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await gotoItem(page, 24); // the tips-up long-name item overflows at 360 px
  const canvas = firstFig(page).locator(".rt-canvas");
  const m = await canvas.evaluate((el) => ({
    client: el.clientWidth,
    scroll: el.scrollWidth,
  }));
  expect(
    m.scroll,
    "the long-name figure overflows the 360 px panel",
  ).toBeGreaterThan(m.client);
  await expect(canvas).toHaveAttribute("data-cue", "right");

  await canvas.evaluate((el) => {
    el.scrollLeft = el.scrollWidth - el.clientWidth;
  });
  await expect(canvas).toHaveAttribute("data-cue", "left");

  await canvas.evaluate((el) => {
    el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2;
  });
  await expect(canvas).toHaveAttribute("data-cue", "both");

  // Widening the viewport past the figure's width removes the cue —
  // the panel's ResizeObserver drives the update without a scroll.
  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(canvas).not.toHaveAttribute("data-cue", /.+/);
});

/* ---- touch ------------------------------------------------------------------- */

/** A tap through Chromium's CDP touch path (like reading-touch.spec.ts):
 *  elementFromPoint finds the target under the finger — never a drag. */
async function cdpTap(page: Page, loc: Locator): Promise<void> {
  const box = await loc.boundingBox();
  expect(box, "tap target has a box").not.toBeNull();
  const x = box!.x + box!.width / 2;
  const y = box!.y + box!.height / 2;
  const under = await page.evaluate(([px, py]) => {
    const el = document.elementFromPoint(px, py);
    return el?.closest("[data-clade]")?.getAttribute("data-clade") ?? null;
  }, [x, y] as const);
  const wanted = await loc.getAttribute("data-clade");
  expect(
    under,
    `elementFromPoint lands on the intended hit (wanted ${wanted}, found ${under})`,
  ).toBe(wanted);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y, id: 1 }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
}

test("under hasTouch: hit pads are ≥40×40 and a tip tap answers the question", async ({
  browser,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "CDP touch input is Chromium-only");
  const context = await browser.newContext({
    baseURL: "http://localhost:4173",
    viewport: { width: 375, height: 812 },
    hasTouch: true,
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  await page.goto(DEMO_URL);
  await expect(page.getByText(/Question 1 of/)).toBeVisible();
  expect(
    await page.evaluate(() => matchMedia("(pointer: coarse)").matches),
    "the emulation presents a coarse pointer",
  ).toBe(true);

  // Item 8 (q-closest) selects tips: navigate there.
  for (let i = 0; i < 8; i += 1) {
    await page.getByRole("button", { name: "Next" }).click();
  }
  await expect(page.getByText("Question 9 of")).toBeVisible();
  await expect(tip(page, "chimp")).toBeVisible();

  const pads = firstFig(page).locator(".rt-hit-pad");
  const count = await pads.count();
  expect(count, "coarse pads render for every node").toBeGreaterThan(0);
  for (let i = 0; i < count; i += 1) {
    const box = await pads.nth(i).boundingBox();
    if (box === null) continue;
    expect(
      box.width,
      `pad ${i} at least 40 px wide (${box.width}×${box.height})`,
    ).toBeGreaterThanOrEqual(39.95);
    expect(
      box.height,
      `pad ${i} at least 40 px tall (${box.width}×${box.height})`,
    ).toBeGreaterThanOrEqual(39.95);
  }

  await cdpTap(page, tip(page, "chimp"));
  await expect(
    page.locator(".read-sel-list"),
    "the tap selected chimp in the visible selection list",
  ).toContainText("chimp");
  await checkExpect(page, true, "mouse");

  await context.close();
});
