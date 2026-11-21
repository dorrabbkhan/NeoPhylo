// Worksheet and answer-key end-to-end tests (v1.4c plan Task 11, spec
// §7.2). Covered here:
//
// - the nj-by-hand paper sheet renders its matrix, join blocks, blanks,
//   link and QR; the paper key shows the engine's values after the
//   instructor gate — which asks once per browser session and not again
// - print emulation prints light paper on sheet and key in a dark
//   session, including the <html>/<body> ancestors (the lab
//   print-colour assertions, reused)
// - a custom matrix exercise built in the editor gets a paper sheet
//   through its #x= share link
// - every built-in lesson and lab renders its in-app sheet and key
//   with no console errors
// - axe-clean on the sheet and the gated key

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { test, expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";
import lzstring from "lz-string";

import { waitForApp } from "./helpers";

const EXERCISES = fileURLToPath(new URL("../../exercises", import.meta.url));

const LESSON_IDS = readdirSync(EXERCISES)
  .filter((f) => f.endsWith(".json") && !f.endsWith("schema.json"))
  .map((f) => f.replace(/\.json$/, ""));
const LAB_IDS = readdirSync(`${EXERCISES}/labs`)
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.replace(/\.json$/, ""));
const ALL_IDS = [...LESSON_IDS, ...LAB_IDS];
// Every built-in reading set (v1.4d Task 13): the shipped files —
// trees-demo included, since it loads like any set — plus the Task-12
// coverage sets.
const READING_IDS = [
  ...readdirSync(`${EXERCISES}/reading`)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, "")),
  ...readdirSync(`${EXERCISES}/reading/coverage`)
    .filter((f) => f.endsWith(".json") && f !== "manifest.json")
    .map((f) => f.replace(/\.json$/, "")),
];

// No worksheet test needs the PWA service worker; blocking it also
// keeps the dev server's sw.js 404 out of the console-error loop below.
test.use({ serviceWorkers: "block" });

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    try {
      window.localStorage.setItem("neophylo-e2e", "1");
      window.localStorage.setItem("neophylo.tourSeen", "1");
    } catch {
      // storage can be blocked; the app tolerates it
    }
  });
});

/** Click through the instructor gate when it is up — waits for the
 * lazy chunk's dialog rather than racing it; an already-granted
 * session skips straight to the key. */
async function passGate(page: Page): Promise<void> {
  const gate = page.getByRole("dialog", {
    name: "Answer keys are for instructors",
  });
  try {
    await gate.waitFor({ state: "visible", timeout: 5000 });
    await gate.getByRole("button", { name: "I'm an instructor" }).click();
  } catch {
    // Already granted this session — the key is rendering directly.
  }
}

/** Open a key page through the gate. */
async function openKey(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await passGate(page);
}

test("the nj-by-hand paper sheet shows the matrix, the join blocks, the link and the QR", async ({
  page,
}) => {
  await page.goto("/?worksheet=nj-by-hand&kind=paper");
  await expect(
    page.getByRole("heading", { name: "1. The distance matrix" }),
  ).toBeVisible();
  const matrix = page.getByRole("table", {
    name: /distance matrix$/,
  });
  await expect(matrix).toBeVisible();
  await expect(matrix).toContainText("5");
  // Three join blocks (5 taxa → n−2 joins) plus the finish block.
  await expect(
    page.getByRole("heading", { name: /2\. Join 1/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /4\. Join 3/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /Finish the tree/ }),
  ).toBeVisible();
  // Ruled blanks, not filled answers.
  await expect(page.locator(".ws-blank").first()).toBeVisible();
  // The exact exercise link and a QR that encodes it.
  const link = page.locator(".ws-link-text a");
  await expect(link).toHaveAttribute("href", /lesson=nj-by-hand/);
  await expect(page.locator("svg.ws-qr")).toBeVisible();
  // Nothing that looks like an engine answer leaked onto the sheet.
  await expect(page.getByText(/because their distance is smallest/)).toHaveCount(
    0,
  );
  await expect(page.getByText(/Joins:/)).toHaveCount(0);
});

