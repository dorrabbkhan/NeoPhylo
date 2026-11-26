// embed.spec.ts (v1.5 plan Task 8, spec §7.4): `?embed` chrome —
// and the same mode switched on automatically inside a frame
// (`window.top !== window.self`, conductor note 2) — plus the
// blocked-storage path (Review Focus 5): the student still
// finishes, can copy the code, and the page says progress won't
// survive a reload.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

import { assignmentLink } from "./assess";
import { waitForApp } from "./helpers";

const NJ_BASICS = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL("../../exercises/nj-basics.json", import.meta.url),
    ),
    "utf8",
  ),
) as unknown;

const ASSIGNMENT = {
  schema_version: 1,
  kind: "assignment",
  id: "e2e-embed",
  title: "E2E embed assignment",
  content: { exercise: NJ_BASICS },
  id_prompt: { label: "university email", rule: "trim_lower" },
  mode: "practice",
  variation: true,
  tasks: [{ task: { kind: "predict_pair", step: 1 } }],
};

const EMBED_LINK = assignmentLink(ASSIGNMENT).replace("/#", "/?embed#");

test("?embed hides the chrome and offers Open in a new tab", async ({
  page,
}) => {
  await page.goto(EMBED_LINK);
  // Start page: no header/footer chrome, the new-tab affordance.
  await expect(page.getByLabel(/university email/i)).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.locator("header.app-header")).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Open in a new tab" }),
  ).toBeVisible();

  await page.getByLabel(/university email/i).fill("sara");
  await page.getByRole("button", { name: "Start" }).click();
  await waitForApp(page);
  // The working page keeps the embed bar but never the app's
  // header or its footer links (spec §7.4).
  await expect(page.locator("header.app-header")).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Open in a new tab" }),
  ).toBeVisible();
});

test("a cross-origin frame turns embed mode on without ?embed", async ({
  page,
}) => {
  // A test page on about:blank (a different origin than the app)
  // frames the plain link — the comparison in Root switches embed
  // on inside the frame.
  await page.setContent(
    `<iframe src="http://localhost:4173${assignmentLink(ASSIGNMENT)}" ` +
      `style="width: 100%; height: 100vh; border: 0"></iframe>`,
  );
  const frame = page.frameLocator("iframe");
  await expect(frame.getByLabel(/university email/i)).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    frame.getByRole("link", { name: "Open in a new tab" }),
  ).toBeVisible();

  await frame.getByLabel(/university email/i).fill("sara");
  await frame.getByRole("button", { name: "Start" }).click();
  await expect(frame.locator(".app")).toBeVisible({ timeout: 30_000 });
  await expect(
    frame.getByRole("link", { name: "Open in a new tab" }),
  ).toBeVisible();
  await expect(frame.locator("header.app-header")).toHaveCount(0);
});

test("inside a real frame the stepper footer pins to the viewport (1024×768 and 768×1024)", async ({
  page,
}) => {
  for (const vp of [
    { width: 1024, height: 768 },
    { width: 768, height: 1024 },
  ]) {
    await page.setViewportSize(vp);
    // A distinct assignment id per size — the storage key names the
    // assignment, so the second frame can't auto-resume the first
    // iteration's session past the start page.
    const a = {
      ...ASSIGNMENT,
      id: `${ASSIGNMENT.id}-pins-${vp.width}x${vp.height}`,
    };
    await page.setContent(
      `<iframe src="http://localhost:4173${assignmentLink(a)}" ` +
        `style="width: 100%; height: 100vh; border: 0"></iframe>`,
    );
    const frame = page.frameLocator("iframe");
    await expect(frame.getByLabel(/university email/i)).toBeVisible({
      timeout: 30_000,
    });
    await frame.getByLabel(/university email/i).fill("sara");
    await frame.getByRole("button", { name: "Start" }).click();
    await expect(frame.locator(".app")).toBeVisible({ timeout: 30_000 });

    const box = await frame
      .getByRole("button", { name: "Next step" })
      .boundingBox();
    expect(box, `Next step renders at ${vp.width}×${vp.height}`).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(
      box!.x + box!.width,
      "Next step's right edge inside the frame's viewport",
    ).toBeLessThanOrEqual(vp.width);
    expect(
      box!.y + box!.height,
      "Next step's bottom edge inside the frame's viewport",
    ).toBeLessThanOrEqual(vp.height);

    const inner = page
      .frames()
      .find((f) => f !== page.mainFrame());
    const metrics = await inner!.evaluate(() => ({
      y: window.scrollY,
      scrollHeight: document.documentElement.scrollHeight,
    }));
    expect(metrics.y, "the framed document is not scrolled").toBe(0);
    expect(
      metrics.scrollHeight,
      `the framed document fits ${vp.height}px (got ${metrics.scrollHeight})`,
    ).toBeLessThanOrEqual(vp.height);
  }
});

test("storage blocked: the student still finishes and the page says so (Review Focus 5)", async ({
  context,
  page,
}) => {
  // Third-party storage blocked: every localStorage access throws
  // before the app's scripts run (spec §7.2/§7.4).
  await context.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("Access is denied", "SecurityError");
      },
    });
  });
  await page.goto(EMBED_LINK);
  await page.getByLabel(/university email/i).fill("sara");
  await page.getByRole("button", { name: "Start" }).click();
  await waitForApp(page);
  await expect(page.getByRole("status")).toContainText(
    /progress won't survive a reload/i,
  );

  await page.getByRole("button", { name: "Finish" }).click();
  await expect(page.locator(".assess-code")).not.toBeEmpty();
  await expect(page.getByRole("status")).toContainText(
    /progress won't survive a reload/i,
  );

  // The Copy affordance stays — where the Clipboard API exists the
  // copy lands; where it doesn't the code text stays selectable.
  await context.grantPermissions(
    ["clipboard-read", "clipboard-write"],
    { origin: "http://localhost:4173" },
  ).catch(() => {});
  await page
    .getByRole("button", { name: /Copy/ })
    .click()
    .catch(() => {});
  const clip = await page
    .evaluate(() => navigator.clipboard?.readText?.() ?? "")
    .catch(() => "");
  const shown = await page.locator(".assess-code").innerText();
  if (clip !== "") {
    expect(clip).toBe(shown);
  } else {
    await expect(page.locator(".assess-code")).toBeVisible();
  }
});
