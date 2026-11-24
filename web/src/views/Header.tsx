// App header (v1.5 Task 2, spec §16.2–§16.3 — mockup style B + mode
// variant R1): wordmark · current title · the icon tray · the Lesson |
// Sandbox pill at the right end. Tray items are icon-only at rest —
// the label stays in the DOM and expands on hover/focus — and the
// current page's item keeps its label and an accent tint.
//
// Breakpoints (spec §16.2):
//   wide   ≥1280  Lessons, Library, Labs, Reading trees, Guides, then
//                 the view controls — no More menu, no Settings button
//                 (the controls column is on screen).
//   medium 1024–1279  Library stays a direct pick; Labs, Reading trees
//                 and the two guides move into a compact More menu —
//                 every destination keeps today's activation count
//                 (conductor's call, recorded in docs/decisions.md).
//                 Settings and the tour keep their drawer homes.
//   narrow  768–1023  the More menu carries the same nine secondary
//                 items as today; Settings stays a direct button.
//   compact <768   wordmark, title and one Menu button — the
//                 PhoneMenuSheet holds everything, mode switch
//                 included (§16.3, mockup M2).
//
// Preserved contracts (v1.3–v1.4d): the skip link is the page's first
// focusable element; "Take the tour" reopens from the Lessons menu's
// last item at ≥1280, the Settings drawer at 1024–1279 and below that
// the phone sheet's tile (§6.7 owner decision B); presenter mode hides
// the Settings entry; the header toggles park above content sheets'
// scrim; the Reading trees link routes a plain click through
// onOpenReading so the unsaved-work question still runs.

import { useState } from "react";
import type { Dispatch } from "react";

import type { Breakpoint } from "../design/breakpoints";
import type { ThemeName } from "../design/tokens";
import type { Action, Session } from "../state/session";

