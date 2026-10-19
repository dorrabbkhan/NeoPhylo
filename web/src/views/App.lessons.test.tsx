// Lessons-menu integration tests (checkpoint 13): the header menu lists
// every built-in lesson; picking one fetches /exercises/<id>.json,
// loads the file's own settings at step 0 in lesson mode, and the URL
// sync writes ?lesson=<id>. Nothing from the previous lesson or the
// sandbox — correction, sim model, alphabet, notice, step — survives.
//
// fetch is stubbed to read the real exercise files off disk (Vitest
// runs with cwd = web/), so the assertions run on the shipped lessons.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LESSONS } from "../lessons/catalog";
import { App } from "./App";

const EXERCISES = resolve("..", "exercises");

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  history.replaceState(null, "", "/");
});

/** fetch that serves exercises/<id>.json from disk, like the vite plugin. */
function stubLessonFetch() {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    const m = /^\/exercises\/([\w.-]+\.json)$/.exec(url);
    const body =
      m !== null ? readFileSync(resolve(EXERCISES, m[1]), "utf8") : "nf";
    return Promise.resolve({
      ok: m !== null,
      status: m !== null ? 200 : 404,
      text: () => Promise.resolve(body),
    } as Response);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const openMenu = () =>
  fireEvent.click(screen.getByRole("button", { name: "Lessons" }));

describe("Lessons menu in the header", () => {
  it("lists every built-in lesson in teaching order, marking the current one", async () => {
    stubLessonFetch();
    render(<App />);
    await screen.findByRole("img", { name: "Inferred tree" });
    openMenu();
    const items = screen.getAllByRole("menuitemradio");
    expect(
      items.map((b) => b.querySelector(".lessons-menu-title")?.textContent),
    ).toEqual(LESSONS.map((l) => l.title));
    // The default lesson is nj-basics: exactly its item is checked.
    const checked = items.filter(
      (b) => b.getAttribute("aria-checked") === "true",
    );
    expect(checked).toHaveLength(1);
    expect(checked[0].textContent).toContain("How Neighbor-Joining works");
  });

  it("choosing a lesson loads it and updates the URL to ?lesson=<id>", async () => {
    stubLessonFetch();
    render(<App />);
    await screen.findByRole("img", { name: "Inferred tree" });
    openMenu();
    fireEvent.click(
      screen.getAllByRole("menuitemradio")[1], // upgma-fails
    );
    await screen.findByText("When UPGMA fails: the molecular clock");
    await waitFor(() =>
      expect(window.location.search).toContain("lesson=upgma-fails"),
    );
    // Lesson mode, step 0, no notice.
    expect(
      screen.getByRole("radio", { name: "Lesson" }).getAttribute("aria-checked"),
    ).toBe("true");
    expect(screen.getByText(/step 0 of/)).toBeTruthy();
    expect(document.querySelector(".alphabet-notice")).toBeNull();
    expect(screen.queryByText(/Switched /)).toBeNull();
  });

  it("loads the picked lesson's own settings — nothing carries over", async () => {
    // protein-models declares correction p; switching to nj-basics
    // must show nj-basics.json's analysis, not p.
    stubLessonFetch();
    history.replaceState(null, "", "/?lesson=protein-models");
    render(<App />);
    await screen.findByText("Protein distances: when counting isn't enough");

    openMenu();
    fireEvent.click(screen.getAllByRole("menuitemradio")[0]);
    await screen.findByText("How Neighbor-Joining works");

    const correction = screen.getByLabelText(
      "Distance correction",
    ) as HTMLSelectElement;
    expect(correction.value).toBe("Jc69");
    expect(screen.getByText(/step 0 of/)).toBeTruthy();
    expect(screen.queryByText(/Switched /)).toBeNull();
    expect(
      screen.getByRole("radio", { name: "Lesson" }).getAttribute("aria-checked"),
    ).toBe("true");
    await waitFor(() =>
      expect(window.location.search).toContain("lesson=nj-basics"),
    );
    // DNA sim model from the file, not the protein JTT of before.
    const model = screen.getByLabelText(
      "Simulation model",
    ) as HTMLSelectElement;
    expect(model.value).toBe("Jc69");
  });

  it("reset from Sandbox with imported protein data, via the menu", async () => {
    stubLessonFetch();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<App />);
    await screen.findByRole("img", { name: "Inferred tree" });
    fireEvent.click(screen.getByRole("radio", { name: "Sandbox" }));
    fireEvent.change(screen.getByLabelText("Paste sequences or a tree"), {
      target: { value: ">p1\nMKVL\n>p2\nMKIL\n>p3\nMRVL\n>p4\nMKVA" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    // The protein import switched the correction to JTT with a notice.
    await screen.findByText(/Switched correction to JTT/);
    const correction = screen.getByLabelText(
      "Distance correction",
    ) as HTMLSelectElement;
    expect(correction.value).toBe("Jtt");

    // Picking nj-basics confirms (imported data is cleared), then loads.
    openMenu();
    fireEvent.click(screen.getAllByRole("menuitemradio")[0]);
    await screen.findByText("How Neighbor-Joining works");
    expect(confirmSpy).toHaveBeenCalledWith(
      "Leave sandbox? Your imported data will be cleared.",
    );
    expect(correction.value).toBe("Jc69");
    expect(screen.queryByText(/Switched /)).toBeNull();
    expect(screen.getByText(/step 0 of/)).toBeTruthy();
    confirmSpy.mockRestore();
  });

  it("leaving sandbox via the Lesson radio also restores file settings", async () => {
    // The header's other lesson-reload path (exitSandbox) must reset
    // analysis to the file's values too — sandbox tweaks don't leak.
    stubLessonFetch();
    history.replaceState(null, "", "/?lesson=upgma-fails");
    render(<App />);
    await screen.findByText("When UPGMA fails: the molecular clock");
    fireEvent.click(screen.getByRole("radio", { name: "Sandbox" }));
    const correction = screen.getByLabelText(
      "Distance correction",
    ) as HTMLSelectElement;
    fireEvent.change(correction, { target: { value: "P" } });
    expect(correction.value).toBe("P");

    fireEvent.click(screen.getByRole("radio", { name: "Lesson" }));
    await waitFor(() => expect(correction.value).toBe("Jc69"));
    expect(screen.queryByText(/Switched /)).toBeNull();
    expect(screen.getByText(/step 0 of/)).toBeTruthy();
  });
});
