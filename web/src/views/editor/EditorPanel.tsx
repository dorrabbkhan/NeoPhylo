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
// The preview opens a bare `?preview=<nonce>` tab — the REAL lesson
// player a student sees, unchanged (spec §5.3) — and the draft crosses
// to it over a same-origin postMessage handshake (editor/preview.ts,
// fix round 3), so it works at any exercise size, link limit or not.
// Save and preview gate on the same `settingsProblems` the form
// displays, so a value the form accepts can never fail the save path
// (Review Focus 1).

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { ChangeEvent } from "react";

import { useBreakpoint } from "../../design/breakpoints";
import {
  buildExerciseState,
  DEFAULT_SETTINGS,
  EMPTY_PRESERVED,
  preservedFieldNames,
  settingsFromExercise,
  settingsProblems,
  type EditorSettings,
  type PreservedFields,
} from "../../editor/draft";
import {
  importExercise,
  saveExercise,
  shareLink,
  SHARE_LINK_MAX_LENGTH,
} from "../../editor/exerciseFile";
import type { ExerciseState } from "../../editor/exerciseFile";
import type { EditorModel } from "../../editor/model";
import {
  answerPreviewRequests,
  previewNonce,
  previewUrl,
} from "../../editor/preview";
import { engine } from "../../engine/index";
import type { Prompt } from "../../engine/generated/Prompt";
import type { Tree } from "../../engine/generated/Tree";
import { errorMessage } from "../../explain/errors";
import { listLabs, loadLab } from "../../labs/registry";
import type { LabSummary } from "../../labs/registry";
import { LabPickList } from "../labs/LabIndex";
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

/** Everything "unsaved work" means here (Review Focus 5): the tree,
 * the settings, the prompts and the fields carried from an import.
 * Serializing them is the dirty check — the baseline is the state at
 * mount, after the last accepted load and after a successful save. */
