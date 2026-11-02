// Dataset library registry tests (v1.4b plan Task 11, spec §5): the
// index listing and the fetch+parse path an "Open dataset" click takes.
// fetch is stubbed to read web/public/library/ off disk — the same
// static files the app serves.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { listDatasets, loadDataset, loadProvenance } from "./registry";

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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("listDatasets", () => {
  it("returns one summary per index.json entry", async () => {
    stubLibrary();
    const list = await listDatasets();
    expect(list.map((d) => d.id)).toEqual([
      "16s-rrna",
      "cytochrome-c",
      "globins",
      "primate-mtdna",
      "sars-cov-2-spike",
    ]);
    const g = list.find((d) => d.id === "globins");
    expect(g?.title).toBe("Vertebrate globins");
    expect(g?.alphabet).toBe("protein");
    expect(g?.taxa).toBe(23);
    expect(g?.sites).toBe(156);
    expect(g?.provenance).toBe("globins.json");
  });

  it("fails when the index cannot be fetched", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("offline");
    });
    await expect(listDatasets()).rejects.toThrow(/library index/);
  });
});

describe("loadDataset", () => {
  it("fetches and parses the dataset FASTA", async () => {
    stubLibrary();
    const r = await loadDataset("globins");
    if (!r.ok) throw new Error(`loadDataset failed: ${JSON.stringify(r.error)}`);
    expect(r.value.alphabet).toBe("protein");
    expect(r.value.labels).toHaveLength(23);
    expect(r.value.seqs[0].length).toBe(156);
  });

  it("an unknown id returns the unknown-dataset error", async () => {
    stubLibrary();
    const r = await loadDataset("nope");
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.kind === "InvalidExercise") {
      expect(r.error.msg).toBe("unknown library dataset 'nope'");
    }
  });

  it("a fetch failure of a known id is an error, not a blank result", async () => {
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const s = String(input);
      if (s.endsWith("index.json")) {
        return new Response(
          readFileSync(
            resolve(process.cwd(), "public/library/index.json"),
            "utf8",
          ),
        );
      }
      return new Response("gone", { status: 500 });
    });
    const r = await loadDataset("globins");
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.kind === "InvalidExercise") {
      expect(r.error.msg).toContain("globins");
    }
  });
});

describe("loadProvenance", () => {
  it("reads the dataset's provenance file for the source column", async () => {
    stubLibrary();
    const list = await listDatasets();
    const globins = list.find((d) => d.id === "globins");
    if (globins === undefined) throw new Error("globins missing");
    const p = await loadProvenance(globins);
    expect(p?.source).toBe("UniProtKB");
    expect(p?.license).toContain("CC BY 4.0");
  });
});
