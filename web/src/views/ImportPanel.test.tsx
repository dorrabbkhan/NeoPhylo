// Component tests for the sandbox import box (plan Task 20, spec §3.1,
// §4.1, §4.7). Sessions run through the real reducer against the real
// wasm engine (initialized in src/test/setup.ts), so pasted input takes
// the exact path a student's paste would.

import { useState } from "react";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { engine } from "../engine/index";
import type { DistanceInput } from "../engine/generated/DistanceInput";
import type { Exercise } from "../engine/generated/Exercise";
import { errorMessage } from "../explain/errors";
import type { Session } from "../state/session";
import { initialSession, reducer } from "../state/session";
import { App } from "./App";
import { ImportPanel } from "./ImportPanel";

afterEach(cleanup);

const NJ_BASICS: Exercise = {
  schema_version: 2,
  id: "nj-basics",
  title: "How Neighbor-Joining works",
  alphabet: "dna",
  data: {
    kind: "simulated",
    true_tree: "((A:0.1,B:0.2):0.05,C:0.3,(D:0.1,E:0.15):0.1);",
    sim: { model: "Jc69", length: 1000, seed: 42 },
  },
  reference: {
    newick: "((A:0.1,B:0.2):0.05,C:0.3,(D:0.1,E:0.15):0.1);",
    kind: "true",
  },
  analysis: { correction: "Jc69", method: "Nj" },
  locked: ["sim.model", "analysis.method"],
  prompts: [],
    bootstrap: null,
};

/** A session already in sandbox mode (load with source "sandbox" flips
 * the mode; the pipeline still runs against the exercise). */
function sandbox(ex: Exercise): Session {
  return reducer(initialSession(ex), {
    type: "load",
    exercise: ex,
    source: "sandbox",
  });
}

/** Render ImportPanel around a live session; `holder.s` reflects the
 * post-dispatch state. `inferred`/`tree` test ids make session outcomes
 * observable without rendering the full app. */
function renderPanel(initial: Session) {
  const holder = { s: initial };
  function Harness() {
    const [s, setS] = useState(initial);
    holder.s = s;
    return (
      <>
        <ImportPanel
          session={s}
          dispatch={(a) => setS((cur) => reducer(cur, a))}
          onOpenDatasets={() => {}}
        />
        <div data-testid="inferred">{String(s.result !== null)}</div>
        <div data-testid="true-tree">{String(s.reference !== null)}</div>
      </>
    );
  }
  render(<Harness />);
  return holder;
}

/** Paste `text` into the import box and commit. */
function paste(text: string) {
  fireEvent.change(screen.getByLabelText("Paste sequences or a tree"), {
    target: { value: text },
  });
  fireEvent.click(screen.getByRole("button", { name: "Import" }));
}