test("the instructor gate asks once per session and shows the paper key", async ({
  page,
}) => {
  await page.goto("/?key=nj-by-hand&kind=paper");
  const gate = page.getByRole("dialog", {
    name: "Answer keys are for instructors",
  });
  await expect(gate).toBeVisible();
  await expect(
    gate.getByText(
      "Answer keys are for instructors. Students: work the sheet first.",
    ),
  ).toBeVisible();
  // The gate focus-traps: the confirm button holds focus.
  await expect(
    gate.getByRole("button", { name: "I'm an instructor" }),
  ).toBeFocused();
  // No key content behind the dialog.
  await expect(
    page.getByRole("heading", { name: "1. The distance matrix" }),
  ).toHaveCount(0);
  await gate.getByRole("button", { name: "I'm an instructor" }).click();
  await expect(
    page.getByRole("heading", { name: "1. The distance matrix" }),
  ).toBeVisible();
  await expect(page.getByText(/Joins:/).first()).toBeVisible();
  await expect(
    page.getByText(/because their distance is smallest/).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /The finished tree/ }),
  ).toBeVisible();

  // A second key page in the same session asks nothing.
  await page.goto("/?key=nj-basics&kind=app");
  await expect(gate).toHaveCount(0);
  await expect(page.locator(".ws-key-items")).toBeVisible();
});

test("a fresh session asks the gate again", async ({ page, context }) => {
  await openKey(page, "/?key=nj-by-hand&kind=paper");
  await expect(
    page.getByRole("heading", { name: "1. The distance matrix" }),
  ).toBeVisible();
  const fresh = await context.browser()!.newContext();
  const page2 = await fresh.newPage();
  await page2.goto("http://localhost:4173/?key=nj-by-hand&kind=paper");
  await expect(
    page2.getByRole("dialog", {
      name: "Answer keys are for instructors",
    }),
  ).toBeVisible();
  await fresh.close();
});

// The lab print-colour assertions, reused for the worksheet pages:
// light paper (luminance > 0.85) and dark text (< 0.35) under print
// emulation even in a dark-theme session, including the <html>/<body>
// paper around the sheet (owner finding 2026-11-14).
const luminance = (cssColor: string): number => {
  const m = cssColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) throw new Error(`not an rgb() color: ${cssColor}`);
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return (
    0.2126 * channel(Number(m[1])) +
    0.7152 * channel(Number(m[2])) +
    0.0722 * channel(Number(m[3]))
  );
};

const transparent = (c: string) =>
  c === "transparent" || /^rgba\(.*,\s*0(?:\.0+)?\)$/.test(c);

test("a dark-theme session still prints the worksheet pages light", async ({
  page,
  context,
}) => {
  await context.addInitScript(() => {
    try {
      window.localStorage.setItem("neophylo.theme", "dark");
    } catch {
      // storage can be blocked; the app tolerates it
    }
  });

  const printColors = (h1: import("@playwright/test").Locator) =>
    h1.evaluate((el) => {
      const transparent = (c: string) =>
        c === "transparent" || /^rgba\(.*,\s*0(?:\.0+)?\)$/.test(c);
      let bg = "rgb(255, 255, 255)";
      for (let n: Element | null = el; n; n = n.parentElement) {
        const c = getComputedStyle(n).backgroundColor;
        if (!transparent(c)) {
          bg = c;
          break;
        }
      }
      return { bg, fg: getComputedStyle(el).color };
    });

  const paperColors = (block: import("@playwright/test").Locator) =>
    block.evaluate((el) => {
      const chain: Element[] = [document.documentElement, document.body];
      for (let a = el.parentElement; a; a = a.parentElement) chain.push(a);
      return chain.map((n) => ({
        tag: n.tagName.toLowerCase() + (n.id ? `#${n.id}` : ""),
        bg: getComputedStyle(n).backgroundColor,
      }));
    });

  const expectLightPrint = async (
    url: string,
    h1: string,
    gate = false,
  ): Promise<void> => {
    if (gate) await openKey(page, url);
    else await page.goto(url);
    const heading = page.getByRole("heading", {
      name: h1,
      exact: true,
      level: 1,
    });
    await expect(heading).toBeVisible();
    await page.emulateMedia({ media: "print" });
    const { bg, fg } = await printColors(heading);
    expect(
      luminance(bg),
      `${url} prints on light paper (background ${bg})`,
    ).toBeGreaterThan(0.85);
    expect(
      luminance(fg),
      `${url} prints dark text (color ${fg})`,
    ).toBeLessThan(0.35);
    for (const { tag, bg: paper } of await paperColors(
      page.locator(".lab-print"),
    )) {
      if (!transparent(paper)) {
        expect(
          luminance(paper),
          `${url} prints light paper around the sheet (${tag} ${paper})`,
        ).toBeGreaterThan(0.85);
      }
    }
    await page.emulateMedia({ media: "screen" });
  };

  await expectLightPrint(
    "/?worksheet=nj-by-hand&kind=paper",
    "Neighbor-Joining, by hand",
  );
  await expectLightPrint(
    "/?key=nj-by-hand&kind=paper",
    "Neighbor-Joining, by hand — answer key",
    true,
  );
  // Task 13: the reading sheet and key print light too — dark
  // tokens on the drawn trees would be unreadable on paper.
  await expectLightPrint(
    "/?worksheet=trees-clades-traits&kind=paper",
    "Clades and shared traits",
  );
  await expectLightPrint(
    "/?key=trees-clades-traits&kind=paper",
    "Clades and shared traits — answer key",
    true,
  );
});

