// PromptCard unit tests (plan Task 21, spec §6.2 guided lessons): an
// unanswered predict_pair prompt shows the question plus a pick hint; a
// pick reveals "Correct" or the right pair, followed by the concept/math
// text. A note prompt only displays.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { Prompt } from "../engine/generated/Prompt";
import { PromptCard } from "./PromptCard";

const PREDICT: Prompt = {
  at_step: 1,
  type: "predict_pair",
  concept: "Which two taxa will join first?",
  math: "Find the minimum Q(i,j).",
  reveal: null,
};

const NOTE: Prompt = {
  at_step: 3,
  type: "note",
  concept: "Joins so far.",
  math: null,
  reveal: null,
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
});
