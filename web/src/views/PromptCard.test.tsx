// PromptCard unit tests (plan Task 21, spec §6.2 guided lessons): an
// unanswered predict_pair prompt shows the question plus a pick hint; a
// pick reveals "Correct" or the right pair, followed by the concept/math
// text. A note prompt only displays.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Prompt } from "../engine/generated/Prompt";
import { PromptCard } from "./PromptCard";

const PREDICT: Prompt = {
  at_step: 1,
  type: "predict_pair",
  concept: "Which two taxa will join first?",
  math: "Find the minimum Q(i,j).",
  reveal: null,
  reveal_pair: null,
  after: null,
};

const NOTE: Prompt = {
  at_step: 3,
  type: "note",
  concept: "Joins so far.",
  math: null,
  reveal: null,
  reveal_pair: null,
  after: null,
};

afterEach(cleanup);

describe("PromptCard", () => {
  it("asks the question while the prompt is unanswered", () => {
    render(
      <PromptCard
        prompt={PREDICT}
        mode="concept"
        picked={null}
        answer={["A", "B"]}
      />,
    );
    expect(screen.getByText("Which two taxa will join first?")).toBeTruthy();
    expect(screen.queryByText(/Not quite/)).toBeNull();
    expect(screen.queryByText("Correct")).toBeNull();
  });

  it("shows Correct after a matching pick", () => {
    render(
      <PromptCard
        prompt={PREDICT}
        mode="concept"
        picked={["B", "A"]}
        answer={["A", "B"]}
      />,
    );
    expect(screen.getByText("Correct")).toBeTruthy();
    expect(screen.queryByText(/Not quite/)).toBeNull();
  });

  it("shows the right pair after a wrong pick", () => {
    render(
      <PromptCard
        prompt={PREDICT}
        mode="concept"
        picked={["A", "C"]}
        answer={["A", "B"]}
      />,
    );
    expect(screen.getByText("Not quite: the answer is A and B.")).toBeTruthy();
  });

  it("shows the math text in math mode", () => {
    render(
      <PromptCard
        prompt={PREDICT}
        mode="math"
        picked={["A", "B"]}
        answer={["A", "B"]}
      />,
    );
    expect(screen.getByText("Find the minimum Q(i,j).")).toBeTruthy();
  });

  it("displays a note prompt without a verdict", () => {
    render(
      <PromptCard prompt={NOTE} mode="concept" picked={null} answer={null} />,
    );
    expect(screen.getByText("Joins so far.")).toBeTruthy();
    expect(screen.queryByText(/Correct|Not quite/)).toBeNull();
  });

  it("shows the reveal text only after a pick", () => {
    const prompt: Prompt = {
      ...PREDICT,
      reveal: "u1 and u2 are closest, but NJ joins E and F.",
    };
    const { rerender } = render(
      <PromptCard
        prompt={prompt}
        mode="concept"
        picked={null}
        answer={["E", "F"]}
      />,
    );
    expect(screen.queryByText(/u1 and u2 are closest/)).toBeNull();
    rerender(
      <PromptCard
        prompt={prompt}
        mode="concept"
        picked={["u1", "u2"]}
        answer={["E", "F"]}
      />,
    );
    expect(
      screen.getByText("u1 and u2 are closest, but NJ joins E and F."),
    ).toBeTruthy();
  });

  it("offers the reveal_pair detail only after answering", () => {
    // checkpoint 12: a prompt with reveal_pair gets a "Show a vs b"
    // button once answered — it must not appear while still gating.
    const onShowPair = vi.fn();
    const prompt: Prompt = {
      ...PREDICT,
      reveal_pair: ["horse", "chicken"],
    };
    const { rerender } = render(
      <PromptCard
        prompt={prompt}
        mode="concept"
        picked={null}
        answer={["A", "B"]}
        onShowPair={onShowPair}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /Show horse vs chicken/ }),
    ).toBeNull();
    rerender(
      <PromptCard
        prompt={prompt}
        mode="concept"
        picked={["A", "B"]}
        answer={["A", "B"]}
        onShowPair={onShowPair}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Show horse vs chicken" }),
    );
    expect(onShowPair).toHaveBeenCalledWith(["horse", "chicken"]);
  });
});

// --- v1.2 spec §7.1: predict_branch ------------------------------------

const BRANCH: Prompt = {
  at_step: 4,
  type: "predict_branch",
  concept: "Before you run, click the internal branch you think the data supports least.",
  math: "support = count ÷ successful replicates",
  reveal: "Short internal branches leave the fewest informative sites.",
  reveal_pair: null,
  after: null,
};

describe("PromptCard predict_branch (v1.2 spec §7.1)", () => {
  it("asks the student to click an internal branch while unanswered", () => {
    render(
      <PromptCard
        prompt={BRANCH}
        mode="concept"
        picked={null}
        answer={null}
        branch={{ picked: null, verdict: null }}
      />,
    );
    expect(
      screen.getByText(
        "Before you run, click the internal branch you think the data supports least.",
      ),
    ).toBeTruthy();
    expect(screen.getByText(/Click an internal branch/)).toBeTruthy();
    expect(screen.queryByText(/Not quite/)).toBeNull();
    expect(screen.queryByText("Correct")).toBeNull();
  });

  it("a recorded pick without a run waits for the bootstrap", () => {
    render(
      <PromptCard
        prompt={BRANCH}
        mode="concept"
        picked={null}
        answer={null}
        branch={{ picked: "A|B", verdict: null }}
      />,
    );
    expect(screen.getByText(/run the bootstrap/i)).toBeTruthy();
    expect(screen.queryByText(/Not quite/)).toBeNull();
    expect(screen.queryByText("Correct")).toBeNull();
    // The explanation stays hidden until the verdict — it is part of
    // the answer.
    expect(screen.queryByText(/Short internal branches/)).toBeNull();
  });

  it("verdict: Correct when the clicked branch is the weakest", () => {
    render(
      <PromptCard
        prompt={BRANCH}
        mode="concept"
        picked={null}
        answer={null}
        branch={{
          picked: "E|F|G|H",
          verdict: { correct: true, weakest: ["E", "F", "G", "H"], supportPct: 41 },
        }}
      />,
    );
    expect(screen.getByText("Your prediction: Correct")).toBeTruthy();
    expect(screen.getByText(/Short internal branches/)).toBeTruthy();
  });

  it("verdict: names the weakest group and its support on a miss", () => {
    render(
      <PromptCard
        prompt={BRANCH}
        mode="concept"
        picked={null}
        answer={null}
        branch={{
          picked: "A|B",
          verdict: { correct: false, weakest: ["E", "F", "G", "H"], supportPct: 41 },
        }}
      />,
    );
    expect(
      screen.getByText(
        "Your prediction: Not quite — the weakest group was (E, F, G, H) at 41%.",
      ),
    ).toBeTruthy();
    expect(screen.getByText(/Short internal branches/)).toBeTruthy();
  });

  it("a terminal-edge click explains leaf branches can't be the answer", () => {
    render(
      <PromptCard
        prompt={BRANCH}
        mode="concept"
        picked={null}
        answer={null}
        branch={{ picked: null, terminalPicked: true, verdict: null }}
      />,
    );
    expect(
      screen.getByText("Pick a branch that joins two or more taxa."),
    ).toBeTruthy();
    // The generic hint is replaced, and the prompt stays unanswered.
    expect(screen.queryByText(/Click an internal branch/)).toBeNull();
    expect(screen.queryByText(/Not quite/)).toBeNull();
  });
});
