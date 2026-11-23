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
 * the Check button live after a wrong answer. The first wrong Check
 * on an item is the retry verdict ("Not quite — try again.") with no
 * explanation; a second resolves the item (§21(c) feedback design). */
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
    await expect(verdict(page)).toContainText("Not quite — try again");
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
            // Exact: the item text itself ends "— and why?", so a
            // substring match also hits the first tier's
            // "…and why? Choose one" and .first() picks in the wrong
            // group. The Why? group's name is exactly its caption.
            .getByRole("radiogroup", { name: "Why?", exact: true })
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

/* ---- practice feedback staging (§21(c)) ----------------------------------- */

test("a first wrong verdict is a real retry: no explanation, Show answer resolves", async ({
  page,
}) => {
  await gotoItem(page, 0); // q-differs, the odd tree is Tree 3
  await pickRadio("Tree 1")(page, "mouse");
  await page.getByRole("button", { name: "Check" }).click();
  await expect(verdict(page)).toContainText("Not quite — try again.");
  // Nothing about the answer leaks on a first wrong Check — no
  // explanation, no note_after, and no mark of which option was right.
  await expect(page.locator(".read-explain")).toHaveCount(0);
  await expect(page.locator(".read-note")).toHaveCount(0);

  // "Show answer" resolves the item — the engine's explanation lands.
  await page.getByRole("button", { name: "Show answer" }).click();
  await expect(verdict(page)).toContainText("Not correct.");
  await expect(page.locator(".read-explain")).toBeVisible();
});

test("a second wrong Check resolves the item", async ({ page }) => {
  await gotoItem(page, 0);
  await pickRadio("Tree 1")(page, "mouse");
  await page.getByRole("button", { name: "Check" }).click();
  await expect(verdict(page)).toContainText("Not quite — try again.");
  // Check stays live on the unchanged response; the second wrong
  // answer shows the engine's explanation.
  await page.getByRole("button", { name: "Check" }).click();
  await expect(verdict(page)).toContainText("Not correct.");
  await expect(page.locator(".read-explain")).toBeVisible();
});

test("a correct first Check shows the explanation at once", async ({
  page,
}) => {
  await gotoItem(page, 0);
  await pickRadio("Tree 3")(page, "mouse");
  await page.getByRole("button", { name: "Check" }).click();
  await expect(verdict(page)).toContainText("Correct.");
  await expect(page.locator(".read-explain")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Show answer" }),
  ).toHaveCount(0);
});

test("Back/Next keeps a first-wrong item's tried-once, not-shown state", async ({
  page,
}) => {
  await gotoItem(page, 0);
  await pickRadio("Tree 1")(page, "mouse");
  await page.getByRole("button", { name: "Check" }).click();
  await expect(verdict(page)).toContainText("Not quite — try again.");
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByText("Question 2 of")).toBeVisible();
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByText("Question 1 of")).toBeVisible();
  // Still tried once, still unshown — the retry verdict is back with
  // its Show answer button and no explanation.
  await expect(verdict(page)).toContainText("Not quite — try again.");
  await expect(page.locator(".read-explain")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Show answer" }),
  ).toBeVisible();
});

/* ---- item-change relayout (§21(j)) ----------------------------------------- */

/** Running animations whose target sits inside a reading figure. */
const runningTreeAnims = (page: Page): Promise<number> =>
  page.evaluate(
    () =>
      document.getAnimations().filter((a) => {
        const t = (a.effect as KeyframeEffect | null)?.target;
        return (
          a.playState === "running" &&
          t instanceof Element &&
          t.closest(".rt-figure svg") !== null
        );
      }).length,
  );

/** Every positioned group rests where its own transform puts it —
 * the checker's readingDrift rule (translate vs getScreenCTM, ≤2 px). */
const treeDrift = (page: Page): Promise<string[]> =>
  page.evaluate(() => {
    const out: string[] = [];
    const translate = /^translate\(([-\d.eE+]+)px[,\s]+([-\d.eE+]+)px\)$/;
    for (const svg of document.querySelectorAll<SVGSVGElement>(
      ".rt-figure svg",
    )) {
      const ctm = svg.getScreenCTM();
      if (ctm === null) continue;
      for (const g of svg.querySelectorAll<SVGGElement>(
        ".rt-anim, .rt-hit",
      )) {
        const m = translate.exec(g.style.transform);
        if (m === null) continue;
        const want = new DOMPoint(
          Number(m[1]),
          Number(m[2]),
        ).matrixTransform(ctm);
        const got = g.getScreenCTM();
        if (got === null) continue;
        const d = Math.hypot(want.x - got.e, want.y - got.f);
        if (d > 2) {
          out.push(
            `${g.getAttribute("class") ?? "?"}: ${d.toFixed(1)}px off`,
          );
        }
      }
    }
    return out;
  });

