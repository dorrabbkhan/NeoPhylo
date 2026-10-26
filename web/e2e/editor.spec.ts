// Exercise editor end-to-end (v1.4 plan Task 8, spec §5.1): the Newick
// text and the branch-length table render one shared tree model on the
// `?editor` page — an edit in one view shows up in the other, and the
// engine's refusals (invalid Newick, duplicate taxa, negative lengths)
// are shown inline without changing the tree. The page itself is
// axe-clean.

import { test, expect } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";

const NEWICK = (page: import("@playwright/test").Page) =>
  page.getByRole("textbox", { name: "Newick tree" });
const TABLE = (page: import("@playwright/test").Page) =>
  page.getByRole("table", { name: "Branch lengths" });

test("Newick and branch table stay in sync through the shared model", async ({
  page,
}) => {
  await page.goto("/?editor");
  const newick = NEWICK(page);
  await expect(newick).toBeVisible();
  await expect(TABLE(page)).toBeVisible();

  // Typing Newick and pressing Enter updates the branch table.
  await newick.fill("(A:0.1,B:0.2,C:0.3);");
  await newick.press("Enter");
  await expect(
    TABLE(page).getByRole("textbox", {
      name: "Length of the branch to C",
    }),
  ).toHaveValue("0.3");

  // Editing a branch length rewrites the Newick text.
  const bInput = TABLE(page).getByRole("textbox", {
    name: "Length of the branch to B",
  });
  await bInput.fill("0.9");
  await bInput.press("Enter");
  await expect(newick).toHaveValue("(A:0.1,B:0.9,C:0.3);");
});

test("an invalid Newick shows the parse error and keeps the last tree", async ({
  page,
}) => {
  await page.goto("/?editor");
  const newick = NEWICK(page);
  await expect(newick).toBeVisible();

  await newick.fill("this is not newick");
  await newick.press("Enter");
  await expect(page.getByRole("alert")).toBeVisible();
  // The starter tree's rows are still in the table.
  await expect(
    TABLE(page).getByRole("textbox", {
      name: "Length of the branch to A",
    }),
  ).toBeVisible();
});

test("a duplicate taxon name is refused with the name in the message", async ({
  page,
}) => {
  await page.goto("/?editor");
  const newick = NEWICK(page);
  await expect(newick).toBeVisible();

  await newick.fill("(A:0.1,A:0.2,B:0.3);");
  await newick.press("Enter");
  const alert = page.getByRole("alert");
  await expect(alert).toBeVisible();
  await expect(alert).toContainText("A");
  await expect(alert).toContainText(/duplicate/i);
});

test('under (pointer: coarse) the "Back to NeoPhylo" link is ≥40×40', async ({
  browser,
}) => {
  const context = await browser.newContext({
    baseURL: "http://localhost:4173",
    viewport: { width: 768, height: 1024 },
    hasTouch: true,
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  await page.goto("/?editor");
  const home = page.getByRole("link", { name: "Back to NeoPhylo" });
  await expect(home).toBeVisible();
  expect(
    await page.evaluate(() => matchMedia("(pointer: coarse)").matches),
    "the emulation presents a coarse pointer",
  ).toBe(true);

  const box = await home.boundingBox();
  if (box === null) throw new Error("the home link has no bounding box");
  expect(
    box.width,
    `the home link is at least 40 px wide (got ${box.width}×${box.height})`,
  ).toBeGreaterThanOrEqual(40);
  expect(
    box.height,
    `the home link is at least 40 px tall (got ${box.width}×${box.height})`,
  ).toBeGreaterThanOrEqual(40);
  await context.close();
});

const CANVAS = (page: import("@playwright/test").Page) =>
  page.getByRole("application", { name: "Tree canvas" });

/** Drag `from`'s centre onto `to`'s centre with a real pointer. */
async function drag(
  page: import("@playwright/test").Page,
  from: import("@playwright/test").Locator,
  to: import("@playwright/test").Locator,
): Promise<void> {
  const a = await from.boundingBox();
  const b = await to.boundingBox();
  if (a === null || b === null) throw new Error("drag endpoint has no box");
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, {
    steps: 8,
  });
  await page.mouse.up();
}

test("a leaf dragged onto a branch moves it; the keyboard path produces the same Newick", async ({
  page,
}) => {
  await page.goto("/?editor");
  const newick = NEWICK(page);
  await newick.fill("(A:0.1,B:0.2,C:0.3);");
  await newick.press("Enter");

  await drag(
    page,
    page.getByRole("button", { name: "Leaf C" }),
    page.getByRole("button", { name: "Branch to B" }),
  );
  await expect(newick).toHaveValue("(A:0.1,(B:0.1,C:0.3):0.1);");
});

test("a touch drag drops on the branch under the finger, matching the keyboard path", async ({
  browser,
  browserName,
}) => {
  // Implicit pointer capture makes a touch pointerup's target the
  // dragged node regardless of where the finger lifts — only Chromium's
  // CDP Input.dispatchTouchEvent reproduces a real touch.
  test.skip(browserName !== "chromium", "CDP touch input is Chromium-only");
  const context = await browser.newContext({
    baseURL: "http://localhost:4173",
    hasTouch: true,
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  await page.goto("/?editor");
  const newick = NEWICK(page);
  await newick.fill("(A:0.1,B:0.2,C:0.3);");
  await newick.press("Enter");

  const leafC = page.getByRole("button", { name: "Leaf C" });
  const edgeB = page.getByRole("button", { name: "Branch to B" });
  const a = await leafC.boundingBox();
  const b = await edgeB.boundingBox();
  if (a === null || b === null) throw new Error("no box");
  const sx = a.x + a.width / 2;
  const sy = a.y + a.height / 2;
  const ex = b.x + b.width / 2;
  const ey = b.y + b.height / 2;

  const cdp = await context.newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: sx, y: sy, id: 1 }],
  });
  const steps = 8;
  for (let i = 1; i <= steps; i += 1) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        {
          x: sx + ((ex - sx) * i) / steps,
          y: sy + ((ey - sy) * i) / steps,
          id: 1,
        },
      ],
    });
  }
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  const byTouch = await newick.inputValue();

  // Reset and take the keyboard path: the touch drop must land on the
  // same move op, not a length pull on the captured node.
  await newick.fill("(A:0.1,B:0.2,C:0.3);");
  await newick.press("Enter");
  await leafC.focus();
  await page.keyboard.press("Enter");
  await edgeB.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("j");
  await expect(newick).toHaveValue(byTouch);
  await expect(newick).toHaveValue("(A:0.1,(B:0.1,C:0.3):0.1);");
  await context.close();
});

