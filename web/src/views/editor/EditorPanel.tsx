// The exercise editor's workspace (v1.4 plan Tasks 8–10, spec §5): the
// drag canvas on top, then the Newick text view and the branch-length
// table — three views of one EditorModel — followed by the settings
// form, the prompt list, and the save / share / preview / import
// actions over Task 7's exerciseFile helpers.
//
// Below 1024 px the Newick and table views leave the grid and open as
// full-screen sheets instead (spec §5.5), reusing the v1.3 Sheet
// component and its focus contract — focus moves in on open, Esc
// closes, focus returns to the button that opened it.
//
// The preview opens the exercise's `#x=` share link in a new tab — the
// REAL lesson player a student sees, unchanged (spec §5.3). Save and
// preview gate on the same `settingsProblems` the form displays, so a
// value the form accepts can never fail the save path (Review Focus 1).

import { useCallback, useState, useSyncExternalStore } from "react";
import type { ChangeEvent } from "react";

import { useBreakpoint } from "../../design/breakpoints";
import {
  buildExerciseState,
  DEFAULT_SETTINGS,
  settingsFromExercise,
  settingsProblems,
  type EditorSettings,
} from "../../editor/draft";
import {
  importExercise,
  saveExercise,
  shareLink,
  SHARE_LINK_MAX_LENGTH,
} from "../../editor/exerciseFile";
import type { EditorModel } from "../../editor/model";
import { engine } from "../../engine/index";
import type { Prompt } from "../../engine/generated/Prompt";
import { errorMessage } from "../../explain/errors";
import { Sheet } from "../Sheet";

import { BranchTable } from "./BranchTable";
import { DrawCanvas } from "./DrawCanvas";
import { detachedRoots, leafNames } from "./drawOps";
import { NewickView } from "./NewickView";
import { PromptList } from "./PromptList";
import { SettingsForm } from "./SettingsForm";

export interface EditorPanelProps {
  /** The shared tree model every editor view renders and edits. */
  model: EditorModel;
}

type SheetKind = "newick" | "table";

interface Notice {
  level: "error" | "status" | "link";
  text: string;
  /** The share/preview URL, shown for manual copy when needed. */
  url?: string;
}

