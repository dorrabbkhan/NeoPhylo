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

import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";

const EXERCISES = fileURLToPath(new URL("../../exercises", import.meta.url));

const LESSON_IDS = readdirSync(EXERCISES)
  .filter((f) => f.endsWith(".json") && f !== "schema.json")
  .map((f) => f.replace(/\.json$/, ""));
const LAB_IDS = readdirSync(`${EXERCISES}/labs`)
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.replace(/\.json$/, ""));
const ALL_IDS = [...LESSON_IDS, ...LAB_IDS];

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
});
