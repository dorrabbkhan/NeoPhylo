// The per-tree extras form of the reading-set editor (v1.4d plan Task
// 10, spec §7.5): the stored tree drawn by ReadingTree — letters,
// ages, marks and points visible where they will land — with taps on
// the preview (or on the draw canvas, resolved by the parent through
// readingCladeOf) choosing the clade the active annotate tool edits.
// Below it: the times axis and trait display names, and a removable
// list of everything already on the tree.

import { useState } from "react";

import type { ReadingTreeView } from "../../../engine/generated/ReadingTreeView";
import { cladeKey } from "../../../layout/readingGeom";

import { ReadingTree } from "../../reading/ReadingTree";

import type { TreeDraft } from "./readingDraft";
import {
  applyExtra,
  EXTRA_TOOLS,
  type ExtraTool,
} from "./readingExtras";
import { TraitDefsForm } from "./TraitDefsForm";

export interface TreeExtrasFormProps {
  tree: TreeDraft;
  /** The stored tree resolved for layout; null while its probe fails. */
  view: ReadingTreeView | null;
  /** The engine's message when the probe set refuses the tree. */
  viewError: string | null;
  /** The clade the last tap (preview or canvas) armed; null = none. */
  pendingClade: string[] | null;
  /** Tells the parent this form owns canvas taps. */
  onArm: () => void;
  /** A preview tap — the parent stores the armed clade. */
  onClade: (clade: string[]) => void;
  onChange: (t: TreeDraft) => void;
}