// Round-3 K1: the finished tree used to keep its screen width in
// print and run off the page's right edge (nj-by-hand lost a, b, c;
// upgma-fails showed almost nothing). Emulate print at the A4
// printable width — 210 mm − 2·15 mm = 180 mm ≈ 680 px, the shared
// @page margins — and every leaf label of every paper key's tree
// must land inside that box.
const PAPER_KEY_IDS = [
  "bootstrap-basics",
  "cytochrome-c",
  "nj-basics",
  "nj-by-hand",
  "protein-models",
  "upgma-fails",
  "upgma-vs-nj-matrix",
  "mega-jc69-vs-k2p",
];
const PRINTABLE_W = Math.round(((210 - 2 * 15) * 96) / 25.4); // 680

test("every paper key's finished tree keeps its leaf labels on the printed page", async ({
  page,
}) => {
  test.setTimeout(300_000);
  // Instructor-grant the session once — §3's gate checks live in the
  // release checker; openKey still clicks through if a gate appears.
  await page.addInitScript(() => {
    try {
      window.sessionStorage.setItem("neophylo.instructor", "1");
    } catch {
      // storage can be blocked; the gate is clicked through instead
    }
  });
  // A wide screen layout is what makes the bug visible: the svg's
  // width attribute keeps the screen geometry, and a printed A4 page
  // clips it. No viewport resize — print media alone must trigger the
  // refit, exactly as page.pdf does.
  await page.setViewportSize({ width: 1280, height: 900 });
  for (const id of PAPER_KEY_IDS) {
    await openKey(page, `/?key=${id}&kind=paper`);
    await expect(
      page.getByRole("heading", { name: /The finished tree/ }),
      `${id}: finished tree section`,
    ).toBeVisible();
    await page.emulateMedia({ media: "print" });
    const svg = page.locator(".tree-canvas svg");
    await expect(svg, `${id}: finished tree svg`).toBeVisible();
    // The refit takes a render after the media flip — the width
    // ATTRIBUTE is the figure's own geometry, so fitting proves the
    // tree shrank for print rather than being CSS-scaled (which
    // would shrink text below the 12 px floor).
    await expect
      .poll(
        async () =>
          svg.evaluate((el) =>
            parseFloat(el.getAttribute("width") ?? "0"),
          ),
        { timeout: 10_000 },
      )
      .toBeLessThanOrEqual(PRINTABLE_W + 1);
    const svgBox = await svg.boundingBox();
    expect(svgBox, `${id}: svg box measurable`).not.toBeNull();
    // Leaf labels are the unclassed <text> children — support pills
    // and zero-length labels carry classes. Measure them against the
    // svg's own left edge: emulated print keeps the viewport layout,
    // so the printable box starts at the figure, not at x=0.
    const labels = svg.locator("text:not(.support-label):not(.zero-len)");
    const count = await labels.count();
    expect(count, `${id}: leaf labels present`).toBeGreaterThan(0);
    for (let i = 0; i < count; i += 1) {
      const bb = await labels.nth(i).boundingBox();
      expect(bb, `${id}: leaf label ${i} measurable`).not.toBeNull();
      if (bb !== null && svgBox !== null) {
        expect(
          bb.x - svgBox.x,
          `${id}: leaf ${i} on the page (left)`,
        ).toBeGreaterThanOrEqual(-1);
        expect(
          bb.x + bb.width - svgBox.x,
          `${id}: leaf ${i} on the page (right edge)`,
        ).toBeLessThanOrEqual(PRINTABLE_W + 1);
      }
    }
    await page.emulateMedia({ media: "screen" });
  }
});

