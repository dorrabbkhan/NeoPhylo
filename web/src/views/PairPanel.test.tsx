// PairPanel tests (v1.1 plan Task 11, spec §5.2 "How was this distance
// computed?"). The panel opens from a protein matrix cell and shows the
// aligned sequences, p/Kimura/JTT side by side, the likelihood curve,
// and the Concept/Math text — all from `engine.jttPairDetail`, never
// recomputed in TypeScript.
//
// Review Focus 5 is covered end to end: an identical pair shows
// d̂ = 0.000 with a curve on [0, 0.5], and a pair with no comparable
// sites renders the no-overlap message inside the open dialog instead
// of crashing it.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { engine } from "../engine";
import type { Alignment } from "../engine/generated/Alignment";
import type { Exercise } from "../engine/generated/Exercise";
import type { PairDetail } from "../engine/generated/PairDetail";
import type { Result } from "../engine";

import { App } from "./App";
import { PairPanel } from "./PairPanel";

afterEach(cleanup);

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

const ALN = fastaAln(
  [">a", "MKVLGELAK", ">b", "MKVLGRLAK", ">c", "MQVLGELTK", ">d", "MKALGELAK"].join(
    "\n",
  ),
);

describe("PairPanel content", () => {
  it("renders both sequences aligned, with a marker row for differing comparable sites", () => {
    // Site 3 is `*` vs `G` — missing for the pair; V vs I at site 2 is
    // the only difference.
    const aln = fastaAln(">a\nMKV*L\n>b\nMKIGL");
    const d = okDetail(aln, 0, 1);
    const { container } = render(
      <PairPanel aln={aln} detail={{ ok: true, value: d }} onClose={() => {}} />,
    );
    const rows = container.querySelectorAll(".pair-seq-row");
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain("MKV*L");
    expect(rows[1].textContent).toContain("MKIGL");

    const markers = container.querySelector(".pair-marker-row");
    expect(markers).not.toBeNull();
    const marked = (markers?.textContent ?? "")
      .split("")
      .filter((c) => c === "×").length;
    expect(marked).toBe(d.differences);

    expect(container.querySelectorAll("[data-missing]").length).toBeGreaterThan(
      0,
    );
  });

  it("shows p, Kimura and JTT to 3 decimals, matching the engine", () => {
    const d = okDetail(ALN, 0, 1);
    const { container } = render(
      <PairPanel aln={ALN} detail={{ ok: true, value: d }} onClose={() => {}} />,
    );
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
    const { container } = render(
      <PairPanel aln={aln} detail={{ ok: true, value: d }} onClose={() => {}} />,
    );
    expect(container.querySelector(".pair-numbers")?.textContent).toContain(
      "can't estimate",
    );
  });

  it("shows the spec Concept sentence and the Math lines as KaTeX", () => {
    const d = okDetail(ALN, 0, 1);
    const { container } = render(
      <PairPanel aln={ALN} detail={{ ok: true, value: d }} onClose={() => {}} />,
    );
    expect(
      screen.getByText(
        /JTT picks the distance that makes these two sequences most probable/,
      ),
    ).toBeTruthy();
    // Every math line renders through KaTeX (one .katex root per line).
    expect(container.querySelectorAll(".pair-math .katex").length).toBe(3);
  });

  it("identical pair: d̂ = 0.000 with a curve on [0, 0.5] (Review Focus 5)", () => {
    const aln = fastaAln(">a\nMKVLG\n>b\nMKVLG");
    const d = okDetail(aln, 0, 1);
    expect(d.d_hat).toBe(0);
    expect(d.curve[d.curve.length - 1][0]).toBe(0.5);
    const { container } = render(
      <PairPanel aln={aln} detail={{ ok: true, value: d }} onClose={() => {}} />,
    );
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
    render(<PairPanel aln={aln} detail={d} onClose={() => {}} />);
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
      <PairPanel aln={ALN} detail={{ ok: true, value: d }} onClose={onClose} />,
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
        },
      ],
    };
    render(<App exercise={ex} />);
    await screen.findByText("Which pair joins first?");
    fireEvent.click(cell(0, 1));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