export function TreeExtrasForm({
  tree,
  view,
  viewError,
  pendingClade,
  onArm,
  onClade,
  onChange,
}: TreeExtrasFormProps) {
  const [tool, setTool] = useState<ExtraTool>("letter");
  const [letter, setLetter] = useState("");
  const [ageText, setAgeText] = useState("");
  const [trait, setTrait] = useState("");
  const [change, setChange] = useState<"gain" | "loss">("gain");

  const ages = typeof tree.times === "object" ? tree.times.ages : [];
  const rootKey =
    view === null ? null : cladeKey(view.nodes[view.root].clade);
  const cladeText =
    pendingClade === null
      ? "nothing tapped yet"
      : cladeKey(pendingClade) === rootKey
        ? "the root"
        : pendingClade.join(", ");
  const ageNum = Number(ageText);

  const canApply =
    pendingClade !== null &&
    (tool === "letter" || tool === "point-node" || tool === "point-branch"
      ? letter.trim() !== ""
      : tool === "age"
        ? typeof tree.times === "object" &&
          ageText.trim() !== "" &&
          Number.isFinite(ageNum)
        : trait.trim() !== "");

  const addLabel = {
    letter: "Set letter",
    age: "Set age",
    mark: "Add mark",
    "point-node": "Add point",
    "point-branch": "Add point",
  }[tool];

  const apply = () => {
    if (pendingClade === null || !canApply) return;
    onChange(
      applyExtra(tree, tool, pendingClade, {
        letter: letter.trim(),
        age: ageNum,
        trait: trait.trim(),
        change,
      }),
    );
  };

  return (
    <div className="rde-extras">
      {viewError !== null && (
        <p role="alert" className="editor-error">
          {viewError}
        </p>
      )}
      {view !== null && (
        <ReadingTree
          view={view}
          style={{ shape: "rectangular", tips: "right" }}
          selectable={
            tool === "mark" || tool === "point-branch" ? "branch" : "node"
          }
          selected={pendingClade === null ? [] : [pendingClade]}
          onSelect={onClade}
          highlight={[]}
          rotatable={false}
          onRotate={() => {}}
          label={`Extras for ${tree.name}`}
        />
      )}
      <fieldset className="rde-checks">
        <legend>Annotate by tapping</legend>
        <div className="rde-item-row">
          <label className="field">
            <span>Tool</span>
            <select
              value={tool}
              onChange={(e) => {
                setTool(e.target.value as ExtraTool);
                onArm();
              }}
            >
              {EXTRA_TOOLS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          {(tool === "letter" ||
            tool === "point-node" ||
            tool === "point-branch") && (
            <label className="field">
              <span>Letter</span>
              <input
                type="text"
                value={letter}
                maxLength={2}
                onChange={(e) => setLetter(e.target.value)}
              />
            </label>
          )}
          {tool === "age" && (
            <label className="field">
              <span>Age</span>
              <input
                type="number"
                value={ageText}
                onChange={(e) => setAgeText(e.target.value)}
              />
            </label>
          )}
          {tool === "mark" && (
            <>
              <label className="field">
                <span>Trait</span>
                <input
                  type="text"
                  value={trait}
                  onChange={(e) => setTrait(e.target.value)}
                />
              </label>
              <label className="field">
                <span>Change</span>
                <select
                  value={change}
                  onChange={(e) =>
                    setChange(e.target.value as "gain" | "loss")
                  }
                >
                  <option value="gain">gain</option>
                  <option value="loss">loss</option>
                </select>
              </label>
            </>
          )}
          <button
            type="button"
            disabled={!canApply}
            onClick={apply}
          >
            {addLabel}
          </button>
        </div>
        <p className="editor-hint">
          {tool === "age" && typeof tree.times !== "object"
            ? "Set the time axis to ages before adding node ages. "
            : ""}
          Armed on {cladeText} — tap the preview above or a node on the
          draw canvas.
        </p>
      </fieldset>
      <fieldset className="rde-checks">
        <legend>Time axis</legend>
        <div className="rde-item-row">
          <label className="field">
            <span>Times</span>
            <select
              value={
                tree.times === "none"
                  ? "none"
                  : tree.times === "schematic"
                    ? "schematic"
                    : "ages"
              }
              onChange={(e) => {
                const v = e.target.value;
                onChange({
                  ...tree,
                  times:
                    v === "ages"
                      ? {
                          unit:
                            typeof tree.times === "object"
                              ? tree.times.unit
                              : "",
                          source:
                            typeof tree.times === "object"
                              ? tree.times.source
                              : "",
                          ages:
                            typeof tree.times === "object"
                              ? tree.times.ages
                              : [],
                        }
                      : (v as "none" | "schematic"),
                });
              }}
            >
              <option value="none">No time axis</option>
              <option value="schematic">Schematic (direction only)</option>
              <option value="ages">Ages</option>
            </select>
          </label>
          {typeof tree.times === "object" && (
            <>
              <label className="field">
                <span>Time unit</span>
                <input
                  type="text"
                  value={tree.times.unit}
                  placeholder="Ma"
                  onChange={(e) =>
                    typeof tree.times === "object" &&
                    onChange({
                      ...tree,
                      times: { ...tree.times, unit: e.target.value },
                    })
                  }
                />
              </label>
              <label className="field">
                <span>Time source (optional)</span>
                <input
                  type="text"
                  value={tree.times.source}
                  onChange={(e) =>
                    typeof tree.times === "object" &&
                    onChange({
                      ...tree,
                      times: { ...tree.times, source: e.target.value },
                    })
                  }
                />
              </label>
            </>
          )}
        </div>
      </fieldset>
      <TraitDefsForm
        traits={tree.traits}
        onChange={(traits) => onChange({ ...tree, traits })}
      />
      <ul className="rde-extra-list">
        {tree.node_letters.map((l, i) => (
          <li key={`l${i}`}>
            Node letter {l.letter} on {l.on.join(", ")}
            <button
              type="button"
              className="rde-chip-x"
              aria-label={`Remove letter ${l.letter}`}
              onClick={() =>
                onChange({
                  ...tree,
                  node_letters: tree.node_letters.filter(
                    (_, j) => j !== i,
                  ),
                })
              }
            >
              Remove
            </button>
          </li>
        ))}
        {ages.map((a, i) => (
          <li key={`a${i}`}>
            Age {a.age} on {a.on.join(", ")}
            <button
              type="button"
              className="rde-chip-x"
              aria-label={`Remove age ${a.age} on ${a.on.join(", ")}`}
              onClick={() =>
                typeof tree.times === "object" &&
                onChange({
                  ...tree,
                  times: {
                    ...tree.times,
                    ages: tree.times.ages.filter((_, j) => j !== i),
                  },
                })
              }
            >
              Remove
            </button>
          </li>
        ))}
        {tree.marks.map((m, i) => (
          <li key={`m${i}`}>
            {m.trait} {m.change} on the branch to {m.on.join(", ")}
            <button
              type="button"
              className="rde-chip-x"
              aria-label={`Remove ${m.trait} ${m.change} mark ${i + 1}`}
              onClick={() =>
                onChange({
                  ...tree,
                  marks: tree.marks.filter((_, j) => j !== i),
                })
              }
            >
              Remove
            </button>
          </li>
        ))}
        {tree.points.map((p, i) => (
          <li key={`p${i}`}>
            Point {p.letter} on the {p.at} at {p.on.join(", ")}
            <button
              type="button"
              className="rde-chip-x"
              aria-label={`Remove point ${p.letter}`}
              onClick={() =>
                onChange({
                  ...tree,
                  points: tree.points.filter((_, j) => j !== i),
                })
              }
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
