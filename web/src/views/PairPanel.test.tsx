// PairPanel tests (v1.1 plan Task 11, spec §5.2 "How was this distance
// computed?"). The panel opens from a protein matrix cell and shows the
// aligned sequences as a column grid, p/Kimura/JTT side by side, the
// likelihood curve, and the Concept/Math text following the session
// mode — all from `engine.jttPairDetail`, never recomputed in
// TypeScript.
//
// Review Focus 5 is covered end to end: an identical pair shows
// d̂ = 0.000 with a curve on [0, 0.5], and a pair with no comparable
// sites renders the no-overlap message inside the open dialog instead
// of crashing it.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { engine } from "../engine";
import type { Alignment } from "../engine/generated/Alignment";
import type { Exercise } from "../engine/generated/Exercise";
import type { PairDetail } from "../engine/generated/PairDetail";
import type { Result } from "../engine";
import type { Action } from "../state/session";

import { App } from "./App";
import { PairPanel } from "./PairPanel";

afterEach(cleanup);

/** Vitest runs with cwd = web/, so fixtures live at ../fixtures. */
const readRepoFile = (rel: string): string =>
  readFileSync(resolve(`../${rel}`), "utf8");

const fastaAln = (text: string): Alignment => {
  const r = engine.parseFasta(text);
  if (!r.ok) throw new Error(`test fasta failed to parse: ${r.error.kind}`);
  return r.value;
};

const detailOf = (aln: Alignment, i: number, j: number): Result<PairDetail> =>
  engine.jttPairDetail(aln, i, j);

const okDetail = (aln: Alignment, i: number, j: number): PairDetail => {
  const d = detailOf(aln, i, j);
  if (!d.ok) throw new Error(`expected a PairDetail, got ${d.error.kind}`);
  return d.value;
};

const renderPanel = (
  aln: Alignment,
  detail: Result<PairDetail>,
  mode: "concept" | "math" = "concept",
  dispatch: (a: Action) => void = () => {},
) =>
  render(
    <PairPanel
      aln={aln}
      detail={detail}
      mode={mode}
      dispatch={dispatch}
      onClose={() => {}}
    />,
  );

/** Column grid accessors: each `.pair-col` is position number, residue
 * A, marker cell, residue B. */
const colCells = (col: Element) => ({
  pos: col.children[0].textContent?.trim() ?? "",
  resA: col.children[1].textContent ?? "",
  marker: col.children[2],
  markerText: col.children[2].textContent?.trim() ?? "",
  resB: col.children[3].textContent ?? "",
});

const STANDARD_AA = "ARNDCQEGHILKMFPSTWYV";

const ALN = fastaAln(
  [">a", "MKVLGELAK", ">b", "MKVLGRLAK", ">c", "MQVLGELTK", ">d", "MKALGELAK"].join(
    "\n",
  ),
);