test("a custom matrix exercise from the editor gets a paper sheet through #x=", async ({
  page,
}) => {
  await page.goto("/?editor");
  await page
    .getByRole("combobox", { name: "Exercise data" })
    .selectOption("matrix");
  await page
    .getByRole("textbox", { name: "Paste a distance matrix" })
    .fill(
      "\tA\tB\tC\tD\tE\n" +
        "A\t0\t5\t9\t9\t8\n" +
        "B\t5\t0\t10\t10\t9\n" +
        "C\t9\t10\t0\t8\t7\n" +
        "D\t9\t10\t8\t0\t3\n" +
        "E\t8\t9\t7\t3\t0\n",
    );
  await page.getByRole("button", { name: "Use this matrix" }).click();
  await expect(
    page.getByText(/A matrix is committed — 5 taxa\./),
  ).toBeVisible();
  await page.getByRole("button", { name: "Share link" }).click();
  const url = await page
    .getByRole("textbox", { name: "Share link URL" })
    .inputValue();
  const hash = url.slice(url.indexOf("#"));
  expect(hash).toMatch(/^#x=/);

  await page.goto(`/?worksheet=custom&kind=paper${hash}`);
  await expect(
    page.getByRole("heading", { name: "1. The distance matrix" }),
  ).toBeVisible();
  await expect(
    page.getByRole("table", { name: /distance matrix$/ }),
  ).toContainText("5");
  // The QR encodes the #x= link itself (custom links fit capacity at
  // this size).
  await expect(page.locator("svg.ws-qr")).toBeVisible();
  await expect(page.locator(".ws-link-text a")).toHaveAttribute(
    "href",
    /#x=/,
  );

  // The link/QR opens the exercise itself — not the worksheet route
  // again (fix round 1, R6). It carries no worksheet/key/kind params.
  const href = await page
    .locator(".ws-link-text a")
    .getAttribute("href");
  expect(href).not.toBeNull();
  const linkUrl = new URL(href!);
  expect(linkUrl.search).toBe("");
  expect(linkUrl.hash).toMatch(/^#x=/);
  await page.goto(href!);
  await waitForApp(page);
  // The pasted matrix's exercise is loaded — its distance grid is up.
  await expect(
    page.getByRole("gridcell", { name: "B, A: 5" }),
  ).toBeVisible();
  await expect(page.locator('[role="gridcell"]')).toHaveCount(25);
});

test("the paper route on a >8-taxon exercise points at the in-app worksheet", async ({
  page,
}) => {
  await page.goto("/?worksheet=seqboot-consense&kind=paper");
  await expect(
    page.getByText(/too many taxa for a paper worksheet/),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Open the in-app worksheet" })
    .click();
  await expect(page.locator(".ws-items")).toBeVisible();
});

test("an unknown id shows a clear message on both routes", async ({
  page,
}) => {
  await page.goto("/?worksheet=no-such-exercise&kind=paper");
  await expect(page.getByText("Worksheet not available")).toBeVisible();
  await page.goto("/?key=no-such-exercise&kind=app");
  await page
    .getByRole("button", { name: "I'm an instructor" })
    .click();
  await expect(
    page.getByText("Answer key not available"),
  ).toBeVisible();
});

// Fix round 2 (release-checkpoint §2): a load that THROWS — the wasm
// fetch or the lesson fetch aborted by navigation, a body read that
// fails mid-stream — must land in the error state, not escape the
// async effect as an unhandled rejection (Firefox logged
// "NetworkError when attempting to fetch resource" on the deploy).
test("a load that throws shows the error state with no page error", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route(/\.wasm(\?|$)/, (r) => r.abort());

  await page.goto("/?worksheet=nj-by-hand&kind=app");
  await expect(
    page.getByText("Worksheet not available"),
  ).toBeVisible();
  await page.goto("/?key=nj-by-hand&kind=app");
  await page
    .getByRole("button", { name: "I'm an instructor" })
    .click();
  await expect(page.getByText("Answer key not available")).toBeVisible();
  expect(errors).toEqual([]);
});

test("every built-in lesson and lab renders its in-app sheet and key without console errors", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(String(e)));

  let gateDone = false;
  for (const id of ALL_IDS) {
    errors.length = 0;
    await page.goto(`/?worksheet=${id}&kind=app`);
    await expect(
      page.locator(".ws-items, .error"),
      `${id} sheet rendered`,
    ).toBeVisible();
    expect(errors, `${id} worksheet console`).toEqual([]);

    await page.goto(`/?key=${id}&kind=app`);
    if (!gateDone) {
      await passGate(page);
      gateDone = true;
    }
    await expect(
      page.locator(".ws-key-items, .error"),
      `${id} key rendered`,
    ).toBeVisible({ timeout: 60_000 }); // bootstrap keys run a seeded replicate tally
    expect(errors, `${id} key console`).toEqual([]);
  }
});

