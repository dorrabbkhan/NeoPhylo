// GradedTaskGate unit tests (v1.5 plan Task 8, spec §5.6): the card
// marks the task graded, takes a numeric draft, shows the Check
// button in practice mode only, and locks once committed.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GradedTaskGate } from "./GradedTaskGate";

const PAIR = { kind: "predict_pair", step: 2 } as const;
const NUM = {
  kind: "numeric",
  step: 1,
  quantity: "q_value",
  role: "chosen",
} as const;

afterEach(cleanup);

describe("GradedTaskGate", () => {
  it("marks the task graded and describes it like the builder", () => {
    render(
      <GradedTaskGate
        task={PAIR}
        mode="test"
        committed={false}
        draft={null}
        verdict={null}
        answerText={null}
      />,
    );
    expect(screen.getByText("Graded task")).toBeTruthy();
    expect(
      screen.getByText(/Predict the pair joined at step 2/),
    ).toBeTruthy();
    expect(screen.getByText(/Pick a cell on the matrix/)).toBeTruthy();
  });

  it("test mode shows no Check and no verdict", () => {
    render(
      <GradedTaskGate
        task={NUM}
        mode="test"
        committed={false}
        draft={{ kind: "number", value: 5 }}
        verdict={null}
        answerText="0.005"
      />,
    );
    expect(screen.queryByRole("button", { name: "Check" })).toBeNull();
    expect(screen.queryByText("Correct.")).toBeNull();
  });

  it("practice Check is enabled only with a draft", () => {
    const onCheck = vi.fn();
    const { rerender } = render(
      <GradedTaskGate
        task={PAIR}
        mode="practice"
        committed={false}
        draft={null}
        verdict={null}
        answerText={null}
        onCheck={onCheck}
      />,
    );
    const check = screen.getByRole("button", {
      name: "Check",
    }) as HTMLButtonElement;
    expect(check.disabled).toBe(true);
    rerender(
      <GradedTaskGate
        task={PAIR}
        mode="practice"
        committed={false}
        draft={{ kind: "pair", value: [0, 1] }}
        verdict={true}
        answerText="A + B"
        onCheck={onCheck}
      />,
    );
    expect(check.disabled).toBe(false);
    fireEvent.click(check);
    expect(onCheck).toHaveBeenCalled();
    expect(screen.getByText("Correct.")).toBeTruthy();
  });

  it("the numeric input reports every change", () => {
    const onNumeric = vi.fn();
    render(
      <GradedTaskGate
        task={NUM}
        mode="test"
        committed={false}
        draft={null}
        verdict={null}
        answerText={null}
        onNumeric={onNumeric}
      />,
    );
    fireEvent.change(screen.getByLabelText(/your answer/i), {
      target: { value: "1.234" },
    });
    expect(onNumeric).toHaveBeenCalledWith("1.234");
  });

  it("a committed answer locks the card", () => {
    render(
      <GradedTaskGate
        task={PAIR}
        mode="practice"
        committed={true}
        draft={{ kind: "pair", value: [0, 1] }}
        verdict={null}
        answerText="A + B"
      />,
    );
    expect(screen.getByText("Answer locked in.")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByText(/Pick a cell/)).toBeNull();
    expect(screen.getByText("A + B")).toBeTruthy();
  });
});