describe("ImportPanel — visibility", () => {
  it("renders nothing while source is lesson", () => {
    const s = reducer(initialSession(NJ_BASICS), {
      type: "load",
      exercise: NJ_BASICS,
      source: "lesson",
    });
    const { container } = render(
      <ImportPanel session={s} dispatch={() => {}} onOpenDatasets={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("App enters sandbox through the mode switch, unlocking controls", async () => {
    render(<App exercise={NJ_BASICS} />);
    await screen.findByRole("img", { name: "Inferred tree" });
    // The lesson locks this select; sandbox unlocks it (spec §6.2).
    expect(
      (screen.getByLabelText("Simulation model") as HTMLSelectElement).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: "Sandbox" }));
    // The panel is a lazy chunk (v1.4c fix round 1) — findBy, not getBy.
    expect(
      await screen.findByLabelText("Paste sequences or a tree"),
    ).toBeTruthy();
    expect(
      (screen.getByLabelText("Simulation model") as HTMLSelectElement).disabled,
    ).toBe(false);
  });
});

describe("ImportPanel — FASTA", () => {
  it('Review Focus 4: pasting two sequences shows "Need at least 3 sequences" and no tree', () => {
    const holder = renderPanel(sandbox(NJ_BASICS));
    paste(">a\nACGT\n>b\nACGT\n");
    expect(screen.getByText(/Need at least 3 sequences/)).toBeTruthy();
    expect(screen.getByTestId("inferred").textContent).toBe("false");
    expect(holder.s.error?.kind).toBe("TooFewTaxa");
  });

  it("pastes three sequences and builds a tree", () => {
    const holder = renderPanel(sandbox(NJ_BASICS));
    paste(">a\nACGTACGT\n>b\nACGTACGA\n>c\nACGTTCGT\n");
    expect(screen.getByTestId("inferred").textContent).toBe("true");
    expect(holder.s.alignment?.labels).toEqual(["a", "b", "c"]);
  });

  it("handles a CRLF/BOM paste end to end through the wasm", () => {
    const holder = renderPanel(sandbox(NJ_BASICS));
    // Labels match the lesson's true tree so the run is clean (other
    // names would legitimately produce LabelMismatch at the compare
    // step). Covers BOM, CRLF, wrapped lines, blank lines, trailing
    // spaces and mixed LF/CRLF (Review Focus 1).
    paste(
      "\uFEFF>A\r\nAC\r\nGT\r\n\r\n>B\r\nACGA  \r\n>C\nACGG\n>D\nAGGT\n>E\nTCGT\n",
    );
    expect(holder.s.error).toBeNull();
    expect(holder.s.alignment?.labels).toEqual(["A", "B", "C", "D", "E"]);
    expect(screen.getByTestId("inferred").textContent).toBe("true");
  });

  it("shows the UnequalLengths title for a ragged alignment", () => {
    renderPanel(sandbox(NJ_BASICS));
    paste(">a\nACGT\n>b\nACG\n>c\nACGT\n");
    expect(screen.getByText(/Sequences aren't aligned/)).toBeTruthy();
  });

  it("explains pairwise deletion under the import box", () => {
    renderPanel(sandbox(NJ_BASICS));
    expect(
      screen.getByText("Gaps and ambiguous bases are skipped pair by pair."),
    ).toBeTruthy();
  });
});

describe("ImportPanel — gap hint per site filter (v1.4b Task 10 fix 2)", () => {
  const withFilter = (site_filter: Exercise["analysis"]["site_filter"]) =>
    sandbox({
      ...NJ_BASICS,
      analysis: { ...NJ_BASICS.analysis, site_filter },
    });

  it("keeps the pairwise wording under an explicit pairwise filter", () => {
    renderPanel(withFilter({ kind: "pairwise" }));
    expect(
      screen.getByText("Gaps and ambiguous bases are skipped pair by pair."),
    ).toBeTruthy();
  });

  it("describes column removal under complete deletion", () => {
    renderPanel(withFilter({ kind: "complete" }));
    expect(
      screen.getByText(
        "Columns with a gap or ambiguous base in any sequence are removed (complete deletion).",
      ),
    ).toBeTruthy();
  });

  it("names the coverage cutoff under partial deletion", () => {
    renderPanel(withFilter({ kind: "partial", cutoff_pct: 80 }));
    expect(
      screen.getByText(
        "Columns with less than 80% coverage are removed (partial deletion).",
      ),
    ).toBeTruthy();
  });

  it("separates the NoSitesKept title from its body like the bootstrap panel does", () => {
    renderPanel(withFilter({ kind: "complete" }));
    // Every column carries a gap, so complete deletion keeps nothing.
    paste(">a\n--AAAA\n>b\nAA--AA\n>c\nAAAA--\n");
    expect(
      screen.getByText("The gap filter removed every site."),
    ).toBeTruthy();
  });
});

describe("ImportPanel — Newick", () => {
  it("detects Newick (no leading '>') and sets the true tree", () => {
    const holder = renderPanel(sandbox(NJ_BASICS));
    paste("(x:0.1,y:0.2,z:0.3);");
    expect(screen.getByTestId("true-tree").textContent).toBe("true");
    const labels = holder.s
      .reference!.tree.nodes.filter((n) => n.children.length === 0)
      .map((n) => n.label);
    expect(labels).toEqual(["x", "y", "z"]);
  });

  it("shows the LabelMismatch title when a later FASTA uses different names", () => {
    renderPanel(sandbox(NJ_BASICS));
    paste("(x:0.1,y:0.2,z:0.3);");
    paste(">a\nACGT\n>b\nACGT\n>c\nACGT\n");
    expect(
      screen.getByText(/Tree and sequences have different names/),
    ).toBeTruthy();
  });

  it("shows a parse error for malformed Newick", () => {
    renderPanel(sandbox(NJ_BASICS));
    paste("(a:0.1,b:0.2");
    expect(screen.getByText(/Couldn't read line 1/)).toBeTruthy();
  });
});

describe("ImportPanel — PHYLIP (v1.1 Task 10)", () => {
  it("detects a PHYLIP header and imports through parsePhylip", () => {
    const holder = renderPanel(sandbox(NJ_BASICS));
    paste("3 4\nalpha ACGT\nbeta ACGA\ngamma ACTT\n");
    expect(holder.s.error).toBeNull();
    expect(holder.s.alignment?.labels).toEqual(["alpha", "beta", "gamma"]);
    expect(holder.s.alignment?.seqs[0]).toHaveLength(4);
    // Auto used whitespace-delimited names; the toggle shows it.
    expect(
      screen
        .getByRole("radio", { name: "Relaxed names" })
        .getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("detects the header after blank lines and space indentation", () => {
    const holder = renderPanel(sandbox(NJ_BASICS));
    paste("\n\n   3   8\na ACGT\nb ACGA\nc ACTT\n\nACGT\nACGA\nACTT\n");
    expect(holder.s.error).toBeNull();
    expect(holder.s.alignment?.labels).toEqual(["a", "b", "c"]);
    expect(holder.s.alignment?.seqs[0]).toHaveLength(8);
  });

  it("detects strict names that run into the sequence", () => {
    const holder = renderPanel(sandbox(NJ_BASICS));
    // Exactly-10-character names with no space before the sequence:
    // Relaxed can't parse this, so Auto falls back to Strict.
    paste("3 4\nabcdefghijACGT\nbcdefghijkACGA\ncdefghijklACTT\n");
    expect(holder.s.error).toBeNull();
    expect(holder.s.alignment?.labels).toEqual([
      "abcdefghij",
      "bcdefghijk",
      "cdefghijkl",
    ]);
    expect(
      screen
        .getByRole("radio", { name: "Strict names" })
        .getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("toggling the name style re-parses the pasted text", () => {
    const holder = renderPanel(sandbox(NJ_BASICS));
    paste("3 4\nalpha ACGT\nbeta ACGA\ngamma ACTT\n");
    expect(holder.s.error).toBeNull();
    // Re-parse as Strict: "alpha ACGT" fills all 10 name columns and
    // leaves no sequence, so the engine reports a Parse error in-panel.
    fireEvent.click(screen.getByRole("radio", { name: "Strict names" }));
    expect(screen.getByText(/Couldn't read line/)).toBeTruthy();
    // Toggling back to Relaxed restores the clean parse.
    fireEvent.click(screen.getByRole("radio", { name: "Relaxed names" }));
    expect(holder.s.alignment?.labels).toEqual(["alpha", "beta", "gamma"]);
    expect(holder.s.error).toBeNull();
  });
});

describe("ImportPanel — file input", () => {
  it("imports a .fasta file like a paste", async () => {
    const holder = renderPanel(sandbox(NJ_BASICS));
    const file = new File([">a\nACGT\n>b\nACGA\n>c\nACGG\n"], "x.fasta", {
      type: "text/plain",
    });
    const input = screen.getByLabelText(/choose a file/i);
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() =>
      expect(holder.s.alignment?.labels).toEqual(["a", "b", "c"]),
    );
    expect(screen.getByTestId("inferred").textContent).toBe("true");
  });

  // The file's name belongs to its own import attempt (v1.4b Task 11
  // fix): a file that never dispatches importAlignment — a parse
  // failure or a tree — must not leave its name behind for a later
  // paste to pick up as its .meg !Title.
  it("a file that fails to parse doesn't leak its name into a later paste", async () => {
    const holder = renderPanel(sandbox(NJ_BASICS));
    const input = screen.getByLabelText(/choose a file/i);
    fireEvent.change(input, {
      target: { files: [new File(["(a:0.1,b:0.2"], "bad.nwk")] },
    });
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "Couldn't read",
      ),
    );
    paste(">a\nACGT\n>b\nACGA\n>c\nACGG\n");
    expect(holder.s.alignment?.labels).toEqual(["a", "b", "c"]);
    expect(holder.s.alignmentName).toBeNull();
  });

  it("a .meg matrix route doesn't leak its name into a later paste", async () => {
    const matrix = readFileSync(
      resolve(
        process.cwd(),
        "../crates/neophylo-core/tests/meg_inputs/matrix.meg",
      ),
      "utf8",
    );
    const holder = renderPanel(sandbox(NJ_BASICS));
    const input = screen.getByLabelText(/choose a file/i);
    fireEvent.change(input, {
      target: { files: [new File([matrix], "matrix.meg")] },
    });
    // The matrix .meg routes to the matrix parser (v1.4c Task 8):
    // its own message shows — the alignment refusal notice is gone —
    // and no alignment import happened, so no name can leak.
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "expected 1 matrix rows",
      ),
    );
    paste(">a\nACGT\n>b\nACGA\n>c\nACGG\n");
    expect(holder.s.alignment?.labels).toEqual(["a", "b", "c"]);
    expect(holder.s.alignmentName).toBeNull();
  });

  it("a file that imports as a tree doesn't leak its name into a later paste", async () => {
    const holder = renderPanel(sandbox(NJ_BASICS));
    const input = screen.getByLabelText(/choose a file/i);
    fireEvent.change(input, {
      target: {
        files: [new File(["(a:0.1,b:0.2,c:0.3);"], "tree.nwk")],
      },
    });
    // The sandbox already holds the lesson's reference (A–E); the file
    // has landed once its a–c leaves replace it.
    await waitFor(() =>
      expect(
        holder.s.reference?.tree.nodes
          .filter((n) => n.children.length === 0)
          .map((n) => n.label),
      ).toEqual(["a", "b", "c"]),
    );
    paste(">a\nACGT\n>b\nACGA\n>c\nACGG\n");
    expect(holder.s.alignment?.labels).toEqual(["a", "b", "c"]);
    expect(holder.s.alignmentName).toBeNull();
  });
});

describe("ImportPanel — empty state and samples (v1.3 Task 12, spec §6.8)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows the exact empty text and both sample buttons while the sandbox is empty", () => {
    renderPanel(sandbox(NJ_BASICS));
    expect(
      screen.getByText("Paste or upload sequences, or try a sample:"),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Cytochrome c (protein)" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Weak-support example (DNA)" }),
    ).toBeTruthy();
  });

  it("hides the sample buttons once data is imported", () => {
    renderPanel(sandbox(NJ_BASICS));
    paste(">a\nACGTACGT\n>b\nACGTACGA\n>c\nACGTTCGT\n");
    expect(
      screen.queryByRole("button", { name: "Weak-support example (DNA)" }),
    ).toBeNull();
  });

  it("the weak-support button loads 6 taxa (A–F) of 120 sites", async () => {
    const fasta = readFileSync("public/samples/weak-support.fasta", "utf8");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        expect(url).toContain("samples/weak-support.fasta");
        return new Response(fasta, { status: 200 });
      }),
    );
    const holder = renderPanel(sandbox(NJ_BASICS));
    fireEvent.click(
      screen.getByRole("button", { name: "Weak-support example (DNA)" }),
    );
    await waitFor(() =>
      expect(holder.s.alignment?.labels).toEqual([
        "A", "B", "C", "D", "E", "F",
      ]),
    );
    expect(holder.s.alignment?.seqs.every((s) => s.length === 120)).toBe(
      true,
    );
    expect(holder.s.alignment?.alphabet).toBe("dna");
    expect(screen.getByTestId("inferred").textContent).toBe("true");
  });

  it("the cytochrome-c button loads the lesson's protein alignment", async () => {
    const lesson = readFileSync("../exercises/cytochrome-c.json", "utf8");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        expect(url).toContain("/exercises/cytochrome-c.json");
        return new Response(lesson, { status: 200 });
      }),
    );
    const holder = renderPanel(sandbox(NJ_BASICS));
    fireEvent.click(
      screen.getByRole("button", { name: "Cytochrome c (protein)" }),
    );
    await waitFor(() =>
      expect(holder.s.alignment?.alphabet).toBe("protein"),
    );
    expect(holder.s.alignment?.labels).toHaveLength(8);
    expect(screen.getByTestId("inferred").textContent).toBe("true");
  });
});

