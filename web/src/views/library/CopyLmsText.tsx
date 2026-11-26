// "Copy assignment text" on a library card (v1.5 plan Task 8,
// spec §7.5): LMS-ready paste text for the card's own link — no
// assignment needed (the plan wires the plain lesson link). The
// four choices come from assess/lmsText.ts; a successful copy
// writes rich text where the Clipboard API offers it, plain text
// otherwise. A toggle-button disclosure, not a <details>: lab
// cards reserve that element for the settings fold.

import { useId, useState } from "react";

import {
  LMS_KINDS,
  LMS_LABEL,
  lmsText,
  type LmsKind,
} from "../../assess/lmsText";

export function CopyLmsText({
  title,
  href,
}: {
  title: string;
  /** The card's own open link (relative is fine — resolved here). */
  href: string;
}) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const panelId = useId();
  const link = new URL(href, window.location.href).href;

  const copy = async (kind: LmsKind) => {
    const t = lmsText({ title, link, idLabel: null, code: false }, kind);
    try {
      if (
        typeof ClipboardItem !== "undefined" &&
        navigator.clipboard.write !== undefined
      ) {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/plain": new Blob([t.plain], { type: "text/plain" }),
            "text/html": new Blob([t.html], { type: "text/html" }),
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(t.plain);
      }
      setStatus(`Copied the ${LMS_LABEL[kind]} text — paste it into your LMS.`);
    } catch {
      setStatus(
        "The browser refused the copy — the link above opens the lesson; copy it from the address bar.",
      );
    }
  };

  return (
    <div className="lib-copy">
      <button
        type="button"
        className="lib-copy-toggle btn btn-ghost"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        Copy assignment text
      </button>
      {open && (
        <div className="lib-copy-panel" id={panelId}>
          {LMS_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              className="lib-copy-choice btn btn-secondary"
              onClick={() => void copy(k)}
            >
              {LMS_LABEL[k]}
            </button>
          ))}
          {status !== null && (
            <p role="status" className="lib-copy-status">
              {status}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