test("an item change lands the trees at their final spots — dots never slide", async ({
  page,
}) => {
  // trees-reading-a-tree items 1→2 draw the same vertebrates tree in
  // different styles — exactly the re-use case §21(j) caught mid-slide.
  await page.goto("/?read=trees-reading-a-tree");
  await expect(page.getByText("Question 1 of 7")).toBeVisible();
  await expect(firstFig(page).locator("svg")).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();
  // Inside the old 300 ms window: the view change draws with the
  // transition off, so nothing animates and every dot already rests
  // on its node.
  expect(
    await runningTreeAnims(page),
    "no running animation on an item change",
  ).toBe(0);
  expect(await treeDrift(page), "dots rest on their nodes").toEqual([]);
  await expect(page.getByText("Question 2 of 7")).toBeVisible();
});

test("rotating inside an item keeps its 300 ms animation", async ({
  page,
}) => {
  await page.goto("/?read=trees-reading-a-tree");
  await expect(page.getByText("Question 1 of 7")).toBeVisible();
  await firstFig(page)
    .getByRole("button", { name: "Rotate here" })
    .click();
  await expect
    .poll(() => runningTreeAnims(page), {
      message: "a rotation still animates the swap",
    })
    .toBeGreaterThan(0);
});

test("a panel resize relayouts without sliding the dots", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/?read=trees-reading-a-tree");
  await expect(page.getByText("Question 1 of 7")).toBeVisible();
  const svg = firstFig(page).locator("svg");
  await expect(svg).toBeVisible();
  const before = await svg.getAttribute("width");
  await page.setViewportSize({ width: 480, height: 768 });
  // Wait for the relayout to actually land — asserting before it
  // would prove nothing.
  await expect
    .poll(async () => svg.getAttribute("width"))
    .not.toBe(before);
  expect(
    await runningTreeAnims(page),
    "a size-only relayout never animates",
  ).toBe(0);
  expect(await treeDrift(page), "dots rest on their nodes").toEqual([]);
});

/* ---- malformed links ---------------------------------------------------------- */

test("a #r= fragment lz-string cannot decode refuses with the link message", async ({
  page,
}) => {
  await page.goto("/#r=zzz");
  const alert = page.getByRole("alert");
  await expect(alert).toBeVisible();
  await expect(alert).toContainText(
    "the shared set could not be decompressed",
  );
  await expect(alert).not.toContainText(/engine/i);
});

/* ---- same-tab #r= re-routing -------------------------------------------------- */

// Root picks its route once at module load, so a fragment-only
// navigation used to leave the old page mounted: a second `#r=` link
// opened in the same tab kept showing the first set, and `#r=` added
// to a `?read=` URL never mounted the shared set at all (reproduced on
// the PR #182 deploy). The hashchange watcher now reloads across a
// `#r=` boundary so the route is picked again — checkpoint fix, owner
// decision 2026-11-22.

/** A `#r=` hash carrying a one-item set built from the demo file —
 *  the same { v: 1, set } envelope the editor's Share button writes. */
const sharedHash = (id: string, title: string): string =>
  "#r=" +
  lzstring.compressToEncodedURIComponent(
    JSON.stringify({
      v: 1,
      set: { ...demoSet, id, title, items: [demoSet.items[6]] },
    }),
  );

test("a second #r= link in the same tab re-routes to its set", async ({
  page,
}) => {
  await page.goto(`/${sharedHash("shared-a", "Shared set A")}`);
  await expect(
    page.getByRole("heading", { name: "Shared set A" }),
  ).toBeVisible();
  await expect(page.getByText("Question 1 of 1")).toBeVisible();

  // Same-document navigation: only the fragment differs, so without
  // the watcher the first set would stay mounted.
  await page.goto(`/${sharedHash("shared-b", "Shared set B")}`);
  await expect(
    page.getByRole("heading", { name: "Shared set B" }),
  ).toBeVisible();
  await expect(page.getByText("Question 1 of 1")).toBeVisible();
});

