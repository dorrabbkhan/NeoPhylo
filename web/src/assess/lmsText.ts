// LMS copy text (v1.5 plan Task 8, spec §7.5): the assignment
// builder and the library cards produce paste-ready text for the
// four LMS shapes the spec names — Canvas, Moodle, a generic form
// (Google/Microsoft Forms) and a plain-text fallback. Each variant
// names the link, the ID the student types and where the
// completion code is pasted. The wording is owner review text —
// quoted verbatim in the PR.

/** What the pasted text announces. */
export interface LmsSource {
  /** Assignment or lesson title. */
  title: string;
  /** The absolute URL the student opens. */
  link: string;
  /** The assignment's `id_prompt.label`, or null for a plain
   *  lesson that asks for no id. */
  idLabel: string | null;
  /** True when finishing produces a completion code to paste. */
  code: boolean;
}

export type LmsKind = "canvas" | "moodle" | "forms" | "plain";

export const LMS_KINDS: readonly LmsKind[] = [
  "canvas",
  "moodle",
  "forms",
  "plain",
];

export const LMS_LABEL: Record<LmsKind, string> = {
  canvas: "Canvas",
  moodle: "Moodle",
  forms: "Forms",
  plain: "Plain text",
};

const PASTE_SPOT: Record<LmsKind, string> = {
  canvas: "this Canvas assignment's text-entry box",
  moodle: "the Moodle answer box for this assignment",
  forms: "the form's answer field",
  plain: "where your instructor collects answers",
};

/** The copy text in both shapes: `plain` for clipboard paste,
 * `html` for rich editors. */
export function lmsText(
  a: LmsSource,
  lms: LmsKind,
): { plain: string; html: string } {
  const idLine =
    a.idLabel === null
      ? ""
      : ` When the page asks for an ID, type your ${a.idLabel}.`;
  const codeLine = a.code
    ? ` When you finish, copy the completion code NeoPhylo shows and paste it into ${PASTE_SPOT[lms]}.`
    : "";
  const plain = `${a.title} — open ${a.link} and work through it in NeoPhylo.${idLine}${codeLine}`;
  const html =
    `<p>${escapeHtml(a.title)} — open ` +
    `<a href="${escapeHtml(a.link)}">${escapeHtml(a.link)}</a> ` +
    `and work through it in NeoPhylo.` +
    (a.idLabel === null
      ? ""
      : ` When the page asks for an ID, type your ${escapeHtml(a.idLabel)}.`) +
    (a.code
      ? ` When you finish, copy the completion code NeoPhylo shows and paste it into ${escapeHtml(PASTE_SPOT[lms])}.`
      : "") +
    `</p>`;
  return { plain, html };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
