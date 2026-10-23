// Theme end-to-end tests (v1.3 plan Task 6, spec §3.3):
//
// - The default theme is light regardless of the OS
//   prefers-color-scheme; a stored neophylo.theme pref wins.
// - The header toggle carries aria-pressed and the choice persists
//   across a reload (device-local, never in the URL).
// - Review Focus 3: with storage throwing, the app still boots light
//   with no uncaught errors, and the toggle works for the session.
// - Review Focus 4: switching theme while a bootstrap run is in
//   progress and the pair panel is open loses nothing — the run keeps
//   going and the dialog stays open.
// - axe reports no serious/critical violations in either theme — on the
//   page and on the open pair panel (its tinted residues are where the
//   dark-theme contrast failure lived).

import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";
import { fileURLToPath } from "node:url";

import { stepToEnd, waitForApp } from "./helpers";

// No theme test needs the PWA service worker; blocking it also keeps
// the dev server's sw.js 404 out of the console-error assertion below.
test.use({ serviceWorkers: "block" });

const P6_150 = fileURLToPath(
  new URL("../../fixtures/inputs/protein/p6_150.fasta", import.meta.url),
);

const dataTheme = (page: Page) =>
  page.evaluate(() => document.documentElement.dataset.theme);
const toggle = (page: Page) =>
  page.getByRole("button", { name: "Dark mode" });

async function expectNoSeriousViolations(
  page: Page,
  where: string,
  scope?: string,
): Promise<void> {
  let builder = new AxeBuilder({ page });
  if (scope !== undefined) builder = builder.include(scope);
  const results = await builder.analyze();
  const bad = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(
    bad.map(
      (v) =>
        `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
    ),
    `${where} must have no serious/critical axe violations`,
  ).toEqual([]);
}

test("the default theme is light even when the OS prefers dark", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/?lesson=nj-basics");
  await waitForApp(page);
  expect(await dataTheme(page)).toBe("light");
  // The page background lives on :root (html), not body.
  await expect
    .poll(async () =>
      page.evaluate(
        () => getComputedStyle(document.documentElement).backgroundColor,
      ),
    )
    .toBe("rgb(255, 255, 255)");
});

test("the toggle has aria-pressed, stays out of the URL, and persists across a reload", async ({
  page,
}) => {
  await page.goto("/?lesson=nj-basics");
  await waitForApp(page);
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");
  await toggle(page).click();
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
  expect(await dataTheme(page)).toBe("dark");
  expect(page.url()).not.toContain("theme");
  await page.reload();
  await waitForApp(page);
  expect(await dataTheme(page)).toBe("dark");
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
});

test("blocked storage: the app loads light with no errors and the toggle still works for the session", async ({
  page,
  context,
}) => {
  await context.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("storage is blocked", "SecurityError");
      },
    });
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto("/?lesson=nj-basics");
  await waitForApp(page);
  expect(await dataTheme(page)).toBe("light");
  await toggle(page).click();
  expect(await dataTheme(page)).toBe("dark");
  // The dev server 404s sw.js registration (an expected console error
  // outside storage) — filter that known noise, assert nothing else.
  expect(errors.filter((e) => !/sw\.js|service worker/i.test(e))).toEqual(
    [],
  );
});

test("switching theme mid-run keeps the bootstrap going and the pair panel open", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.goto("/?lesson=cytochrome-c");
  await waitForApp(page);
  await stepToEnd(page);
  const { max } = await (async () => {
    const m = /step (\d+) of (\d+)/.exec(
      await page.locator(".stepper-status").innerText(),
    );
    return { max: Number(m![2]) };
  })();
  await page.getByRole("button", { name: /Run bootstrap/ }).click();
  // At the final position the matrix is the 3×3 final-join matrix of
  // cluster labels — pair cells resolve to alignment sequences only on
  // earlier steps (App's onPickPairCell/pairDetail). Step the slider
  // back to the full taxon matrix while the run keeps going behind;
  // the run's own status UI returns at the final position.
  await page.locator('[aria-label="Step"]').fill("0");
  await page.locator('[role="gridcell"][data-i="0"][data-j="1"]').click();
  const panel = page.getByRole("dialog");
  await expect(panel).toBeVisible();
  // Task 10: the toggle is raised above the scrim so theme switching
  // stays a real pointer path while a dialog is open (Review Focus 4).
  await toggle(page).click();
  expect(await dataTheme(page)).toBe("dark");
  await expect(panel).toBeVisible();
  // The dialog stayed open through the switch — that assertion is done.
  // Close it so the stepper and the confirm gate's Start are clickable,
  // then return to the final position where the run's panel lives. The
  // real toggle click moved focus to the header, so the dialog's own ×
  // is the real path out.
  await panel.getByRole("button", { name: "Close pair details" }).click();
  await expect(panel).toHaveCount(0);
  await page.locator('[aria-label="Step"]').fill(String(max));
  const done = page.getByText(/Run complete: /);
  const start = page.getByRole("button", { name: "Start", exact: true });
  const doneWait = done
    .waitFor({ timeout: 120_000 })
    .then(() => "done" as const);
  const startWait = start
    .waitFor({ timeout: 120_000 })
    .then(() => "confirm" as const);
  doneWait.catch(() => {});
  startWait.catch(() => {});
  const winner = await Promise.race([doneWait, startWait]);
  if (winner === "confirm") await start.click();
  await expect(done).toBeVisible({ timeout: 120_000 });
  expect(await dataTheme(page)).toBe("dark");
});

test("axe is clean in both themes", async ({ page }) => {
  await page.goto("/?lesson=nj-basics");
  await waitForApp(page);
  await expectNoSeriousViolations(page, "light theme");
  await toggle(page).click();
  expect(await dataTheme(page)).toBe("dark");
  await expectNoSeriousViolations(page, "dark theme");
});

test("axe is clean on the open pair panel in both themes", async ({
  page,
}) => {
  await page.goto("/");
  await waitForApp(page);
  await page.getByRole("radio", { name: "Sandbox" }).click();
  await page
    .locator('.import-panel input[type="file"]')
    .setInputFiles(P6_150);
  await expect(page.locator('[role="gridcell"]')).toHaveCount(36);
  await page.locator('[role="gridcell"][data-i="0"][data-j="1"]').click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  // The dialog holds the tinted residue cells — the scan is scoped to
  // it so a violation can't hide behind the rest of the page.
  await expectNoSeriousViolations(
    page,
    "pair panel (light theme)",
    '[role="dialog"]',
  );
  // Task 10: the toggle stays a real click target above the scrim.
  await toggle(page).click();
  expect(await dataTheme(page)).toBe("dark");
  await expectNoSeriousViolations(
    page,
    "pair panel (dark theme)",
    '[role="dialog"]',
  );
});
