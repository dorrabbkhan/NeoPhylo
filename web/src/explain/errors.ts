// Friendly messages for every engine error (plan Task 20, spec §4.7).
// Each variant gets the plan's verbatim title plus a body that names
// the specific values and suggests one fix. The switch is exhaustive
// via a `never` check: a new NeoError variant without a case here is a
// compile error, not a runtime fallback.

import type { NeoError } from "../engine/generated/NeoError";

export interface ErrorMessage {
  title: string;
  body: string;
}

/** `"a", "b"` or `none` when the list is empty. */
function nameList(labels: string[]): string {
  if (labels.length === 0) return "none";
  return labels.map((l) => `"${l}"`).join(", ");
}

export function errorMessage(e: NeoError): ErrorMessage {
  switch (e.kind) {
    case "Parse":
      return {
        title: `Couldn't read line ${e.line}`,
        body: `${e.msg} (line ${e.line}, column ${e.col}). Check that FASTA records start with ">" and that a Newick tree ends with ";".`,
      };
    case "UnequalLengths":
      return {
        title: "Sequences aren't aligned",
        body: `"${e.label}" has ${e.got} site${e.got === 1 ? "" : "s"} but the first sequence has ${e.expected}. Sequences must be aligned (same length, with gaps) before building a tree. Align them first, e.g. with Clustal Omega or MAFFT.`,
      };
    case "UnsupportedCharacter":
      return {
        title: "Unexpected character",
        body: `Sequence "${e.label}" contains "${e.ch}" at position ${e.position}. Only DNA letters, IUPAC ambiguity codes, "-" and "?" are allowed — remove or replace it.`,
      };
    case "InsufficientOverlap":
      return {
        title: "Two sequences share no comparable sites",
        body: `"${e.a}" and "${e.b}" have no site where both are A, C, G or T. Use sequences with less missing data.`,
      };
    case "TooManyTaxa":
      return {
        title: "Too many sequences",
        body: `This input has ${e.got} sequences; the limit is ${e.max}. Remove some and import again.`,
      };
    case "TooFewTaxa":
      return {
        title: `Need at least ${e.min} sequences`,
        body: `This input has ${e.got}; add at least ${e.min - e.got} more to build a tree.`,
      };
    case "SaturatedMatrix":
      return {
        title: "Some distances can't be estimated",
        body: `${e.cells.length} sequence pair${e.cells.length === 1 ? "" : "s"} differ too much for the chosen correction. Use longer sequences, shorter branches, or switch to p-distance.`,
      };
    case "LabelMismatch":
      return {
        title: "Tree and sequences have different names",
        body: `Names only in the tree: ${nameList(e.only_in_a)}; names only in the sequences: ${nameList(e.only_in_b)}. Rename the tips so both use the same labels.`,
      };
    case "InvalidExercise":
      return {
        title: "This exercise file has a problem",
        body: `Field "${e.field}": ${e.msg}. Fix the file and load it again.`,
      };
    case "BootstrapFailed":
      // v1.2 spec §6.2: every replicate was skipped (saturated or no
      // comparable sites), so there is no tally to report.
      return {
        title: "Every bootstrap replicate failed",
        body: `All ${e.total} resampled datasets had distances too divergent to correct. Use longer sequences or switch to p-distance.`,
      };
    case "InvalidEdit":
      // v1.4 spec §5.1: the engine's msg already names the taxon or
      // node and the reason.
      return {
        title: "That edit isn't allowed",
        body: e.msg,
      };
    case "NoSitesKept":
      // v1.4b spec §3.1: `filter` is "complete" or "partial {cutoff}%".
      return {
        title: "The gap filter removed every site",
        body: `${e.filter} deletion dropped all columns — every site has too much missing data for that treatment. Choose pairwise deletion or a lower partial cutoff, or use sequences with less missing data.`,
      };
    case "ModelAlphabetMismatch": {
      // The named model belongs to the other alphabet (v1.1 spec §3.4).
      const modelAlphabet = e.alphabet === "protein" ? "DNA" : "protein";
      const dataAlphabet = e.alphabet === "protein" ? "protein" : "DNA";
      const choices =
        e.alphabet === "protein" ? "p, Kimura or JTT" : "p, JC69 or K80";
      return {
        title: `${e.model} doesn't fit this data`,
        body: `${e.model} is for ${modelAlphabet}; this data is ${dataAlphabet}. Choose ${choices}.`,
      };
    }
    default: {
      const _exhaustive: never = e;
      return _exhaustive;
    }
  }
}
