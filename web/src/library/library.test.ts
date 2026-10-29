// Data library tests (v1.4b plan Task 8, spec §5.2). The bundled datasets
// under public/library/ are built offline by scripts/data/build_library.py
// from the committed lists in scripts/data/accessions/ — CI never fetches.
// Every index entry must have its FASTA on disk, the FASTA's sha256 must
// match the provenance JSON, the engine must parse it as the declared
// alphabet within the 30 taxa / 2,000 site caps, the provenance must
// validate against provenance.schema.json, and index.json must list the
// same dataset ids as the files on disk. Labels match ^[^\s"]+$ and are
// unique per dataset (the .meg writer turns whitespace into `_` and
// parse_meg keeps names literally — anything else would not round-trip).

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import { engine } from "../engine";

const LIBRARY = resolve("public", "library");
const ACCESSIONS = resolve("..", "scripts", "data", "accessions");
const LABEL_RE = /^[^\s"]+$/;

interface IndexEntry {
  id: string;
  title: string;
  alphabet: "dna" | "protein";
  taxa: number;
  sites: number;
  good_for: string;
  license: string;
  provenance: string;
}

const index = JSON.parse(
  readFileSync(resolve(LIBRARY, "index.json"), "utf8"),
) as IndexEntry[];
const schema = JSON.parse(
  readFileSync(resolve(LIBRARY, "provenance.schema.json"), "utf8"),
) as Record<string, unknown>;
const validate = new Ajv2020({ allErrors: true }).compile(schema);

const accessionFiles = () =>
  readdirSync(ACCESSIONS)
    .filter((f) => f.endsWith(".txt"))
    .sort();

const accessionLabels = (file: string) =>
  readFileSync(resolve(ACCESSIONS, file), "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => l.split(/\s+/)[1]);

const fastaLabels = (text: string) =>
  text
    .split("\n")
    .filter((l) => l.startsWith(">"))
    .map((l) => l.slice(1));

describe("data library (spec §5.2)", () => {
  it("index.json and the .fasta files on disk list the same ids", () => {
    const indexIds = index.map((e) => e.id).sort();
    const diskIds = readdirSync(LIBRARY)
      .filter((f) => f.endsWith(".fasta"))
      .map((f) => f.replace(/\.fasta$/, ""))
      .sort();
    expect(diskIds).toEqual(indexIds);
  });

  it("index.json and scripts/data/accessions/*.txt list the same ids", () => {
    const indexIds = index.map((e) => e.id).sort();
    const listIds = accessionFiles()
      .map((f) => f.replace(/\.txt$/, ""))
      .sort();
    expect(listIds).toEqual(indexIds);
  });

  it("labels in the accession lists match ^[^\\s\"]+$ and are unique per dataset", () => {
    for (const f of accessionFiles()) {
      const labels = accessionLabels(f);
      expect(labels.length, `${f} has no accessions`).toBeGreaterThan(0);
      for (const label of labels) {
        expect(label, `${f}: bad label ${label}`).toMatch(LABEL_RE);
      }
      expect(new Set(labels).size, `${f} has duplicate labels`).toBe(
        labels.length,
      );
    }
  });

  it("every index entry passes sha256, provenance, alphabet and the caps", () => {
    for (const e of index) {
      const fastaPath = resolve(LIBRARY, `${e.id}.fasta`);
      const provPath = resolve(LIBRARY, e.provenance);
      expect(existsSync(fastaPath), `${e.id}: FASTA missing`).toBe(true);
      expect(existsSync(provPath), `${e.id}: provenance missing`).toBe(true);

      const prov = JSON.parse(readFileSync(provPath, "utf8"));
      expect(
        validate(prov),
        `${e.id}: provenance fails schema: ${JSON.stringify(validate.errors)}`,
      ).toBe(true);
      expect(prov.id).toBe(e.id);
      expect(prov.accessions).toHaveLength(e.taxa);

      const fasta = readFileSync(fastaPath);
      const sha = createHash("sha256").update(fasta).digest("hex");
      expect(sha, `${e.id}: sha256 mismatch with provenance`).toBe(prov.sha256);

      const labels = fastaLabels(fasta.toString("utf8"));
      for (const label of labels) {
        expect(label, `${e.id}: bad label ${label}`).toMatch(LABEL_RE);
      }
      expect(new Set(labels).size, `${e.id} has duplicate labels`).toBe(
        labels.length,
      );

      const aln = engine.parseFasta(fasta.toString("utf8"));
      if (!aln.ok) throw new Error(`${e.id}: engine refused the FASTA`);
      expect(aln.value.alphabet, `${e.id}: wrong alphabet`).toBe(e.alphabet);
      expect(aln.value.labels.length, `${e.id}: taxa cap`).toBeLessThanOrEqual(30);
      expect(aln.value.labels.length).toBe(e.taxa);
      for (const s of aln.value.seqs) {
        expect(s.length, `${e.id}: sites cap`).toBeLessThanOrEqual(2000);
      }
      expect(aln.value.seqs[0].length).toBe(e.sites);
    }
  });
});
