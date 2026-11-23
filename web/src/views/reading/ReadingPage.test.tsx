// ReadingPage tests (v1.4d plan Task 8, spec §4.4/§4.6/§7). Named
// tests:
// - test mode never exposes a verdict, explanation or note_after
//   before Finish;
// - rotating after selecting keeps the selection on the same clade
//   (Review Focus 4) — the response is a clade key, not a position;
// - an invalid `#r=` shows the engine's message;
// - practice Check: a correct answer shows the verdict, explanation
//   and note_after at once; the first wrong verdict says "Not quite
//   — try again." with none of those, and a second Check or "Show
//   answer" resolves the item (the §7.4 deviation, checkpoint §21(c)).
//
// The page is rendered with the real wasm engine (test/setup.ts
// inits it) and the shipped trees-demo set.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { engine } from "../../engine/index";
import type { ReadingSet } from "../../engine/generated/ReadingSet";

import { encodeReadingLink } from "../../reading/url";
import { ReadingPage } from "./ReadingPage";

function loadDemo(): ReadingSet {
  const r = engine.loadReadingSet(
    readFileSync(
      resolve("..", "exercises", "reading", "trees-demo.json"),
      "utf8",
    ),
  );
  if (!r.ok) throw new Error("demo set refused");
  return r.value;
}

const DEMO = loadDemo();

const cladeKey = (tips: string[]) => JSON.stringify([...tips].sort());

async function renderPage(props: {
  id?: string | null;
  hash?: string | null;
}) {
  const ui = render(
    <ReadingPage id={props.id ?? null} hash={props.hash ?? null} />,
  );
  // Wait for the lazy load + fonts gate to reach the first question.
  await screen.findByRole("button", { name: /next/i });
  return ui;
}

function next() {
  fireEvent.click(screen.getByRole("button", { name: /^next$/i }));
}

function nextTimes(n: number) {
  for (let i = 0; i < n; i++) next();
}

afterEach(cleanup);

describe("ReadingPage loading", () => {
  it("renders the first item of a shipped set at ?read=", async () => {
    await renderPage({ id: "trees-demo" });
    expect(
      screen.getByText(/different relationships from the others/i),
    ).toBeTruthy();
    expect(screen.getByText(/question 1 of \d+/i)).toBeTruthy();
    expect(screen.getAllByRole("figure").length).toBe(3);
  });

  it("shows the engine's message for an invalid #r=", async () => {
    const bad = {
      v: 1,
      set: {
        ...JSON.parse(JSON.stringify(DEMO)),
        items: [
          {
            id: "q-bad",
            text: "Do {set} form a clade?",
            trees: ["mammals"],
            tips: ["human", "nosuchtip"],
            question: { type: "is_clade" },
          },
        ],
      },
    };
    const { compressToEncodedURIComponent } = await import("lz-string");
    const hash = `#r=${compressToEncodedURIComponent(JSON.stringify(bad))}`;
    render(<ReadingPage id={null} hash={hash} />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/nosuchtip/i);
  });

  it("refuses an unknown ?read= id", async () => {
    render(<ReadingPage id="no-such-set" hash={null} />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/no-such-set/i);
  });
});

