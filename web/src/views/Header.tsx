// App header (v1.3 spec §6.3): the skip link, wordmark, lesson title,
// the link-restore toast, the Lesson|Sandbox mode switch, the Lessons
// menu, "Coming from PHYLIP?", the theme toggle and the presenter
// toggle. Task 10: a "Skip to content" link is the page's first
// focusable element; below 1280 px the Settings button opens the
// controls drawer (§6.4); below 1024 px "Coming from PHYLIP?",
// Licenses, Source code and Help live in the More menu (§6.3).
// Task 11 (§6.6): presenter mode hides the Settings button — the
// controls are unreachable by design — while the two toggles stay.
// Task 12 round 3 (§6.7, owner decision B, 2026-10-24): "Take the
// tour" reopens from the Lessons menu's last item at ≥ 1280, from the
// Settings drawer at 1024–1279 and from the More menu below 1024 —
// one reopen path per width, and the header itself is back to main's.

import type { Dispatch } from "react";

import type { Breakpoint } from "../design/breakpoints";
import type { ThemeName } from "../design/tokens";
import type { Action, Session } from "../state/session";

import { LessonsMenu } from "./LessonsMenu";
import { MoreMenu } from "./MoreMenu";
import { PresenterToggle } from "./PresenterToggle";
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
  /** Presenter mode flag (§6.6): scales the app 1.5× and hides the
   * controls column and the drawer button. */
  presenter: boolean;
  dispatch: Dispatch<Action>;
  /** The live breakpoint (spec §6.1) — decides which secondary
   * controls the header shows directly vs inside the drawer/menu. */
  breakpoint: Breakpoint;
  /** Settings drawer open flag (§6.4) for the button's aria-expanded. */
  drawerOpen: boolean;
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
  presenter,
  dispatch,
  breakpoint,
  drawerOpen,
}: HeaderProps) {
  const belowWide = breakpoint !== "wide";
  const belowMedium = breakpoint === "narrow" || breakpoint === "compact";
  return (
    <header className="app-header">
      <a
        className="skip-link"
        href="#main-content"
        onClick={() =>
          // Fragment navigation alone scrolls the target but leaves
          // focus on the link — move focus explicitly (§6.10).
          document.getElementById("main-content")?.focus()
        }
      >
        Skip to content
      </a>
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
      {/* §6.7 (owner decision B, Task 12 round 3): the tour's ≥ 1280
          reopen path is the Lessons menu's last item — a header button
          here wrapped the row to two lines at 1280 on the longer
          lesson titles (round 2). Below 1280 the Settings drawer and
          the More menu own the item instead. */}
      <LessonsMenu
        currentId={currentLessonId}
        onPick={onPickLesson}
        onTakeTour={
          belowWide ? undefined : () => dispatch({ type: "tourStart" })
        }
      />
      {belowWide && !presenter && (
        <button
          type="button"
          className="drawer-toggle"
          aria-expanded={drawerOpen}
          aria-controls="settings-drawer"
          onClick={() =>
            dispatch({ type: "setDrawer", open: !drawerOpen })
          }
        >
          Settings
        </button>
      )}
      {!belowMedium && (
        <button
          type="button"
          className="phylip-help-open"
          onClick={onOpenPhylipHelp}
        >
          Coming from PHYLIP?
        </button>
      )}
      {belowMedium && (
        <MoreMenu
          onOpenPhylipHelp={onOpenPhylipHelp}
          onTakeTour={() => dispatch({ type: "tourStart" })}
        />
      )}
      {/* The toggles come last in DOM order: the presenter switch hides
          the Settings button, so nothing it can remove sits after it
          (the header-controls layout test clicks every button in
          order). */}
      <div className="header-toggles">
        <ThemeToggle theme={theme} dispatch={dispatch} />
        <PresenterToggle presenter={presenter} dispatch={dispatch} />
      </div>
    </header>
  );
}
