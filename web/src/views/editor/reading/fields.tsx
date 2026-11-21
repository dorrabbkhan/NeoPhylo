// Small field controls shared by the reading editor's item/question
// forms (v1.4d plan Task 10): the label-above-control wrapper plus
// text, number and comma-separated-tips inputs, and the readout for a
// value the author set by tapping the preview tree.

/** The label-above-control wrapper every form field uses. */
export function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function Text({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <Field label={label}>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

export function Num({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <Field label={label}>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.valueAsNumber)}
      />
    </Field>
  );
}

/** A trait-name field: the wire wants a name the tree knows, so the
 *  control offers the tree's own trait names (trait defs first, then
 *  mark names — the engine's `trait_names` order) instead of free
 *  text. A tree with no traits yet falls back to a plain input; a
 *  value the list doesn't know stays visible and selectable so an
 *  imported item never lies about what it holds. */
export function TraitNameField({
  label,
  value,
  traitNames,
  onChange,
  emptyLabel = "— pick a trait —",
}: {
  label: string;
  value: string;
  traitNames: string[];
  onChange: (v: string) => void;
  /** The empty option's text; "none" wording for optional fields. */
  emptyLabel?: string;
}) {
  if (traitNames.length === 0) {
    return <Text label={label} value={value} onChange={onChange} />;
  }
  return (
    <Field label={label}>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{emptyLabel}</option>
        {traitNames.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
        {value !== "" && !traitNames.includes(value) && (
          <option value={value}>{value} (not on this tree)</option>
        )}
      </select>
    </Field>
  );
}

/** A tip list as a comma-separated input — the wire wants an array. */
export function CsvField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string[];
  onChange: (tips: string[]) => void;
}) {
  return (
    <Field label={label}>
      <input
        type="text"
        value={value.join(", ")}
        placeholder="tip names, comma separated"
        onChange={(e) =>
          onChange(
            e.target.value
              .split(",")
              .map((s) => s.trim())
              .filter((s) => s !== ""),
          )
        }
      />
    </Field>
  );
}

/** A value set by tapping, shown as text with a clear button — the
 *  tap itself lands through the item's preview tree. */
export function PickedField({
  label,
  value,
  onClear,
}: {
  label: string;
  value: string | string[] | undefined;
  onClear: () => void;
}) {
  const text =
    value === undefined
      ? "— tap on the preview tree"
      : Array.isArray(value)
        ? value.join(", ")
        : value;
  return (
    <p className="rde-picked">
      <span className="rde-picked-label">{label}:</span> {text}
      {value !== undefined && (
        <button type="button" className="rde-chip-x" onClick={onClear}>
          Clear
        </button>
      )}
    </p>
  );
}
