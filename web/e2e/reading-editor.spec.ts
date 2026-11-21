// Reading-set editor end-to-end (v1.4d plan Task 10, spec §7.5): on
// the `?editor` page the "Tree reading set" mode builds a six-tip set
// — three stored trees pasted as Newick, a trait mark placed by tapping
// the extras preview, and one item each of which_differs, mrca,
// closest_relative and trait with tips picked by tapping the item
// preview. The set is previewed in the real student view, shared as
// an `#r=` link and reopened from that link; both the editor and the
// reopened reading page are axe-clean.

import { test, expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";

// Six tips, same taxa. which_differs needs a unique differing tree, so
// t1 and t3 are rotations of the same topology and t2 is the outlier
// (it groups a with c where the others group a with b).
const T1 = "((a,b),(c,(d,(e,f))));";
const T2 = "((a,c),(b,(d,(e,f))));";
const T3 = "((((e,f),d),c),(a,b));";

const item = (page: Page, id: string) =>
  page.getByRole("group", { name: `Item ${id}` });
const treeSlot = (page: Page, name: string) =>
  page.getByRole("group", { name: `Tree ${name}` });
const tip = (scope: Locator, t: string) =>
  scope.locator(`.rt-hit[data-kind="tip"][data-clade='${JSON.stringify([t])}']`);
const branch = (scope: Locator, clade: string[]) =>
  scope.locator(
    `.rt-branch-hit[data-clade='${JSON.stringify([...clade].sort())}']`,
  );

async function expectNoSeriousViolations(
  page: Page,
  where: string,
): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
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

async function gotoReadingEditor(page: Page): Promise<void> {
  await page.goto("/?editor");
  await page.getByRole("radio", { name: "Tree reading set" }).click();
  await expect(
    page.getByRole("heading", { name: "Tree reading set editor" }),
  ).toBeVisible();
}

async function addItem(page: Page, type: string, id: string) {
  await page
    .getByRole("combobox", { name: "New item type" })
    .selectOption(type);
  await page.getByRole("button", { name: "Add item" }).click();
  return item(page, id);
}

// Fix round 2: toggling the mode hides the inactive editor instead of
// unmounting it — typed work in BOTH editors survives a round trip.
test("toggling the mode keeps unsaved work in both editors", async ({
  page,
}) => {
  await page.goto("/?editor");
  // exact: getByRole's name is a substring match, so bare "Title"
  // would also hit the reading editor's "Set title".
  const title = page.getByRole("textbox", { name: "Title", exact: true });
  await title.fill("Kept exercise title");

  await page.getByRole("radio", { name: "Tree reading set" }).click();
  const setTitle = page.getByRole("textbox", {
    name: "Set title",
    exact: true,
  });
  await expect(setTitle).toBeVisible();
  await expect(title).toBeHidden();
  await setTitle.fill("Kept reading title");
  await expectNoSeriousViolations(page, "editor reading mode");

  await page.getByRole("radio", { name: "Distance exercise" }).click();
  await expect(title).toBeVisible();
  await expect(title).toHaveValue("Kept exercise title");
  await expect(setTitle).toBeHidden();
  await expectNoSeriousViolations(page, "editor exercise mode");

  await page.getByRole("radio", { name: "Tree reading set" }).click();
  await expect(setTitle).toBeVisible();
  await expect(setTitle).toHaveValue("Kept reading title");
  await expect(title).toBeHidden();
});

test("build a six-tip reading set by tapping, then preview, share and reopen", async ({
  page,
}) => {
  await gotoReadingEditor(page);

  await page.getByRole("textbox", { name: "Set id" }).fill("e2e-sixtip");
  await page
    .getByRole("textbox", { name: "Set title" })
    .fill("Six-tip reading");
  await page
    .getByRole("textbox", { name: "Summary" })
    .fill("Three trees, six tips, four questions.");

  // Stored trees: t1/t3 agree, t2 groups (a,c) instead of (a,b).
  const t1 = treeSlot(page, "t1");
  await t1.getByRole("textbox", { name: "Newick" }).fill(T1);
  await expect(
    t1.getByRole("tree", { name: "Extras for t1" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Add tree" }).click();
  const t2 = treeSlot(page, "t2");
  await t2.getByRole("textbox", { name: "Newick" }).fill(T2);
  await expect(
    t2.getByRole("tree", { name: "Extras for t2" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Add tree" }).click();
  const t3 = treeSlot(page, "t3");
  await t3.getByRole("textbox", { name: "Newick" }).fill(T3);
  await expect(
    t3.getByRole("tree", { name: "Extras for t3" }),
  ).toBeVisible();

  // Trait names + a gain mark on the branch to (a,b), added by tapping.
  await t1.getByRole("button", { name: "Add trait names" }).click();
  await t1.getByRole("textbox", { name: "Trait 1" }).fill("wings");
  await t1
    .getByRole("textbox", { name: "Ancestral label" })
    .fill("absent");
  await t1
    .getByRole("textbox", { name: "Derived label" })
    .fill("present");
  await t1.getByRole("combobox", { name: "Tool" }).selectOption("mark");
  await t1
    .getByRole("textbox", { name: "Trait", exact: true })
    .fill("wings");
  // Branch hits are a 12 px transparent stroke — a real click can miss
  // the stroke on elbow paths, so activate it by keyboard (Enter/Space
  // are supported taps, per ReadingTree's onKeyDown).
  await branch(t1, ["a", "b"]).press("Enter");
  await t1.getByRole("button", { name: "Add mark" }).click();
  await expect(
    t1.getByText("wings gain on the branch to a, b"),
  ).toBeVisible();

  // which_differs over all three trees — t2 is the unique outlier.
  const q1 = await addItem(page, "which_differs", "q1");
  await q1
    .getByRole("textbox", { name: "Question text" })
    .fill("Which tree shows different relationships?");
  await q1.getByRole("checkbox", { name: "t2" }).check();
  await q1.getByRole("checkbox", { name: "t3" }).check();

  // mrca: the {set} tips are a and b, picked by tapping.
  const q2 = await addItem(page, "mrca", "q2");
  await q2
    .getByRole("textbox", { name: "Question text" })
    .fill("Tap the MRCA of {set}.");
  await tip(q2, "a").click();
  await tip(q2, "b").click();
  await expect(
    q2.getByText(/most recent common ancestor of a and b/),
  ).toBeVisible();

  // closest_relative pairwise: taps bind a, b and c.
  const q3 = await addItem(page, "closest_relative", "q3");
  await q3
    .getByRole("textbox", { name: "Question text" })
    .fill("Is {a} closer to {b} or to {c}?");
  await q3.getByRole("combobox", { name: "Form" }).selectOption("pairwise");
  const pickTarget = q3.getByRole("combobox", { name: "Pick by tapping" });
  await pickTarget.selectOption({ label: "tip {a}" });
  await tip(q3, "d").click();
  await pickTarget.selectOption({ label: "tip {b}" });
  await tip(q3, "e").click();
  await pickTarget.selectOption({ label: "tip {c}" });
  await tip(q3, "a").click();

  // trait: which tips have wings.
  const q4 = await addItem(page, "trait", "q4");
  await q4
    .getByRole("textbox", { name: "Question text" })
    .fill("Which tips have wings?");
  await q4.getByRole("textbox", { name: "Trait name" }).fill("wings");
  await expect(q4.getByText(/^Answer:/)).toBeVisible();

  // Share stays gated until the set loads — by now it should be live.
  await expect(
    page.getByRole("button", { name: "Share link" }),
  ).toBeEnabled();

  // Preview opens the real student page in a new tab.
  const [preview] = await Promise.all([
    page.waitForEvent("popup"),
    page.getByRole("button", { name: "Preview" }).click(),
  ]);
  await expect(preview.getByText(/Question 1 of 4/)).toBeVisible();
  await preview.close();

  // Share, then reopen the same set from the link.
  await page.getByRole("button", { name: "Share link" }).click();
  const url = await page
    .getByRole("textbox", { name: "Share link URL" })
    .inputValue();
  expect(url).toContain("#r=");

  await expectNoSeriousViolations(page, "reading editor");

  await page.goto(url);
  await expect(page.getByText(/Question 1 of 4/)).toBeVisible();
  await expectNoSeriousViolations(page, "shared reading set");
});

test("a denied clipboard still shows the share link, with no unhandled rejection", async ({
  page,
}) => {
  // §21(i): the reading editor's Share hits the same writeText path —
  // a rejected promise must not surface as a pageerror, and the notice
  // still shows the link.
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript(() => {
    Object.defineProperty(navigator.clipboard, "writeText", {
      value: () => Promise.reject(new Error("clipboard-write denied")),
      configurable: true,
    });
  });
  await gotoReadingEditor(page);

  await page.getByRole("textbox", { name: "Set id" }).fill("clip-set");
  await page
    .getByRole("textbox", { name: "Set title" })
    .fill("Clipboard denial");
  await page
    .getByRole("textbox", { name: "Summary" })
    .fill("One tree, one question.");
  const t1 = treeSlot(page, "t1");
  await t1.getByRole("textbox", { name: "Newick" }).fill("((a,b),(c,d));");
  await expect(
    t1.getByRole("tree", { name: "Extras for t1" }),
  ).toBeVisible();

  await page
    .getByRole("combobox", { name: "New item type" })
    .selectOption("is_clade");
  await page.getByRole("button", { name: "Add item" }).click();
  const q1 = item(page, "q1");
  await q1
    .getByRole("textbox", { name: "Question text" })
    .fill("Are {set} a clade?");
  for (const t of ["a", "b"]) {
    await q1
      .locator(
        `.rt-hit[data-kind="tip"][data-clade='${JSON.stringify([t])}']`,
      )
      .click();
  }
  await expect(q1.getByText(/^Answer:/)).toBeVisible();

  const share = page.getByRole("button", { name: "Share link" });
  await expect(share).toBeEnabled();
  await share.click();
  const url = await page
    .getByRole("textbox", { name: "Share link URL" })
    .inputValue();
  expect(url).toContain("#r=");
  await page.waitForTimeout(100);
  expect(errors).toEqual([]);
});