test("adding #r= to a ?read= URL mounts the shared set", async ({
  page,
}) => {
  await page.goto("/?read=trees-form-a");
  await expect(
    page.getByRole("heading", { name: "Tree reading — form A" }),
  ).toBeVisible();

  // `#r=` wins over `?read=` — the shared set's title replaces the
  // shipped set's.
  await page.goto(
    `/?read=trees-form-a${sharedHash("shared-c", "Shared set C")}`,
  );
  await expect(
    page.getByRole("heading", { name: "Shared set C" }),
  ).toBeVisible();
  await expect(page.getByText("Question 1 of 1")).toBeVisible();
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

// §21(p) — the owner's NVDA pass (2026-11-23) found the question
// unvoiced on Tab, the tree text unreachable, and the first Check
// silent. Pin the DOM contract: the radio group's accessible name
// carries the question, and the empty verdict region exists before
// Check so its first fill is announced.
test("Tab reaches an answer group named by the question; the verdict region predates Check", async ({
  page,
}) => {
  await gotoItem(page, 6); // q-clade — one tree, a "Choose one" radio group

  // The live region mounts empty with the page — a region inserted
  // together with its content is never announced.
  const status = page.getByRole("status", { name: "Verdict" });
  await expect(status).toBeAttached();
  await expect(status).toHaveText("");

  // gotoItem's Next clicks leave real focus on the button; release
  // it so the walk starts from the page top like a fresh visit. On
  // the BiDi-driven Firefox an injected Tab only traverses while
  // <body> holds focus — with a focused element the press is a no-op.
  await page.evaluate(() =>
    (document.activeElement as HTMLElement | null)?.blur(),
  );

  // Walk the tab order until focus lands inside the radio group —
  // at most a couple of dozen stops (wordmark, toggles, radios).
  const group = page.getByRole("radiogroup");
  let inside = false;
  for (let i = 0; i < 60 && !inside; i += 1) {
    await page.keyboard.press("Tab");
    inside = await page.evaluate(
      () =>
        document.activeElement?.closest('[role="radiogroup"]') !==
        null,
    );
  }
  expect(inside, "Tab reaches the answer radios").toBe(true);
  // The focused control's group name is the question then the
  // instruction — never "Choose one" alone.
  await expect(group).toHaveAccessibleName(
    /do gibbon and gorilla form a clade\? choose one/i,
  );

  // And the same on the second half: the first Check fills the
  // already-mounted region.
  await page.getByRole("radio", { name: "No — not a clade" }).press(" ");
  await page.getByRole("button", { name: "Check" }).press("Enter");
  await expect(status).toContainText("Not quite — try again.");
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

/* ---- figure width independence (§21(k)) --------------------------------------- */

// Session 2b: .rt-figure used to be a content-sized flex item whose
// measured width fed ReadingTree's layout, so box.width and fig.width
// formed a feedback loop — a figure converged to different widths
// depending on how the item was reached. Each figure now gets an
// equal, content-independent share of the row, so an item's figure
// boxes depend only on the container and the tree — never on mount
// history, navigation order or an earlier resize.
const figBoxes = async (
  page: Page,
): Promise<{ w: number; h: number }[]> => {
  const figs = page.locator(".read-trees > .rt-figure");
  const n = await figs.count();
  const out: { w: number; h: number }[] = [];
  for (let i = 0; i < n; i += 1) {
    const b = await figs.nth(i).boundingBox();
    expect(b, `figure ${i} has a box`).not.toBeNull();
    out.push({ w: b!.width, h: b!.height });
  }
  return out;
};

const expectSameBoxes = (
  a: { w: number; h: number }[],
  b: { w: number; h: number }[],
): void => {
  expect(a.length).toBe(b.length);
  a.forEach((fa, i) => {
    expect(Math.abs(fa.w - b[i].w), `figure ${i} width`).toBeLessThanOrEqual(1);
    expect(Math.abs(fa.h - b[i].h), `figure ${i} height`).toBeLessThanOrEqual(1);
  });
};

/** Load a set and click Next `index` times. */
async function reachItem(
  page: Page,
  set: string,
  index: number,
): Promise<void> {
  await page.goto(`/?read=${set}`);
  await expect(page.getByText(/Question 1 of/)).toBeVisible();
  for (let i = 0; i < index; i += 1) {
    await page.getByRole("button", { name: "Next" }).click();
  }
  await expect(page.getByText(`Question ${index + 1} of`)).toBeVisible();
  await expect(
    page.locator(".read-trees > .rt-figure svg").first(),
  ).toBeVisible();
}

for (const vp of [1280, 360]) {
  for (const [set, idx, label] of [
    ["cov-styles", 3, "item 4"],
    ["trees-reading-a-tree", 1, "item 2"],
  ] as const) {
    test(`${set} ${label}: figure boxes are mount-order independent (${vp} px)`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: vp, height: 800 });
      await reachItem(page, set, idx);
      const forward = await figBoxes(page);
      // A different history: back to item 1, then forward again.
      for (let i = 0; i < idx; i += 1) {
        await page.getByRole("button", { name: "Back" }).click();
      }
      await expect(page.getByText("Question 1 of")).toBeVisible();
      for (let i = 0; i < idx; i += 1) {
        await page.getByRole("button", { name: "Next" }).click();
      }
      await expect(
        page.locator(".read-trees > .rt-figure svg").first(),
      ).toBeVisible();
      expectSameBoxes(forward, await figBoxes(page));
    });
  }
}

test("resize to 360 and back restores the same figure boxes", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await reachItem(page, "cov-styles", 3);
  const wide = await figBoxes(page);
  await page.setViewportSize({ width: 360, height: 800 });
  await expect(
    page.locator(".read-trees > .rt-figure svg").first(),
  ).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(
    page.locator(".read-trees > .rt-figure svg").first(),
  ).toBeVisible();
  expectSameBoxes(wide, await figBoxes(page));
});

