// Export menu tests (v1.1 plan Task 13): the "Distance matrix (PHYLIP)"
// item downloads distances.phy produced by engine.writePhylipMatrix
// (Auto names) and explains the Relaxed fallback when names are too long.

import {
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Alignment } from "../engine/generated/Alignment";
import type { DistanceMatrix } from "../engine/generated/DistanceMatrix";

import { ExportMenu } from "./ExportMenu";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const ALN: Alignment = {
  labels: ["a", "b", "c"],
  seqs: [
    [65, 67, 71, 84],
    [65, 67, 71, 65],
    [65, 67, 65, 84],
  ],
  alphabet: "dna",
};

const MATRIX: DistanceMatrix = {
  labels: ["a", "b", "c"],
  model: "Jc69",
  cells: [
    { Value: 0 },
    { Value: 0.1 },
    { Value: 0.2 },
    { Value: 0.1 },
    { Value: 0 },
    { Value: 0.15 },
    { Value: 0.2 },
    { Value: 0.15 },
    { Value: 0 },
  ],
};

/** Stub object URLs and capture every downloaded file name. */
function stubDownloads(): string[] {
  const names: string[] = [];
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: vi.fn(() => "blob:fake"),
    revokeObjectURL: vi.fn(),
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
    function (this: HTMLAnchorElement) {
      names.push(this.download);
    },
  );
  return names;
}

const MENU_LABEL = "Distance matrix (PHYLIP)";

describe("ExportMenu PHYLIP matrix", () => {
  it("downloads distances.phy via writePhylipMatrix with Auto names", () => {
    const downloads = stubDownloads();
    render(
      <ExportMenu
        tree={null}
        alignment={ALN}
        correction="Jc69"
        method="Nj"
        clampNegative={false}
        matrix={MATRIX}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: MENU_LABEL }));
    expect(downloads).toEqual(["distances.phy"]);
  });

  it("is disabled while no distance matrix exists", () => {
    render(
      <ExportMenu
        tree={null}
        alignment={ALN}
        correction="Jc69"
        method="Nj"
        clampNegative={false}
        matrix={null}
      />,
    );
    expect(
      screen.getByRole("button", { name: MENU_LABEL }),
    ).toHaveProperty("disabled", true);
  });

  it("explains the Relaxed fallback when a name exceeds 10 characters", () => {
    stubDownloads();
    const long: DistanceMatrix = {
      ...MATRIX,
      labels: ["Homo_sapiens", "b", "c"],
    };
    render(
      <ExportMenu
        tree={null}
        alignment={ALN}
        correction="Jc69"
        method="Nj"
        clampNegative={false}
        matrix={long}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: MENU_LABEL }));
    expect(screen.getByText(/Relaxed names/)).toBeTruthy();
  });
});