function draftSnapshot(
  tree: Tree,
  settings: EditorSettings,
  prompts: Prompt[],
  fileExtras: Record<string, unknown> | undefined,
  preserved: PreservedFields,
): string {
  return JSON.stringify({
    n: engine.writeNewick(tree),
    s: settings,
    p: prompts,
    x: fileExtras ?? null,
    r: preserved,
  });
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
  // Fields the form can't edit, carried from an imported file to the
  // saved one (fix round 1) — empty on a fresh draft.
  const [preserved, setPreserved] =
    useState<PreservedFields>(EMPTY_PRESERVED);
  const [importText, setImportText] = useState("");
  const [importFileName, setImportFileName] = useState<string | null>(
    null,
  );
  const [notice, setNotice] = useState<Notice | null>(null);
  // Task 11 (Review Focus 5): the "PHYLIP labs" sheet and the lab
  // whose load is waiting on the unsaved-work question.
  const [labSheet, setLabSheet] = useState(false);
  const [pendingLab, setPendingLab] = useState<LabSummary | null>(null);
  // The clean-draft baseline: mount state, updated after every
  // accepted load and every successful save (see draftSnapshot).
  const baseline = useRef(
    draftSnapshot(
      model.tree,
      DEFAULT_SETTINGS,
      [],
      undefined,
      EMPTY_PRESERVED,
    ),
  );

  // One handshake listener per open preview tab — pruned as tabs
  // close, all disarmed when the panel unmounts (fix round 3).
  const previewTabs = useRef<{ win: Window; disarm: () => void }[]>([]);
  useEffect(
    () => () => {
      for (const t of previewTabs.current) t.disarm();
      previewTabs.current = [];
    },
    [],
  );

  const problems = settingsProblems(settings);
  const canSave = !problems.some((p) => p.level === "error");
  const buildState = () =>
    buildExerciseState(tree, settings, prompts, fileExtras, preserved);

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
    // The saved file now holds this draft — nothing is unsaved.
    baseline.current = draftSnapshot(
      tree,
      settings,
      prompts,
      fileExtras,
      preserved,
    );
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
    // Any size, unsaved draft: save-validate first (the same gate the
    // Share button faces), then send the reloaded exercise over
    // postMessage — never a length-limited link (fix round 3).
    const saved = saveExercise(buildState());
    if ("error" in saved) {
      setNotice({ level: "error", text: `No preview — ${saved.error}.` });
      return;
    }
    const loaded = engine.loadExercise(saved.json);
    if (!loaded.ok) {
      setNotice({
        level: "error",
        text: "No preview — the exercise could not be reloaded.",
      });
      return;
    }
    const nonce = previewNonce();
    const win = window.open(previewUrl(nonce), "_blank");
    if (win === null) {
      setNotice({
        level: "error",
        text: "The browser blocked the preview tab — allow popups for this site and press Preview again.",
      });
      return;
    }
    previewTabs.current = previewTabs.current.filter((t) => !t.win.closed);
    previewTabs.current.push({
      win,
      disarm: answerPreviewRequests({
        win,
        nonce,
        exercise: loaded.value,
      }),
    });
    setNotice({
      level: "status",
      text: "Preview opened in a new tab — exactly what a student sees.",
    });
  };

  // Shared by file/link import and the lab sheet's "Load this lab":
  // convert the loaded file's exercise into settings, replace the
  // tree through the model (the engine's editable-tree gate applies
  // like any edit), then make the loaded state the clean baseline.
  const applyLoaded = (
    state: ExerciseState,
    verb: "imported" | "loaded",
    done: string,
  ): boolean => {
    const ex = state.exercise;
    const conv = settingsFromExercise(ex, state.fileExtras);
    if ("error" in conv) {
      setNotice({ level: "error", text: `Not ${verb} — ${conv.error}` });
      return false;
    }
    // The engine already validated the file; the tree still has to
    // satisfy the editor's editable-tree rules (a unary node or a
    // missing length is refused the same way as a Newick edit).
    const exTree = ex.data.kind === "simulated" ? ex.data.true_tree : "";
    const parsed = engine.parseNewick(exTree);
    if (!parsed.ok) {
      setNotice({
        level: "error",
        text: `Not ${verb} — the exercise's true tree did not parse.`,
      });
      return false;
    }
    const replaced = model.replace(parsed.value);
    if (!replaced.ok) {
      const m = errorMessage(replaced.error);
      setNotice({
        level: "error",
        text: `Not ${verb} — ${m.title}: ${m.body}`,
      });
      return false;
    }
    setSettings(conv.settings);
    setPrompts(conv.prompts);
    setFileExtras(state.fileExtras);
    setPreserved(conv.preserved);
    baseline.current = draftSnapshot(
      parsed.value,
      conv.settings,
      conv.prompts,
      state.fileExtras,
      conv.preserved,
    );
    setNotice({ level: "status", text: done });
    return true;
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
    if (
      applyLoaded(
        r.value,
        "imported",
        `Imported “${r.value.exercise.title}” — the tree, settings and prompts are loaded.`,
      )
    ) {
      setImportText("");
    }
  };

  // Review Focus 5: "load this lab" replaces the whole draft, so a
  // draft that differs from the baseline asks first — declining keeps
  // the exact tree and settings, accepting runs the same load path a
  // file import does and makes the lab the new baseline.
  const onPickLab = (lab: LabSummary) => {
    const dirty =
      baseline.current !==
      draftSnapshot(tree, settings, prompts, fileExtras, preserved);
    if (dirty) {
      setPendingLab(lab);
    } else {
      doLoadLab(lab.id);
    }
  };

  const doLoadLab = (id: string) => {
    const r = loadLab(id);
    if (!r.ok) {
      const m = errorMessage(r.error);
      setNotice({
        level: "error",
        text: `Not loaded — ${m.title}: ${m.body}`,
      });
      return;
    }
    const imp = importExercise(r.value.text);
    if (!imp.ok) {
      const m = errorMessage(imp.error);
      setNotice({
        level: "error",
        text: `Not loaded — ${m.title}: ${m.body}`,
      });
      return;
    }
    if (
      applyLoaded(
        imp.value,
        "loaded",
        `Loaded lab “${r.value.lab.title}” — the tree, settings and prompts are loaded.`,
      )
    ) {
      setLabSheet(false);
      setPendingLab(null);
    }
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
        <button
          type="button"
          aria-haspopup="dialog"
          onClick={() => {
            setPendingLab(null);
            setLabSheet(true);
          }}
        >
          PHYLIP labs
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
        {/* The visible control is a token-styled button labelling a
          * visually hidden input — the browser's unstyled file widget
          * never renders, while the input keeps its accessible name,
          * its tab stop and the file dialog it opens (fix round 1). */}
        <span className="import-file">
          <input
            type="file"
            id="editor-import-file"
            className="import-file-input"
            accept=".json,application/json"
            aria-label="Import an exercise file"
            onChange={onImportFile}
          />
          <label htmlFor="editor-import-file" className="import-file-btn">
            Import file…
          </label>
          {importFileName !== null && (
            <span className="import-file-name">{importFileName}</span>
          )}
        </span>
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
        {preservedFieldNames(preserved).length > 0 && (
          <p className="editor-hint">
            Kept from the imported file (not editable here):{" "}
            {preservedFieldNames(preserved).join(", ")}
          </p>
        )}
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
          <NewickView
            model={model}
            labelledBy="editor-sheet-newick-title"
          />
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
          <BranchTable
            model={model}
            labelledBy="editor-sheet-table-title"
          />
        </Sheet>
      )}
      {labSheet && (
        <Sheet
          className="editor-sheet lab-picker"
          labelledBy="lab-picker-title"
          onClose={() => {
            setLabSheet(false);
            setPendingLab(null);
          }}
        >
          <header className="editor-sheet-head">
            <h2 id="lab-picker-title">PHYLIP labs</h2>
            <button
              type="button"
              className="close"
              aria-label="Close the PHYLIP labs list"
              onClick={() => {
                setLabSheet(false);
                setPendingLab(null);
              }}
            >
              ×
            </button>
          </header>
          {pendingLab !== null ? (
            <div className="lab-confirm">
              <h3>Replace your unsaved work?</h3>
              <p>
                Loading “{pendingLab.title}” replaces the exercise in
                the editor — your unsaved changes will be lost.
              </p>
              <div className="lab-confirm-actions">
                <button
                  type="button"
                  onClick={() => doLoadLab(pendingLab.id)}
                >
                  Replace my work
                </button>
                <button
                  type="button"
                  onClick={() => setPendingLab(null)}
                >
                  Keep my work
                </button>
              </div>
            </div>
          ) : (
            <LabPickList labs={listLabs()} onLoadLab={onPickLab} />
          )}
        </Sheet>
      )}
    </section>
  );
}
