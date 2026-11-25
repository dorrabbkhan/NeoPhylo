// The assignment builder (v1.5 plan Task 7, spec §6): the editor's
// third mode. An instructor picks content — a built-in lesson, lab
// or reading set, one of the editor's own autosaved drafts, or a
// pasted saved file — names the assignment, chooses the LMS id
// prompt and the practice/test mode, sets variation, and picks the
// graded tasks (spec §5.3) from plain-word labels. The finished
// `.neophylo-assignment.json` saves as a file or copies as a `#a=`
// link the student start page (Task 8) opens.
//
// The draft autosaves under `neophylo:draft:assignment` on every
// change (spec §9.1) — a reload mid-build restores it. The engine
// owns every refusal: `loadAssignment` validates, `maxCodeLen`
// enforces the 250-char code cap, and `makeVariant` powers both the
// base-variant answer column and the three sample students.

import {
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";

import { encodeAssignmentLink } from "../../../assess/url";
import { engine } from "../../../engine/index";
import type { Mode } from "../../../engine/generated/Mode";
import type { Variant } from "../../../engine/generated/Variant";

import { autosave } from "../autosave";

import { SamplePreview } from "./SamplePreview";
import { TaskPicker } from "./TaskPicker";
import {
  assignmentFile,
  CODE_LEN_LIMIT,
  contentFromSelectValue,
  contentSelectValue,
  draftForParam,
  ID_PRESETS,
  isFixedData,
  listBuiltins,
  precisionMap,
  probeJson,
  prosePrompts,
  refusals,
  resolveContent,
} from "./builder";
import type { BuiltinOption, Resolution } from "./builder";

export interface AssignmentBuilderProps {
  /** The `?editor&assign=<id>` preselect — a built-in content id the
   *  library card's "Make an assignment" names. */
  initialBuiltin?: string;
}

export function AssignmentBuilder({
  initialBuiltin,
}: AssignmentBuilderProps) {
  const [draft, setDraft] = useState(() =>
    draftForParam(initialBuiltin),
  );
  const [builtins, setBuiltins] = useState<BuiltinOption[] | null>(null);
  const [fetched, setFetched] = useState<Resolution | null>(null);
  const [fileText, setFileText] = useState("");
  const [linkUrl, setLinkUrl] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // The storage flag is external mutable state — read it through a
  // subscription (the model.subscribe pattern), not effect-set-state.
  const draftBlocked = useSyncExternalStore(
    autosave.subscribe,
    () => autosave.blocked,
  );
  const decimals = useMemo(() => precisionMap(), []);

  // The draft autosaves on every change (spec §9.1) — the storage
  // flag surfaces as the "drafts won't be saved" line, never a crash.
  useEffect(() => {
    autosave.save("assignment", draft);
  }, [draft]);

  // The shipped-content list arrives once — lessons are synchronous,
  // labs read the registry, reading sets load through the engine.
  useEffect(() => {
    let live = true;
    void listBuiltins().then((list) => {
      if (live) setBuiltins(list);
    });
    return () => {
      live = false;
    };
  }, []);

  // Resolve the picked content to something the engine probes —
  // builtin text is a lazy glob, drafts rebuild synchronously. "No
  // content" is derived at render, not pushed by the effect.
  useEffect(() => {
    if (draft.content === null) return;
    let live = true;
    void resolveContent(draft.content).then((r) => {
      if (live) setFetched(r);
    });
    return () => {
      live = false;
    };
  }, [draft.content]);

  const resolution = draft.content === null ? null : fetched;
  const resolved = resolution?.ok === true ? resolution.value : null;
  const exercise = resolved?.exercise ?? null;

  // An empty title takes the content's own (owner-visible in §6) —
  // render-phase adjustment when the resolution lands (the
  // NewickView pattern; set-state-in-effect is lint-forbidden).
  const [prevResolved, setPrevResolved] = useState(resolved);
  if (resolved !== prevResolved) {
    setPrevResolved(resolved);
    if (resolved !== null) {
      const title = resolved.title;
      setDraft((d) => (d.title === "" ? { ...d, title } : d));
    }
  }

  // The owner's ruling (PR #187 fix, 2026-11-25): content whose prose
  // names taxa defaults variation OFF; enabling it warns, naming the
  // 1-based prompts the note will mismatch.
  const namedPrompts = useMemo(() => prosePrompts(exercise), [exercise]);
  const variation = draft.variation ?? namedPrompts.length === 0;

  const file = useMemo(
    () =>
      resolved === null ? null : assignmentFile(draft, resolved, variation),
    [draft, resolved, variation],
  );
  const probe = useMemo(
    () =>
      file === null || resolved === null
        ? null
        : probeJson(file, resolved.fileText),
    [file, resolved],
  );
  const loaded = useMemo(
    () => (probe === null ? null : engine.loadAssignment(probe)),
    [probe],
  );
  const codeLen = useMemo(() => {
    if (probe === null) return null;
    const r = engine.maxCodeLen(probe);
    return r.ok ? r.value : null;
  }, [probe]);
  // The base variant — variation off — is where prompt answers are
  // quoted; a fixed probe id keeps it stable between renders.
  const baseVariant: Variant | null = useMemo(() => {
    if (file === null || resolved === null) return null;
    const r = engine.makeVariant(
      probeJson({ ...file, variation: false }, resolved.fileText),
      "sample",
    );
    return r.ok ? r.value : null;
  }, [file, resolved]);

  const reasons = useMemo(
    () =>
      refusals({
        title: draft.title,
        tasks: draft.tasks,
        loadError:
          loaded !== null && !loaded.ok ? loaded.error : null,
        codeLen,
        hasContent: resolved !== null,
      }),
    [draft.title, draft.tasks, loaded, codeLen, resolved],
  );
  const canShare = file !== null && reasons.length === 0;

  const shareUrl = (): string | null =>
    file === null
      ? null
      : `${window.location.origin}${window.location.pathname}${encodeAssignmentLink(file)}`;

  const onCopyLink = () => {
    const url = shareUrl();
    if (url === null) return;
    try {
      void navigator.clipboard?.writeText(url).catch(() => undefined);
    } catch {
      // blocked clipboard — the field below still shows the link
    }
    setLinkUrl(url);
    setNotice("Assignment link — copy it, or save the file instead:");
  };

  const onSave = () => {
    if (file === null) return;
    const name = `${file.id}.neophylo-assignment.json`;
    const blob = new Blob([JSON.stringify(file, null, 2)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
    setNotice(`Saved ${name}.`);
  };

  const onContentPick = (v: string) => {
    const content = contentFromSelectValue(
      v,
      v === "file" ? parseFileText(fileText) : null,
    );
    setDraft((d) => ({ ...d, content }));
  };

  const onFileText = (text: string) => {
    setFileText(text);
    setDraft((d) => ({
      ...d,
      content: { kind: "file", file: parseFileText(text) },
    }));
  };

  const groups = useMemo(() => {
    const map = new Map<string, BuiltinOption[]>();
    for (const b of builtins ?? []) {
      const list = map.get(b.group) ?? [];
      list.push(b);
      map.set(b.group, list);
    }
    return map;
  }, [builtins]);

  const fixedData = resolved !== null && isFixedData(resolved.content);
  const customId = draft.idLabel === "custom";

  return (
    <section className="editor-panel" aria-labelledby="ab-title">
      <h1 id="ab-title">Assignment builder</h1>
      <p className="editor-intro">
        Pick the lesson or lab, name the assignment, choose the graded
        tasks, then copy the link or save the file — students open it
        straight into the assignment. The draft autosaves as you work.
      </p>
      <div className="editor-actions">
        <button
          type="button"
          className="btn btn-primary"
          onClick={onCopyLink}
          disabled={!canShare}
        >
          Copy link
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={onSave}
          disabled={!canShare}
        >
          Save file
        </button>
      </div>
      {reasons.length > 0 && draft.content !== null && (
        <div className="editor-notice">
          {reasons.map((r) => (
            <p key={r} role="alert" className="editor-error">
              {r}
            </p>
          ))}
        </div>
      )}
      {notice !== null && (
        <div className="editor-notice">
          <p role="status" className="editor-hint">
            {notice}
          </p>
          {linkUrl !== null && (
            <input
              type="text"
              className="share-link-out"
              readOnly
              value={linkUrl}
              aria-label="Assignment link"
              onFocus={(e) => e.target.select()}
            />
          )}
        </div>
      )}
      {draftBlocked && (
        <p className="editor-warning">
          Drafts won't be saved — this browser's storage is
          unavailable.
        </p>
      )}

      <section className="editor-section" aria-labelledby="ab-content">
        <h2 id="ab-content">Which lesson or lab does this assignment use?</h2>
        <label className="field">
          <span>Assignment content</span>
          <select
            value={contentSelectValue(draft.content)}
            onChange={(e) => onContentPick(e.target.value)}
          >
            <option value="">— pick content —</option>
            {[...groups.entries()].map(([name, options]) => (
              <optgroup key={name} label={name}>
                {options.map((o) => (
                  <option key={o.id} value={`builtin:${o.id}`}>
                    {o.title}
                  </option>
                ))}
              </optgroup>
            ))}
            <option value="exercise-draft">
              The exercise in the editor draft
            </option>
            <option value="reading-draft">
              The reading set in the editor draft
            </option>
            <option value="file">A saved .json file…</option>
          </select>
        </label>
        {draft.content?.kind === "file" && (
          <label className="field">
            <span>Assignment file JSON</span>
            <textarea
              value={fileText}
              rows={6}
              onChange={(e) => onFileText(e.target.value)}
            />
          </label>
        )}
        {resolution !== null && !resolution.ok && (
          <p role="alert" className="editor-error">
            {resolution.error}
          </p>
        )}
        {fixedData && (
          <p className="editor-hint">
            This content is fixed data — every student gets the same
            data; variation still shuffles the names each student
            sees.
          </p>
        )}
      </section>

      <section className="editor-section" aria-labelledby="ab-basics">
        <h2 id="ab-basics">The assignment</h2>
        <label className="field">
          <span>Assignment title</span>
          <input
            type="text"
            value={draft.title}
            onChange={(e) =>
              setDraft((d) => ({ ...d, title: e.target.value }))
            }
          />
        </label>
        <label className="field">
          <span>Instructions (optional)</span>
          <textarea
            value={draft.instructions}
            rows={3}
            onChange={(e) =>
              setDraft((d) => ({ ...d, instructions: e.target.value }))
            }
          />
        </label>
        <label className="field">
          <span>Student id prompt</span>
          <select
            value={draft.idLabel}
            onChange={(e) =>
              setDraft((d) => ({ ...d, idLabel: e.target.value }))
            }
          >
            {ID_PRESETS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
            <option value="custom">Custom…</option>
          </select>
        </label>
        {customId && (
          <label className="field">
            <span>Custom id prompt label</span>
            <input
              type="text"
              value={draft.customLabel}
              onChange={(e) =>
                setDraft((d) => ({ ...d, customLabel: e.target.value }))
              }
            />
          </label>
        )}
        <fieldset className="editor-mode">
          <legend>Mode</legend>
          <label className="editor-mode-opt">
            <input
              type="radio"
              name="assignment-mode"
              checked={draft.mode === "practice"}
              onChange={() =>
                setDraft((d) => ({ ...d, mode: "practice" as Mode }))
              }
            />
            Practice — students see each task's verdict as they go
          </label>
          <label className="editor-mode-opt">
            <input
              type="radio"
              name="assignment-mode"
              checked={draft.mode === "test"}
              onChange={() =>
                setDraft((d) => ({ ...d, mode: "test" as Mode }))
              }
            />
            Test — answers stay hidden until the completion code
          </label>
        </fieldset>
        <label className="builder-check">
          <input
            type="checkbox"
            checked={variation}
            onChange={(e) =>
              setDraft((d) => ({ ...d, variation: e.target.checked }))
            }
          />
          <span>Each student gets their own variation</span>
        </label>
        {variation && namedPrompts.length > 0 && (
          <p className="editor-warning">
            This lesson's notes name specific taxa. With variation on,
            students get different names and data, so some notes may
            not match what they see. Grading is not affected. Affected
            prompts: {namedPrompts.map((n) => `prompt ${n}`).join(", ")}.
          </p>
        )}
      </section>

      <TaskPicker
        resolved={resolved}
        baseVariant={baseVariant}
        tasks={draft.tasks}
        decimals={decimals}
        onChange={(tasks) => setDraft((d) => ({ ...d, tasks }))}
      />

      <SamplePreview probe={probe} tasks={draft.tasks} decimals={decimals} />

      {codeLen !== null && codeLen <= CODE_LEN_LIMIT && (
        <p className="editor-hint">
          The longest completion code this assignment can issue is{" "}
          {codeLen} characters.
        </p>
      )}
    </section>
  );
}

/** The pasted file's parse — `null` keeps the resolution error
 *  honest ("not valid JSON") instead of inventing an object. */
function parseFileText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
