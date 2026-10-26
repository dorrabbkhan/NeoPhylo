// The new-leaf inline form for the draw canvas (v1.4 Task 9 fix
// round 2, spec §5.2): the `N` key and the "New leaf" button both
// open it. A labelled name field plus a submit button — Enter or the
// button asks the canvas to apply the engine's `add_leaf` op; Escape
// cancels and the canvas returns focus to whatever was focused
// before. The form holds no tree logic: the name goes to the engine
// verbatim (empty and duplicate names are its refusals, shown by the
// canvas), and a refused name keeps the form open with its value —
// the parent only unmounts this on success or cancel.
//
// Enter's submit is wired by hand (preventDefault + the submit
// callback) instead of relying on implicit form submission, so the
// key behaves identically in jsdom and every browser.

import { useEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";

export interface NewLeafFormProps {
  /** Apply the name through the engine (the canvas closes the form
   * only when the op is accepted). */
  onSubmit: (name: string) => void;
  /** Escape cancels; the canvas restores the previous focus. */
  onCancel: () => void;
}

export function NewLeafForm({ onSubmit, onCancel }: NewLeafFormProps) {
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  // The form only exists while it is open — focus its field on mount.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = (): void => onSubmit(name);
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <form
      className="new-leaf-form"
      aria-label="New leaf"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        submit();
      }}
    >
      <label className="editor-view-label" htmlFor="new-leaf-name">
        New taxon name
      </label>
      <input
        id="new-leaf-name"
        ref={inputRef}
        value={name}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <button type="submit">Add leaf</button>
    </form>
  );
}
