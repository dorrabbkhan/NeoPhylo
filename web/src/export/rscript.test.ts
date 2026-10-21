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

describe("exportR bootstrap (v1.2 spec §6.8, checkpoint 15)", () => {
  it("resamples in an explicit loop that skips saturated replicates", () => {
    const s = exportR(ALN, "Jc69", "Nj", { replicates: 100, seed: 1 });
    // No boot.phylo — it aborts on the first FUN error and cannot
    // express the engine's skipped-replicate rule.
    expect(s).not.toContain("boot.phylo(tree");
    expect(s).toContain("x <- aln");
    expect(s).toContain("set.seed(1)");
    expect(s).toContain("B <- 100");
    expect(s).toContain("for (i in seq_len(B))");
    expect(s).toContain("xx <- x[, sample.int(ncol(x), replace = TRUE)]");
    // Same distance as the main analysis, then the non-finite check.
    expect(s).toContain(
      'distOf <- function(xx) ape::dist.dna(xx, model = "JC69", pairwise.deletion = TRUE)',
    );
    expect(s).toContain("any(!is.finite(m_i[lower.tri(m_i)]))");
    expect(s).toContain("tr <- tryCatch(ape::nj(d_i)");
    // Skipped accounting and support on the kept trees.
    expect(s).toContain('sprintf("Skipped (saturated): %d of %d');
    expect(s).toContain("skipped / B > 0.1");
    expect(s).toContain("kept == 0L");
    expect(s).toContain("ape::prop.clades(tree, trees) / kept");
    expect(s).toContain(
      "R's random draws differ from NeoPhylo's; support values vary by a few percent.",
    );
  });

  it("UPGMA keeps phangorn::upgma inside the replicate loop", () => {
    const s = exportR(ALN, "K80", "Upgma", { replicates: 250, seed: 7 });
    expect(s).toContain("tr <- tryCatch(phangorn::upgma(d_i)");
    expect(s).toContain("B <- 250");
    expect(s).toContain("set.seed(7)");
    expect(s).not.toContain("nj(d_i)");
  });

  it("protein Kimura computes the distance inside distOf", () => {
    const s = exportR(PROT, "Kimura", "Nj", { replicates: 100, seed: 1 });
    expect(s).not.toContain("boot.phylo(tree");
    expect(s).toContain("distOf <- function(xx)");
    expect(s).toContain("ape::dist.aa(xx, pairwise.deletion = TRUE");
    expect(s).toContain("as.dist(-log(1 - p - 0.2 * p^2))");
    expect(s).toContain("B <- 100");
    expect(s).toContain('x <- do.call(rbind, as.character(aln))');
  });

  it("protein p and JTT reuse the export's distance expressions", () => {
    const p = exportR(PROT, "P", "Nj", { replicates: 20, seed: 1 });
    expect(p).toContain(
      "distOf <- function(xx) ape::dist.aa(xx, pairwise.deletion = TRUE, scaled = TRUE)",
    );
    const jtt = exportR(PROT, "Jtt", "Nj", { replicates: 20, seed: 1 });
    expect(jtt).toContain("phangorn::dist.ml(phangorn::phyDat(xx,");
    expect(jtt).toContain('model = "JTT"');
  });

  it("leaves the script unchanged when no bootstrap ran", () => {
    expect(exportR(ALN, "Jc69", "Nj")).not.toContain("seq_len(B)");
    expect(exportR(PROT, "Kimura", "Nj")).not.toContain("seq_len(B)");
  });
});
