// The phone menu sheet (v1.5 Task 2, spec §16.3 — mockup M1): below
// 768 px the header is wordmark + title + the mode pill + one Menu
// button, and this sheet carries every destination and action the
// phone header and the More menu offered (the Lessons list, the two
// guides, Labs, Library, Reading trees, Settings, the tour,
// Licenses, Source code and Help) plus the Dark/Presenter toggles.
// The mode pill stays in the header (M1) — no Mode row here.
//
// Modal contract: focus moves in on open, Tab cycles inside, Escape
// or the ✕ button closes and the Sheet puts focus back on the Menu
// button. A destination/action tile activates and closes; the
// Lessons and Guides tiles swap to in-sheet lists (a Back control
// returns to the tiles — picking a lesson is Menu → Lessons →
// lesson). The theme and presenter rows are controls, not tiles:
// they switch in place and the sheet stays open.

import { useEffect, useRef, useState } from "react";
import type { Dispatch } from "react";

import { REPO_URL } from "../../config";
import type { ThemeName } from "../../design/tokens";
import { LESSONS } from "../../lessons/catalog";
import type { Action } from "../../state/session";
import { Sheet } from "../Sheet";

import { Icon } from "./Icon";
import type { IconName } from "./Icon";

export interface PhoneMenuSheetProps {
  open: boolean;
  onClose: () => void;
  /** The loaded built-in lesson's id, or null on a custom exercise. */
  currentLessonId: string | null;
  onPickLesson: (id: string) => void;
  onOpenPhylipHelp: () => void;
  onOpenMegaHelp: () => void;
  onOpenLibrary?: () => void;
  onOpenReading?: () => void;
  theme: ThemeName;
  presenter: boolean;
  dispatch: Dispatch<Action>;
}

type View = "tiles" | "lessons" | "guides";

/** One big labelled tile in the grid — a link, an action, or the
 * switch into a sub-list. */
function Tile({
  icon,
  label,
  href,
  onClick,
  current = false,
}: {
  icon: IconName;
  label: string;
  href?: string;
  onClick?: () => void;
  current?: boolean;
}) {
  const cls = `phone-sheet-tile${current ? " phone-sheet-current" : ""}`;
  const inner = (
    <>
      <Icon name={icon} className="phone-sheet-icon" />
      <span>{label}</span>
    </>
  );
  if (href !== undefined) {
    return (
      <a className={cls} href={href} onClick={onClick}>
        {inner}
      </a>
    );
  }
  return (
    <button
      type="button"
      className={cls}
      aria-current={current ? "page" : undefined}
      onClick={onClick}
    >
      {inner}
    </button>
  );
}

/** A full-width row holding a label and a two-option radiogroup — the
 * mode switch and the two toggles share it (mockup M2). */