describe("practice mode", () => {
  it("a correct first Check shows the verdict and explanation at once", async () => {
    await renderPage({ id: "trees-demo" });
    // Item 0: which_differs, the odd tree is Tree 3.
    fireEvent.click(screen.getByRole("radio", { name: /tree 3/i }));
    fireEvent.click(screen.getByRole("button", { name: /^check$/i }));
    const status = screen.getByRole("status", { name: /verdict|result/i });
    expect(status.textContent).toMatch(/Correct\./);
    // The explanation comes from the engine — it names the differing tree.
    expect(status.textContent).toMatch(/mammals-diff|relationships/i);
    expect(
      screen.queryByRole("button", { name: /show answer/i }),
    ).toBeNull();
  });

  it("first wrong Check hides the explanation; a second resolves the item", async () => {
    await renderPage({ id: "trees-demo" });
    // Item 0: which_differs, the odd tree is Tree 3.
    fireEvent.click(screen.getByRole("radio", { name: /tree 1/i }));
    fireEvent.click(screen.getByRole("button", { name: /^check$/i }));
    const status = screen.getByRole("status", { name: /verdict|result/i });
    expect(status.textContent).toMatch(/Not quite — try again\./);
    // The first wrong verdict carries no explanation and no note —
    // it is a real retry, not the revealed answer.
    expect(status.textContent).not.toMatch(/mammals-diff|relationships/i);
    // A second wrong Check resolves the item: verdict + explanation.
    fireEvent.click(screen.getByRole("button", { name: /^check$/i }));
    expect(status.textContent).toMatch(/Not correct\./);
    expect(status.textContent).toMatch(/mammals-diff|relationships/i);
    // Retry still works after the reveal: Tree 3 → Correct. The
    // status element itself persists through the answer edit (§21(p)).
    fireEvent.click(screen.getByRole("radio", { name: /tree 3/i }));
    fireEvent.click(screen.getByRole("button", { name: /^check$/i }));
    expect(status.textContent).toMatch(/Correct\./);
  });

  it("Show answer after a first wrong Check reveals the explanation", async () => {
    await renderPage({ id: "trees-demo" });
    fireEvent.click(screen.getByRole("radio", { name: /tree 1/i }));
    fireEvent.click(screen.getByRole("button", { name: /^check$/i }));
    const status = screen.getByRole("status", { name: /verdict|result/i });
    expect(status.textContent).not.toMatch(/mammals-diff|relationships/i);
    fireEvent.click(
      screen.getByRole("button", { name: /show answer/i }),
    );
    expect(status.textContent).toMatch(/mammals-diff|relationships/i);
    // Revealed stays revealed: edit + Check can't hide it again, and
    // the status element persists through the edit (§21(p)).
    fireEvent.click(screen.getByRole("radio", { name: /tree 2/i }));
    fireEvent.click(screen.getByRole("button", { name: /^check$/i }));
    expect(status.textContent).toMatch(/Not correct\./);
    expect(status.textContent).toMatch(/mammals-diff|relationships/i);
  });

  it("Back/Next keeps a first-wrong item's retry state", async () => {
    await renderPage({ id: "trees-demo" });
    fireEvent.click(screen.getByRole("radio", { name: /tree 1/i }));
    fireEvent.click(screen.getByRole("button", { name: /^check$/i }));
    next();
    fireEvent.click(screen.getByRole("button", { name: /^back$/i }));
    const status = screen.getByRole("status", { name: /verdict|result/i });
    // Still "tried once, not shown": the retry verdict, no
    // explanation, the Show answer button back on offer.
    expect(status.textContent).toMatch(/Not quite — try again\./);
    expect(status.textContent).not.toMatch(/mammals-diff|relationships/i);
    expect(
      screen.getByRole("button", { name: /show answer/i }),
    ).toBeTruthy();
  });

  it("note_after appears only after Check", async () => {
    await renderPage({ id: "trees-demo" });
    nextTimes(3); // q-mrca: MRCA of gorilla+human is node P.
    expect(
      screen.queryByText(/everything that descends/i),
    ).toBeNull();
    const target = document.querySelector(
      `.rt-hit[data-clade='${cladeKey(["chimp", "gorilla", "gibbon", "human"])}']`,
    );
    expect(target).not.toBeNull();
    fireEvent.click(target!);
    fireEvent.click(screen.getByRole("button", { name: /^check$/i }));
    expect(screen.getByText(/everything that descends/i)).toBeTruthy();
  });

  it("note_after placeholders are filled after Check", async () => {
    const set: ReadingSet = {
      ...(JSON.parse(JSON.stringify(DEMO)) as ReadingSet),
      items: [
        {
          id: "q-note",
          text: "Do {set} form a clade?",
          trees: ["mammals"],
          tips: ["chimp", "human"],
          a: "chimp",
          note_after:
            "{a} and kin: {set} are exactly the descendants of one node.",
          rotate_tool: false,
          question: { type: "is_clade" },
        },
        // A second item so the page shows Next (a one-item set goes
        // straight to Finish).
        DEMO.items[0],
      ],
    };
    await renderPage({ hash: encodeReadingLink(set) });
    fireEvent.click(
      screen.getByRole("radio", { name: /yes — a clade/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: /^check$/i }));
    const note = document.querySelector(".read-note");
    expect(note).not.toBeNull();
    expect(note!.textContent).toBe(
      "chimp and kin: chimp and human are exactly the descendants of one node.",
    );
    expect(note!.textContent).not.toContain("{");
  });
});

