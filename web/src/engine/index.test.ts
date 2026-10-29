import { describe, expect, it } from "vitest";

import type { Alignment } from "./generated/Alignment";
import type { SiteFilter } from "./generated/SiteFilter";
import { engine } from "./index";

describe("engine wrapper", () => {
  it("parses FASTA text", () => {
    const r = engine.parseFasta(">a\nAC\n");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.labels).toEqual(["a"]);
    }
  });

  it("returns errors as values", () => {
    const r = engine.parseFasta("not fasta");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe("Parse");
    }
  });
});

/** A small DNA alignment with gaps in two columns only. */
const GAPPED: Alignment = (() => {
  const r = engine.parseFasta(">a\nACGTACGT\n>b\nAC-TA-GT\n>c\nTCGTACGA\n");
  if (!r.ok) throw new Error("test alignment failed to parse");
  return r.value;
})();

/** Every column has a gap in at least one sequence, so complete
 * deletion removes all sites. */
const ALL_GAP: Alignment = (() => {
  const r = engine.parseFasta(">a\n-GT\n>b\nA-T\n>c\nAC-\n");
  if (!r.ok) throw new Error("test alignment failed to parse");
  return r.value;
})();

const PAIRWISE: SiteFilter = { kind: "pairwise" };

// v1.4b Task 7: the filtered-distance, site-mask and .meg wrappers.
// Each returns `{ ok: true }` on a valid input and the NeoError shape
// on an invalid one — errors are values, nothing throws.
describe("engine filtered wrappers", () => {
  it("distancesFiltered with pairwise equals distances exactly", () => {
    const filtered = engine.distancesFiltered(GAPPED, "Jc69", PAIRWISE);
    const plain = engine.distances(GAPPED, "Jc69");
    expect(filtered.ok).toBe(true);
    expect(plain.ok).toBe(true);
    if (filtered.ok && plain.ok) {
      expect(filtered.value).toEqual(plain.value);
    }
  });

  it("distancesFiltered with complete deletion on an all-gap alignment is NoSitesKept", () => {
    const r = engine.distancesFiltered(ALL_GAP, "Jc69", { kind: "complete" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe("NoSitesKept");
    }
  });

  it("a partial filter with cutoff_pct 101 is an error value", () => {
    const r = engine.distancesFiltered(GAPPED, "Jc69", {
      kind: "partial",
      cutoff_pct: 101,
    } as SiteFilter);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe("InvalidExercise");
    }
  });

  it.each([
    ["bogus kind", { kind: "bogus" }],
    ["null", null],
  ])("a malformed filter (%s) is an error value", (_name, filter) => {
    const r = engine.distancesFiltered(
      GAPPED,
      "Jc69",
      filter as unknown as SiteFilter,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe("InvalidExercise");
    }
  });

  it("siteMask reports weights and removed columns", () => {
    const r = engine.siteMask(GAPPED, { kind: "complete" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.weights).toEqual([1, 1, 0, 1, 1, 0, 1, 1]);
      expect(r.value.removed).toEqual([2, 5]);
    }
  });

  it("siteMask with complete deletion on an all-gap alignment is NoSitesKept", () => {
    const r = engine.siteMask(ALL_GAP, { kind: "complete" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe("NoSitesKept");
    }
  });

  it("siteMask refuses cutoff_pct 101", () => {
    const r = engine.siteMask(GAPPED, {
      kind: "partial",
      cutoff_pct: 101,
    } as SiteFilter);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe("InvalidExercise");
    }
  });

  it("bootstrapBatchFiltered with pairwise equals bootstrapBatch exactly", () => {
    const filtered = engine.bootstrapBatchFiltered(
      GAPPED,
      "Jc69",
      "Nj",
      PAIRWISE,
      7,
      0,
      20,
    );
    const plain = engine.bootstrapBatch(GAPPED, "Jc69", "Nj", 7, 0, 20);
    expect(filtered.ok).toBe(true);
    expect(plain.ok).toBe(true);
    if (filtered.ok && plain.ok) {
      expect(filtered.value).toEqual(plain.value);
    }
  });

  it("bootstrapBatchFiltered with complete deletion on an all-gap alignment is NoSitesKept", () => {
    const r = engine.bootstrapBatchFiltered(
      ALL_GAP,
      "Jc69",
      "Nj",
      { kind: "complete" },
      7,
      0,
      5,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe("NoSitesKept");
    }
  });

  it("replicateDetailFiltered with pairwise equals replicateDetail exactly", () => {
    const filtered = engine.replicateDetailFiltered(
      GAPPED,
      "Jc69",
      "Nj",
      PAIRWISE,
      7,
      3,
    );
    const plain = engine.replicateDetail(GAPPED, "Jc69", "Nj", 7, 3);
    expect(filtered.ok).toBe(true);
    expect(plain.ok).toBe(true);
    if (filtered.ok && plain.ok) {
      expect(filtered.value).toEqual(plain.value);
    }
  });

  it("replicateDetailFiltered accepts a non-pairwise filter", () => {
    const r = engine.replicateDetailFiltered(
      GAPPED,
      "Jc69",
      "Nj",
      { kind: "complete" },
      7,
      3,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      // Weights stay one entry per alignment column; the removed
      // columns are never drawn.
      expect(r.value.weights).toHaveLength(8);
      expect(r.value.weights[2]).toBe(0);
      expect(r.value.weights[5]).toBe(0);
    }
  });
});

const SEQ_MEG = `#mega
!Title Sequential DNA example;
!Format DataType=DNA Indel=- Missing=?;

#Alpha
AACGTGGCCA
#Beta
AAGGTCGCCA
#Gamma
CAGTTCGCCA
`;

const MATRIX_MEG = `#mega
!Format DataType=Distance;
#Alpha
0.00 0.50
#Beta
0.50 0.00
`;

describe("engine .meg wrappers", () => {
  it("parseMeg returns the alignment, title and notices", () => {
    const r = engine.parseMeg(SEQ_MEG);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.alignment.labels).toEqual(["Alpha", "Beta", "Gamma"]);
      expect(r.value.title).toBe("Sequential DNA example");
    }
  });

  it("parseMeg refuses a distance-matrix .meg file", () => {
    const r = engine.parseMeg(MATRIX_MEG);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe("Parse");
      if (r.error.kind === "Parse") {
        expect(r.error.msg).toContain("distance-matrix");
      }
    }
  });

  it("writeMeg then parseMeg is the same alignment", () => {
    const written = engine.writeMeg(GAPPED, "round trip");
    expect(written.ok).toBe(true);
    if (!written.ok) return;
    expect(written.value.startsWith("#mega")).toBe(true);
    const parsed = engine.parseMeg(written.value);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.alignment.labels).toEqual(GAPPED.labels);
      expect(parsed.value.alignment.seqs).toEqual(GAPPED.seqs);
    }
  });

  it("writeMeg refuses a title it cannot write", () => {
    const r = engine.writeMeg(GAPPED, 'a "quoted" title');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe("InvalidExercise");
    }
  });
});
