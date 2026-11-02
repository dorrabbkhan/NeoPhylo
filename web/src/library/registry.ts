// Dataset library registry (v1.4b plan Task 8/11, spec §5): the
// "Open dataset" sheet's data source. The library is static files
// under public/library/ — index.json lists the datasets, <id>.fasta
// is the alignment, <id>.json the provenance. The browser never
// fetches sequence data from anywhere else; loading goes through the
// same engine.parseFasta path as an opened file.

import { engine, type Result } from "../engine/index";
import type { Alignment } from "../engine/generated/Alignment";
import type { NeoError } from "../engine/generated/NeoError";

/** One entry of library/index.json (spec §5.2 shape). */
export interface DatasetSummary {
  id: string;
  title: string;
  alphabet: "dna" | "protein";
  taxa: number;
  sites: number;
  good_for: string;
  license: string;
  provenance: string;
}

/** The fields of <id>.json the sheet displays. */
export interface DatasetProvenance {
  source: string;
  license: string;
  citation?: string;
}

const BASE = `${import.meta.env.BASE_URL}library/`;

function isSummary(x: unknown): x is DatasetSummary {
  if (typeof x !== "object" || x === null) return false;
  const d = x as Record<string, unknown>;
  return (
    typeof d.id === "string" &&
    typeof d.title === "string" &&
    (d.alphabet === "dna" || d.alphabet === "protein") &&
    typeof d.taxa === "number" &&
    typeof d.sites === "number" &&
    typeof d.good_for === "string" &&
    typeof d.license === "string" &&
    typeof d.provenance === "string"
  );
}

/** Read library/index.json. Throws when it can't be fetched or is
 * malformed — callers show it as a restore/load error. */
export async function listDatasets(): Promise<DatasetSummary[]> {
  let res: Response;
  try {
    res = await fetch(`${BASE}index.json`);
  } catch (e) {
    throw new Error(
      `the library index could not be loaded (${e instanceof Error ? e.message : String(e)})`,
      { cause: e },
    );
  }
  if (!res.ok) {
    throw new Error(`the library index could not be loaded (HTTP ${res.status})`);
  }
  const raw: unknown = await res.json();
  if (!Array.isArray(raw) || !raw.every(isSummary)) {
    throw new Error("the library index is malformed");
  }
  return raw;
}

function datasetError(msg: string): Result<Alignment> {
  return {
    ok: false,
    error: { kind: "InvalidExercise", field: "dataset", msg } as NeoError,
  };
}

/**
 * Fetch and parse a library dataset — the same engine.parseFasta path
 * an opened file takes. An unknown id, a fetch failure and a parse
 * failure all come back as error values; nothing here throws on a bad
 * response.
 */
export async function loadDataset(id: string): Promise<Result<Alignment>> {
  let list: DatasetSummary[];
  try {
    list = await listDatasets();
  } catch (e) {
    return datasetError(e instanceof Error ? e.message : String(e));
  }
  return loadDatasetFrom(list, id);
}

/** The fetch+parse half of `loadDataset` given an already-read index —
 * the `ds=` restore path reads index.json once for both the existence
 * check and the row's title (v1.4b Task 11). */
export async function loadDatasetFrom(
  list: DatasetSummary[],
  id: string,
): Promise<Result<Alignment>> {
  if (!list.some((d) => d.id === id)) {
    return datasetError(`unknown library dataset '${id}'`);
  }
  let res: Response;
  try {
    res = await fetch(`${BASE}${encodeURIComponent(id)}.fasta`);
  } catch (e) {
    return datasetError(
      `could not fetch dataset "${id}" (${e instanceof Error ? e.message : String(e)})`,
    );
  }
  if (!res.ok) {
    return datasetError(`dataset "${id}" not found (HTTP ${res.status})`);
  }
  return engine.parseFasta(await res.text());
}

/** The dataset's provenance JSON — the sheet's source/citation column.
 * `null` when the file can't be read; the index row already carries
 * the license, so a missing provenance degrades the row gracefully. */
export async function loadProvenance(
  d: DatasetSummary,
): Promise<DatasetProvenance | null> {
  try {
    const res = await fetch(`${BASE}${d.provenance}`);
    if (!res.ok) return null;
    const raw = (await res.json()) as Record<string, unknown>;
    return {
      source: typeof raw.source === "string" ? raw.source : "—",
      license:
        typeof raw.license === "string" ? raw.license : d.license,
      citation:
        typeof raw.citation === "string" ? raw.citation : undefined,
    };
  } catch {
    return null;
  }
}