/* §21(k) follow-up (2b2): the equal-flex row restored determinism but
 * let a single tree stretch across the whole row (~950 px at 1024 vs
 * the approved ~230–550 px). --reading-figure-max caps each figure;
 * multi-tree rows still share equally up to the cap. The test reads
 * the token back from the DOM so it tracks the design token. */
for (const vp of [1024, 1920]) {
  test(`a single-tree item's figure stays within --reading-figure-max (${vp} px)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: vp, height: 800 });
    await reachItem(page, "trees-demo", 12); // q-order-nodes: one tree
    const cap = await page.evaluate(() =>
      parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue(
          "--reading-figure-max",
        ),
      ),
    );
    expect(Number.isFinite(cap), "--reading-figure-max is set").toBe(true);
    const boxes = await figBoxes(page);
    expect(boxes).toHaveLength(1);
    expect(
      boxes[0].w,
      `single figure ${boxes[0].w}px exceeds the ${cap}px cap at ${vp}px`,
    ).toBeLessThanOrEqual(cap + 1);
  });
}

/* Round 2d (R1): the 2b2 cap only stopped a lone figure from
 * stretching — it also forced .rt-canvas to scroll when a drawing was
 * wider than the cap but not wider than the row (the long-name
 * tips-up figure kept its cue at 1024 px in CI). A lone figure's
 * width is now min(its share, max(its drawing, --reading-figure-max)),
 * so at desktop widths a canvas may scroll only when its drawing is
 * wider than the share the row allots it. Every item of trees-demo,
 * cov-styles and the four lessons, at 1024 and 1920 px. */
const FIGURE_FIT_SETS: [string, string][] = [
  ["trees-demo", "trees-demo.json"],
  ["cov-styles", "coverage/cov-styles.json"],
  ["trees-reading-a-tree", "trees-reading-a-tree.json"],
  ["trees-clades-traits", "trees-clades-traits.json"],
  ["trees-closest-relatives", "trees-closest-relatives.json"],
  ["trees-rotation", "trees-rotation.json"],
];

for (const vp of [1024, 1920]) {
  test(`no canvas scrolls unless its drawing exceeds the row share (${vp} px)`, async ({
    page,
  }) => {
    test.setTimeout(300_000);
    await page.setViewportSize({ width: vp, height: 800 });
    for (const [id, file] of FIGURE_FIT_SETS) {
      const items = (
        JSON.parse(
          readFileSync(
            resolve("..", "exercises", "reading", file),
            "utf8",
          ),
        ) as { items: unknown[] }
      ).items.length;
      await page.goto(`/?read=${id}`);
      await expect(
        page.getByText(/Question 1 of/),
        `${id} loads`,
      ).toBeVisible();
      for (let i = 0; i < items; i += 1) {
        await expect(
          page.getByText(`Question ${i + 1} of`),
          `${id} item ${i + 1}`,
        ).toBeVisible();
        await expect(
          page.locator(".read-trees > .rt-figure svg").first(),
          `${id} item ${i + 1} draws a tree`,
        ).toBeVisible();
        const bad = await page.evaluate(() => {
          const out: string[] = [];
          document
            .querySelectorAll<HTMLElement>(".read-trees")
            .forEach((row) => {
              const gap =
                parseFloat(getComputedStyle(row).columnGap) || 0;
              const figs = [
                ...row.querySelectorAll<HTMLElement>(".rt-figure"),
              ];
              // The equal flex share every figure gets — the row's
              // width minus its gaps, split evenly.
              const share =
                (row.clientWidth - gap * (figs.length - 1)) /
                figs.length;
              figs.forEach((fig, j) => {
                const c = fig.querySelector<HTMLElement>(".rt-canvas");
                const svg = c?.querySelector("svg");
                if (!c || !svg) return;
                if (c.scrollWidth <= c.clientWidth + 1) return;
                const w = svg.getBoundingClientRect().width;
                if (w <= share + 1) {
                  out.push(
                    `figure ${j}: drawing ${w.toFixed(0)} px fits its ${share.toFixed(0)} px share but the canvas scrolls ${c.scrollWidth} > ${c.clientWidth}`,
                  );
                }
              });
            });
          return out;
        });
        expect(bad, `${id} item ${i + 1} at ${vp} px`).toEqual([]);
        if (i + 1 < items) {
          await page.getByRole("button", { name: "Next" }).click();
        }
      }
    }
  });
}