test("the keyboard path covers join, detach and length nudges without a drag", async ({
  page,
}) => {
  await page.goto("/?editor");
  const newick = NEWICK(page);
  await newick.fill("(A:0.1,B:0.2,C:0.3);");
  await newick.press("Enter");

  // Select leaf C, then the branch above B, then J → the same move op
  // a drag performs.
  await page.getByRole("button", { name: "Leaf C" }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Branch to B" }).focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("j");
  await expect(newick).toHaveValue("(A:0.1,(B:0.1,C:0.3):0.1);");

  // The selection survives the move — leaf C was evicted by the new
  // pick, so the selected items are B's edge and A's node; ArrowRight
  // nudges every selected branch by a fixed step.
  await page.getByRole("button", { name: "Leaf A" }).focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("ArrowRight");
  await expect(newick).toHaveValue("(A:0.11,(B:0.11,C:0.3):0.1);");
});

test("detach and re-join through the canvas (keyboard only)", async ({
  page,
}) => {
  await page.goto("/?editor");
  const newick = NEWICK(page);
  await expect(newick).toBeVisible();
  // Starter tree: ((A,B),C,(D,E)) — the (D,E) node's parent has three
  // children, so it detaches cleanly.
  const clade = page.getByRole("button", { name: "Node u3 (D, E)" });
  await clade.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Delete");
  await expect(newick).toHaveValue("((A:0.1,B:0.2):0.05,C:0.3);");
  // The detached component still draws (it can be re-joined).
  await expect(page.getByText(/Detached/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Leaf D" }),
  ).toBeVisible();
  // The detached root stays selected after Delete; selecting the main
  // root too gives J two component roots to join.
  await page.getByRole("button", { name: "Node u1 (A, B, C)" }).focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("j");
  await expect(newick).toHaveValue(
    "((D:0.1,E:0.15):0.1,((A:0.1,B:0.2):0.05,C:0.3):0.1);",
  );
});

test("a drag that would create a unary node is refused with the engine's message", async ({
  page,
}) => {
  await page.goto("/?editor");
  const newick = NEWICK(page);
  // A nested tree: A's parent has exactly two children, so detaching A
  // would leave it unary — the engine refuses.
  await newick.fill("((A:0.1,B:0.2):0.05,C:0.3);");
  await newick.press("Enter");

  // Drop leaf A on empty canvas space below the last row: a detach
  // attempt that would leave (A,B) with one child.
  const svg = CANVAS(page);
  const svgBox = await svg.boundingBox();
  const leafA = page.getByRole("button", { name: "Leaf A" });
  const from = await leafA.boundingBox();
  if (svgBox === null || from === null) throw new Error("no box");
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(svgBox.x + svgBox.width - 12, svgBox.y + svgBox.height - 6, {
    steps: 8,
  });
  await page.mouse.up();
  await expect(page.getByRole("alert")).toContainText(
    /fewer than two children/,
  );
  await expect(newick).toHaveValue("((A:0.1,B:0.2):0.05,C:0.3);");
});

test("Escape cancels an in-progress drag", async ({ page }) => {
  await page.goto("/?editor");
  const newick = NEWICK(page);
  await newick.fill("(A:0.1,B:0.2,C:0.3);");
  await newick.press("Enter");

  const leafC = page.getByRole("button", { name: "Leaf C" });
  const edgeB = page.getByRole("button", { name: "Branch to B" });
  const a = await leafC.boundingBox();
  const b = await edgeB.boundingBox();
  if (a === null || b === null) throw new Error("no box");
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, {
    steps: 8,
  });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(newick).toHaveValue("(A:0.1,B:0.2,C:0.3);");
});

test("dragging a branch end changes its length", async ({ page }) => {
  await page.goto("/?editor");
  const newick = NEWICK(page);
  await newick.fill("(A:0.1,B:0.2,C:0.3);");
  await newick.press("Enter");

  const leafC = page.getByRole("button", { name: "Leaf C" });
  const from = await leafC.boundingBox();
  if (from === null) throw new Error("no box");
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  // Pull the branch end 90 px to the right, staying on C's row.
  await page.mouse.move(from.x + from.width / 2 + 90, from.y + from.height / 2, {
    steps: 8,
  });
  await page.mouse.up();
  await expect(newick).not.toHaveValue("(A:0.1,B:0.2,C:0.3);");
  await expect(newick).toHaveValue(/C:0\.[0-9]/);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("a keyboard-focused handle shows a visible focus ring", async ({
  page,
}) => {
  await page.goto("/?editor");
  const svg = CANVAS(page);
  await expect(svg).toBeVisible();
  await svg.focus();
  // Tab into the canvas until a node or branch handle holds focus —
  // real keyboard input, so :focus-visible applies on every engine.
  let onHandle = await page.evaluate(
    () =>
      document.activeElement instanceof Element &&
      document.activeElement.closest("[data-node],[data-edge]") !== null,
  );
  for (let i = 0; i < 24 && !onHandle; i += 1) {
    await page.keyboard.press("Tab");
    onHandle = await page.evaluate(
      () =>
        document.activeElement instanceof Element &&
        document.activeElement.closest("[data-node],[data-edge]") !==
          null,
    );
  }
  expect(onHandle, "Tab reached a node or branch handle").toBe(true);

  const ring = await page.evaluate(() => {
    const el = document.activeElement;
    if (!(el instanceof Element)) return null;
    const ringEl = el.querySelector(".focus-ring");
    if (ringEl === null) return null;
    const cs = getComputedStyle(ringEl);
    return {
      focusVisible: el.matches(":focus-visible"),
      stroke: cs.stroke,
      strokeWidth: parseFloat(cs.strokeWidth),
    };
  });
  expect(ring?.focusVisible, "the handle matches :focus-visible").toBe(
    true,
  );
  expect(ring?.stroke, "the focus ring paints a stroke").not.toBe("none");
  expect(
    ring?.strokeWidth ?? 0,
    "the focus ring is at least 2 px wide",
  ).toBeGreaterThanOrEqual(2);
});

test("N adds a detached leaf; selecting a branch and J grafts it (keyboard only)", async ({
  page,
}) => {
  await page.goto("/?editor");
  const newick = NEWICK(page);
  await newick.fill("(A:0.1,B:0.2,C:0.3);");
  await newick.press("Enter");

  await CANVAS(page).focus();
  await page.keyboard.press("n");
  const nameInput = page.getByRole("textbox", { name: "New taxon name" });
  await expect(nameInput).toBeFocused();
  // The shortcut's own letter never lands in the field.
  await expect(nameInput).toHaveValue("");
  await nameInput.fill("F");
  await page.keyboard.press("Enter");

  // The new leaf draws as a detached component, selected and focused.
  await expect(page.getByText("Detached: F")).toBeVisible();
  const leafF = page.getByRole("button", { name: "Leaf F" });
  await expect(leafF).toBeFocused();
  await expect(leafF).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("status")).toContainText(/Added leaf F/);

  // F stays selected; add the branch to B and press J — the same move
  // op a drag onto that branch performs.
  await page.getByRole("button", { name: "Branch to B" }).focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("j");
  await expect(newick).toHaveValue("(A:0.1,(B:0.1,F:0.1):0.1,C:0.3);");
});

test("touch: the New leaf button, its ≥40 px target and a touch-drag graft", async ({
  browser,
  browserName,
}) => {
  // Implicit pointer capture makes a touch pointerup's target the
  // dragged node regardless of where the finger lifts — only Chromium's
  // CDP Input.dispatchTouchEvent reproduces a real touch.
  test.skip(browserName !== "chromium", "CDP touch input is Chromium-only");
  const context = await browser.newContext({
    baseURL: "http://localhost:4173",
    viewport: { width: 768, height: 1024 },
    hasTouch: true,
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  await page.goto("/?editor");
  const newick = NEWICK(page);
  await newick.fill("(A:0.1,B:0.2,C:0.3);");
  await newick.press("Enter");
  expect(
    await page.evaluate(() => matchMedia("(pointer: coarse)").matches),
    "the emulation presents a coarse pointer",
  ).toBe(true);

  const newLeafBtn = page.getByRole("button", { name: "New leaf" });
  await expect(newLeafBtn).toBeVisible();
  const btnBox = await newLeafBtn.boundingBox();
  if (btnBox === null) throw new Error("the New leaf button has no box");
  expect(
    btnBox.width,
    `the New leaf button is at least 40 px wide (got ${btnBox.width}×${btnBox.height})`,
  ).toBeGreaterThanOrEqual(40);
  expect(
    btnBox.height,
    `the New leaf button is at least 40 px tall (got ${btnBox.width}×${btnBox.height})`,
  ).toBeGreaterThanOrEqual(40);

  const cdp = await context.newCDPSession(page);
  const tap = async (x: number, y: number): Promise<void> => {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y, id: 1 }],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  };

  // Tap "New leaf": the inline form opens with its input focused.
  await tap(btnBox.x + btnBox.width / 2, btnBox.y + btnBox.height / 2);
  const nameInput = page.getByRole("textbox", { name: "New taxon name" });
  await expect(nameInput).toBeFocused();
  await page.keyboard.insertText("F");
  const submitBtn = page.getByRole("button", { name: "Add leaf" });
  const submitBox = await submitBtn.boundingBox();
  if (submitBox === null) throw new Error("the Add leaf button has no box");
  await tap(submitBox.x + submitBox.width / 2, submitBox.y + submitBox.height / 2);
  await expect(page.getByText("Detached: F")).toBeVisible();

  // Touch-drag the new leaf onto the branch to B — the same move op
  // the keyboard path produces.
  const leafF = page.getByRole("button", { name: "Leaf F" });
  const edgeB = page.getByRole("button", { name: "Branch to B" });
  const a = await leafF.boundingBox();
  const b = await edgeB.boundingBox();
  if (a === null || b === null) throw new Error("no box");
  const sx = a.x + a.width / 2;
  const sy = a.y + a.height / 2;
  const ex = b.x + b.width / 2;
  const ey = b.y + b.height / 2;
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: sx, y: sy, id: 1 }],
  });
  const steps = 8;
  for (let i = 1; i <= steps; i += 1) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        {
          x: sx + ((ex - sx) * i) / steps,
          y: sy + ((ey - sy) * i) / steps,
          id: 1,
        },
      ],
    });
  }
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect(newick).toHaveValue("(A:0.1,(B:0.1,F:0.1):0.1,C:0.3);");
  await context.close();
});

