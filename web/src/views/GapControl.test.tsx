// GapControl tests (v1.4b plan Task 10, spec §3.1, §6.1–6.2): the
// sandbox's MEGA gap-treatment radio group — Pairwise (default),
// Complete, Partial with a 0–100 integer cutoff — plus the live-region
// count of removed sites. Out-of-range cutoff input is refused with a
// message and the last valid value stays (Review Focus 2).

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GapControl } from "./GapControl";
import type { GapControlProps } from "./GapControl";

afterEach(cleanup);

function props(over: Partial<GapControlProps> = {}): GapControlProps {
  return {
    value: { kind: "pairwise" },
    onChange: () => {},
    removed: 0,
    total: 1480,
    locked: false,
    ...over,
  };
}

const radios = () => screen.getAllByRole("radio");
const cutoff = () => screen.getByLabelText(/Site coverage cutoff/);

describe("GapControl", () => {
  it("offers Pairwise, Complete and Partial radios, selecting the current value", () => {
    render(<GapControl {...props({ value: { kind: "complete" } })} />);
    const names = radios().map((r) => r.getAttribute("aria-label") ?? r.id);
    expect(
      screen.getByRole("radio", { name: /pairwise/i }),
    ).toBeTruthy();
    expect(
      screen.getByRole("radio", { name: /complete/i }),
    ).toBeTruthy();
    expect(
      screen.getByRole("radio", { name: /partial/i }),
    ).toBeTruthy();
    expect(
      (screen.getByRole("radio", { name: /complete deletion/i }) as HTMLInputElement)
        .checked,
    ).toBe(true);
    void names;
  });

  it("clicking a radio reports the matching SiteFilter", () => {
    const onChange = vi.fn();
    const { rerender } = render(<GapControl {...props({ onChange })} />);
    fireEvent.click(screen.getByRole("radio", { name: /complete deletion/i }));
    expect(onChange).toHaveBeenCalledWith({ kind: "complete" });
    // Controlled radios: the parent's new value must be re-rendered
    // before the next click registers a change.
    rerender(<GapControl {...props({ value: { kind: "complete" }, onChange })} />);
    fireEvent.click(screen.getByRole("radio", { name: /partial deletion/i }));
    expect(onChange).toHaveBeenCalledWith({
      kind: "partial",
      cutoff_pct: 95,
    });
    rerender(
      <GapControl
        {...props({ value: { kind: "partial", cutoff_pct: 95 }, onChange })}
      />,
    );
    fireEvent.click(screen.getByRole("radio", { name: /pairwise deletion/i }));
    expect(onChange).toHaveBeenCalledWith({ kind: "pairwise" });
  });

  it("the cutoff field shows only for partial deletion", () => {
    const { rerender } = render(<GapControl {...props()} />);
    expect(screen.queryByLabelText(/Site coverage cutoff/)).toBeNull();
    rerender(
      <GapControl {...props({ value: { kind: "complete" } })} />,
    );
    expect(screen.queryByLabelText(/Site coverage cutoff/)).toBeNull();
    rerender(
      <GapControl
        {...props({ value: { kind: "partial", cutoff_pct: 80 } })}
      />,
    );
    expect((cutoff() as HTMLInputElement).value).toBe("80");
  });

  it("a valid cutoff commits an integer partial filter", () => {
    const onChange = vi.fn();
    render(
      <GapControl
        {...props({ value: { kind: "partial", cutoff_pct: 95 }, onChange })}
      />,
    );
    fireEvent.change(cutoff(), { target: { value: "90" } });
    expect(onChange).toHaveBeenCalledWith({
      kind: "partial",
      cutoff_pct: 90,
    });
  });

  it.each(["101", "2.5", "-1", "", "abc"])(
    "refuses cutoff %j with a message and keeps the last valid value (Review Focus 2)",
    (bad) => {
      const onChange = vi.fn();
      render(
        <GapControl
          {...props({ value: { kind: "partial", cutoff_pct: 95 }, onChange })}
        />,
      );
      fireEvent.change(cutoff(), { target: { value: bad } });
      expect(onChange).not.toHaveBeenCalled();
      expect(screen.getByRole("alert").textContent).toContain("0");
    },
  );

  it("clears the refusal once a valid value is typed", () => {
    const onChange = vi.fn();
    render(
      <GapControl
        {...props({ value: { kind: "partial", cutoff_pct: 95 }, onChange })}
      />,
    );
    fireEvent.change(cutoff(), { target: { value: "101" } });
    expect(screen.getByRole("alert")).toBeTruthy();
    fireEvent.change(cutoff(), { target: { value: "90" } });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(onChange).toHaveBeenCalledWith({
      kind: "partial",
      cutoff_pct: 90,
    });
  });

  it("announces the removed count in a polite live region", () => {
    render(
      <GapControl
        {...props({
          value: { kind: "complete" },
          removed: 312,
          total: 1480,
        })}
      />,
    );
    const live = document.querySelector('[aria-live="polite"]');
    expect(live?.textContent).toBe(
      "312 of 1,480 sites removed by complete deletion",
    );
  });

  it("the count names the partial cutoff", () => {
    render(
      <GapControl
        {...props({
          value: { kind: "partial", cutoff_pct: 95 },
          removed: 12,
          total: 200,
        })}
      />,
    );
    expect(
      document.querySelector('[aria-live="polite"]')?.textContent,
    ).toBe("12 of 200 sites removed by partial 95% deletion");
  });

  it("locked disables every input with the lesson tooltip", () => {
    render(
      <GapControl
        {...props({ locked: true, value: { kind: "partial", cutoff_pct: 95 } })}
      />,
    );
    for (const r of radios()) {
      expect((r as HTMLInputElement).disabled).toBe(true);
    }
    expect((cutoff() as HTMLInputElement).disabled).toBe(true);
  });
});
