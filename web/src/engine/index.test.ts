import { describe, expect, it } from "vitest";

import type { Alignment } from "./generated/Alignment";
import type { DistanceInput } from "./generated/DistanceInput";
import type { SiteFilter } from "./generated/SiteFilter";
import { stepMatrix } from "../views/stepMatrix";
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

  it("jttPairDetailFiltered with pairwise equals jttPairDetail exactly", () => {
    const aln = engine.parseFasta(">a\nMKVLGELAK\n>b\nMKVLGRLAK\n>c\nMQVLGELTK\n");
    if (!aln.ok) throw new Error("test alignment failed to parse");
    const filtered = engine.jttPairDetailFiltered(aln.value, 0, 1, PAIRWISE);
    const plain = engine.jttPairDetail(aln.value, 0, 1);
    expect(filtered.ok).toBe(true);
    expect(plain.ok).toBe(true);
    if (filtered.ok && plain.ok) {
      expect(filtered.value).toEqual(plain.value);
    }
  });

  it("jttPairDetailFiltered counts only the kept columns", () => {
    const aln = engine.parseFasta(">a\nMKVLG\n>b\nMIVLG\n>c\n-KVLG\n");
    if (!aln.ok) throw new Error("test alignment failed to parse");
    const r = engine.jttPairDetailFiltered(aln.value, 0, 1, {
      kind: "complete",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      // Column 0 is removed by complete deletion: 4 comparable sites,
      // one difference — the unfiltered detail counts 5 and p = 0.2.
      expect(r.value.comparable).toBe(4);
      expect(r.value.differences).toBe(1);
      expect(r.value.p).toBe(0.25);
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
        expect(r.error.msg).toContain("holds a distance matrix");
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

// v1.4c Task 6: the matrix and worksheet wrappers. Each returns
// `{ ok: true }` on a valid input and the NeoError shape on an
// invalid one — errors are values, nothing throws.
describe("engine matrix + worksheet wrappers", () => {
  const WIKI5: DistanceInput = {
    names: ["a", "b", "c", "d", "e"],
    lower: [5, 9, 10, 9, 10, 8, 8, 9, 7, 3],
  };
  const MEG_DISTANCE = `#mega
!Title wiki5;
!Format DataType=Distance DataFormat=LowerLeft NTaxa=5;

#a
#b
#c
#d
#e

5
9 10
9 10 8
8 9 7 3
`;

  it("matrixToDistances validates and converts", () => {
    const r = engine.matrixToDistances(WIKI5);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.labels).toEqual(WIKI5.names);
      expect(r.value.model).toBe("Supplied");
    }
  });

  it("matrixToDistances refuses duplicate names as InvalidMatrix", () => {
    const bad: DistanceInput = { names: ["a", "a", "c"], lower: [1, 2, 3] };
    const r = engine.matrixToDistances(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("InvalidMatrix");
  });

  it("validateMatrix accepts a valid input and refuses a short lower", () => {
    expect(engine.validateMatrix(WIKI5).ok).toBe(true);
    const short: DistanceInput = { names: ["a", "b", "c"], lower: [1, 2] };
    const r = engine.validateMatrix(short);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("InvalidMatrix");
  });

  it("detectMatrixFormat recognizes PHYLIP and .meg, null otherwise", () => {
    const phy = engine.detectMatrixFormat("3\na 0 1\nb 1 0\nc 2 3 0\n");
    expect(phy.ok).toBe(true);
    if (phy.ok) expect(phy.value).toBe("Phylip");
    const meg = engine.detectMatrixFormat(MEG_DISTANCE);
    expect(meg.ok).toBe(true);
    if (meg.ok) expect(meg.value).toBe("Meg");
    const none = engine.detectMatrixFormat("not a matrix");
    expect(none.ok).toBe(true);
    if (none.ok) expect(none.value).toBeNull();
  });

  it("parsePhylipMatrix parses a square matrix", () => {
    const r = engine.parsePhylipMatrix("3\na 0 1 2\nb 1 0 3\nc 2 3 0\n", {
      names: "Auto",
      use_lower_if_asymmetric: false,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.matrix.names).toEqual(["a", "b", "c"]);
      expect(r.value.matrix.lower).toEqual([1, 2, 3]);
    }
  });

  it("parseMegMatrix parses a distance file", () => {
    const r = engine.parseMegMatrix(MEG_DISTANCE);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.title).toBe("wiki5");
      expect(r.value.matrix.names).toEqual(WIKI5.names);
      expect(r.value.matrix.lower).toEqual(WIKI5.lower);
    }
  });

  it("parsePastedMatrix parses a headered square grid", () => {
    const r = engine.parsePastedMatrix(
      "a b c d e\n0 5 9 9 8\n5 0 10 10 9\n9 10 0 8 7\n9 10 8 0 3\n8 9 7 3 0\n",
      { first_column_names: false, header_row: true, decimal_comma: false },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.matrix.names).toEqual(WIKI5.names);
      expect(r.value.matrix.lower).toEqual(WIKI5.lower);
    }
  });

  it("parsePastedMatrix asks MatrixAmbiguous on a nameless grid", () => {
    // All-numeric rows genuinely admit two readings.
    const r = engine.parsePastedMatrix("0\n1 0\n2 3 0\n", {
      first_column_names: null,
      header_row: null,
      decimal_comma: null,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("MatrixAmbiguous");
  });

  it("writeMegMatrix round-trips through parseMegMatrix", () => {
    const written = engine.writeMegMatrix(WIKI5, "wiki5");
    expect(written.ok).toBe(true);
    if (!written.ok) return;
    expect(written.value.startsWith("#mega")).toBe(true);
    const parsed = engine.parseMegMatrix(written.value);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.matrix).toEqual(WIKI5);
      expect(parsed.value.title).toBe("wiki5");
    }
  });

  it("additiveMatrix derives a matrix from a tree", () => {
    const tree = engine.parseNewick("((a:1,b:1):1,(c:1,(d:1,e:1):1):1);");
    expect(tree.ok).toBe(true);
    if (!tree.ok) return;
    const r = engine.additiveMatrix(tree.value, 1);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.names).toEqual(["a", "b", "c", "d", "e"]);
      // d(a,b) = 1 + 1 = 2; d(d,e) = 1 + 1 = 2.
      expect(r.value.lower[0]).toBe(2);
      expect(r.value.lower[r.value.lower.length - 1]).toBe(2);
    }
  });

  it("worksheetFacts reports the wiki5 joins from the trace", () => {
    const dm = engine.matrixToDistances(WIKI5);
    expect(dm.ok).toBe(true);
    if (!dm.ok) return;
    const r = engine.worksheetFacts(dm.value, "Nj");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Two pairwise joins plus the final three-way join entry.
    expect(r.value).toHaveLength(3);
    const [s1, s2, fin] = r.value;
    expect(s1.chosen).toEqual(["a", "b"]);
    expect(s1.row_sums).toEqual([31, 34, 34, 30, 27]);
    expect(s1.chosen_is_closest).toBe(false);
    expect(s1.closest).toEqual([["d", "e"]]);
    expect(s2.tied).toEqual([
      ["c", "u1"],
      ["d", "e"],
    ]);
    expect(s2.tie_same_split).toBe(true);
    expect(fin.final_join).toBe(true);
    expect(fin.chosen).toEqual(["d", "e"]);
    expect(fin.new_distances).toEqual([["u2", 2]]);
  });

  it("worksheetFacts is an error value on an invalid matrix", () => {
    const r = engine.worksheetFacts(
      {
        labels: ["a", "b"],
        model: "Supplied",
        cells: [{ Value: 0 }, { Value: 1 }, { Value: 1 }, { Value: 0 }],
      },
      "Nj",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("TooFewTaxa");
  });

  it("JoinFacts names equal what stepMatrix shows for the same steps", () => {
    const dm = engine.matrixToDistances(WIKI5);
    expect(dm.ok).toBe(true);
    if (!dm.ok) return;
    const built = engine.buildTree(dm.value, "Nj", { trace: true });
    expect(built.ok).toBe(true);
    if (!built.ok || built.value.trace === null) return;
    const facts = engine.worksheetFacts(dm.value, "Nj");
    expect(facts.ok).toBe(true);
    if (!facts.ok) return;
    const { trace, tree } = built.value;
    if (!("Nj" in trace)) return;
    for (let i = 0; i < trace.Nj.steps.length; i += 1) {
      const sm = stepMatrix({
        trace,
        step: i,
        matrix: dm.value,
        matrixView: "distance",
        inferred: tree,
      });
      expect(sm).not.toBeNull();
      if (sm === null || sm.chosen === null) continue;
      const f = facts.value[i];
      // The chosen pair's names equal the heatmap's labels at the
      // chosen indices, and every fact name is a shown cluster name.
      expect(f.chosen).toEqual([sm.labels[sm.chosen[0]], sm.labels[sm.chosen[1]]]);
      const shown = new Set(sm.labels);
      for (const [a, b] of [...f.tied, ...f.closest]) {
        expect(shown.has(a)).toBe(true);
        expect(shown.has(b)).toBe(true);
      }
      for (const [name] of f.new_distances) {
        expect(shown.has(name)).toBe(true);
      }
    }
    // The final entry names a, b, c exactly like the final position.
    const sm = stepMatrix({
      trace,
      step: trace.Nj.steps.length,
      matrix: dm.value,
      matrixView: "distance",
      inferred: tree,
    });
    const fin = facts.value[facts.value.length - 1];
    expect(sm).not.toBeNull();
    if (sm !== null) {
      expect(fin.chosen).toEqual([sm.labels[0], sm.labels[1]]);
      expect(fin.new_distances[0][0]).toBe(sm.labels[2]);
    }
  });
});
