// The trait display-names editor of a stored tree (v1.4d plan Task
// 10): each trait gets its name and the ancestral/derived labels the
// reading area shows on the bars. Marks themselves are added by the
// annotate tools in TreeExtrasForm.

import type { TraitDef } from "../../../engine/generated/TraitDef";

export function TraitDefsForm({
  traits,
  onChange,
}: {
  traits: TraitDef[];
  onChange: (traits: TraitDef[]) => void;
}) {
  const set = (i: number, t: TraitDef) =>
    onChange(traits.map((x, j) => (j === i ? t : x)));
  return (
    <fieldset className="rde-checks">
      <legend>Trait display names</legend>
      {traits.map((t, i) => (
        <div className="rde-item-row" key={i}>
          <label className="field">
            <span>Trait {i + 1}</span>
            <input
              type="text"
              value={t.name}
              onChange={(e) => set(i, { ...t, name: e.target.value })}
            />
          </label>
          <label className="field">
            <span>Ancestral label</span>
            <input
              type="text"
              value={t.ancestral}
              onChange={(e) =>
                set(i, { ...t, ancestral: e.target.value })
              }
            />
          </label>
          <label className="field">
            <span>Derived label</span>
            <input
              type="text"
              value={t.derived}
              onChange={(e) =>
                set(i, { ...t, derived: e.target.value })
              }
            />
          </label>
          <button
            type="button"
            className="rde-chip-x"
            aria-label={`Remove trait ${t.name || i + 1}`}
            onClick={() => onChange(traits.filter((_, j) => j !== i))}
          >
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() =>
          onChange([...traits, { name: "", ancestral: "", derived: "" }])
        }
      >
        Add trait names
      </button>
    </fieldset>
  );
}
