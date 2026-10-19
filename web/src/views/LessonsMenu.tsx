// "Lessons" header menu (checkpoint 13): a menu-button that lists every
// built-in lesson in teaching order (src/lessons/catalog.ts) with its
// title and one-line summary. Picking one calls `onPick`, which loads
// the lesson and points the URL at ?lesson=<id>. The current lesson —
// when the session was loaded as a built-in — is marked.
//
// Keyboard (ARIA menu-button pattern): Enter, Space or ArrowDown opens
// the menu and focuses the current lesson's item (the first when none
// is marked); ArrowUp opens on the last item. Arrow keys cycle through
// the items, Home/End jump to the ends, Escape closes and returns focus
// to the button, and Tab closes without moving focus back.

import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

import { LESSONS } from "../lessons/catalog";

export interface LessonsMenuProps {
  /** The built-in lesson currently loaded, or null for a custom
   * exercise (a `#x=` link or a prop-driven test exercise). */
  currentId: string | null;
  /** Load the lesson with this id. */
  onPick: (id: string) => void;
}

export function LessonsMenu({ currentId, onPick }: LessonsMenuProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const openAt = (index: number) => {
    setActive(index);
    setOpen(true);
  };

  const openMenu = () =>
    openAt(
      Math.max(
        0,
        LESSONS.findIndex((l) => l.id === currentId),
      ),
    );

  const closeMenu = (backToButton: boolean) => {
    setOpen(false);
    if (backToButton) buttonRef.current?.focus();
  };

  // Move DOM focus to the active item once the menu is open.
  useEffect(() => {
    if (open) itemRefs.current[active]?.focus();
  }, [open, active]);

  // Clicking outside the menu closes it (focus stays where it went).
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const onButtonKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    switch (e.key) {
      case "Enter":
      case " ":
      case "ArrowDown":
        e.preventDefault();
        if (open) {
          closeMenu(true);
        } else {
          openMenu();
        }
        break;
      case "ArrowUp":
        e.preventDefault();
        openAt(LESSONS.length - 1);
        break;
      default:
        break;
    }
  };

  const onMenuKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActive((a) => (a + 1) % LESSONS.length);
        break;
      case "ArrowUp":
        e.preventDefault();
        setActive((a) => (a - 1 + LESSONS.length) % LESSONS.length);
        break;
      case "Home":
        e.preventDefault();
        setActive(0);
        break;
      case "End":
        e.preventDefault();
        setActive(LESSONS.length - 1);
        break;
      case "Escape":
        e.preventDefault();
        closeMenu(true);
        break;
      case "Tab":
        setOpen(false);
        break;
      default:
        break;
    }
  };

  return (
    <div className="lessons-menu" ref={rootRef}>
      <button
        type="button"
        ref={buttonRef}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? closeMenu(false) : openMenu())}
        onKeyDown={onButtonKeyDown}
      >
        Lessons
      </button>
      {open && (
        <div className="lessons-menu-list" role="menu" aria-label="Lessons" onKeyDown={onMenuKeyDown}>
          {LESSONS.map((l, i) => (
            <button
              key={l.id}
              type="button"
              role="menuitemradio"
              aria-checked={l.id === currentId}
              tabIndex={-1}
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
              onClick={() => {
                closeMenu(true);
                onPick(l.id);
              }}
            >
              <span className="lessons-menu-title">{l.title}</span>
              <span className="lessons-menu-summary">{l.summary}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