describe("screen-reader plumbing (§21(p))", () => {
  it("the verdict status element exists before Check — same node after", async () => {
    await renderPage({ id: "trees-demo" });
    // The region mounts empty — a live region arriving WITH content
    // is never announced, which is why the first Check used to be
    // silent under NVDA.
    const status = screen.getByRole("status", { name: /verdict/i });
    expect(status.textContent).toBe("");
    fireEvent.click(screen.getByRole("radio", { name: /tree 1/i }));
    fireEvent.click(screen.getByRole("button", { name: /^check$/i }));
    // Same node, now carrying the first verdict.
    expect(
      screen.getByRole("status", { name: /verdict/i }),
    ).toBe(status);
    expect(status.textContent).toMatch(/Not quite — try again\./);
  });

  it("the answer group is named by the question, not just 'Choose one'", async () => {
    await renderPage({ id: "trees-demo" });
    expect(
      screen.getByRole("radiogroup", {
        name: /different relationships from the others\. which one\? choose one/i,
      }),
    ).toBeTruthy();
  });

  it("the svg describes itself by its text description", async () => {
    await renderPage({ id: "trees-demo" });
    const svg = document.querySelector(".rt-figure svg")!;
    const ids = svg.getAttribute("aria-describedby")!.split(" ");
    // Non-interactive (which_differs answers by radio): the
    // description is the text list alone.
    expect(ids).toHaveLength(1);
    const list = document.getElementById(ids[0])!;
    expect(list.tagName).toBe("UL");
    expect(list.textContent).toContain("contains");
  });

  it("an interactive tree's description leads with the question", async () => {
    await renderPage({ id: "trees-demo" });
    nextTimes(3); // q-mrca — tap-the-tree is the answer control.
    const svg = document.querySelector(".rt-figure svg")!;
    const ids = svg.getAttribute("aria-describedby")!.split(" ");
    expect(ids).toHaveLength(2);
    expect(
      document.getElementById(ids[0])!.textContent,
    ).toMatch(/tap the most recent common ancestor/i);
  });
});

describe("test mode", () => {
  function testSet(): ReadingSet {
    return {
      ...JSON.parse(JSON.stringify(DEMO)),
      mode: "test",
      items: DEMO.items.slice(0, 2),
    };
  }

  it("never exposes a verdict, explanation or note_after before Finish", async () => {
    await renderPage({ hash: encodeReadingLink(testSet()) });
    expect(
      screen.queryByRole("button", { name: /^check$/i }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: /tree 3/i }));
    // Nothing about correctness is visible.
    expect(screen.queryByText(/correct/i)).toBeNull();
    next();
    fireEvent.click(
      screen.getByRole("radio", { name: /all show the same/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: /finish/i }));
    // Summary: score plus per-item explanation.
    expect(screen.getByText(/score|correctly|of 2/i)).toBeTruthy();
    expect(screen.getAllByText(/correct/i).length).toBeGreaterThan(0);
  });
});

describe("rotation keeps clade-keyed selection", () => {
  it("a selected node stays selected when its parent is rotated", async () => {
    await renderPage({ id: "trees-demo" });
    nextTimes(3); // q-mrca on the mammals tree.
    const sel = cladeKey(["chimp", "gorilla", "gibbon", "human"]);
    fireEvent.click(
      document.querySelector(`.rt-hit[data-clade='${sel}']`)!,
    );
    expect(
      document.querySelector(`.rt-hit[data-selected="true"][data-clade='${sel}']`),
    ).not.toBeNull();
    // Rotate the root: its two halves swap sides.
    const root = document.querySelector(
      `.rt-hit[data-clade='${cladeKey(["bear", "cat", "chimp", "dog", "gibbon", "gorilla", "human", "seal"])}']`,
    )!;
    fireEvent.keyDown(root, { key: "r" });
    expect(
      document.querySelector(`.rt-hit[data-selected="true"][data-clade='${sel}']`),
    ).not.toBeNull();
    // The response itself is still the clade.
    fireEvent.click(screen.getByRole("button", { name: /^check$/i }));
    expect(
      screen.getByRole("status", { name: /verdict/i }).textContent,
    ).toMatch(/correct/i);
  });
});

describe("navigation", () => {
  it("Back returns to the previous item with the response intact", async () => {
    await renderPage({ id: "trees-demo" });
    fireEvent.click(screen.getByRole("radio", { name: /tree 2/i }));
    next();
    fireEvent.click(screen.getByRole("button", { name: /^back$/i }));
    const opt = screen.getByRole("radio", { name: /tree 2/i });
    expect((opt as HTMLInputElement).checked).toBe(true);
  });
});
