// NeoPhylo's internal `?route` link forms (v1.4c plan Task 13, spec
// §7.5). The shared markdown renderer (views/labs/Md.tsx) turns a
// `[text](href)` token into an <a> only when parseInternalHref accepts
// the href — every other target (http:, javascript:, data:, //, a bare
// path, unknown params) stays literal text, so repository markdown can
// never inject a URL the app does not own. The guide's tests
// additionally require every linked id to exist in the registries.
//
// The allowed forms are exactly the routes Root.tsx switches on plus
// the library filter params items.ts's filtersQuery writes.

export type InternalRoute =
  | "lesson"
  | "lab"
  | "worksheet"
  | "key"
  | "read"
  | "library"
  | "labs"
  | "editor";

export interface InternalTarget {
  route: InternalRoute;
  /** The linked item's registry id (lesson/lab/read/worksheet/key
   * links). */
  id?: string;
  /** worksheet/key sheet kind; absent defaults to "app" on the route. */
  kind?: "app" | "paper";
}

/** Registry ids are exercise-file stems. `custom` worksheet ids are
 * never linkable — their exercise rides the `#x=` fragment, which this
 * parser rejects. */
const ID_RE = /^[A-Za-z0-9_-]+$/;
const SHEET_KINDS = new Set(["app", "paper"]);
// The library's filtersQuery writes type= as a comma list of TypeKey,
// level= as a Level, and short=1.
const LIBRARY_TYPES = new Set([
  "lessons",
  "reading",
  "phylip",
  "mega",
  "datasets",
]);
const LIBRARY_LEVELS = new Set(["intro", "intermediate", "advanced"]);

/** Parse an href as one of NeoPhylo's own route links; null for
 * anything the app does not own. A single `?` prefix is required — no
 * scheme, no `//`, no second `?`, no fragment, no whitespace — and
 * every parameter must belong to the matched route. */
export function parseInternalHref(href: string): InternalTarget | null {
  if (!href.startsWith("?")) return null;
  const q = href.slice(1);
  if (q === "" || /[?#\s"'<>\\]/.test(q)) return null;
  const params = new URLSearchParams(q);
  const keys = [...params.keys()];

  const idRoutes = ["lesson", "lab", "worksheet", "key", "read"] as const;
  const present = idRoutes.filter((r) => params.has(r));
  if (present.length > 1) return null;
  if (present.length === 1) {
    const route = present[0];
    const id = params.get(route);
    if (id === null || id === "" || !ID_RE.test(id)) return null;
    if (route === "worksheet" || route === "key") {
      const kind = params.get("kind");
      if (kind !== null && !SHEET_KINDS.has(kind)) return null;
      if (!keys.every((k) => k === route || k === "kind")) return null;
      return kind === null
        ? { route, id }
        : { route, id, kind: kind as "app" | "paper" };
    }
    if (keys.length !== 1) return null;
    return { route, id };
  }

  const bareFlag = (name: InternalRoute): InternalTarget | null =>
    params.has(name) && params.get(name) === "" && keys.length === 1
      ? { route: name }
      : null;

  if (params.has("library")) {
    if (params.get("library") !== "") return null;
    const raw = params.get("type");
    if (raw !== null) {
      const types = raw === "" ? [] : raw.split(",");
      if (!types.every((t) => LIBRARY_TYPES.has(t))) return null;
    }
    const level = params.get("level");
    if (level !== null && !LIBRARY_LEVELS.has(level)) return null;
    const short = params.get("short");
    if (short !== null && short !== "1") return null;
    if (
      !keys.every(
        (k) => k === "library" || k === "type" || k === "level" || k === "short",
      )
    ) {
      return null;
    }
    return { route: "library" };
  }
  if (params.has("labs")) return bareFlag("labs");
  if (params.has("editor")) return bareFlag("editor");
  return null;
}

/** True when the href is one the renderer may turn into an <a>. */
export function isInternalHref(href: string): boolean {
  return parseInternalHref(href) !== null;
}

/** The markdown blocks of a source: blank-line-separated chunks of
 * headings, lists and paragraphs — the same split the shared renderer
 * uses. */
export function mdBlocks(source: string): string[] {
  return source
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter((b) => b !== "");
}

/** Every `[text](href)` token in a markdown source, in document order. */
export function markdownLinks(
  source: string,
): { text: string; href: string }[] {
  const out: { text: string; href: string }[] = [];
  for (const m of source.matchAll(/\[([^\]]+)\]\(([^)\s]+)\)/g)) {
    out.push({ text: m[1], href: m[2] });
  }
  return out;
}

/** The hrefs of a plan block's ordered-list items — every line must be
 * `N. [text](href)` and nothing else; null otherwise. */
export function planItemHrefs(block: string): string[] | null {
  const lines = block.split("\n").map((l) => l.trim());
  if (lines.length === 0 || !lines.every((l) => /^\d+\.\s+/.test(l))) {
    return null;
  }
  const hrefs: string[] = [];
  for (const l of lines) {
    const m = /^\d+\.\s+\[[^\]]+\]\(([^)\s]+)\)\s*$/.exec(l);
    if (m === null) return null;
    hrefs.push(m[1]);
  }
  return hrefs;
}