describe("PairPanel content", () => {
  it("renders one column per site: residues, marker cell, position numbers", () => {
    // Site 4 is `*` vs `G` — missing for the pair; V vs I at site 3 is
    // the only difference.
    const aln = fastaAln(">a\nMKV*L\n>b\nMKIGL");
    const d = okDetail(aln, 0, 1);
    const { container } = renderPanel(aln, { ok: true, value: d });

    const cols = Array.from(container.querySelectorAll(".pair-col"));
    expect(cols.length).toBe(5);
    expect(cols.map((c) => colCells(c).resA).join("")).toBe("MKV*L");
    expect(cols.map((c) => colCells(c).resB).join("")).toBe("MKIGL");
    expect(cols.map((c) => colCells(c).markerText === "×")).toEqual([
      false,
      false,
      true,
      false,
      false,
    ]);
    expect(d.differences).toBe(1);
    expect(container.querySelectorAll("[data-missing]").length).toBeGreaterThan(
      0,
    );
  });

  it("marks exactly the differing comparable sites across all 150 columns (p6_150 P01–P02)", () => {
    const aln = fastaAln(readRepoFile("fixtures/inputs/protein/p6_150.fasta"));
    const d = okDetail(aln, 0, 1);
    const { container } = renderPanel(aln, { ok: true, value: d });

    const cols = Array.from(container.querySelectorAll(".pair-col"));
    expect(cols.length).toBe(150);

    let marks = 0;
    for (const col of cols) {
      const { resA, resB, marker, markerText } = colCells(col);
      if (markerText === "×") {
        marks++;
        // Every × sits in a column whose residues differ and are both
        // standard amino acids.
        expect(resA).not.toBe(resB);
        expect(STANDARD_AA).toContain(resA);
        expect(STANDARD_AA).toContain(resB);
        expect(marker.hasAttribute("data-missing")).toBe(false);
      }
    }
    expect(marks).toBe(d.differences);
    expect(d.differences).toBe(73);

    // Position numbers every 10 columns.
    const pos = cols.map((c) => colCells(c).pos);
    expect(pos[9]).toBe("10");
    expect(pos[149]).toBe("150");
    expect(pos.filter((p) => p !== "").length).toBe(15);
  });

  it("shows p, Kimura and JTT to 3 decimals, matching the engine", () => {
    const d = okDetail(ALN, 0, 1);
    const { container } = renderPanel(ALN, { ok: true, value: d });
    const numbers = container.querySelector(".pair-numbers");
    expect(numbers).not.toBeNull();
    expect(numbers?.textContent).toContain(d.p.toFixed(3));
    if (d.kimura !== "Saturated") {
      expect(numbers?.textContent).toContain(d.kimura.Value.toFixed(3));
    }
    if (d.jtt !== "Saturated") {
      expect(numbers?.textContent).toContain(d.jtt.Value.toFixed(3));
    }
  });

  it("shows 'can't estimate' for a saturated pair", () => {
    const aln = fastaAln(`>a\n${"A".repeat(50)}\n>b\n${"W".repeat(50)}`);
    const d = okDetail(aln, 0, 1);
    expect(d.jtt).toBe("Saturated");
    const { container } = renderPanel(aln, { ok: true, value: d });
    expect(container.querySelector(".pair-numbers")?.textContent).toContain(
      "can't estimate",
    );
  });

  it("concept mode: the Concept sentence and no KaTeX element", () => {
    const d = okDetail(ALN, 0, 1);
    const { container } = renderPanel(ALN, { ok: true, value: d }, "concept");
    expect(
      screen.getByText(
        /JTT picks the distance that makes these two sequences most probable/,
      ),
    ).toBeTruthy();
    expect(container.querySelector(".katex")).toBeNull();
    expect(container.querySelector(".pair-math")).toBeNull();
  });

  it("math mode: the KaTeX lines and no Concept sentence", () => {
    const d = okDetail(ALN, 0, 1);
    const { container } = renderPanel(ALN, { ok: true, value: d }, "math");
    // Every math line renders through KaTeX (one .katex root per line).
    expect(container.querySelectorAll(".pair-math .katex").length).toBe(3);
    expect(container.querySelector(".pair-concept")).toBeNull();
    expect(
      screen.queryByText(
        /JTT picks the distance that makes these two sequences most probable/,
      ),
    ).toBeNull();
  });

  it("identical pair: d̂ = 0.000 with a curve on [0, 0.5] (Review Focus 5)", () => {
    const aln = fastaAln(">a\nMKVLG\n>b\nMKVLG");
    const d = okDetail(aln, 0, 1);
    expect(d.d_hat).toBe(0);
    expect(d.curve[d.curve.length - 1][0]).toBe(0.5);
    const { container } = renderPanel(aln, { ok: true, value: d });
    expect(container.querySelector(".pair-numbers")?.textContent).toContain(
      "0.000",
    );
    expect(container.querySelector("polyline")).not.toBeNull();
    expect(container.querySelector("[data-peak]")).not.toBeNull();
  });

  it("zero-overlap pair: message inside the open panel, no crash (Review Focus 5)", () => {
    const aln = fastaAln(">x\nXXXX\n>y\nMKVL");
    const d = detailOf(aln, 0, 1);
    expect(d.ok).toBe(false);
    renderPanel(aln, d);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(
      screen.getByText("These two sequences share no comparable sites."),
    ).toBeTruthy();
  });
});