describe("ImportPanel — .meg (v1.4b Task 11)", () => {
  const MEG_DIR = resolve(
    process.cwd(),
    "../crates/neophylo-core/tests/meg_inputs",
  );
  const files = readdirSync(MEG_DIR).filter((f) => f.endsWith(".meg"));

  it("accepts .meg in the file picker", () => {
    renderPanel(sandbox(NJ_BASICS));
    const input = document.querySelector<HTMLInputElement>(
      '.import-panel input[type="file"]',
    );
    expect(input?.accept).toContain(".meg");
  });

  it.each(files)(
    "%s gives the parser's result or its line-numbered error",
    (name) => {
      const text = readFileSync(resolve(MEG_DIR, name), "utf8");
      // A matrix .meg routes to the matrix parser (v1.4c Task 8):
      // a valid one starts a matrix session, an invalid one shows
      // the matrix error — never the alignment parser's refusal.
      const det = engine.detectMatrixFormat(text);
      if (det.ok && det.value === "Meg") {
        const m = engine.parseMegMatrix(text);
        const holder = renderPanel(sandbox(NJ_BASICS));
        paste(text);
        if (m.ok) {
          expect(holder.s.alignmentOrigin).toBe("matrix");
          expect(holder.s.matrixInput).toEqual(m.value.matrix);
        } else {
          const em = errorMessage(m.error);
          expect(
            screen.getByRole("alert").textContent,
          ).toContain(em.title);
        }
        return;
      }
      const expected = engine.parseMeg(text);
      const holder = renderPanel(sandbox(NJ_BASICS));
      paste(text);
      if (expected.ok) {
        expect(holder.s.alignment?.labels).toEqual(
          expected.value.alignment.labels,
        );
      } else if (expected.error.kind === "Parse") {
        expect(
          document.querySelector(".import-panel .error")?.textContent,
        ).toContain(`line ${expected.error.line}`);
      }
    },
  );

  // A picked file's .meg extension routes it to the .meg parser on
  // its name alone (Task 11 fix round 2): a file saved without the
  // #mega line gets the engine's missing-header error — with the MEGA
  // hint — instead of a Newick error. Pasted text keeps the #mega
  // sniff, so the same content pasted is a Newick error.
  it("a picked *.meg file without #mega gets the .meg error, not Newick's", async () => {
    const text = readFileSync(resolve(MEG_DIR, "no_mega_header.meg"), "utf8");
    renderPanel(sandbox(NJ_BASICS));
    const input = screen.getByLabelText(/choose a file/i);
    fireEvent.change(input, {
      target: { files: [new File([text], "no_mega_header.meg")] },
    });
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "expected '#mega' on the first line",
      ),
    );
    const alert = screen.getByRole("alert").textContent;
    expect(alert).toContain("Check the MEGA file");
    expect(alert).not.toContain("FASTA");
  });

  it("the picked-file .meg extension check is case-insensitive", async () => {
    // No #mega line: only the ".MEG" name can route this to the .meg
    // parser, so the missing-header error proves the check ran.
    const text = readFileSync(resolve(MEG_DIR, "no_mega_header.meg"), "utf8");
    renderPanel(sandbox(NJ_BASICS));
    const input = screen.getByLabelText(/choose a file/i);
    fireEvent.change(input, {
      target: { files: [new File([text], "NOHDR.MEG")] },
    });
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "expected '#mega' on the first line",
      ),
    );
  });

  it("pasted text without #mega is still not .meg (sniff unchanged)", () => {
    const text = readFileSync(resolve(MEG_DIR, "no_mega_header.meg"), "utf8");
    renderPanel(sandbox(NJ_BASICS));
    paste(text);
    const alert = screen.getByRole("alert").textContent;
    expect(alert).not.toContain("Check the MEGA file");
    expect(alert).toContain("FASTA");
  });

  it("shows parser notices for ignored commands", () => {
    const text = readFileSync(resolve(MEG_DIR, "commands.meg"), "utf8");
    renderPanel(sandbox(NJ_BASICS));
    paste(text);
    expect(screen.getAllByText(/ignored !\w+ command/).length).toBeGreaterThan(0);
  });

  it("opens the dataset sheet through the Open dataset button", () => {
    const onOpenDatasets = vi.fn();
    const s = sandbox(NJ_BASICS);
    render(
      <ImportPanel
        session={s}
        dispatch={() => {}}
        onOpenDatasets={onOpenDatasets}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Open dataset/ }));
    expect(onOpenDatasets).toHaveBeenCalledTimes(1);
  });
});

