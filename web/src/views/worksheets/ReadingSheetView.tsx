// The reading paper worksheet (`?worksheet=<id>&kind=paper`, v1.4d
// plan Task 13, spec §8.4): every item's question and its shown trees
// drawn by the real ReadingTree in the item's authored style, then
// the answer space the control type needs — options to circle or
// tick, order slots, a number or a ruled line. Nothing here is an
// answer: the model carries only what the student needs to write
// one, and the set opens at its `?read=`/`#r=` link + QR.

import { useMemo } from "react";

import { engine } from "../../engine/index";
import type { ReadingSet } from "../../engine/generated/ReadingSet";
import type { ReadingTreeView } from "../../engine/generated/ReadingTreeView";
import type {
  ReadingSheet,
  SheetSpace,
} from "../../worksheets/reading";
import { ReadingTree } from "../reading/ReadingTree";

import { Blank, LinkBlock } from "./blocks";

export interface ReadingSheetViewProps {
  set: ReadingSet;
  sheet: ReadingSheet;
}

/** The paper worksheet: masthead, one block per item, the link/QR. */
export function ReadingSheetView({ set, sheet }: ReadingSheetViewProps) {
  // Resolve every tree the sheet draws, once per name — the views are
  // immutable; style is a draw-time choice like the app's own items.
  const views = useMemo(() => {
    const out = new Map<string, ReadingTreeView>();
    for (const item of sheet.items) {
      for (const t of item.trees) {
        if (out.has(t.name)) continue;
        const r = engine.readingTree(set, t.name);
        if (r.ok) out.set(t.name, r.value);
      }
    }
    return out;
  }, [set, sheet]);

  return (
    <>
      <header className="lab-mast">
        <p className="lab-print-head">NeoPhylo — worksheet</p>
        <h1>{sheet.title}</h1>
        <p className="ws-meta">
          Tree reading
          {sheet.minutes !== null && ` · about ${sheet.minutes} minutes`}
        </p>
      </header>
      <ol className="ws-items">
        {sheet.items.map((item) => (
          <li key={item.id} className="ws-item ws-read-item">
            <p className="ws-question">{item.text}</p>
            <div className="read-trees ws-read-trees">
              {item.trees.map((t) => {
                const v = views.get(t.name);
                if (v === undefined) {
                  return (
                    <p key={t.name} className="error">
                      Tree “{t.name}” could not be drawn.
                    </p>
                  );
                }
                return (
                  <ReadingTree
                    key={`${t.name}-${t.label}`}
                    view={v}
                    style={t.style}
                    selectable="none"
                    selected={[]}
                    onSelect={() => {}}
                    highlight={item.tips}
                    rotatable={false}
                    onRotate={() => {}}
                    label={t.label}
                  />
                );
              })}
            </div>
            <SpaceView space={item.space} />
          </li>
        ))}
      </ol>
      <section aria-labelledby="ws-read-link-h">
        <h2 id="ws-read-link-h">Open this set in NeoPhylo</h2>
        <p>Check your answers in the app — scan the code or follow the link:</p>
        <LinkBlock link={sheet.link} />
      </section>
      <footer className="lab-print-foot">
        Printed from NeoPhylo — worksheet for {sheet.title}.
      </footer>
    </>
  );
}

/** The printable answer space — the paper form of the app's control.
 * Options render as a bubble list (circle one / tick all that apply);
 * an order question writes each lettered node into a slot; number and
 * write-in answers get a ruled blank. */
function SpaceView({ space }: { space: SheetSpace }) {
  switch (space.kind) {
    case "options":
      return (
        <div className="ws-space">
          <p className="ws-space-hint">
            {space.multi
              ? "Tick every option that applies."
              : "Circle one."}
          </p>
          <OptionList options={space.options} />
        </div>
      );
    case "number":
      return (
        <p className="ws-fill-line">
          <Blank label="Answer:" />
        </p>
      );
    case "order":
      return (
        <div className="ws-space">
          <p className="ws-space-hint">
            Write the letters in order, oldest first:
          </p>
          <p className="ws-order-letters">
            {space.letters.join("\u2003")}
          </p>
          <ol className="ws-order-slots">
            {space.letters.map((l) => (
              <li key={l}>
                <span className="ws-blank ws-blank-mini" aria-hidden="true" />
              </li>
            ))}
          </ol>
        </div>
      );
    case "line":
      return (
        <p className="ws-fill-line">
          <Blank label={`Answer (${space.hint}):`} wide />
        </p>
      );
    case "two_tier":
      return (
        <div className="ws-space">
          <SpaceView space={space.first} />
          <p className="ws-space-hint">Why? Circle one.</p>
          <OptionList options={space.reasons} />
        </div>
      );
  }
}

function OptionList({ options }: { options: string[] }) {
  return (
    <ul className="ws-options">
      {options.map((o, i) => (
        <li key={i}>
          <span className="ws-bubble" aria-hidden="true" />
          {o}
        </li>
      ))}
    </ul>
  );
}
