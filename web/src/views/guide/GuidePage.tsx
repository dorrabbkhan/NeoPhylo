// The instructor guide, `?guide` (v1.4c plan Task 13, spec §7.5): a
// printable page rendered from docs/instructor-guide.md through the
// same safe markdown subset the lab handouts use — `[text](href)`
// becomes a real <a> for the internal `?route` links links.ts
// whitelists, and no raw HTML is ever injected.
//
// The two plan lists carry no typed minutes: the page reads each
// linked item's minutes from the same registry resolution the library
// cards use (meta.minutes for lessons, lab.minutes ?? meta.minutes for
// labs — items.ts's buildItems), shows it inside the item's link and
// appends a computed "Total: N min" line after each plan's ordered
// list. A plan list is the block whose items are all single internal
// links (planItemHrefs) — the markdown itself stays numbers-free.
//
// Like the library it is a lazy route (Root.tsx): the markdown
// (?raw), the registries and their ajv import stay out of the initial
// bundle.

import { Fragment, useMemo } from "react";
import type { ReactNode } from "react";

import guideSource from "../../../../docs/instructor-guide.md?raw";

import { mdBlocks, parseInternalHref, planItemHrefs } from "../../links";
import { Wordmark } from "../Wordmark";
import { LabPrintStyles } from "../labs/LabPrintStyles";
import { MdBlock } from "../labs/Md";
import { buildItems } from "../library/items";

import "../labs/labs.css";
import "./guide.css";

interface GuideSection {
  id: string;
  heading: string;
  blocks: string[];
}

/** `# title` plus `##` sections; anything before the first `##` is
 * the intro. Section headings render as the page's h2s — the
 * handout-level h3/h4 mapping stays for lab markdown. */
function parseGuide(source: string): {
  title: string;
  intro: string[];
  sections: GuideSection[];
} {
  const blocks = mdBlocks(source);
  const title = (blocks[0] ?? "Instructor guide").replace(/^#\s*/, "");
  const intro: string[] = [];
  const sections: GuideSection[] = [];
  let current: GuideSection | null = null;
  for (const b of blocks.slice(1)) {
    const h = /^##\s+(.+)$/.exec(b);
    if (h !== null) {
      current = {
        id: `guide-h${sections.length}`,
        heading: h[1],
        blocks: [],
      };
      sections.push(current);
    } else if (current !== null) {
      current.blocks.push(b);
    } else {
      intro.push(b);
    }
  }
  return { title, intro, sections };
}

export function GuidePage() {
  const { title, intro, sections } = useMemo(
    () => parseGuide(guideSource),
    [],
  );
  // The same minutes the library cards show: meta.minutes for
  // lessons, lab.minutes ?? meta.minutes for labs.
  const minutes = useMemo(() => {
    const m = new Map<string, number>();
    for (const item of buildItems()) {
      if (item.minutes !== undefined) m.set(item.id, item.minutes);
    }
    return m;
  }, []);

  const minutesOf = (href: string): number | undefined => {
    const id = parseInternalHref(href)?.id;
    return id === undefined ? undefined : minutes.get(id);
  };

  /** The per-item minutes rendered inside a plan link. */
  const linkExtra = (href: string): ReactNode => {
    const m = minutesOf(href);
    return m === undefined ? null : (
      <span className="guide-min"> — {m} min</span>
    );
  };

  /** A block's items rendered, plus the plan total after an
   * all-link ordered list. */
  const guideBlock = (block: string, sectionId: string, key: number) => {
    const hrefs = planItemHrefs(block);
    const isPlan = hrefs !== null;
    const total = isPlan
      ? hrefs.reduce((sum, h) => sum + (minutesOf(h) ?? 0), 0)
      : 0;
    return (
      <Fragment key={key}>
        <MdBlock
          block={block}
          linkExtra={isPlan ? linkExtra : undefined}
          olLabelledBy={isPlan ? `${sectionId}-h` : undefined}
        />
        {isPlan && <p className="guide-total">Total: {total} min</p>}
      </Fragment>
    );
  };

  return (
    <main className="lab-page lab-print guide-page">
      <LabPrintStyles />
      <header className="lab-page-head lab-nav">
        <a
          className="editor-home"
          href={import.meta.env.BASE_URL}
          aria-label="Back to NeoPhylo"
        >
          <Wordmark size="sm" />
        </a>
        <a className="lab-nav-link" href="?library">
          Library
        </a>
        <a className="lab-nav-link" href="?labs">
          Labs
        </a>
      </header>
      <div className="lab-main guide-main">
        <p className="lab-print-head">NeoPhylo — instructor guide</p>
        <h1>{title}</h1>
        <div className="lab-controls">
          <button type="button" onClick={() => window.print()}>
            Print guide
          </button>
        </div>
        {intro.length > 0 && (
          <div className="lab-md guide-md">
            {intro.map((b, i) => guideBlock(b, "guide-intro", i))}
          </div>
        )}
        {sections.map((s) => (
          <section key={s.id} aria-labelledby={`${s.id}-h`}>
            <h2 id={`${s.id}-h`}>{s.heading}</h2>
            <div className="lab-md guide-md">
              {s.blocks.map((b, i) => guideBlock(b, s.id, i))}
            </div>
          </section>
        ))}
        <footer className="lab-print-foot">
          Printed from NeoPhylo — instructor guide.
        </footer>
      </div>
    </main>
  );
}
