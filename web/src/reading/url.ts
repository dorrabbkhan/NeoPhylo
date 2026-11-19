// `#r=` shared reading-set links (v1.4d plan Task 8, spec §4.6). The
// whole set rides in the URL fragment, lz-compressed like the app's
// `#x=` links, so shared sets are never sent to a server. The
// envelope is `{ v: 1, set }`; the engine's `loadReadingSet` is the
// only validator — TypeScript never re-checks a set itself, so a bad
// link surfaces the engine's own InvalidReading message.

import {
  compressToEncodedURIComponent,
  decompressFromEncodedURIComponent,
} from "lz-string";

import { engine, type Result } from "../engine/index";
import type { NeoError } from "../engine/generated/NeoError";
import type { ReadingSet } from "../engine/generated/ReadingSet";

const LINK_VERSION = 1;

/** A pre-engine refusal, shaped like the engine's error so the page
 *  renders link failures and set-validation failures identically. */
function linkError(msg: string): Result<ReadingSet> {
  const error: NeoError = {
    kind: "InvalidReading",
    item: "",
    field: "link",
    msg,
  };
  return { ok: false, error };
}

/**
 * Serialize a set for a `#r=` link. The payload is the wire shape —
 * what `loadReadingSet` parses — so `set` here is the loaded
 * ReadingSet JSON-encoded verbatim.
 */
export function encodeReadingLink(set: ReadingSet): string {
  return (
    "#r=" +
    compressToEncodedURIComponent(
      JSON.stringify({ v: LINK_VERSION, set }),
    )
  );
}

/**
 * Decode a `#r=` fragment (or a whole href containing one) back to
 * the set it carries. Failures are NeoError values: a malformed
 * fragment reports what failed (decompression / JSON / version); a
 * well-formed fragment carrying a bad set reports the engine's
 * InvalidReading.
 */
export function decodeReadingLink(href: string): Result<ReadingSet> {
  const start = href.indexOf("#r=");
  if (start < 0) {
    return linkError("this link carries no reading set");
  }
  const json = decompressFromEncodedURIComponent(href.slice(start + 3));
  if (json === null || json === "") {
    return linkError("the shared set could not be decompressed");
  }
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return linkError("the shared set is not valid JSON");
  }
  if (
    typeof raw !== "object" ||
    raw === null ||
    (raw as { v?: unknown }).v !== LINK_VERSION ||
    typeof (raw as { set?: unknown }).set !== "object" ||
    (raw as { set?: unknown }).set === null
  ) {
    return linkError("the shared set has an unsupported link version");
  }
  const set = (raw as { set: unknown }).set;
  return engine.loadReadingSet(JSON.stringify(set));
}