describe("ImportPanel — the tab strip (v1.4c fix round 1)", () => {
  const SEQ = "Sequences or tree";
  const MATRIX = "Distance matrix";
  const tab = (name: string) => screen.getByRole("tab", { name });

  /** A sandbox session already running on a distance matrix. */
  function matrixSandbox(input: DistanceInput): Session {
    return reducer(sandbox(NJ_BASICS), {
      type: "importMatrix",
      input,
      name: "m.phy",
    });
  }

  it("is a full ARIA tabs pattern: aria-controls ↔ aria-labelledby, roving tabindex", () => {
    renderPanel(sandbox(NJ_BASICS));
    expect(
      screen.getByRole("tablist", { name: "Import kind" }),
    ).toBeTruthy();
    // Only the selected tab is in the Tab order.
    expect(tab(SEQ).getAttribute("aria-selected")).toBe("true");
    expect(tab(SEQ).tabIndex).toBe(0);
    expect(tab(MATRIX).getAttribute("aria-selected")).toBe("false");
    expect(tab(MATRIX).tabIndex).toBe(-1);
    // Each tab names its panel; each panel names its tab.
    for (const name of [SEQ, MATRIX]) {
      const t = tab(name);
      const panel = document.getElementById(
        t.getAttribute("aria-controls") as string,
      );
      expect(panel?.getAttribute("role")).toBe("tabpanel");
      expect(panel?.getAttribute("aria-labelledby")).toBe(t.id);
    }
  });

  it("Arrow keys move selection AND focus; Home/End go to the ends", () => {
    renderPanel(sandbox(NJ_BASICS));
    tab(SEQ).focus();
    fireEvent.keyDown(tab(SEQ), { key: "ArrowRight" });
    expect(tab(MATRIX).getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tab(MATRIX));
    expect(tab(SEQ).tabIndex).toBe(-1);
    expect(tab(MATRIX).tabIndex).toBe(0);
    // Right on the last tab wraps to the first.
    fireEvent.keyDown(tab(MATRIX), { key: "ArrowRight" });
    expect(document.activeElement).toBe(tab(SEQ));
    // Left on the first wraps to the last.
    fireEvent.keyDown(tab(SEQ), { key: "ArrowLeft" });
    expect(document.activeElement).toBe(tab(MATRIX));
    fireEvent.keyDown(tab(MATRIX), { key: "Home" });
    expect(document.activeElement).toBe(tab(SEQ));
    expect(tab(SEQ).getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(tab(SEQ), { key: "End" });
    expect(document.activeElement).toBe(tab(MATRIX));
    expect(tab(MATRIX).getAttribute("aria-selected")).toBe("true");
  });

  it("a matrix session selects the Distance matrix tab by default", () => {
    renderPanel(
      matrixSandbox({
        names: ["a", "b", "c", "d", "e"],
        lower: [5, 9, 10, 9, 10, 8, 8, 9, 7, 3],
      }),
    );
    expect(tab(MATRIX).getAttribute("aria-selected")).toBe("true");
    expect(tab(SEQ).getAttribute("aria-selected")).toBe("false");
  });

  it("a matrix import mid-session re-selects the Distance matrix tab", () => {
    renderPanel(sandbox(NJ_BASICS));
    expect(tab(SEQ).getAttribute("aria-selected")).toBe("true");
    // A PHYLIP matrix paste routes to the matrix parsers and flips the
    // session's origin — the strip follows.
    paste("5\na\nb  5\nc  9  10\nd  9  10  8\ne  8  9  7  3\n");
    expect(tab(MATRIX).getAttribute("aria-selected")).toBe("true");
  });

  it("a matrix file opened from the Sequences tab mounts the matrix panel AND its grid (fix round 2)", async () => {
    const holder = renderPanel(sandbox(NJ_BASICS));
    expect(tab(SEQ).getAttribute("aria-selected")).toBe("true");
    // The bug this round fixes: the origin change re-selected the tab
    // but matrixOpened stayed false, so the tabpanel rendered EMPTY.
    const input = screen.getByLabelText(/choose a file/i);
    fireEvent.change(input, {
      target: {
        files: [
          new File(
            ["5\na\nb  5\nc  9  10\nd  9  10  8\ne  8  9  7  3\n"],
            "wiki5_lower.phy",
          ),
        ],
      },
    });
    await waitFor(() =>
      expect(holder.s.alignmentOrigin).toBe("matrix"),
    );
    expect(tab(MATRIX).getAttribute("aria-selected")).toBe("true");
    // The panel's content is mounted: the grid sheet opens with the
    // imported names and values (the lazy chunk needs findBy).
    fireEvent.click(
      await screen.findByRole("button", { name: "Type a matrix…" }),
    );
    for (const [i, n] of ["a", "b", "c", "d", "e"].entries()) {
      expect(
        await screen.findByLabelText(`Taxon ${i + 1} name`),
      ).toHaveProperty("value", n);
    }
    expect(
      screen.getByLabelText("Distance between e and d"),
    ).toHaveProperty("value", "3");
    expect(
      screen.getByLabelText("Distance between b and a"),
    ).toHaveProperty("value", "5");
  });

  it("a manual 'Sequences or tree' pick survives re-renders in a matrix session", () => {
    renderPanel(
      matrixSandbox({
        names: ["a", "b", "c", "d", "e"],
        lower: [5, 9, 10, 9, 10, 8, 8, 9, 7, 3],
      }),
    );
    expect(tab(MATRIX).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(tab(SEQ));
    expect(tab(SEQ).getAttribute("aria-selected")).toBe("true");
    // A local-state re-render (typing in the box) and a session
    // re-render (a same-origin matrix re-paste) must not snap the
    // strip back — the origin never changed.
    fireEvent.change(
      screen.getByLabelText("Paste sequences or a tree"),
      { target: { value: ">a\nAC" } },
    );
    expect(tab(SEQ).getAttribute("aria-selected")).toBe("true");
    paste("3\nx\ny  1\nz  2  3\n");
    expect(tab(SEQ).getAttribute("aria-selected")).toBe("true");
  });
});
