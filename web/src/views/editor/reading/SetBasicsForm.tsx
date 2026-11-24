// The reading-set editor's top block (v1.4d plan Task 10): the
// save/share/preview/import action row, the notice it raises (a
// status line, an error, or the share-link field), the set-level
// InvalidReading, and the set's own fields — id, title, mode,
// summary. The trees and items have their own sections below the
// draw canvas.

import type { ChangeEvent } from "react";

import type { ReadingMode } from "../../../engine/generated/ReadingMode";

import type { ReadingDraft } from "./readingDraft";

export interface SetBasicsFormProps {
  draft: ReadingDraft;
  onDraft: (patch: Partial<ReadingDraft>) => void;
  /** Whether the set currently loads — gates Save/Share/Preview. */
  canAct: boolean;
  onSave: () => void;
  onShare: () => void;
  onPreview: () => void;
  importText: string;
  onImportText: (text: string) => void;
  onImport: () => void;
  importFileName: string | null;
  onImportFile: (e: ChangeEvent<HTMLInputElement>) => void;
  /** The action row's last message; `url` adds the copyable field. */
  notice: { level: "error" | "status" | "link"; text: string; url?: string } | null;
  /** A set-level refusal the engine reported (not an item's). */
  globalError: string | null;
}

export function SetBasicsForm({
  draft,
  onDraft,
  canAct,
  onSave,
  onShare,
  onPreview,
  importText,
  onImportText,
  onImport,
  importFileName,
  onImportFile,
  notice,
  globalError,
}: SetBasicsFormProps) {
  return (
    <>
      <div className="editor-actions">
        <button
          type="button"
          className="btn btn-primary"
          onClick={onSave}
          disabled={!canAct}
        >
          Save file
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={onShare}
          disabled={!canAct}
        >
          Share link
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={onPreview}
          disabled={!canAct}
        >
          Preview
        </button>
        <label className="field import-field">
          <span>Import a file or #r= link</span>
          <input
            type="text"
            value={importText}
            placeholder="{…} or https://…#r=…"
            onChange={(e) => onImportText(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={onImport}
          disabled={importText.trim() === ""}
        >
          Import text
        </button>
        {/* The visible control is a token-styled label for a visually
          * hidden input — same pattern as the exercise editor's Import
          * file button (keeps the accessible name and the dialog). */}
        <span className="import-file">
          <input
            type="file"
            id="reading-import-file"
            className="import-file-input"
            accept=".json,application/json"
            aria-label="Import a reading-set file"
            onChange={onImportFile}
          />
          <label
            htmlFor="reading-import-file"
            className="import-file-btn btn btn-secondary"
          >
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
      {globalError !== null && (
        <p role="alert" className="editor-error">
          {globalError}
        </p>
      )}
      <section className="editor-section" aria-labelledby="rde-set-title">
        <h2 id="rde-set-title">Set</h2>
        <div className="rde-item-row">
          <label className="field">
            <span>Set id</span>
            <input
              type="text"
              value={draft.id}
              onChange={(e) => onDraft({ id: e.target.value })}
            />
          </label>
          <label className="field">
            <span>Set title</span>
            <input
              type="text"
              value={draft.title}
              onChange={(e) => onDraft({ title: e.target.value })}
            />
          </label>
          <label className="field">
            <span>Mode</span>
            <select
              value={draft.mode}
              onChange={(e) =>
                onDraft({ mode: e.target.value as ReadingMode })
              }
            >
              <option value="practice">practice</option>
              <option value="test">test</option>
            </select>
          </label>
        </div>
        <label className="field">
          <span>Summary</span>
          <textarea
            rows={2}
            value={draft.summary}
            onChange={(e) => onDraft({ summary: e.target.value })}
          />
        </label>
      </section>
    </>
  );
}