export function EditorPanel({ model }: EditorPanelProps) {
  const subscribe = useCallback(
    (fn: () => void) => model.subscribe(fn),
    [model],
  );
  const tree = useSyncExternalStore(subscribe, () => model.tree);

  const bp = useBreakpoint();
  const compact = bp === "narrow" || bp === "compact";
  const [sheet, setSheet] = useState<SheetKind | null>(null);
  // Crossing back to ≥1024 px closes an open sheet — the views return
  // to the grid.
  if (!compact && sheet !== null) setSheet(null);

  const [settings, setSettings] =
    useState<EditorSettings>(DEFAULT_SETTINGS);
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [fileExtras, setFileExtras] = useState<
    Record<string, unknown> | undefined
  >(undefined);
  const [importText, setImportText] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);

  const problems = settingsProblems(settings);
  const canSave = !problems.some((p) => p.level === "error");
  const buildState = () =>
    buildExerciseState(tree, settings, prompts, fileExtras);

  const detached = detachedRoots(tree).length;
  const taxa: string[] = [];
  leafNames(tree, tree.root, taxa);

  const onSave = () => {
    const r = saveExercise(buildState());
    if ("error" in r) {
      setNotice({ level: "error", text: `Not saved — ${r.error}.` });
      return;
    }
    const name = `${settings.id.trim() || "exercise"}.json`;
    const blob = new Blob([r.json], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
    setNotice({ level: "status", text: `Saved ${name}.` });
  };

  const onShare = () => {
    const r = shareLink(buildState());
    if ("error" in r) {
      setNotice({ level: "error", text: `No link — ${r.error}.` });
    } else if ("tooLong" in r) {
      setNotice({
        level: "error",
        text: `The share link would be over ${SHARE_LINK_MAX_LENGTH} characters — save the file and share that instead.`,
      });
    } else {
      // Clipboard is convenience only (spec §5.4): never required —
      // the link field below stays for manual copy.
      try {
        void navigator.clipboard?.writeText(r.url);
      } catch {
        // blocked clipboard — the field still shows the link
      }
      setNotice({
        level: "link",
        text: "Share link — copy it, or save the file for anything longer:",
        url: r.url,
      });
    }
  };

  const onPreview = () => {
    const r = shareLink(buildState());
    if ("error" in r) {
      setNotice({ level: "error", text: `No preview — ${r.error}.` });
      return;
    }
    if ("tooLong" in r) {
      setNotice({
        level: "error",
        text: `The exercise is too large to preview as a link (over ${SHARE_LINK_MAX_LENGTH} characters) — save the file and open it instead.`,
      });
      return;
    }
    const win = window.open(r.url, "_blank", "noopener");
    setNotice(
      win === null
        ? {
            level: "link",
            text: "The browser blocked the new tab — open the preview link manually:",
            url: r.url,
          }
        : {
            level: "status",
            text: "Preview opened in a new tab — exactly what a student sees.",
          },
    );
  };

  const onImport = (text: string) => {
    const r = importExercise(text);
    if (!r.ok) {
      const m = errorMessage(r.error);
      setNotice({
        level: "error",
        text: `Not imported — ${m.title}: ${m.body}`,
      });
      return;
    }
    const ex = r.value.exercise;
    const conv = settingsFromExercise(ex, r.value.fileExtras);
    if ("error" in conv) {
      setNotice({ level: "error", text: `Not imported — ${conv.error}` });
      return;
    }
    // The engine already validated the file; the tree still has to
    // satisfy the editor's editable-tree rules (a unary node or a
    // missing length is refused the same way as a Newick edit).
    const exTree = ex.data.kind === "simulated" ? ex.data.true_tree : "";
    const parsed = engine.parseNewick(exTree);
    if (!parsed.ok) {
      setNotice({
        level: "error",
        text: "Not imported — the exercise's true tree did not parse.",
      });
      return;
    }
    const replaced = model.replace(parsed.value);
    if (!replaced.ok) {
      const m = errorMessage(replaced.error);
      setNotice({
        level: "error",
        text: `Not imported — ${m.title}: ${m.body}`,
      });
      return;
    }
    setSettings(conv.settings);
    setPrompts(conv.prompts);
    setFileExtras(r.value.fileExtras);
    setImportText("");
    setNotice({
      level: "status",
      text: `Imported “${ex.title}” — the tree, settings and prompts are loaded.`,
    });
  };

  const onImportFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file === undefined) return;
    void file.text().then(
      (text) => onImport(text),
      () =>
        setNotice({
          level: "error",
          text: "Not imported — the file could not be read.",
        }),
    );
    // Let the same file be picked twice in a row.
    e.target.value = "";
  };

  return (
    <section className="editor-panel" aria-labelledby="editor-panel-title">
      <h1 id="editor-panel-title">Exercise editor</h1>
      <p className="editor-intro">
        One tree, three ways to edit it: drag on the canvas, write
        Newick text, or fill the branch table. Then set the model and
        prompts, preview the lesson a student sees, and save or share
        the exercise.
      </p>
      <div className="editor-actions">
        <button type="button" onClick={onSave} disabled={!canSave}>
          Save file
        </button>
        <button type="button" onClick={onShare} disabled={!canSave}>
          Share link
        </button>
        <button type="button" onClick={onPreview} disabled={!canSave}>
          Preview
        </button>
        <label className="field import-field">
          <span>Import a file or #x= link</span>
          <input
            type="text"
            value={importText}
            placeholder="{…} or https://…#x=…"
            onChange={(e) => setImportText(e.target.value)}
          />
        </label>
        <button
          type="button"
          onClick={() => onImport(importText)}
          disabled={importText.trim() === ""}
        >
          Import text
        </button>
        <label className="import-file">
          <span className="import-file-btn">Import file…</span>
          <input
            type="file"
            accept=".json,application/json"
            aria-label="Import an exercise file"
            onChange={onImportFile}
          />
        </label>
      </div>
      {notice !== null && (
        <div className="editor-notice">
          <p
            role={notice.level === "error" ? "alert" : "status"}
            className={
              notice.level === "error" ? "editor-error" : "editor-hint"
            }
          >
            {notice.text}
          </p>
          {notice.url !== undefined && (
            <input
              type="text"
              className="share-link-out"
              readOnly
              value={notice.url}
              aria-label="Share link URL"
              onFocus={(e) => e.target.select()}
            />
          )}
        </div>
      )}
      {detached > 0 && (
        <p className="editor-warning">
          {detached} detached {detached === 1 ? "subtree" : "subtrees"}{" "}
          on the canvas {detached === 1 ? "is" : "are"} not part of the
          saved exercise — join or detach deliberately.
        </p>
      )}
      <div className="editor-views">
        <DrawCanvas model={model} />
        {compact ? (
          <div className="editor-view-buttons">
            <button type="button" onClick={() => setSheet("newick")}>
              Newick tree
            </button>
            <button type="button" onClick={() => setSheet("table")}>
              Branch lengths
            </button>
          </div>
        ) : (
          <>
            <NewickView model={model} />
            <BranchTable model={model} />
          </>
        )}
      </div>
      <section
        className="editor-section"
        aria-labelledby="editor-settings-title"
      >
        <h2 id="editor-settings-title">Settings</h2>
        <SettingsForm settings={settings} onChange={setSettings} />
      </section>
      <section
        className="editor-section"
        aria-labelledby="editor-prompts-title"
      >
        <h2 id="editor-prompts-title">Prompts</h2>
        <PromptList prompts={prompts} taxa={taxa} onChange={setPrompts} />
      </section>
      {sheet === "newick" && (
        <Sheet
          className="editor-sheet"
          labelledBy="editor-sheet-newick-title"
          onClose={() => setSheet(null)}
        >
          <header className="editor-sheet-head">
            <h2 id="editor-sheet-newick-title">Newick tree</h2>
            <button
              type="button"
              className="close"
              aria-label="Close the Newick tree view"
              onClick={() => setSheet(null)}
            >
              ×
            </button>
          </header>
          <NewickView model={model} />
        </Sheet>
      )}
      {sheet === "table" && (
        <Sheet
          className="editor-sheet"
          labelledBy="editor-sheet-table-title"
          onClose={() => setSheet(null)}
        >
          <header className="editor-sheet-head">
            <h2 id="editor-sheet-table-title">Branch lengths</h2>
            <button
              type="button"
              className="close"
              aria-label="Close the branch-length table"
              onClick={() => setSheet(null)}
            >
              ×
            </button>
          </header>
          <BranchTable model={model} />
        </Sheet>
      )}
    </section>
  );
}
