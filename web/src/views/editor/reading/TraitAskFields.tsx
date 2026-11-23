// The trait-question ask editor (v1.4d plan Task 10, spec §7.5): the
// ask kind plus its typed fields — tips are tap-set readouts (the item
// preview feeds them), trait names are picked from the tree's own
// trait list so the wire always carries a name the engine knows.

import type { TraitAsk } from "../../../engine/generated/TraitAsk";

import { Field, PickedField, TraitNameField } from "./fields";

const ASK_KINDS: { value: TraitAsk["kind"]; label: string }[] = [
  { value: "which_have", label: "Which tips have the trait" },
  { value: "which_shared", label: "Trait shared by exactly a clade" },
  { value: "how_many_changes", label: "How many changes" },
  { value: "profile", label: "A tip's full profile" },
  { value: "ancestral_or_derived", label: "Ancestral or derived" },
  { value: "has_not", label: "Has one trait, lacks another" },
  { value: "homologous", label: "Homologous or independent" },
];

function newAsk(v: TraitAsk["kind"]): TraitAsk {
  switch (v) {
    case "which_have":
    case "how_many_changes":
      return { kind: v, trait_name: "" };
    case "which_shared":
      return { kind: v, tips: [] };
    case "profile":
      return { kind: v, tip: "" };
    case "ancestral_or_derived":
      return { kind: v, trait_name: "", tip: "" };
    case "has_not":
      return { kind: v, has: "", lacks: "" };
    case "homologous":
      return { kind: v, trait_name: "", x: "", y: "" };
  }
}

function TipField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <PickedField
      label={label}
      value={value === "" ? undefined : value}
      onClear={() => onChange("")}
    />
  );
}

export function TraitAskFields({
  ask,
  traitNames,
  onChange,
}: {
  ask: TraitAsk;
  /** The item's first tree's trait names — every trait field the ask
   *  carries must name one of these. */
  traitNames: string[];
  onChange: (a: TraitAsk) => void;
}) {
  return (
    <>
      <Field label="Ask">
        <select
          value={ask.kind}
          onChange={(e) => onChange(newAsk(e.target.value as TraitAsk["kind"]))}
        >
          {ASK_KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
      </Field>
      {"trait_name" in ask && (
        <TraitNameField
          label="Trait name"
          value={ask.trait_name}
          traitNames={traitNames}
          onChange={(trait_name) => onChange({ ...ask, trait_name })}
        />
      )}
      {ask.kind === "which_shared" && (
        <PickedField
          label="Shared clade"
          value={ask.tips.length > 0 ? ask.tips : undefined}
          onClear={() => onChange({ ...ask, tips: [] })}
        />
      )}
      {(ask.kind === "profile" || ask.kind === "ancestral_or_derived") && (
        <TipField
          label="Tip"
          value={ask.tip}
          onChange={(tip) => onChange({ ...ask, tip })}
        />
      )}
      {ask.kind === "has_not" && (
        <>
          <TraitNameField
            label="Has trait"
            value={ask.has}
            traitNames={traitNames}
            onChange={(has) => onChange({ ...ask, has })}
          />
          <TraitNameField
            label="Lacks trait"
            value={ask.lacks}
            traitNames={traitNames}
            onChange={(lacks) => onChange({ ...ask, lacks })}
          />
        </>
      )}
      {ask.kind === "homologous" && (
        <>
          <TipField
            label="Tip x"
            value={ask.x}
            onChange={(x) => onChange({ ...ask, x })}
          />
          <TipField
            label="Tip y"
            value={ask.y}
            onChange={(y) => onChange({ ...ask, y })}
          />
        </>
      )}
    </>
  );
}
