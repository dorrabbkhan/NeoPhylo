// AssignmentFinish unit tests (v1.5 plan Task 8, spec §7.3): the
// code with its Copy button, the practice score / test summary, the
// student's id and the blocked-storage notice.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AssignmentFinish } from "./AssignmentFinish";

const GRADE = {
  score: 3,
  max: 4,
  tasks: [],
  flags: [],
};

afterEach(cleanup);

describe("AssignmentFinish", () => {
  it("shows the code and a Copy button", () => {
    render(
      <AssignmentFinish
        code="NP1-TEST"
        mode="test"
        grade={null}
        studentId="sara"
        storageOk={true}
      />,
    );
    expect(screen.getByText("NP1-TEST")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Copy/ }),
    ).toBeTruthy();
    expect(screen.getByText(/sara/)).toBeTruthy();
  });

  it("practice shows the score, test shows the recorded line", () => {
    const { rerender } = render(
      <AssignmentFinish
        code="NP1-X"
        mode="practice"
        grade={GRADE}
        studentId="s"
        storageOk={true}
      />,
    );
    expect(screen.getByText(/Score: 3 of 4/)).toBeTruthy();
    rerender(
      <AssignmentFinish
        code="NP1-X"
        mode="test"
        grade={null}
        studentId="s"
        storageOk={true}
      />,
    );
    expect(screen.queryByText(/Score:/)).toBeNull();
    expect(screen.getByText(/answers are recorded/)).toBeTruthy();
  });

  it("blocked storage shows the notice", () => {
    render(
      <AssignmentFinish
        code="NP1-X"
        mode="test"
        grade={null}
        studentId="s"
        storageOk={false}
      />,
    );
    expect(
      screen.getByText(/progress won't survive a reload/),
    ).toBeTruthy();
  });
});