describe("PairPanel accessibility", () => {
  it("is a dialog: focus moves in, stays trapped, Esc closes, focus returns", () => {
    const prior = document.createElement("button");
    document.body.appendChild(prior);
    prior.focus();

    const onClose = vi.fn();
    const d = okDetail(ALN, 0, 1);
    const { unmount } = render(
      <PairPanel
        aln={ALN}
        detail={{ ok: true, value: d }}
        mode="concept"
        dispatch={() => {}}
        onClose={onClose}
      />,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog.contains(document.activeElement)).toBe(true);

    // Tab and Shift+Tab cycle inside the panel; focus never escapes.
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(dialog.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(dialog.contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();
    expect(document.activeElement).toBe(prior);
    prior.remove();
  });

  it("the in-panel mode toggle is inside the tab ring and switches modes", () => {
    const dispatch = vi.fn();
    const d = okDetail(ALN, 0, 1);
    renderPanel(ALN, { ok: true, value: d }, "concept", dispatch);
    const dialog = screen.getByRole("dialog");

    // The same toggle component as the explanation column, inside the
    // dialog.
    const group = within(dialog).getByRole("group", {
      name: "Explanation mode",
    });
    const mathBtn = within(group).getByRole("button", { name: "Math" });
    const conceptBtn = within(group).getByRole("button", { name: "Concept" });
    expect(conceptBtn.getAttribute("aria-pressed")).toBe("true");

    // The focus trap iterates exactly this selector (FOCUSABLE in
    // PairPanel); the toggle is in it, so Tab inside the open dialog
    // reaches it — real key presses are covered by e2e/pair-panel.spec.
    const tabbables = dialog.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    expect(Array.from(tabbables)).toContain(mathBtn);
    expect(Array.from(tabbables)).toContain(conceptBtn);

    // jsdom does not emulate the browser's Enter/Space → click
    // activation for buttons: fire the keys, then dispatch the click
    // the browser produces for them.
    mathBtn.focus();
    expect(document.activeElement).toBe(mathBtn);
    fireEvent.keyDown(mathBtn, { key: "Enter" });
    fireEvent.keyUp(mathBtn, { key: "Enter" });
    fireEvent.keyDown(mathBtn, { key: " " });
    fireEvent.keyUp(mathBtn, { key: " " });
    fireEvent.click(mathBtn);
    expect(dispatch).toHaveBeenCalledWith({ type: "setMode", mode: "math" });
  });
});

describe("PairPanel wiring in App", () => {
  const PROTEIN_EX: Exercise = {
    schema_version: 2,
    id: "protein-pair",
    title: "Protein pairs",
    alphabet: "protein",
    data: {
      kind: "embedded",
      fasta: [
        ">a",
        "MKVLGELAK",
        ">b",
        "MKVLGRLAK",
        ">c",
        "MQVLGELTK",
        ">d",
        "MKALGELAK",
      ].join("\n"),
      source: { citation: "test", license: "test", accessions: [] },
    },
    reference: null,
    analysis: { correction: "Jtt", method: "Nj" },
    locked: [],
    prompts: [],
    bootstrap: null,
  };

  const DNA_EX: Exercise = {
    ...PROTEIN_EX,
    id: "dna-pair",
    alphabet: "dna",
    data: {
      kind: "embedded",
      fasta: [">a", "ACGTACGT", ">b", "ACGTACGA", ">c", "ACGTTCGT", ">d", "ACGTACGA"].join(
        "\n",
      ),
      source: { citation: "test", license: "test", accessions: [] },
    },
    analysis: { correction: "Jc69", method: "Nj" },
  };

  const cell = (i: number, j: number) =>
    document.querySelector<SVGGElement>(
      `[role="gridcell"][data-i="${i}"][data-j="${j}"]`,
    )!;

  it("opens on a protein cell click and closes on Esc", async () => {
    render(<App exercise={PROTEIN_EX} />);
    await screen.findByRole("grid", { name: "Distance matrix" });
    fireEvent.click(cell(0, 1));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("How was this distance computed?");
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens on Enter and returns focus to the cell on Esc", async () => {
    render(<App exercise={PROTEIN_EX} />);
    await screen.findByRole("grid", { name: "Distance matrix" });
    const c = cell(1, 2);
    c.focus();
    fireEvent.keyDown(c, { key: "Enter" });
    const dialog = await screen.findByRole("dialog");
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(c);
  });

  it("the panel's toggle drives the shared session mode", async () => {
    render(<App exercise={PROTEIN_EX} />);
    await screen.findByRole("grid", { name: "Distance matrix" });
    fireEvent.click(cell(0, 1));
    const dialog = await screen.findByRole("dialog");

    fireEvent.click(within(dialog).getByRole("button", { name: "Math" }));
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();

    const main = screen.getByRole("group", { name: "Explanation mode" });
    expect(
      within(main).getByRole("button", { name: "Math" }).getAttribute(
        "aria-pressed",
      ),
    ).toBe("true");
  });

  it("does nothing on a DNA matrix cell", async () => {
    render(<App exercise={DNA_EX} />);
    await screen.findByRole("grid", { name: "Distance matrix" });
    fireEvent.click(cell(0, 1));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("a gating predict prompt consumes the pick — no panel", async () => {
    const ex: Exercise = {
      ...PROTEIN_EX,
      prompts: [
        {
          at_step: 1,
          type: "predict_pair",
          concept: "Which pair joins first?",
          math: null,
          reveal: null,
          reveal_pair: null,
          after: null,
        },
      ],
    };
    render(<App exercise={ex} />);
    await screen.findByText("Which pair joins first?");
    fireEvent.click(cell(0, 1));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
