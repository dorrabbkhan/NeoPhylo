// Component tests for the sandbox import box (plan Task 20, spec §3.1,
// §4.1, §4.7). Sessions run through the real reducer against the real
// wasm engine (initialized in src/test/setup.ts), so pasted input takes
// the exact path a student's paste would.

import { useState } from "react";

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { Exercise } from "../engine/generated/Exercise";
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
        />
        <div data-testid="inferred">{String(s.result !== null)}</div>
        <div data-testid="true-tree">{String(s.trueTree !== null)}</div>
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
      <ImportPanel session={s} dispatch={() => {}} />,
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
    expect(screen.getByLabelText("Paste sequences or a tree")).toBeTruthy();
    expect(
      (screen.getByLabelText("Simulation model") as HTMLSelectElement).disabled,
    ).toBe(false);
  });
});

describe("ImportPanel — FASTA", () => {
  it('Review Focus 4: pasting two sequences shows "Need at least 3 sequences" and no tree', () => {
    const holder = renderPanel(sandbox(NJ_BASICS));
    paste(">a\nACGT\n>b\nACGT\n");
    expect(screen.getByText("Need at least 3 sequences")).toBeTruthy();
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
    expect(screen.getByText("Sequences aren't aligned")).toBeTruthy();
  });

  it("explains pairwise deletion under the import box", () => {
    renderPanel(sandbox(NJ_BASICS));
    expect(
      screen.getByText("Gaps and ambiguous bases are skipped pair by pair."),
    ).toBeTruthy();
  });
});

describe("ImportPanel — Newick", () => {
  it("detects Newick (no leading '>') and sets the true tree", () => {
    const holder = renderPanel(sandbox(NJ_BASICS));
    paste("(x:0.1,y:0.2,z:0.3);");
    expect(screen.getByTestId("true-tree").textContent).toBe("true");
    const labels = holder.s
      .trueTree!.nodes.filter((n) => n.children.length === 0)
      .map((n) => n.label);
    expect(labels).toEqual(["x", "y", "z"]);
  });

  it("shows the LabelMismatch title when a later FASTA uses different names", () => {
    renderPanel(sandbox(NJ_BASICS));
    paste("(x:0.1,y:0.2,z:0.3);");
    paste(">a\nACGT\n>b\nACGT\n>c\nACGT\n");
    expect(
      screen.getByText("Tree and sequences have different names"),
    ).toBeTruthy();
  });

  it("shows a parse error for malformed Newick", () => {
    renderPanel(sandbox(NJ_BASICS));
    paste("(a:0.1,b:0.2");
    expect(screen.getByText(/Couldn't read line 1/)).toBeTruthy();
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
});
