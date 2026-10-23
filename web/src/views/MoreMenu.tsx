// "More" header menu (v1.3 plan Task 10, spec §6.3): below 1024 px the
// items that leave the header and footer — "Coming from PHYLIP?",
// Licenses, Source code and Help — move behind this menu-button.
// Same keyboard contract as the Lessons menu (the ARIA menu-button
// pattern): Enter, Space or ArrowDown opens on the first item,
// ArrowUp opens on the last; arrows rove, Home/End jump, Esc closes
// and returns focus to the button, Tab closes without it.

import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

import { REPO_URL } from "../config";

export interface MoreMenuProps {
  /** Opens the "Coming from PHYLIP?" dialog. */
  onOpenPhylipHelp: () => void;
}

interface Item {
  label: string;
  /** Link items navigate; an item without `href` runs `action`. */
  href?: string;
  action?: () => void;
}

export function MoreMenu({ onOpenPhylipHelp }: MoreMenuProps) {
  const ITEMS: Item[] = [
    { label: "Coming from PHYLIP?", action: onOpenPhylipHelp },
    {
      label: "Licenses",
      href: `${import.meta.env.BASE_URL}licenses.html`,
    },
    { label: "Source code", href: REPO_URL },
    // No in-app help page exists (§6.3); the project's published docs
    // are the README — Task 12's "Take the tour" joins this menu.
    { label: "Help", href: `${REPO_URL}#readme` },
  ];

  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLElement | null)[]>([]);

  const openAt = (index: number) => {
    setActive(index);
    setOpen(true);
  };

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
          openAt(0);
        }
        break;
      case "ArrowUp":
        e.preventDefault();
        openAt(ITEMS.length - 1);
        break;
      default:
        break;
    }
  };

  const onMenuKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActive((a) => (a + 1) % ITEMS.length);
        break;
      case "ArrowUp":
        e.preventDefault();
        setActive((a) => (a - 1 + ITEMS.length) % ITEMS.length);
        break;
      case "Home":
        e.preventDefault();
        setActive(0);
        break;
      case "End":
        e.preventDefault();
        setActive(ITEMS.length - 1);
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

  const itemProps = (i: number) => ({
    role: "menuitem" as const,
    tabIndex: -1,
    ref: (el: HTMLElement | null) => {
      itemRefs.current[i] = el;
    },
  });

  return (
    <div className="more-menu" ref={rootRef}>
      <button
        type="button"
        ref={buttonRef}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? closeMenu(false) : openAt(0))}
        onKeyDown={onButtonKeyDown}
      >
        More
      </button>
      {open && (
        <div
          className="more-menu-list"
          role="menu"
          aria-label="More"
          onKeyDown={onMenuKeyDown}
        >
          {ITEMS.map((item, i) =>
            item.href !== undefined ? (
              <a
                key={item.label}
                {...itemProps(i)}
                href={item.href}
                onClick={() => closeMenu(false)}
              >
                {item.label}
              </a>
            ) : (
              <button
                key={item.label}
                type="button"
                {...itemProps(i)}
                onClick={() => {
                  closeMenu(true);
                  item.action?.();
                }}
              >
                {item.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