import { LessonsMenu } from "./LessonsMenu";
import { GuidesMenu, MoreMenu } from "./MoreMenu";
import { PresenterToggle } from "./PresenterToggle";
import { ThemeToggle } from "./ThemeToggle";
import { Wordmark } from "./Wordmark";
import { NavItem } from "./nav/NavItem";
import { NavDivider, NavTray } from "./nav/NavTray";
import { PhoneMenuSheet } from "./nav/PhoneMenuSheet";

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
  /** Opens the "Coming from MEGA?" guide (v1.4b Task 12). */
  onOpenMegaHelp: () => void;
  /** Navigates to the library (v1.4c Task 12, spec §7.1) — the caller
   * owns the unsaved-work question, so this is an action, not a link. */
  onOpenLibrary?: () => void;
  /** Navigates to the library's Tree reading filter (v1.4d Task 9,
   * spec §7.1) — an action like onOpenLibrary for the same unsaved-
   * work question; the menus carry it at every width. */
  onOpenReading?: () => void;
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
  onOpenMegaHelp,
  onOpenLibrary,
  onOpenReading,
  theme,
  presenter,
  dispatch,
  breakpoint,
  drawerOpen,
}: HeaderProps) {
  const wide = breakpoint === "wide";
  const medium = breakpoint === "medium";
  const narrow = breakpoint === "narrow";
  const compact = breakpoint === "compact";
  const belowWide = !wide;
  const [phoneMenu, setPhoneMenu] = useState(false);
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
      {/* The title truncates with an ellipsis when it's the header's
          only shrinkable item (index.css) — the attribute keeps the
          full text on hover, and the accessible name stays the full
          title either way (v1.3 fixes, owner decision). */}
      <h1 title={title}>{title}</h1>
      {toast !== null && (
        <p role="status" className="toast">
          {toast}
        </p>
      )}
      {compact ? (
        <>
          {/* §16.3 + mockup M2: the phone header is only wordmark,
              title and Menu — the Lesson | Sandbox switch lives in
              the sheet as a row like Dark mode. The Menu button is a
              nav-item (icon + clipped label) so its name and 44 px
              target match the rest of the header. The cluster's auto
              margin pushes it right. */}
          <div className="nav-cluster">
            <NavItem
              icon={phoneMenu ? "close" : "menu"}
              label="Menu"
              className="nav-menu-button"
              hasPopup="dialog"
              expanded={phoneMenu}
              onActivate={() => setPhoneMenu((v) => !v)}
            />
          </div>
          <PhoneMenuSheet
            open={phoneMenu}
            onClose={() => setPhoneMenu(false)}
            currentLessonId={currentLessonId}
            onPickLesson={onPickLesson}
            onOpenPhylipHelp={onOpenPhylipHelp}
            onOpenMegaHelp={onOpenMegaHelp}
            onOpenLibrary={onOpenLibrary}
            onOpenReading={onOpenReading}
            source={source}
            onSelectMode={onSelectMode}
            theme={theme}
            presenter={presenter}
            dispatch={dispatch}
          />
        </>
      ) : (
        <>
          {/* Tray + pill ride in one right-aligned cluster so a
              wrap (narrow, long title, the pinned current label)
              lands them on row two together instead of scattering. */}
          <div className="nav-cluster">
            <NavTray>
            {/* §6.7 (owner decision B): the tour's ≥1280 reopen path is
                the Lessons menu's last item; below that the drawer and
                the phone sheet's tile own it. */}
            <LessonsMenu
              currentId={currentLessonId}
              onPick={onPickLesson}
              onOpenLibrary={onOpenLibrary}
              onOpenReading={onOpenReading}
              onTakeTour={
                belowWide ? undefined : () => dispatch({ type: "tourStart" })
              }
            />
            {/* §16.2 overflow: Library keeps its direct pick at medium
                (the umbrella page for labs + reading); Labs, Reading
                trees and the guides move to the compact More there. */}
            {!narrow && onOpenLibrary !== undefined && (
              <NavItem
                icon="library"
                label="Library"
                onActivate={onOpenLibrary}
              />
            )}
            {wide && (
              <NavItem
                icon="labs"
                label="Labs"
                href="?labs"
                className="labs-link"
              />
            )}
            {/* The reading area's header entry (v1.4d Task 9, §7.1): a
                link to the library's Tree reading filter. A plain
                primary click routes through onOpenReading so the
                unsaved-work question runs exactly like the menus';
                the href stays for modified clicks (open in a new tab). */}
            {wide && (
              <NavItem
                icon="reading"
                label="Reading trees"
                href="?library&type=reading"
                className="reading-link"
                onClick={(event) => {
                  if (
                    onOpenReading !== undefined &&
                    event.button === 0 &&
                    !event.metaKey &&
                    !event.ctrlKey &&
                    !event.shiftKey &&
                    !event.altKey
                  ) {
                    event.preventDefault();
                    onOpenReading();
                  }
                }}
              />
            )}
            {wide && (
              <GuidesMenu
                onOpenPhylipHelp={onOpenPhylipHelp}
                onOpenMegaHelp={onOpenMegaHelp}
              />
            )}
            {(medium || narrow) && (
              <MoreMenu
                variant={narrow ? "narrow" : "medium"}
                onOpenPhylipHelp={onOpenPhylipHelp}
                onOpenMegaHelp={onOpenMegaHelp}
                onOpenLibrary={onOpenLibrary}
                onOpenReading={onOpenReading}
                onTakeTour={() => dispatch({ type: "tourStart" })}
              />
            )}
            <NavDivider />
            {/* The toggles come last in the destination group: the
                presenter switch hides the Settings item, so nothing it
                can remove sits after it (the header-controls layout
                test clicks every control in order). */}
            <div className="header-toggles">
              <ThemeToggle theme={theme} dispatch={dispatch} />
              <PresenterToggle presenter={presenter} dispatch={dispatch} />
            </div>
            {belowWide && !presenter && (
              <NavItem
                icon="settings"
                label="Settings"
                className="drawer-toggle"
                expanded={drawerOpen}
                controls="settings-drawer"
                onActivate={() =>
                  dispatch({ type: "setDrawer", open: !drawerOpen })
                }
              />
            )}
          </NavTray>
            {/* R1: today's quiet Lesson|Sandbox pill moved to the right
                end of the header — same radiogroup semantics. */}
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
          </div>
        </>
      )}
    </header>
  );
}