// ---- Reading worksheets and keys (v1.4d Task 13, spec §8.4) --------
// The paper sheet draws every tree in its authored style and carries
// only answer space — never an answer. The key sits behind the same
// instructor gate, every line an engine value: the accepted answer,
// the explanation, and the "authored answer" label where the set
// authored its own.

/** A reading set's item count, read from its file (not a literal). */
function readingItemCount(id: string): number {
  const dir = id.startsWith("cov-")
    ? `${EXERCISES}/reading/coverage`
    : `${EXERCISES}/reading`;
  return (
    JSON.parse(readFileSync(`${dir}/${id}.json`, "utf8")) as {
      items: unknown[];
    }
  ).items.length;
}

test("a reading set's paper sheet draws the trees and carries no key text", async ({
  page,
}) => {
  await page.goto("/?worksheet=trees-clades-traits&kind=paper");
  await expect(
    page.getByRole("heading", {
      name: "Clades and shared traits",
      level: 1,
    }),
  ).toBeVisible();
  // One block per shipped item — drawn trees plus answer space.
  const n = readingItemCount("trees-clades-traits");
  await expect(page.locator(".ws-items .ws-item")).toHaveCount(n);
  await expect(page.locator(".rt-figure svg").first()).toBeVisible();
  await expect(page.locator(".ws-options li").first()).toBeVisible();
  // The set's own ?read= link and the QR for it.
  await expect(page.locator("svg.ws-qr")).toBeVisible();
  await expect(page.locator(".ws-link-text a")).toHaveAttribute(
    "href",
    /read=trees-clades-traits/,
  );
  // The sheet carries no key text — no answers, explanations, notes
  // or authored labels anywhere in the DOM.
  await expect(
    page.locator(".ws-answer, .ws-explain, .ws-note"),
  ).toHaveCount(0);
  await expect(page.getByText("authored answer")).toHaveCount(0);
});

test("a reading set's gated key shows every engine answer with the authored label", async ({
  page,
}) => {
  const n = readingItemCount("trees-clades-traits");
  await openKey(page, "/?key=trees-clades-traits&kind=paper");
  await expect(
    page.getByRole("heading", {
      name: "Clades and shared traits — answer key",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "student sheet" }),
  ).toHaveAttribute("href", "?worksheet=trees-clades-traits&kind=paper");
  await expect(page.locator(".ws-key-items .ws-item")).toHaveCount(n);
  await expect(page.locator(".ws-answer")).toHaveCount(n);
  await expect(page.locator(".ws-explain")).toHaveCount(n);
  // trees-clades-traits' two-tier item has an authored reason —
  // labelled, per the spec.
  await expect(page.getByText("authored answer").first()).toBeVisible();
});

test("a custom reading set gets a paper sheet and key through #r=", async ({
  page,
}) => {
  const set = {
    schema_version: 1,
    kind: "reading",
    id: "e2e-shared",
    title: "Shared reading set",
    summary: "A set carried by its link",
    mode: "practice",
    taxa_pool: {},
    trees: {
      t: {
        newick: "((a,b),(c,d));",
        node_letters: [],
        marks: [],
        traits: [],
        points: [],
      },
    },
    items: [
      {
        id: "q-clade",
        text: "Are {set} a clade in this tree?",
        trees: ["t"],
        tips: ["a", "b"],
        rotate_tool: false,
        question: { type: "is_clade" },
      },
    ],
  };
  const hash = `#r=${lzstring.compressToEncodedURIComponent(
    JSON.stringify({ v: 1, set }),
  )}`;

  await page.goto(`/?worksheet=custom&kind=paper${hash}`);
  await expect(
    page.getByRole("heading", { name: "Shared reading set", level: 1 }),
  ).toBeVisible();
  await expect(page.locator(".rt-figure svg")).toBeVisible();
  // The link block carries the #r= payload itself.
  await expect(page.locator(".ws-link-text a")).toHaveAttribute(
    "href",
    /#r=/,
  );

  await openKey(page, `/?key=custom&kind=paper${hash}`);
  await expect(
    page.getByRole("heading", { name: /— answer key/ }),
  ).toBeVisible();
  await expect(page.locator(".ws-answer")).toHaveCount(1);
});

