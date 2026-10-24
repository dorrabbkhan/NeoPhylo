// Export figure regression (v1.3 Task 11 fix round): presenter mode
// scales the on-screen figure — shared leaf spacing 28 → 42 px/leaf
// and 1.5× text — but exports are document-size figures, so the
// exported SVG must be byte-identical whether the mode is on or off
// for the same tree and the same measured panel width.
//
// The export menu itself is unreachable through the UI in presenter
// mode (§6.6 hides the controls column and the drawer's header
// button), so the test captures App's dispatch through a transparent
// Header wrapper and opens the Settings drawer with a setDrawer
// action — a state only a non-pointer dispatch can produce — to run
// the real App → ExportMenu → exportSvg path with session.presenter
// set. ResizeObserver is the jsdom stub, so the measured panel width
// stays at the pre-measurement default on both sides.

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import type { Dispatch } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Exercise } from "../engine/generated/Exercise";
import type { Action } from "../state/session";
import { initialSession, reducer } from "../state/session";
import { App } from "./App";
import type { HeaderProps } from "./Header";

/** App's dispatch, lifted out of the wrapped Header each render. */
const captured = vi.hoisted(() => ({
  dispatch: null as Dispatch<Action> | null,
}));

vi.mock("./Header", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./Header")>();
  const WrappedHeader = (props: HeaderProps) => {
    captured.dispatch = props.dispatch;
    return <mod.Header {...props} />;
  };
  return { ...mod, Header: WrappedHeader };
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
  delete document.documentElement.dataset.presenter;
});

// Same content as src/lessons/default.ts (spec §7 example).
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
  locked: [],
  prompts: [],
  bootstrap: null,
};

/** The trace's final position, computed independently of the app. */
function finalStep(ex: Exercise): number {
  const s = reducer(initialSession(ex), {
    type: "load",
    exercise: ex,
    source: "lesson",
  });
  const trace = s.result!.trace!;
  return "Nj" in trace ? trace.Nj.steps.length + 1 : trace.Upgma.steps.length;
}

/** Capture downloaded (name, text) pairs by stubbing URL.createObjectURL. */
function stubDownloads() {
  const names: string[] = [];
  const blobs: Blob[] = [];
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: vi.fn((b: Blob) => {
      blobs.push(b);
      return "blob:fake";
    }),
    revokeObjectURL: vi.fn(),
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
    function (this: HTMLAnchorElement) {
      names.push(this.download);
    },
  );
  return { names, texts: () => Promise.all(blobs.map((b) => b.text())) };
}

/** The SVG item of the export menu currently mounted. */
function svgExportButton(menu: HTMLElement) {
  return within(menu).getByRole("button", { name: /^SVG/ });
}

describe("export path under presenter mode", () => {
  it("exports the identical SVG whether presenter mode is on or off", async () => {
    const dl = stubDownloads();
    render(<App exercise={NJ_BASICS} />);
    const slider = await screen.findByRole("slider");
    fireEvent.change(slider, {
      target: { value: String(finalStep(NJ_BASICS)) },
    });

    // Presenter off (jsdom is pinned at the wide breakpoint, so the
    // export menu sits in the controls column).
    const columnMenu = document.querySelector<HTMLElement>(".export-menu");
    expect(columnMenu).not.toBeNull();
    fireEvent.click(svgExportButton(columnMenu!));

    // Presenter on: the controls column — and with it the export menu —
    // unmounts by design (§6.6). A setDrawer dispatch still mounts the
    // same sections in the drawer, which is the only way the menu can
    // exist under the mode.
    fireEvent.click(screen.getByRole("button", { name: "Presenter mode" }));
    expect(document.documentElement.dataset.presenter).toBe("true");
    expect(document.querySelector(".export-menu")).toBeNull();

    act(() => {
      captured.dispatch!({ type: "setDrawer", open: true });
    });
    const drawer = await screen.findByRole("dialog", { name: "Settings" });
    const drawerMenu = drawer.querySelector<HTMLElement>(".export-menu");
    expect(drawerMenu).not.toBeNull();
    fireEvent.click(svgExportButton(drawerMenu!));

    const texts = await dl.texts();
    expect(dl.names).toEqual(["neophylo-tree.svg", "neophylo-tree.svg"]);
    expect(texts).toHaveLength(2);
    expect(texts[1]).toBe(texts[0]);
  });
});
