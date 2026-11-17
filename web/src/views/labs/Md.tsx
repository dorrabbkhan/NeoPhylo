// The tiny markdown subset shared by the lab pages and the instructor
// guide (v1.4c plan Task 13, spec §7.5 — guide markdown renders "like
// handouts, never raw HTML"). Moved verbatim out of LabPage.tsx; the
// one renderer addition is `[text](href)`, which becomes an <a> only
// for the internal `?route` hrefs links.ts whitelists — every other
// target renders as literal text. Raw HTML is never injected either
// way, so pack and guide markdown cannot carry markup into the page.
//
// `linkExtra` lets a page append nodes inside a link that points at a
// registry item (the guide's per-item minutes). It defaults to
// nothing, so lab output is byte-identical to before the move.

import type { ReactNode } from "react";

import { isInternalHref, mdBlocks } from "../../links";

/** Inline markdown: **bold**, `code` spans and internal
 * `[text](href)` links. A link whose href is not an internal route
 * renders as its literal source text. */
function inline(
  text: string,
  linkExtra?: (href: string) => ReactNode,
): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g;
  let last = 0;
  let key = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith("**")) {
      out.push(<strong key={key++}>{t.slice(2, -2)}</strong>);
    } else if (t.startsWith("`")) {
      out.push(<code key={key++}>{t.slice(1, -1)}</code>);
    } else {
      const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(t);
      const href = link?.[2] ?? "";
      out.push(
        isInternalHref(href) ? (
          <a key={key++} href={href}>
            {inline(link?.[1] ?? "")}
            {linkExtra?.(href)}
          </a>
        ) : (
          t
        ),
      );
    }
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export interface MdBlockProps {
  block: string;
  /** Extra nodes appended inside an internal-route link (the guide
   * shows an item's registry minutes inside its plan link). */
  linkExtra?: (href: string) => ReactNode;
  /** aria-labelledby for an ordered list (the guide's plan lists are
   * named by their section heading). */
  olLabelledBy?: string;
}

export function MdBlock({ block, linkExtra, olLabelledBy }: MdBlockProps) {
  const heading = /^#{1,6}\s/.exec(block);
  if (heading !== null) {
    const text = block.replace(/^#+\s*/, "");
    const level = heading[0].trim().length;
    return level <= 2 ? (
      <h3>{inline(text, linkExtra)}</h3>
    ) : (
      <h4>{inline(text, linkExtra)}</h4>
    );
  }
  const lines = block.split("\n").map((l) => l.trim());
  if (lines.every((l) => /^[-*]\s+/.test(l))) {
    return (
      <ul>
        {lines.map((l, i) => (
          <li key={i}>{inline(l.replace(/^[-*]\s+/, ""), linkExtra)}</li>
        ))}
      </ul>
    );
  }
  if (lines.every((l) => /^\d+\.\s+/.test(l))) {
    return (
      <ol aria-labelledby={olLabelledBy}>
        {lines.map((l, i) => (
          <li key={i}>{inline(l.replace(/^\d+\.\s+/, ""), linkExtra)}</li>
        ))}
      </ol>
    );
  }
  return (
    <p>
      {lines.map((l, i) => (
        <span key={i}>
          {i > 0 && <br />}
          {inline(l, linkExtra)}
        </span>
      ))}
    </p>
  );
}

/** The markdown subset the lab fields use: blank-line-separated
 * blocks of headings, unordered/ordered lists and paragraphs. */
export function Md({ source }: { source: string }) {
  return (
    <div className="lab-md">
      {mdBlocks(source).map((b, i) => (
        <MdBlock key={i} block={b} />
      ))}
    </div>
  );
}