test("every built-in reading set renders its paper sheet and key without console errors", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(String(e)));

  let gateDone = false;
  for (const id of READING_IDS) {
    errors.length = 0;
    await page.goto(`/?worksheet=${id}&kind=paper`);
    // A rendered sheet has items and at least one drawn tree; the
    // error state has neither, so the figure check pins a real render.
    await expect(
      page.locator(".ws-items, .error"),
      `${id} sheet rendered`,
    ).toBeVisible();
    await expect(
      page.locator(".rt-figure svg").first(),
      `${id} drew a tree`,
    ).toBeVisible();
    expect(errors, `${id} sheet console`).toEqual([]);

    await page.goto(`/?key=${id}&kind=paper`);
    if (!gateDone) {
      await passGate(page);
      gateDone = true;
    }
    await expect(
      page.locator(".ws-key-items, .error"),
      `${id} key rendered`,
    ).toBeVisible();
    expect(errors, `${id} key console`).toEqual([]);
  }
});

// §21(f): paper sheets print paper verbs, and a test-mode form is
// collected — it carries no QR that would open the test itself.
test("a test-mode paper sheet is handed in, with paper verbs", async ({
  page,
}) => {
  await page.goto("/?worksheet=trees-form-a&kind=paper");
  await expect(page.locator(".ws-items")).toBeVisible();
  await expect(
    page.getByText("Hand this sheet to your instructor."),
  ).toBeVisible();
  await expect(page.locator(".ws-linkblock")).toHaveCount(0);
  await expect(page.locator(".ws-qr")).toHaveCount(0);
  // The authored "Tap every tip that has limbs." prints re-verbed.
  await expect(
    page.getByText("Circle every tip that has limbs."),
  ).toBeVisible();
  const body = await page.locator(".ws-items").innerText();
  expect(body).not.toMatch(/\b[Tt]ap\b|\b[Cc]lick\b|\bSelect\b/);
});

test("a practice paper sheet keeps the check-in-app QR", async ({
  page,
}) => {
  await page.goto("/?worksheet=trees-demo&kind=paper");
  await expect(page.locator(".ws-items")).toBeVisible();
  await expect(
    page.getByText(/Check your answers in the app/),
  ).toBeVisible();
  await expect(page.locator(".ws-qr")).toBeVisible();
  await expect(
    page.getByText("Hand this sheet to your instructor."),
  ).toHaveCount(0);
});

// §21(a): the printed trait tree's mark labels used to touch the
// "hippo" tip label — with real getBBox() no mark label may
// intersect any tip label in the same figure.
test("form A's trait tree: mark labels clear the tip labels", async ({
  page,
}) => {
  await page.goto("/?worksheet=trees-form-a&kind=paper");
  await expect(page.locator(".rt-mark-label").first()).toBeVisible();
  const result = await page.evaluate(() => {
    const hits: string[] = [];
    let checked = 0;
    const marks = [
      ...document.querySelectorAll<SVGGraphicsElement>(".rt-mark-label"),
    ].filter(
      (el) =>
        el.textContent === "limbs" || el.textContent === "echolocation",
    );
    for (const m of marks) {
      const mb = m.getBBox();
      for (const el of m.ownerSVGElement!.querySelectorAll<SVGGraphicsElement>(
        ".rt-tip-label",
      )) {
        const tb = el.getBBox();
        checked += 1;
        if (
          mb.x < tb.x + tb.width &&
          mb.x + mb.width > tb.x &&
          mb.y < tb.y + tb.height &&
          mb.y + mb.height > tb.y
        ) {
          hits.push(
            `${m.textContent} touches ${el.textContent} @${m.ownerSVGElement!.id}`,
          );
        }
      }
    }
    return { hits, checked, marks: marks.length };
  });
  expect(result.marks, "trait marks drawn").toBeGreaterThan(0);
  expect(result.checked, "tip labels checked").toBeGreaterThan(0);
  expect(result.hits).toEqual([]);
});

