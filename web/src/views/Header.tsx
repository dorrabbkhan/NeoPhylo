// App header (v1.3 spec §6.3): the lesson title, the link-restore
// toast, the Lesson|Sandbox mode switch, the Lessons menu, "Coming
// from PHYLIP?" and the theme toggle. Task 8 adds the wordmark; Task
// 10 adds the skip link and moves secondary items into a More menu
// below 1024 px; Task 11 adds the presenter toggle.

import type { Dispatch } from "react";

import type { ThemeName } from "../design/tokens";
import type { Action, Session } from "../state/session";

import { LessonsMenu } from "./LessonsMenu";
import { ThemeToggle } from "./ThemeToggle";
import { Wordmark } from "./Wordmark";

export interface HeaderProps {
  title: string;
  /** Link-restore toast text; null hides it. */
  toast: string | null;
  /** Lesson|Sandbox — which side of the mode switch is checked. */
  source: Session["source"];
  onSelectMode: (mode: Session["source"]) => void;
  /** The loaded lesson's id, or null on a custom/sandbox exercise. */
  currentLessonId: string | null;
  onPickLesson: (id: string) => void;
  onOpenPhylipHelp: () => void;
  theme: ThemeName;
  dispatch: Dispatch<Action>;
}

export function Header({
  title,
  toast,
  source,
  onSelectMode,
  currentLessonId,
  onPickLesson,
  onOpenPhylipHelp,
  theme,
  dispatch,
}: HeaderProps) {
  return (
    <header className="app-header">
      <Wordmark />
      <h1>{title}</h1>
      {toast !== null && (
        <p role="status" className="toast">
          {toast}
        </p>
      )}
      <div className="mode-switch" role="radiogroup" aria-label="Mode">
        <button
          type="button"
          role="radio"
          aria-checked={source === "lesson"}
          onClick={() => onSelectMode("lesson")}
        >
          Lesson
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={source === "sandbox"}
          onClick={() => onSelectMode("sandbox")}
        >
          Sandbox
        </button>
      </div>
      <LessonsMenu currentId={currentLessonId} onPick={onPickLesson} />
      <button
        type="button"
        className="phylip-help-open"
        onClick={onOpenPhylipHelp}
      >
        Coming from PHYLIP?
      </button>
      <ThemeToggle theme={theme} dispatch={dispatch} />
    </header>
  );
}
