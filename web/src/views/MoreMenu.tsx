// "More" header menu (v1.3 plan Task 10, spec §6.3): below 1024 px the
// items that leave the header and footer — the two "Coming from …?"
// guides, Labs, the tour, Licenses, Source code and Help — move behind
// this menu-button. Same keyboard contract as the Lessons menu (the
// ARIA menu-button pattern): Enter, Space or ArrowDown opens on the
// first item, ArrowUp opens on the last; arrows rove, Home/End jump,
// Esc closes and returns focus to the button, Tab closes without it.
//
// v1.4b Task 12 (owner decision, 2026-11-02): "Guides" is a second
// menu-button on the same pattern — one header button holding both
// guide items, shown at ≥1024 px where the bare "Coming from PHYLIP?"
// button used to sit. `MenuButton` is the shared implementation.

import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

import { REPO_URL } from "../config";

interface Item {
  label: string;
  /** Link items navigate; an item without `href` runs `action`. */
  href?: string;
  action?: () => void;
}

interface MenuButtonProps {
  /** The button text — also the menu's aria-label. */
  label: string;
  /** The root's class (".more-menu", ".guides-menu"); the list gets
   * "-list" appended. */
  className: string;
  items: Item[];
}

function MenuButton({ label, className, items }: MenuButtonProps) {
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
        openAt(items.length - 1);
        break;
      default:
        break;
    }
  };

  const onMenuKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActive((a) => (a + 1) % items.length);
        break;
      case "ArrowUp":
        e.preventDefault();
        setActive((a) => (a - 1 + items.length) % items.length);
        break;
      case "Home":
        e.preventDefault();
        setActive(0);
        break;
      case "End":
        e.preventDefault();
        setActive(items.length - 1);
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
    <div className={className} ref={rootRef}>
      <button
        type="button"
        ref={buttonRef}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? closeMenu(false) : openAt(0))}
        onKeyDown={onButtonKeyDown}
      >
        {label}
      </button>
      {open && (
        <div
          className={`${className}-list`}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKeyDown}
        >
          {items.map((item, i) =>
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

export interface MoreMenuProps {
  /** Opens the "Coming from PHYLIP?" guide. */
  onOpenPhylipHelp: () => void;
  /** Opens the "Coming from MEGA?" guide (v1.4b Task 12). */
  onOpenMegaHelp: () => void;
  /** Reopens the first-visit tour (spec §6.7). */
  onTakeTour: () => void;
}

export function MoreMenu({
  onOpenPhylipHelp,
  onOpenMegaHelp,
  onTakeTour,
}: MoreMenuProps) {
  return (
    <MenuButton
      label="More"
      className="more-menu"
      items={[
        { label: "Coming from PHYLIP?", action: onOpenPhylipHelp },
        { label: "Coming from MEGA?", action: onOpenMegaHelp },
        // §6.5 lab-index link (the owner's "Labs" rename, 2026-11-02):
        // the <1024 px path — the header link's mirror.
        { label: "Labs", href: "?labs" },
        // §6.7: the tour's only reopen path.
        { label: "Take the tour", action: onTakeTour },
        {
          label: "Licenses",
          href: `${import.meta.env.BASE_URL}licenses.html`,
        },
        { label: "Source code", href: REPO_URL },
        // No in-app help page exists (§6.3); the project's published
        // docs are the README.
        { label: "Help", href: `${REPO_URL}#readme` },
      ]}
    />
  );
}

export interface GuidesMenuProps {
  /** Opens the "Coming from PHYLIP?" guide. */
  onOpenPhylipHelp: () => void;
  /** Opens the "Coming from MEGA?" guide. */
  onOpenMegaHelp: () => void;
}

/** The header's "Guides" menu (v1.4b Task 12, owner decision
 * 2026-11-02): one button, the two guide items. Same keyboard and
 * styling contract as the More menu it shares MenuButton with. */
export function GuidesMenu({
  onOpenPhylipHelp,
  onOpenMegaHelp,
}: GuidesMenuProps) {
  return (
    <MenuButton
      label="Guides"
      className="guides-menu"
      items={[
        { label: "Coming from PHYLIP?", action: onOpenPhylipHelp },
        { label: "Coming from MEGA?", action: onOpenMegaHelp },
      ]}
    />
  );
}
