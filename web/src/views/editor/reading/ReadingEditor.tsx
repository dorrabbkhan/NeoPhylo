// The reading-set editor (v1.4d plan Task 10, spec §7.5) — the
// "Tree reading set" mode EditorPage lazy-loads beside the exercise
// editor. Authors paste Newick into each stored tree (polytomies are
// Newick-only — the canvas stays binary), edit the same tree on the
// shared draw canvas, set letters/ages/marks/points by tapping the
// stored tree or the canvas, and add items whose tips, nodes and
// points are also chosen by tapping — never by editing JSON.
//
// `loadReadingSet` is the only validator: every draft change rebuilds
// the wire set and re-loads it, so an InvalidReading shows beside the
// item/tree it names the moment it appears, and Share, Save and
// Preview stay disabled while the set does not load. Answers under
// each item are the engine's `readingAnswer`; Share uses Task 8's
// `encodeReadingLink`; Import accepts the saved file or an `#r=` link.

import {
  useCallback,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import type { ChangeEvent } from "react";

import type { EditorModel } from "../../../editor/model";
import { engine } from "../../../engine/index";
import type { AnswerKey } from "../../../engine/generated/AnswerKey";
import type { NodeId } from "../../../engine/generated/NodeId";
import type { Question } from "../../../engine/generated/Question";
import type { ReadingTreeView } from "../../../engine/generated/ReadingTreeView";
import { readErrorMessage } from "../../../reading/errors";
import {
  decodeReadingLink,
  encodeReadingLink,
} from "../../../reading/url";

import { DrawCanvas } from "../DrawCanvas";

import { ItemForm } from "./ItemForm";
import { SetBasicsForm } from "./SetBasicsForm";
import {
  buildWireSet,
  canvasClade,
  draftFromSet,
  emptyDraft,
  emptyTreeDraft,
  resolveTreeView,
  type ReadingDraft,
  type TreeDraft,
} from "./readingDraft";
import { newItem, QUESTION_TYPES } from "./readingItems";
import { TreeSlot } from "./TreeSlot";

export interface ReadingEditorProps {
  /** The shared tree model — the draw canvas edits it; "Use canvas
   *  tree" copies its Newick into the focused stored tree. */
  model: EditorModel;
}

interface Notice {
  level: "error" | "status" | "link";
  text: string;
  /** The share/preview URL, shown for manual copy when needed. */
  url?: string;
}

export function ReadingEditor({ model }: ReadingEditorProps) {
  const subscribe = useCallback(
    (fn: () => void) => model.subscribe(fn),
    [model],
  );
  const tree = useSyncExternalStore(subscribe, () => model.tree);

  const [draft, setDraft] = useState<ReadingDraft>(emptyDraft);
  // The extras form that owns canvas taps, plus the clade its last
  // tap (preview or canvas) armed. null = nothing armed.
  const [armed, setArmed] = useState<{
    tree: number;
    clade: string[] | null;
  } | null>(null);
  const [newType, setNewType] =
    useState<Question["type"]>("which_differs");
  const [importText, setImportText] = useState("");
  const [importFileName, setImportFileName] = useState<string | null>(
    null,
  );
  const [notice, setNotice] = useState<Notice | null>(null);

  // Live validation — the engine is the only validator. The loaded
  // set feeds Share/Preview/Save and the per-item answer keys.
  const probe = useMemo(
    () => engine.loadReadingSet(JSON.stringify(buildWireSet(draft))),
    [draft],
  );
  const loaded = probe.ok ? probe.value : null;
  const setError = probe.ok
    ? null
    : probe.error.kind === "InvalidReading"
      ? probe.error
      : null;
  const itemError =
    setError !== null && setError.item !== "" ? setError : null;
  const globalError =
    setError === null
      ? probe.ok
        ? null
        : probe.error.kind // not an InvalidReading — surface the kind
      : itemError === null
        ? readErrorMessage(setError)
        : null;

  const answers: (AnswerKey | null)[] = useMemo(
    () =>
      loaded === null
        ? draft.items.map(() => null)
        : draft.items.map((_, i) => {
            const r = engine.readingAnswer(loaded, i);
            return r.ok ? r.value : null;
          }),
    [loaded, draft.items],
  );

  // Each stored tree resolved for the extras preview — the probe set
  // works whether or not the real set loads, so previews stay alive
  // while an item is still invalid.
  const treeViews = useMemo(() => {
    const views = new Map<string, ReadingTreeView>();
    const errors = new Map<string, string>();
    for (const t of draft.trees) {
      const r = resolveTreeView(t);
      if (r.ok) {
        views.set(t.name, r.value);
      } else {
        errors.set(t.name, readErrorMessage(r.error));
      }
    }
    return { views, errors };
  }, [draft.trees]);

  const setTree = (i: number, t: TreeDraft): void => {
    setDraft((d) => ({
      ...d,
      trees: d.trees.map((x, j) => (j === i ? t : x)),
    }));
    // An applied extra clears the armed clade — the next tap re-arms.
    setArmed((a) =>
      a !== null && a.tree === i ? { ...a, clade: null } : a,
    );
  };

  const setItem = (i: number, item: ReadingDraft["items"][number]) =>
    setDraft((d) => ({
      ...d,
      items: d.items.map((x, j) => (j === i ? item : x)),
    }));

  const onCanvasTap = (id: NodeId): void => {
    if (armed === null) return;
    const r = canvasClade(tree, id);
    if (r.ok) {
      setArmed({ ...armed, clade: r.value });
    } else {
      setNotice({
        level: "status",
        text: "That canvas node does not name a clade of the tree.",
      });
    }
  };

  const shareUrl = (): string | null =>
    loaded === null
      ? null
      : `${window.location.origin}${window.location.pathname}?read=${encodeReadingLink(loaded)}`;

  const onShare = () => {
    const url = shareUrl();
    if (url === null) return;
    try {
      void navigator.clipboard?.writeText(url);
    } catch {
      // blocked clipboard — the field still shows the link
    }
    setNotice({
      level: "link",
      text: "Share link — copy it, or save the file instead:",
      url,
    });
  };

  const onSave = () => {
    if (loaded === null) return;
    const name = `${draft.id.trim() || "reading-set"}.neophylo-reading.json`;
    const blob = new Blob([JSON.stringify(buildWireSet(draft), null, 2)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
    setNotice({ level: "status", text: `Saved ${name}.` });
  };

  const onPreview = () => {
    const url = shareUrl();
    if (url === null) return;
    const win = window.open(url, "_blank");
    setNotice(
      win === null
        ? {
            level: "error",
            text: "The browser blocked the preview tab — allow popups for this site and press Preview again.",
          }
        : {
            level: "status",
            text: "Preview opened in a new tab — exactly what a student sees.",
          },
    );
  };

  const onImport = (text: string) => {
    const r = text.includes("#r=")
      ? decodeReadingLink(text)
      : engine.loadReadingSet(text);
    if (!r.ok) {
      setNotice({
        level: "error",
        text: `Not imported — ${readErrorMessage(r.error)}`,
      });
      return;
    }
    setDraft(draftFromSet(r.value));
    setArmed(null);
    setImportText("");
    setNotice({
      level: "status",
      text: `Imported “${r.value.title}” — the trees and items are loaded.`,
    });
  };

  const onImportFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file === undefined) return;
    setImportFileName(file.name);
    void file.text().then(
      (text) => onImport(text),
      () =>
        setNotice({
          level: "error",
          text: "Not imported — the file could not be read.",
        }),
    );
    e.target.value = "";
  };

  const addItem = () => {
    const ids = new Set(draft.items.map((i) => i.id));
    let n = 1;
    while (ids.has(`q${n}`)) n += 1;
    setDraft((d) => ({
      ...d,
      items: [...d.items, newItem(newType, d.trees[0]?.name ?? null, n)],
    }));
  };

  const addTree = () => {
    const names = new Set(draft.trees.map((t) => t.name));
    let n = draft.trees.length + 1;
    while (names.has(`t${n}`)) n += 1;
    setDraft((d) => ({
      ...d,
      trees: [...d.trees, emptyTreeDraft(`t${n}`)],
    }));
  };

  const removeTree = (i: number) => {
    setDraft((d) => ({
      ...d,
      trees: d.trees.filter((_, j) => j !== i),
    }));
    setArmed(null);
  };

  const takeCanvas = (i: number) => {
    const t = draft.trees[i];
    if (t === undefined) return;
    setTree(i, { ...t, newick: engine.writeNewick(tree) });
  };

  const editOnCanvas = (i: number) => {
    const t = draft.trees[i];
    if (t === undefined) return;
    const r = engine.parseNewick(t.newick);
    if (!r.ok) {
      setNotice({
        level: "error",
        text: `The ${t.name} Newick does not parse — nothing was put on the canvas.`,
      });
      return;
    }
    const replaced = model.replace(r.value);
    if (!replaced.ok) {
      setNotice({
        level: "error",
        text: `The canvas refused that tree (${replaced.error.kind}) — it needs branch lengths and no unary nodes.`,
      });
      return;
    }
    setNotice({
      level: "status",
      text: `${t.name} is on the canvas — edit it, then Use canvas tree to store it back.`,
    });
  };

  const canAct = loaded !== null;

  return (
    <section className="editor-panel" aria-labelledby="rde-title">
      <h1 id="rde-title">Tree reading set editor</h1>
      <p className="editor-intro">
        Paste each tree's Newick (polytomies welcome — the canvas stays
        binary), annotate letters, ages, marks and points by tapping,
        and add items the same way. The engine checks the whole set as
        you work.
      </p>
      <SetBasicsForm
        draft={draft}
        onDraft={(patch) => setDraft((d) => ({ ...d, ...patch }))}
        canAct={canAct}
        onSave={onSave}
        onShare={onShare}
        onPreview={onPreview}
        importText={importText}
        onImportText={setImportText}
        onImport={() => onImport(importText)}
        importFileName={importFileName}
        onImportFile={onImportFile}
        notice={notice}
        globalError={globalError}
      />
      <DrawCanvas model={model} onNodeTap={onCanvasTap} />
      <section className="editor-section" aria-labelledby="rde-trees-title">
        <h2 id="rde-trees-title">Stored trees</h2>
        <p className="editor-hint">
          The canvas above edits one tree at a time: use “Edit on the
          canvas” to load a stored tree, and “Use canvas tree” to store
          the canvas back. Taps on the canvas arm the open extras form.
        </p>
        {draft.trees.map((t, i) => (
          <TreeSlot
            key={i}
            tree={t}
            view={treeViews.views.get(t.name) ?? null}
            viewError={treeViews.errors.get(t.name) ?? null}
            pendingClade={armed?.tree === i ? armed.clade : null}
            onArm={() =>
              setArmed((a) => ({
                tree: i,
                clade: a !== null && a.tree === i ? a.clade : null,
              }))
            }
            onClade={(clade) => setArmed({ tree: i, clade })}
            onChange={(next) => setTree(i, next)}
            onRemove={() => removeTree(i)}
            onTakeCanvas={() => takeCanvas(i)}
            onEditCanvas={() => editOnCanvas(i)}
          />
        ))}
        <button type="button" onClick={addTree}>
          Add tree
        </button>
      </section>
      <section className="editor-section" aria-labelledby="rde-items-title">
        <h2 id="rde-items-title">Items</h2>
        <div className="rde-item-row">
          <label className="field">
            <span>New item type</span>
            <select
              value={newType}
              onChange={(e) =>
                setNewType(e.target.value as Question["type"])
              }
            >
              {QUESTION_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={addItem}>
            Add item
          </button>
        </div>
        {draft.items.map((item, i) => (
          <ItemForm
            key={i}
            item={item}
            treeNames={draft.trees.map((t) => t.name)}
            treeViews={treeViews.views}
            answer={answers[i] ?? null}
            error={
              itemError !== null && itemError.item === item.id
                ? readErrorMessage(itemError)
                : null
            }
            onChange={(next) => setItem(i, next)}
            onRemove={() =>
              setDraft((d) => ({
                ...d,
                items: d.items.filter((_, j) => j !== i),
              }))
            }
          />
        ))}
      </section>
    </section>
  );
}
