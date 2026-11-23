// Tray item (v1.5 Task 2, spec §16.2): one icon + one label. The
// label stays in the DOM — clipped to width 0 at rest, never
// display:none — so the accessible name is always the label; it
// expands on :hover and :focus-visible, and always shows on the
// current page's item ([aria-current]). Renders <a> for navigations,
// <button> for actions; menu and drawer triggers get aria-haspopup /
// aria-expanded / aria-controls through props.
//
// Touch (spec §16.3, conductor's call): under a coarse pointer a tap
// activates immediately — it never only reveals a label — while a
// press held ≥ 500 ms shows the label as a tooltip and does NOT
// activate. Pointer events + one timer, no library.

import { useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent, PointerEvent, Ref } from "react";

import { Icon } from "./Icon";
import type { IconName } from "./Icon";

export interface NavItemProps {
  icon: IconName;
  /** The visible label — also the accessible name. */
  label: string;
  /** Marks the current page's item: label pinned open, accent tint,
   * aria-current="page". */
  current?: boolean;
  /** Toggle items report on/off with aria-pressed (buttons only). */
  pressed?: boolean;
  /** Link items navigate; otherwise the item is a button. */
  href?: string;
  /** Button action — fires on a plain click after any onClick. */
  onActivate?: () => void;
  /** Click interception (e.g. the Reading link's unsaved-work path or
   * a menu-button toggle) — runs before onActivate. */
  onClick?: (e: MouseEvent<HTMLElement>) => void;
  /** Trigger keyboard handling (menu-button pattern). */
  onKeyDown?: (e: KeyboardEvent<HTMLElement>) => void;
  /** aria-haspopup for menu/drawer/dialog triggers. */
  hasPopup?: "menu" | "dialog";
  /** aria-expanded for triggers that open something. */
  expanded?: boolean;
  /** aria-controls target id. */
  controls?: string;
  className?: string;
  /** Ref to the rendered element — menu triggers focus it on close. */
  elementRef?: Ref<HTMLElement>;
}

/** How long a coarse-pointer press must hold to show the name tooltip
 * (spec §16.3, conductor's call). */
export const LONG_PRESS_MS = 500;

export function NavItem({
  icon,
  label,
  current = false,
  pressed,
  href,
  onActivate,
  onClick,
  onKeyDown,
  hasPopup,
  expanded,
  controls,
  className,
  elementRef,
}: NavItemProps) {
  const [tip, setTip] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  // Set when the press crosses LONG_PRESS_MS; the following click is
  // swallowed so the hold can never activate the item.
  const longPressed = useRef(false);

  const cancelPress = () => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    setTip(false);
  };

  const onPointerDown = (e: PointerEvent<HTMLElement>) => {
    if (e.pointerType !== "touch") return;
    longPressed.current = false;
    timer.current = window.setTimeout(() => {
      longPressed.current = true;
      setTip(true);
    }, LONG_PRESS_MS);
  };

  const handleClick = (e: MouseEvent<HTMLElement>) => {
    if (longPressed.current) {
      // The hold showed the name only — no activation.
      longPressed.current = false;
      e.preventDefault();
      return;
    }
    onClick?.(e);
    if (!e.defaultPrevented) onActivate?.();
  };

  const body = (
    <>
      <Icon name={icon} className="nav-item-icon" />
      <span className="nav-item-label">{label}</span>
      {tip && (
        <span className="nav-item-tip" aria-hidden="true">
          {label}
        </span>
      )}
    </>
  );

  const shared = {
    className: `nav-item${className ? ` ${className}` : ""}`,
    onPointerDown,
    onPointerUp: cancelPress,
    onPointerLeave: cancelPress,
    onPointerCancel: cancelPress,
    // A held press suppresses the context menu too — it showed the
    // name, so nothing else may fire from the gesture.
    onContextMenu: (e: MouseEvent<HTMLElement>) => {
      if (longPressed.current) e.preventDefault();
    },
    onClick: handleClick,
    onKeyDown,
    "aria-current": current ? ("page" as const) : undefined,
  };

  if (href !== undefined) {
    return (
      <a
        href={href}
        {...shared}
        ref={elementRef as Ref<HTMLAnchorElement>}
      >
        {body}
      </a>
    );
  }
  return (
    <button
      type="button"
      {...shared}
      ref={elementRef as Ref<HTMLButtonElement>}
      aria-pressed={pressed}
      aria-haspopup={hasPopup}
      aria-expanded={expanded}
      aria-controls={controls}
    >
      {body}
    </button>
  );
}
