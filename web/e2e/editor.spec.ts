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

test("touch: drops onto a node and onto a branch match the keyboard path and never detach", async ({
  browser,
  browserName,
}) => {
  // Under (pointer: coarse) the .node-touch overlays sit above the
  // svg — a release inside a node's 40 px box must still resolve to
  // the node or branch beneath, not "empty canvas" (fix round 1:
  // a node→node drop used to detach). Only Chromium's CDP
  // Input.dispatchTouchEvent reproduces a real touch pointer.
  test.skip(browserName !== "chromium", "CDP touch input is Chromium-only");
  const context = await browser.newContext({
    baseURL: "http://localhost:4173",
    viewport: { width: 768, height: 1024 },
    hasTouch: true,
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  await page.goto("/?editor");
  // Below 1024 px the Newick field lives in its sheet (Task 10).
  const openNewick = async () => {
    await page.getByRole("button", { name: "Newick tree" }).click();
    return NEWICK(page);
  };
  const setTree = async (text: string) => {
    const newick = await openNewick();
    await newick.fill(text);
    await newick.press("Enter");
    await page.keyboard.press("Escape");
  };
  await setTree("(A:0.1,B:0.2,C:0.3);");
  expect(
    await page.evaluate(() => matchMedia("(pointer: coarse)").matches),
    "the emulation presents a coarse pointer",
  ).toBe(true);
  // The overlays are up — the bug only exists while they are.
  await expect(page.locator(".node-touch").first()).toBeVisible();

  const cdp = await context.newCDPSession(page);
  const touchDrag = async (
    from: import("@playwright/test").Locator,
    to: import("@playwright/test").Locator,
  ): Promise<void> => {
    const a = await from.boundingBox();
    const b = await to.boundingBox();
    if (a === null || b === null) throw new Error("drag endpoint has no box");
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
  };

  const leafC = page.getByRole("button", { name: "Leaf C" });
  const leafB = page.getByRole("button", { name: "Leaf B" });
  const edgeB = page.getByRole("button", { name: "Branch to B" });
  const MOVED = "(A:0.1,(B:0.1,C:0.3):0.1);";

  // Drop leaf C onto leaf B's NODE — covered by B's overlay — and the
  // op must be the move the keyboard path produces, never a detach.
  await touchDrag(leafC, leafB);
  let newick = await openNewick();
  await expect(newick).toHaveValue(MOVED);
  await page.keyboard.press("Escape");
  await expect(page.getByText(/Detached/)).toHaveCount(0);

  // The same drop onto B's branch produces the same Newick.
  await setTree("(A:0.1,B:0.2,C:0.3);");
  await touchDrag(leafC, edgeB);
  newick = await openNewick();
  const byTouch = await newick.inputValue();
  expect(byTouch).toBe(MOVED);
  await page.keyboard.press("Escape");

  // The keyboard path — select leaf C, select the branch to B, J —
  // lands the identical op.
  await setTree("(A:0.1,B:0.2,C:0.3);");
  await leafC.focus();
  await page.keyboard.press("Enter");
  await edgeB.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("j");
  newick = await openNewick();
  await expect(newick).toHaveValue(byTouch);
  await expect(newick).toHaveValue(MOVED);
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
  const clade = page.getByRole("button", { name: "Node (D, E)" });
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
  await page.getByRole("button", { name: "Node (A, B, C)" }).focus();
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

// Fix round 3 (owner decision B): a leaf's label must clear the
// largest decoration that can surround its dot — the selected dot,
// the :focus-visible ring (2.5 px stroke), both at once — and a ring
// around any node must stay inside the viewBox, even for a detached
// leaf at the canvas's left edge.

interface DecorBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

const overlaps = (a: DecorBox, b: DecorBox): boolean =>
  a.x < b.x + b.width &&
  b.x < a.x + a.width &&
  a.y < b.y + b.height &&
  b.y < a.y + a.height;

const inside = (b: DecorBox, view: DecorBox): boolean =>
  b.x >= view.x &&
  b.y >= view.y &&
  b.x + b.width <= view.x + view.width &&
  b.y + b.height <= view.y + view.height;

/** Focus a canvas handle by real keyboard Tab presses so
 * :focus-visible paints on every engine (a scripted .focus() is
 * engine-dependent). */
async function tabToHandle(
  page: import("@playwright/test").Page,
  name: string,
): Promise<void> {
  await CANVAS(page).focus();
  for (let i = 0; i < 60; i += 1) {
    const on = await page.evaluate(
      (n) =>
        document.activeElement instanceof Element &&
        document.activeElement.getAttribute("aria-label") === n,
      name,
    );
    if (on) return;
    await page.keyboard.press("Tab");
  }
  throw new Error(`Tab never reached "${name}"`);
}

/** A canvas handle's painted focus-ring bounds (stroke included), its
 * leaf label's bounds, and the svg's viewBox — all in svg user units,
 * so the comparisons are exact regardless of display scaling. */
async function decorBoxes(
  page: import("@playwright/test").Page,
  name: string,
): Promise<{
  focusVisible: boolean;
  selected: boolean;
  ring: DecorBox | null;
  label: DecorBox | null;
  view: DecorBox;
} | null> {
  return page.evaluate((n) => {
    const handle = document.querySelector(
      `.draw-canvas [aria-label="${n}"]`,
    );
    if (!(handle instanceof SVGElement)) return null;
    const box = (el: SVGGraphicsElement | null): DecorBox | null => {
      if (el === null) return null;
      const b = el.getBBox();
      const sw = parseFloat(getComputedStyle(el).strokeWidth) || 0;
      return {
        x: b.x - sw / 2,
        y: b.y - sw / 2,
        width: b.width + sw,
        height: b.height + sw,
      };
    };
    const svg = handle.ownerSVGElement;
    if (svg === null) return null;
    const vb = svg.viewBox.baseVal;
    return {
      focusVisible: handle.matches(":focus-visible"),
      selected: handle.getAttribute("data-selected") === "true",
      ring: box(
        handle.querySelector<SVGGraphicsElement>("circle.focus-ring"),
      ),
      label: box(
        handle.querySelector<SVGGraphicsElement>("text.leaf-name"),
      ),
      view: { x: vb.x, y: vb.y, width: vb.width, height: vb.height },
    };
  }, name);
}

/** (a) the label's box does not intersect the focus ring's box;
 * (b) the ring's box lies inside the svg's box. */
async function expectDecorClear(
  page: import("@playwright/test").Page,
  name: string,
): Promise<void> {
  const d = await decorBoxes(page, name);
  if (d === null) throw new Error(`no canvas handle named "${name}"`);
  expect(d.focusVisible, `${name} holds :focus-visible`).toBe(true);
  expect(d.selected, `${name} is selected`).toBe(true);
  if (d.ring === null) throw new Error(`${name} has no focus ring`);
  if (d.label !== null) {
    expect(
      overlaps(d.label, d.ring),
      `${name}'s label must not overlap its focus ring`,
    ).toBe(false);
  }
  expect(
    inside(d.ring, d.view),
    `${name}'s focus ring must stay inside the svg`,
  ).toBe(true);
}

test("a selected and focused node keeps its ring clear of its label and inside the canvas", async ({
  page,
}) => {
  await page.goto("/?editor");
  const newick = NEWICK(page);
  await newick.fill("(A:0.1,B:0.2,C:0.3);");
  await newick.press("Enter");

  // The main-tree root — an unlabeled node at the left edge; its
  // ring alone must stay inside the canvas. (Checked before the add
  // below: a new arena leaf renumbers the u-names.)
  await tabToHandle(page, "Node (A, B, C)");
  await page.keyboard.press("Enter");
  await expectDecorClear(page, "Node (A, B, C)");

  // The right-edge leaf of the main tree, selected+focused.
  await tabToHandle(page, "Leaf C");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", { name: "Leaf C" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expectDecorClear(page, "Leaf C");

  // The reported scene: a newly added detached leaf sits at the
  // canvas's far left, selected and focused.
  await CANVAS(page).focus();
  await page.keyboard.press("n");
  const nameInput = page.getByRole("textbox", { name: "New taxon name" });
  await nameInput.fill("F");
  await page.keyboard.press("Enter");
  const leafF = page.getByRole("button", { name: "Leaf F" });
  await expect(leafF).toBeFocused();
  await expect(leafF).toHaveAttribute("aria-pressed", "true");
  // Re-focus through real Tab presses so :focus-visible paints on
  // every engine; the add flow's scripted focus is engine-dependent.
  await tabToHandle(page, "Leaf F");
  await expectDecorClear(page, "Leaf F");
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
  // Below 1024 px the Newick field lives in its sheet (Task 10).
  await page.getByRole("button", { name: "Newick tree" }).click();
  const newick = NEWICK(page);
  await newick.fill("(A:0.1,B:0.2,C:0.3);");
  await newick.press("Enter");
  await page.keyboard.press("Escape");
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
  await page.getByRole("button", { name: "Newick tree" }).click();
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

// ---- Task 10 (spec §5.3–5.5): settings, prompts, preview, sheets ----

test("below 1024 px the Newick and table views open as full-screen sheets, and Escape returns focus", async ({
  browser,
}) => {
  const context = await browser.newContext({
    baseURL: "http://localhost:4173",
    viewport: { width: 768, height: 1024 },
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  await page.goto("/?editor");

  // The views leave the grid: two buttons stand in for them.
  const newickBtn = page.getByRole("button", { name: "Newick tree" });
  const tableBtn = page.getByRole("button", { name: "Branch lengths" });
  await expect(newickBtn).toBeVisible();
  await expect(tableBtn).toBeVisible();
  await expect(NEWICK(page)).toHaveCount(0);
  await expect(TABLE(page)).toHaveCount(0);

  // The Newick sheet: a dialog covering the viewport.
  await newickBtn.click();
  const sheet = page.getByRole("dialog", { name: "Newick tree" });
  await expect(sheet).toBeVisible();
  await expect(NEWICK(page)).toBeVisible();
  const box = await sheet.boundingBox();
  const vp = page.viewportSize();
  expect(box).not.toBeNull();
  expect(Math.round(box!.width)).toBe(vp!.width);
  expect(Math.round(box!.height)).toBe(vp!.height);

  // Editing still reaches the model: the table sheet sees it too.
  await NEWICK(page).fill("(A:0.1,B:0.2,C:0.3);");
  await NEWICK(page).press("Enter");
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  // Focus went back to the button that opened the sheet.
  await expect(newickBtn).toBeFocused();

  await tableBtn.click();
  const tableSheet = page.getByRole("dialog", {
    name: "Branch lengths",
  });
  await expect(tableSheet).toBeVisible();
  await expect(
    TABLE(page).getByRole("textbox", {
      name: "Length of the branch to C",
    }),
  ).toHaveValue("0.3");
  await page.keyboard.press("Escape");
  await expect(tableSheet).toHaveCount(0);
  await expect(tableBtn).toBeFocused();
  await context.close();
});

test("a prompt added in the list appears in the preview with its gate", async ({
  page,
  context,
}) => {
  await page.goto("/?editor");
  await page.getByRole("button", { name: "Add note" }).click();
  await page
    .getByRole("textbox", { name: "Prompt 1 concept" })
    .fill("Watch the first join happen.");
  await page
    .getByRole("spinbutton", { name: "Prompt 1 join step" })
    .fill("1");

  // Preview opens the exercise through the real lesson player — a new
  // tab on the #x= link, unchanged.
  const [popup] = await Promise.all([
    context.waitForEvent("page"),
    page.getByRole("button", { name: "Preview" }).click(),
  ]);
  await popup.waitForLoadState();
  await expect(popup.locator(".app")).toBeVisible();
  // at_step 1 shows at stepper position 0 — the gate holds.
  await expect(
    popup.locator(".prompt-card", { hasText: "Watch the first join" }),
  ).toBeVisible();
  await popup.close();
});

test("a share link too long for the limit says so and offers the file (Review Focus 4)", async ({
  page,
}) => {
  await page.goto("/?editor");
  // Deterministic, poorly compressible padding (Math.random is banned)
  // — the same construction exerciseFile.test.ts uses to pass the
  // SHARE_LINK_MAX_LENGTH limit.
  let pad = "";
  for (let i = 0; pad.length < 9000; i++) {
    pad += i.toString(36) + "-";
  }
  await page
    .getByRole("textbox", { name: "Title" })
    .fill(`An exercise ${pad}`);
  await page.getByRole("button", { name: "Share link" }).click();
  const alert = page.getByRole("alert");
  await expect(alert).toBeVisible();
  await expect(alert).toContainText(/too long|over \d+ characters/i);
  await expect(alert).toContainText(/save the file/i);
});

test("the κ field appears only for K2P_PHYLIP, rejects 0 and warns under dnadist's clamp", async ({
  page,
}) => {
  await page.goto("/?editor");
  const kappa = page.getByRole("textbox", { name: "Kappa (κ)" });
  await expect(kappa).toHaveCount(0);
  await page
    .getByRole("combobox", { name: "Model" })
    .selectOption("K2P_PHYLIP");
  await expect(kappa).toBeVisible();

  await kappa.fill("0");
  await expect(page.getByRole("alert")).toContainText(/positive/i);
  await expect(
    page.getByRole("button", { name: "Save file" }),
  ).toBeDisabled();

  await kappa.fill("0.4");
  await expect(
    page.getByText(/dnadist treats ratios ≤ 0\.5 as 0\.5/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save file" }),
  ).toBeEnabled();
});

test("F84 base frequencies show their sum and block save until it is 1", async ({
  page,
}) => {
  await page.goto("/?editor");
  await page.getByRole("combobox", { name: "Model" }).selectOption("F84");
  await expect(
    page.getByRole("textbox", { name: "Base frequency A" }),
  ).toHaveValue("0.25");
  await expect(
    page.getByText(/Sum: 1 — must be 1 to save\./),
  ).toBeVisible();

  await page
    .getByRole("textbox", { name: "Base frequency A" })
    .fill("0.9");
  await expect(
    page.getByText(/Sum: 1\.65 — must be 1 to save\./),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save file" }),
  ).toBeDisabled();
  await page
    .getByRole("textbox", { name: "Base frequency A" })
    .fill("0.25");
  await expect(
    page.getByRole("button", { name: "Save file" }),
  ).toBeEnabled();
});

test("touch: a swipe over empty canvas scrolls the page while a handle drag still drags", async ({
  browser,
  browserName,
}) => {
  // Real touch input only exists via Chromium's CDP
  // Input.dispatchTouchEvent.
  test.skip(browserName !== "chromium", "CDP touch input is Chromium-only");
  const context = await browser.newContext({
    baseURL: "http://localhost:4173",
    viewport: { width: 768, height: 1024 },
    hasTouch: true,
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  await page.goto("/?editor");
  expect(
    await page.evaluate(() => matchMedia("(pointer: coarse)").matches),
    "the emulation presents a coarse pointer",
  ).toBe(true);

  // A 12-taxon tree so the editor page is taller than the viewport —
  // typed into the sheet's field (the Newick view is a sheet here).
  const tall =
    "(((T0:0.1,T1:0.1,T2:0.1):0.1,(T3:0.1,T4:0.1,T5:0.1):0.1):0.1," +
    "((T6:0.1,T7:0.1,T8:0.1):0.1,(T9:0.1,T10:0.1,T11:0.1):0.1):0.1);";
  await page.getByRole("button", { name: "Newick tree" }).click();
  const newick = NEWICK(page);
  await newick.fill(tall);
  await newick.press("Enter");
  // It parsed — otherwise the rest of the test pins a refusal, not
  // the scroll behaviour.
  await expect(page.getByRole("button", { name: "Leaf T0" })).toBeVisible();
  await page.keyboard.press("Escape");

  const cdp = await context.newCDPSession(page);
  const swipe = async (
    sx: number,
    sy: number,
    ex: number,
    ey: number,
  ): Promise<void> => {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: sx, y: sy, id: 1 }],
    });
    const steps = 10;
    for (let i = 1; i <= steps; i += 1) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [
          { x: sx + ((ex - sx) * i) / steps, y: sy + ((ey - sy) * i) / steps, id: 1 },
        ],
      });
    }
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  };

  const scrollPos = () =>
    page.evaluate(() => {
      const box = document.querySelector(".draw-canvas-box");
      return (
        window.scrollY + (box === null ? 0 : box.scrollTop)
      );
    });

  // A vertical swipe over EMPTY canvas must scroll the page/box — not
  // drag or select anything. Pick the start point by hit-test: a spot
  // inside the canvas box where elementFromPoint lands on the bare
  // svg (no handle, no overlay).
  const empty = await page.evaluate(() => {
    const inner = document.querySelector(".draw-canvas-inner");
    const box = document.querySelector(".draw-canvas-box");
    if (inner === null || box === null) return null;
    const r = box.getBoundingClientRect();
    for (let y = r.bottom - 8; y > r.top + 8; y -= 12) {
      for (let x = r.right - 8; x > r.left + 8; x -= 24) {
        const el = document.elementFromPoint(x, y);
        if (el !== null && el.classList.contains("draw-canvas")) {
          return { x, y };
        }
      }
    }
    return null;
  });
  if (empty === null) {
    throw new Error("no bare-canvas point found inside the canvas box");
  }
  const start = await scrollPos();
  await swipe(empty.x, empty.y, empty.x, empty.y - 200);
  await page.waitForTimeout(150);
  expect(
    await scrollPos(),
    "a swipe over empty canvas scrolls the page",
  ).toBeGreaterThan(start);

  // A touch-drag that starts ON a node handle still drags the node:
  // the HTML hit-target overlay carries touch-action: none. Drag the
  // first leaf onto the second's branch — the move op the keyboard
  // path produces.
  const leaf0 = page.getByRole("button", { name: "Leaf T0", exact: true });
  const edge1 = page.getByRole("button", {
    name: "Branch to T1",
    exact: true,
  });
  const a = await leaf0.boundingBox();
  const b = await edge1.boundingBox();
  if (a === null || b === null) throw new Error("no box");
  await swipe(
    a.x + a.width / 2,
    a.y + a.height / 2,
    b.x + b.width / 2,
    b.y + b.height / 2,
  );
  // The tree changed — a real move op landed (leaf T0 now shares a
  // clade with T1).
  await page.getByRole("button", { name: "Newick tree" }).click();
  await expect(newick).toHaveValue(/\(T1:0\.05,T0:0\.1\):0\.05/);
  await context.close();
});
