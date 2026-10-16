import { describe, expect, it } from "vitest";

import type { Alignment } from "../engine/generated/Alignment";

import { exportR } from "./rscript";

const ALN: Alignment = {
  labels: ["a", "b", "c"],
  seqs: [
    [65, 67, 71, 84],
    [65, 67, 71, 65],
    [65, 67, 65, 84],
  ],
};

describe("exportR", () => {
  it("escapes quotes in labels for R string literals", () => {
    const aln: Alignment = {
      labels: ["O'Brien\"s", "b", "c"],
      seqs: ALN.seqs,
    };
    const s = exportR(aln, "Jc69", "Nj");
    // Inside the double-quoted FASTA string, " must become \" while ' stays.
    expect(s).toContain("O'Brien\\\"s");
    expect(s).not.toContain('O\'Brien"s');
  });

  it("maps corrections and methods onto ape/phangorn calls", () => {
    expect(exportR(ALN, "P", "Nj")).toContain('model = "raw"');
    expect(exportR(ALN, "Jc69", "Nj")).toContain('model = "JC69"');
    expect(exportR(ALN, "K80", "Nj")).toContain('model = "K80"');
    const nj = exportR(ALN, "Jc69", "Nj");
    expect(nj).toContain("pairwise.deletion = TRUE");
    expect(nj).toContain("nj(d)");
    expect(nj).toContain("write.tree(tree)");
    const upgma = exportR(ALN, "Jc69", "Upgma");
    expect(upgma).toContain("phangorn::upgma(d)");
    expect(upgma).not.toContain("nj(d)");
  });

  it("embeds the alignment as a FASTA string read via textConnection", () => {
    const s = exportR(ALN, "Jc69", "Nj");
    expect(s).toContain("read.dna(textConnection(fa)");
    expect(s).toContain('format = "fasta"');
    expect(s).toContain(">a\\n");
  });
});
