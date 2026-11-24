// The select_true statements editor (v1.4d plan Task 10, spec §7.5):
// each statement is a kind select, the params that kind needs and the
// text the student sees — the engine turns the structured part into
// the answer key.

import type { Statement } from "../../../engine/generated/Statement";

import { CsvField, Field, Num, Text, TraitNameField } from "./fields";

const STATEMENT_KINDS: { value: Statement["kind"]; label: string }[] = [
  { value: "closer_than", label: "X and Y closer than X and Z" },
  { value: "is_clade", label: "A set is a clade" },
  { value: "clade_in_not_in", label: "Clade in tree i, not in tree j" },
  { value: "same_relationships", label: "Trees i and j agree" },
  { value: "older_than", label: "Node P older than node Q" },
  { value: "older_than_age", label: "Node P older than an age" },
  { value: "lineage_at_least", label: "A lineage is at least an age" },
  { value: "has_trait", label: "A tip has a trait" },
  { value: "shared_derived", label: "Shared derived trait of a set" },
  { value: "gained_within", label: "A trait arose within another" },
];

function newStatement(kind: Statement["kind"]): Statement {
  switch (kind) {
    case "closer_than":
      return { kind, x: "", y: "", z: "", text: "" };
    case "is_clade":
      return { kind, tips: [], text: "" };
    case "clade_in_not_in":
      return { kind, tips: [], tree_i: 0, tree_j: 1, text: "" };
    case "same_relationships":
      return { kind, tree_i: 0, tree_j: 1, text: "" };
    case "older_than":
      return { kind, p: "", q: "", text: "" };
    case "older_than_age":
      return { kind, p: "", age: 0, text: "" };
    case "lineage_at_least":
      return { kind, tip: "", age: 0, text: "" };
    case "has_trait":
      return { kind, tip: "", trait_name: "", text: "" };
    case "shared_derived":
      return { kind, trait_name: "", tips: [], text: "" };
    case "gained_within":
      return { kind, inner: "", outer: "", text: "" };
  }
}

function StatementParams({
  s,
  traitNames,
  onChange,
}: {
  s: Statement;
  traitNames: string[];
  onChange: (s: Statement) => void;
}) {
  switch (s.kind) {
    case "closer_than":
      return (
        <>
          <Text label="Tip x" value={s.x} onChange={(x) => onChange({ ...s, x })} />
          <Text label="Tip y" value={s.y} onChange={(y) => onChange({ ...s, y })} />
          <Text label="Tip z" value={s.z} onChange={(z) => onChange({ ...s, z })} />
        </>
      );
    case "is_clade":
      return (
        <CsvField label="Tips" value={s.tips} onChange={(tips) => onChange({ ...s, tips })} />
      );
    case "clade_in_not_in":
      return (
        <>
          <CsvField label="Tips" value={s.tips} onChange={(tips) => onChange({ ...s, tips })} />
          <Num label="Tree i (1-based)" value={s.tree_i + 1} onChange={(v) => onChange({ ...s, tree_i: v - 1 })} />
          <Num label="Tree j (1-based)" value={s.tree_j + 1} onChange={(v) => onChange({ ...s, tree_j: v - 1 })} />
        </>
      );
    case "same_relationships":
      return (
        <>
          <Num label="Tree i (1-based)" value={s.tree_i + 1} onChange={(v) => onChange({ ...s, tree_i: v - 1 })} />
          <Num label="Tree j (1-based)" value={s.tree_j + 1} onChange={(v) => onChange({ ...s, tree_j: v - 1 })} />
        </>
      );
    case "older_than":
      return (
        <>
          <Text label="Node letter p" value={s.p} onChange={(p) => onChange({ ...s, p })} />
          <Text label="Node letter q" value={s.q} onChange={(q) => onChange({ ...s, q })} />
        </>
      );
    case "older_than_age":
      return (
        <>
          <Text label="Node letter p" value={s.p} onChange={(p) => onChange({ ...s, p })} />
          <Num label="Age" value={s.age} onChange={(age) => onChange({ ...s, age })} />
        </>
      );
    case "lineage_at_least":
      return (
        <>
          <Text label="Tip" value={s.tip} onChange={(tip) => onChange({ ...s, tip })} />
          <Num label="Age" value={s.age} onChange={(age) => onChange({ ...s, age })} />
        </>
      );
    case "has_trait":
      return (
        <>
          <Text label="Tip" value={s.tip} onChange={(tip) => onChange({ ...s, tip })} />
          <TraitNameField label="Trait" value={s.trait_name} traitNames={traitNames} onChange={(trait_name) => onChange({ ...s, trait_name })} />
        </>
      );
    case "shared_derived":
      return (
        <>
          <TraitNameField label="Trait" value={s.trait_name} traitNames={traitNames} onChange={(trait_name) => onChange({ ...s, trait_name })} />
          <CsvField label="Tips" value={s.tips} onChange={(tips) => onChange({ ...s, tips })} />
        </>
      );
    case "gained_within":
      return (
        <>
          <TraitNameField label="Inner trait" value={s.inner} traitNames={traitNames} onChange={(inner) => onChange({ ...s, inner })} />
          <TraitNameField label="Outer trait" value={s.outer} traitNames={traitNames} onChange={(outer) => onChange({ ...s, outer })} />
        </>
      );
  }
}

export function StatementsEditor({
  statements,
  traitNames,
  onChange,
}: {
  statements: Statement[];
  traitNames: string[];
  onChange: (statements: Statement[]) => void;
}) {
  return (
    <div className="rde-statements">
      {statements.map((s, i) => (
        <fieldset className="rde-statement" key={i}>
          <legend>Statement {i + 1}</legend>
          <Field label="Kind">
            <select
              value={s.kind}
              onChange={(e) =>
                onChange(
                  statements.map((x, j) =>
                    j === i
                      ? newStatement(e.target.value as Statement["kind"])
                      : x,
                  ),
                )
              }
            >
              {STATEMENT_KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
          </Field>
          <StatementParams
            s={s}
            traitNames={traitNames}
            onChange={(next) =>
              onChange(statements.map((x, j) => (j === i ? next : x)))
            }
          />
          <Text
            label="Text the student sees"
            value={s.text}
            onChange={(text) =>
              onChange(
                statements.map((x, j) => (j === i ? { ...x, text } : x)),
              )
            }
          />
          <button
            type="button"
            className="rde-chip-x btn btn-ghost"
            onClick={() => onChange(statements.filter((_, j) => j !== i))}
          >
            Remove statement
          </button>
        </fieldset>
      ))}
      <button
        type="button"
        className="btn btn-secondary"
        onClick={() =>
          onChange([...statements, newStatement("is_clade")])
        }
      >
        Add statement
      </button>
    </div>
  );
}
