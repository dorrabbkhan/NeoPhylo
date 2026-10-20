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
  alphabet: "dna",
};

describe("exportR", () => {
  it("escapes quotes in labels for R string literals", () => {
    const aln: Alignment = {
      labels: ["O'Brien\"s", "b", "c"],
      seqs: ALN.seqs,
      alphabet: "dna",
    };
    const s = exportR(aln, "Jc69", "Nj");
    // Inside the double-quoted FASTA string, " must become \" while ' stays.
    expect(s).toContain("O'Brien\\\"s");
    expect(s).not.toContain("O'Brien\"s");
  });

  it("maps corrections and methods onto ape/phangorn calls", () => {
    expect(exportR(ALN, "P", "Nj")).toContain('model = "raw"');
    expect(exportR(ALN, "Jc69", "Nj")).toContain('model = "JC69"');
    expect(exportR(ALN, "K80", "Nj")).toContain('model = "K80"');
    const nj = exportR(ALN, "Jc69", "Nj");
    expect(nj).toContain("pairwise.deletion = TRUE");
    expect(nj).toContain("nj(d)");
    expect(nj).toContain('cat(ape::write.tree(tree), "\\n")');
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

const PROT: Alignment = {
  labels: ["a", "b", "c"],
  seqs: [
    [77, 75, 86, 76], // MKVL
    [77, 75, 73, 76], // MKIL
    [77, 82, 86, 76], // MRVL
  ],
  alphabet: "protein",
};

describe("exportR protein (v1.1 spec §5.6)", () => {
  it("p: ape::dist.aa with pairwise.deletion and scaled", () => {
    const s = exportR(PROT, "P", "Nj");
    expect(s).toContain("read.FASTA(textConnection(fa), type = \"AA\")");
    expect(s).toContain("ape::dist.aa(as.matrix(aln)");
    expect(s).toContain("pairwise.deletion = TRUE");
    expect(s).toContain("scaled = TRUE");
    expect(s).not.toContain("dist.dna");
    expect(s).toContain("nj(");
    expect(s).toContain('cat(ape::write.tree(tree), "\\n")');
  });

  it("Kimura: -log(1 - p - 0.2*p^2) from that proportion", () => {
    const s = exportR(PROT, "Kimura", "Nj");
    expect(s).toContain("dist.aa");
    expect(s).toContain("-log(1 - p - 0.2*p^2)");
    expect(s).not.toContain("dist.ml");
  });

  it("JTT: phangorn::dist.ml on an AA phyDat, with an agreement comment", () => {
    const s = exportR(PROT, "Jtt", "Nj");
    expect(s).toContain('type = "AA"');
    expect(s).toContain('dist.ml(');
    expect(s).toContain('model = "JTT"');
    // The comment states the measured agreement (decisions.md Task 6).
    expect(s).toMatch(/#.*within/i);
  });

  it("DNA models on protein still throw", () => {
    expect(() => exportR(PROT, "Jc69", "Nj")).toThrow();
  });
});

describe("exportR bootstrap (v1.2 spec §6.8)", () => {
  it("adds boot.phylo with the same distance and method, B = replicates", () => {
    const s = exportR(ALN, "Jc69", "Nj", { replicates: 100 });
    expect(s).toContain(
      'ape::boot.phylo(tree, x, function(xx) ape::nj(ape::dist.dna(xx, model = "JC69", pairwise.deletion = TRUE)), B = 100, trees = TRUE)',
    );
    expect(s).toContain("x <- aln");
    expect(s).toContain("phangorn::plotBS(tree, bt$trees)");
    expect(s).toContain(
      "R's random draws differ from NeoPhylo's; support values vary by a few percent.",
    );
    expect(s).toContain("boot.phylo with B = 100 can take a while");
  });

  it("UPGMA keeps phangorn::upgma inside the bootstrap function", () => {
    const s = exportR(ALN, "K80", "Upgma", { replicates: 250 });
    expect(s).toContain("phangorn::upgma(ape::dist.dna(xx,");
    expect(s).toContain("B = 250");
    expect(s).not.toContain("nj(ape::dist.dna(xx");
  });

  it("protein Kimura computes the distance inside boot.phylo's function", () => {
    const s = exportR(PROT, "Kimura", "Nj", { replicates: 100 });
    expect(s).toContain("ape::boot.phylo(tree, x, function(xx)");
    expect(s).toContain("ape::dist.aa(xx, pairwise.deletion = TRUE");
    expect(s).toContain("-log(1 - p - 0.2 * p^2)");
    expect(s).toContain("B = 100");
    expect(s).toContain("boot.phylo with B = 100 can take a while");
  });

  it("protein p and JTT reuse the export's distance expressions", () => {
    const p = exportR(PROT, "P", "Nj", { replicates: 20 });
    expect(p).toContain("ape::dist.aa(xx, pairwise.deletion = TRUE, scaled = TRUE)");
    const jtt = exportR(PROT, "Jtt", "Nj", { replicates: 20 });
    expect(jtt).toContain("phangorn::dist.ml(phangorn::phyDat(xx,");
    expect(jtt).toContain('model = "JTT"');
  });

  it("leaves the script unchanged when no bootstrap ran", () => {
    expect(exportR(ALN, "Jc69", "Nj")).not.toContain("boot.phylo");
    expect(exportR(PROT, "Kimura", "Nj")).not.toContain("boot.phylo");
  });
});