function SegRow({
  label,
  options,
  checked,
  onPick,
}: {
  label: string;
  options: readonly [string, string];
  /** 0 → the first option is on, 1 → the second. */
  checked: 0 | 1;
  onPick: (index: 0 | 1) => void;
}) {
  return (
    <div className="phone-sheet-row">
      <span>{label}</span>
      <div className="mode-switch" role="radiogroup" aria-label={label}>
        {options.map((text, i) => (
          <button
            key={text}
            type="button"
            role="radio"
            aria-checked={checked === i}
            onClick={() => onPick(i as 0 | 1)}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

export function PhoneMenuSheet(props: PhoneMenuSheetProps) {
  // Closed: nothing renders (and Body's view state resets on the next
  // open — a fresh mount always starts on the tile grid).
  if (!props.open) return null;
  return <Body {...props} />;
}

/** The sheet's content — mounts only while open, so its Lessons/
 * Guides sub-view always begins on the tile grid. */
function Body({
  onClose,
  currentLessonId,
  onPickLesson,
  onOpenPhylipHelp,
  onOpenMegaHelp,
  onOpenLibrary,
  onOpenReading,
  theme,
  presenter,
  dispatch,
}: PhoneMenuSheetProps) {
  const [view, setView] = useState<View>("tiles");
  const backRef = useRef<HTMLButtonElement>(null);
  const dark = theme === "dark";

  // Entering a sub-list drops the tile that had focus — land on its
  // Back control so keyboard focus stays inside the sheet.
  useEffect(() => {
    if (view !== "tiles") backRef.current?.focus();
  }, [view]);

  const activate = (action: () => void) => () => {
    onClose();
    action();
  };

  return (
    <Sheet
      className="phone-sheet"
      labelledBy="phone-menu-title"
      onClose={onClose}
    >
      <header className="phone-sheet-head">
        {view === "tiles" ? (
          <span className="phone-sheet-spacer" />
        ) : (
          <button
            type="button"
            className="phone-sheet-back"
            ref={backRef}
            onClick={() => setView("tiles")}
          >
            <Icon name="back" className="phone-sheet-icon" />
            Back
          </button>
        )}
        <h2 id="phone-menu-title">
          {view === "lessons" ? "Lessons" : view === "guides" ? "Guides" : "Menu"}
        </h2>
        <button
          type="button"
          className="phone-sheet-close"
          aria-label="Close menu"
          onClick={onClose}
        >
          <Icon name="close" className="phone-sheet-icon" />
        </button>
      </header>

      {view === "tiles" && (
        <div className="phone-sheet-body">
          <div className="phone-sheet-tiles">
            <Tile
              icon="lessons"
              label="Lessons"
              current={currentLessonId !== null}
              onClick={() => setView("lessons")}
            />
            <Tile
              icon="guides"
              label="Guides"
              onClick={() => setView("guides")}
            />
            {onOpenLibrary !== undefined && (
              <Tile
                icon="library"
                label="Library"
                onClick={activate(onOpenLibrary)}
              />
            )}
            <Tile icon="labs" label="Labs" href="?labs" />
            {onOpenReading !== undefined && (
              <Tile
                icon="reading"
                label="Reading trees"
                onClick={activate(onOpenReading)}
              />
            )}
            {!presenter && (
              <Tile
                icon="settings"
                label="Settings"
                onClick={activate(() =>
                  dispatch({ type: "setDrawer", open: true }),
                )}
              />
            )}
            <Tile
              icon="tour"
              label="Take the tour"
              onClick={activate(() => dispatch({ type: "tourStart" }))}
            />
            <Tile
              icon="licenses"
              label="Licenses"
              href={`${import.meta.env.BASE_URL}licenses.html`}
            />
            <Tile icon="code" label="Source code" href={REPO_URL} />
            <Tile icon="help" label="Help" href={`${REPO_URL}#readme`} />
          </div>
          {/* No Mode row: mockup M1 keeps Lesson | Sandbox in the
              header at this width — the sheet must not duplicate the
              only mode-switch path. */}
          <SegRow
            label="Dark mode"
            options={["Off", "On"]}
            checked={dark ? 1 : 0}
            onPick={(i) =>
              dispatch({ type: "setTheme", theme: i === 1 ? "dark" : "light" })
            }
          />
          <SegRow
            label="Presenter mode"
            options={["Off", "On"]}
            checked={presenter ? 1 : 0}
            onPick={(i) =>
              dispatch({ type: "setPresenter", presenter: i === 1 })
            }
          />
        </div>
      )}

      {view === "lessons" && (
        <div className="phone-sheet-list" role="list">
          {LESSONS.map((l) => (
            <button
              key={l.id}
              type="button"
              className="phone-sheet-pick"
              aria-current={l.id === currentLessonId ? "page" : undefined}
              onClick={activate(() => onPickLesson(l.id))}
            >
              <span className="phone-sheet-pick-title">{l.title}</span>
              <span className="phone-sheet-pick-summary">{l.summary}</span>
            </button>
          ))}
          {/* The compact Lessons menu's action rows ride along — same
              destinations as the tiles above, kept for parity with the
              menu contents at this width. */}
          {onOpenLibrary !== undefined && (
            <button
              type="button"
              className="phone-sheet-pick"
              onClick={activate(onOpenLibrary)}
            >
              <span className="phone-sheet-pick-title">Library</span>
            </button>
          )}
          {onOpenReading !== undefined && (
            <button
              type="button"
              className="phone-sheet-pick"
              onClick={activate(onOpenReading)}
            >
              <span className="phone-sheet-pick-title">Reading trees</span>
            </button>
          )}
        </div>
      )}

      {view === "guides" && (
        <div className="phone-sheet-list" role="list">
          <button
            type="button"
            className="phone-sheet-pick"
            onClick={activate(onOpenPhylipHelp)}
          >
            <span className="phone-sheet-pick-title">
              Coming from PHYLIP?
            </span>
          </button>
          <button
            type="button"
            className="phone-sheet-pick"
            onClick={activate(onOpenMegaHelp)}
          >
            <span className="phone-sheet-pick-title">Coming from MEGA?</span>
          </button>
        </div>
      )}
    </Sheet>
  );
}
