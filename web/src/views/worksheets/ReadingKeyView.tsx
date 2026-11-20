// The reading answer key (`?key=<id>&kind=paper`, v1.4d plan Task
// 13, spec §8.4): behind InstructorGate, one block per item — the
// question, the accepted answer as engine text, the engine's
// explanation and the authored-answer label where the key is authored
// (spec: concept answers and two-tier reasons are authored, labelled
// wherever shown). The post-answer note prints here, never on the
// student sheet.

import type { ReadingKey } from "../../worksheets/reading";
import { worksheetHref } from "./load";

export interface ReadingKeyViewProps {
  keyModel: ReadingKey;
  /** The set id — links back to the student sheet. */
  id: string;
}

export function ReadingKeyView({ keyModel, id }: ReadingKeyViewProps) {
  return (
    <>
      <header className="lab-mast">
        <p className="lab-print-head">NeoPhylo — answer key</p>
        <h1>{keyModel.title} — answer key</h1>
        <p className="ws-meta">
          Answers for the paper worksheet (
          <a href={worksheetHref(id, "paper")}>student sheet</a>).
        </p>
      </header>
      <ol className="ws-items ws-key-items">
        {keyModel.items.map((item) => (
          <li key={item.id} className="ws-item">
            <p className="ws-question">{item.text}</p>
            <p className="ws-answer">
              {item.answer}
              {item.label !== null && (
                <span className="ws-authored"> ({item.label})</span>
              )}
            </p>
            <p className="ws-explain">{item.explanation}</p>
            {item.noteAfter !== null && (
              <p className="ws-note">{item.noteAfter}</p>
            )}
          </li>
        ))}
      </ol>
      <footer className="lab-print-foot">
        Printed from NeoPhylo — answer key for {keyModel.title}.
      </footer>
    </>
  );
}