// Fix round 1 (review 4): under a coarse pointer every interactive
// element on the worksheet pages — plain links included — meets the
// 40×40 px target the app promises elsewhere.
test.describe("coarse-pointer targets", () => {
  test.use({ hasTouch: true, isMobile: true });

  async function expectBigTargets(scope: Page | Locator, where: string) {
    const targets = scope.locator("a, button");
    const count = await targets.count();
    expect(count, `${where}: at least one link/button`).toBeGreaterThan(0);
    for (let i = 0; i < count; i += 1) {
      const el = targets.nth(i);
      if (!(await el.isVisible())) continue;
      const box = await el.boundingBox();
      const name =
        (await el.getAttribute("aria-label")) ??
        ((await el.innerText().catch(() => "")) || "").trim().slice(0, 60);
      expect(
        box !== null && box.width >= 40 && box.height >= 40,
        `${where}: "${name}" is ${box?.width}×${box?.height}`,
      ).toBe(true);
    }
  }

  test("every link and button on the worksheet pages is ≥ 40×40", async ({
    page,
  }) => {
    // The spec emulates a coarse pointer; pin that the media feature
    // really matches so the CSS rule is exercised, not skipped.
    expect(
      await page.evaluate(() =>
        window.matchMedia("(pointer: coarse)").matches,
      ),
    ).toBe(true);

    await page.goto("/?worksheet=nj-by-hand&kind=paper");
    await expect(
      page.getByRole("heading", { name: "1. The distance matrix" }),
    ).toBeVisible();
    await expectBigTargets(page, "paper sheet");

    await page.goto("/?worksheet=nj-by-hand&kind=app");
    await expect(page.locator(".ws-items")).toBeVisible();
    await expectBigTargets(page, "app sheet");

    // Task 13: the reading sheet's links and Show-as-text toggles
    // meet the same target.
    await page.goto("/?worksheet=trees-clades-traits&kind=paper");
    await expect(page.locator(".rt-figure svg").first()).toBeVisible();
    await expectBigTargets(page, "reading sheet");

    await page.goto("/?key=nj-by-hand&kind=paper");
    const gate = page.getByRole("dialog", {
      name: "Answer keys are for instructors",
    });
    await expect(gate).toBeVisible();
    await expectBigTargets(gate, "gate dialog");
    await gate.getByRole("button", { name: "I'm an instructor" }).click();
    await expect(
      page.getByRole("heading", { name: "1. The distance matrix" }),
    ).toBeVisible();
    await expectBigTargets(page, "paper key");
  });
});

test("axe-clean: the paper sheet and the gated key", async ({ page }) => {
  await page.goto("/?worksheet=nj-by-hand&kind=paper");
  await expect(
    page.getByRole("heading", { name: "1. The distance matrix" }),
  ).toBeVisible();
  const sheetScan = await new AxeBuilder({ page }).analyze();
  const sheetBad = sheetScan.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(
    sheetBad.map((v) => v.id),
    "paper sheet has no serious/critical axe violations",
  ).toEqual([]);

  await openKey(page, "/?key=nj-by-hand&kind=paper");
  await expect(
    page.getByRole("heading", { name: "1. The distance matrix" }),
  ).toBeVisible();
  const keyScan = await new AxeBuilder({ page }).analyze();
  const keyBad = keyScan.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(
    keyBad.map((v) => v.id),
    "paper key has no serious/critical axe violations",
  ).toEqual([]);

  // Task 13: the reading sheet and its gated key are axe-clean too.
  await page.goto("/?worksheet=trees-clades-traits&kind=paper");
  await expect(page.locator(".rt-figure svg").first()).toBeVisible();
  const readSheetScan = await new AxeBuilder({ page }).analyze();
  expect(
    readSheetScan.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    ).map((v) => v.id),
    "reading sheet has no serious/critical axe violations",
  ).toEqual([]);

  await openKey(page, "/?key=trees-clades-traits&kind=paper");
  await expect(page.locator(".ws-key-items")).toBeVisible();
  const readKeyScan = await new AxeBuilder({ page }).analyze();
  expect(
    readKeyScan.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    ).map((v) => v.id),
    "reading key has no serious/critical axe violations",
  ).toEqual([]);
});