test("under (pointer: coarse) the canvas's node and branch hit targets are ≥40×40", async ({
  browser,
}) => {
  const context = await browser.newContext({
    baseURL: "http://localhost:4173",
    viewport: { width: 768, height: 1024 },
    hasTouch: true,
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  await page.goto("/?editor");
  await expect(CANVAS(page)).toBeVisible();
  expect(
    await page.evaluate(() => matchMedia("(pointer: coarse)").matches),
    "the emulation presents a coarse pointer",
  ).toBe(true);

  const pads = page.locator(".node-hit-pad");
  const padCount = await pads.count();
  expect(padCount).toBeGreaterThan(0);
  for (let i = 0; i < padCount; i += 1) {
    const box = await pads.nth(i).boundingBox();
    if (box === null) throw new Error("node pad has no box");
    expect(
      box.width >= 40 && box.height >= 40,
      `node pad ${i} is at least 40×40 (got ${box.width}×${box.height})`,
    ).toBe(true);
  }
  const edgePads = page.locator(".edge-hit-pad");
  const edgeCount = await edgePads.count();
  expect(edgeCount).toBeGreaterThan(0);
  for (let i = 0; i < edgeCount; i += 1) {
    const box = await edgePads.nth(i).boundingBox();
    if (box === null) throw new Error("edge pad has no box");
    expect(
      box.width >= 40 && box.height >= 40,
      `edge pad ${i} is at least 40×40 (got ${box.width}×${box.height})`,
    ).toBe(true);
  }
  await context.close();
});

test("axe: the editor page has no serious violations", async ({ page }) => {
  await page.goto("/?editor");
  await expect(NEWICK(page)).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  const bad = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(
    bad.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target).join(", ")}`),
    "the editor page must have no serious/critical axe violations",
  ).toEqual([]);
});
