// "Open dataset" sheet tests (v1.4b plan Task 11, spec §5.3): one row
// per library dataset, the unsaved-work confirm (Review Focus 5), the
// fetch→parse→dispatch path and load errors. fetch is stubbed to read
// web/public/library/ — the same files the app serves.

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

import { DatasetSheet } from "./DatasetSheet";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubLibrary() {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const m = /library\/([\w.-]+)$/.exec(String(input));
    if (m === null) return new Response("not found", { status: 404 });
    try {
      return new Response(
        readFileSync(resolve(process.cwd(), "public/library", m[1]), "utf8"),
      );
    } catch {
      return new Response("not found", { status: 404 });
    }
  });
}

function openSheet(confirmReplace = false) {
  const onOpen = vi.fn();
  const onClose = vi.fn();
  render(
    <DatasetSheet
      confirmReplace={confirmReplace}
      onOpen={onOpen}
      onClose={onClose}
    />,
  );
  return { onOpen, onClose };
}

describe("DatasetSheet", () => {
  it("lists every dataset with its meta and a provenance link", async () => {
    stubLibrary();
    openSheet();
    const dialog = await screen.findByRole("dialog", { name: "Open dataset" });
    await waitFor(() =>
      expect(dialog.querySelectorAll(".dataset-row")).toHaveLength(5),
    );
    expect(screen.getByText("Vertebrate globins")).toBeTruthy();
    expect(dialog.textContent).toContain("23 taxa × 156 sites");
    expect(dialog.textContent).toContain("UniProtKB");
    const link = screen.getAllByRole("link", { name: /provenance/i })[0];
    expect(link.getAttribute("href")).toContain("library/");
  });

  it("opens a dataset through the same parse path as a file", async () => {
    stubLibrary();
    const { onOpen } = openSheet();
    await screen.findByText("Vertebrate globins");
    fireEvent.click(
      screen.getByRole("button", { name: /Vertebrate globins/ }),
    );
    await waitFor(() => expect(onOpen).toHaveBeenCalledTimes(1));
    const [ds, aln] = onOpen.mock.calls[0];
    expect(ds.id).toBe("globins");
    expect(aln.alphabet).toBe("protein");
    expect(aln.labels).toHaveLength(23);
  });

  it("Review Focus 5: over unsaved work it asks first; declining keeps the work", async () => {
    stubLibrary();
    const { onOpen } = openSheet(true);
    await screen.findByText("Vertebrate globins");
    fireEvent.click(
      screen.getByRole("button", { name: /Vertebrate globins/ }),
    );
    expect(screen.getByText("Replace your unsaved work?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Keep my work" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Vertebrate globins/ }),
      ).toBeTruthy(),
    );
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("accepting the confirm loads the dataset", async () => {
    stubLibrary();
    const { onOpen } = openSheet(true);
    await screen.findByText("Vertebrate globins");
    fireEvent.click(
      screen.getByRole("button", { name: /Vertebrate globins/ }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Replace my work" }),
    );
    await waitFor(() => expect(onOpen).toHaveBeenCalledTimes(1));
  });

  it("a fetch failure shows a message inside the sheet", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("offline");
    });
    openSheet();
    await screen.findByRole("dialog", { name: "Open dataset" });
    await screen.findByRole("alert");
  });
});
