// Responsive breakpoints (v1.3 plan Task 9, spec §6.1). The single
// source the media queries in index.css mirror:
//
//   wide    ≥ 1280 px   three columns (controls · center · explanation)
//   medium  1024–1279   single column (controls stack until Task 10's
//   narrow   768–1023    settings drawer; explanation below the center)
//   compact  < 768 px   same as narrow, scrollable
//
// `useBreakpoint` reads media queries — not just innerWidth — because
// CSS zoom on the root element re-evaluates them without firing a
// resize event (the Review Focus 2 zoom test relies on this). Where
// matchMedia is missing (jsdom unit tests) it falls back to
// innerWidth + the resize listener.

import { useSyncExternalStore } from "react";

export type Breakpoint = "wide" | "medium" | "narrow" | "compact";

/** Lower bounds in px (§6.1 / Global Constraints). */
export const BREAKPOINT_MIN = { wide: 1280, medium: 1024, narrow: 768 } as const;

/** The breakpoint a CSS width falls in. */
export function breakpointFor(width: number): Breakpoint {
  if (width >= BREAKPOINT_MIN.wide) return "wide";
  if (width >= BREAKPOINT_MIN.medium) return "medium";
  if (width >= BREAKPOINT_MIN.narrow) return "narrow";
  return "compact";
}

const QUERIES = {
  wide: `(width >= ${BREAKPOINT_MIN.wide}px)`,
  medium: `(width >= ${BREAKPOINT_MIN.medium}px)`,
  narrow: `(width >= ${BREAKPOINT_MIN.narrow}px)`,
} as const;

interface Queries {
  wide: MediaQueryList;
  medium: MediaQueryList;
  narrow: MediaQueryList;
}

// One MediaQueryList set per page — created lazily so jsdom (no
// matchMedia) never touches it.
let cached: Queries | null | undefined;

function queries(): Queries | null {
  if (cached === undefined) {
    cached =
      typeof window !== "undefined" && typeof window.matchMedia === "function"
        ? {
            wide: window.matchMedia(QUERIES.wide),
            medium: window.matchMedia(QUERIES.medium),
            narrow: window.matchMedia(QUERIES.narrow),
          }
        : null;
  }
  return cached;
}

function current(): Breakpoint {
  const mq = queries();
  if (mq === null) {
    return breakpointFor(typeof window === "undefined" ? 0 : window.innerWidth);
  }
  if (mq.wide.matches) return "wide";
  if (mq.medium.matches) return "medium";
  if (mq.narrow.matches) return "narrow";
  return "compact";
}

function subscribe(onChange: () => void): () => void {
  const mq = queries();
  if (mq !== null) {
    mq.wide.addEventListener("change", onChange);
    mq.medium.addEventListener("change", onChange);
    mq.narrow.addEventListener("change", onChange);
  }
  // innerWidth fallback environments (jsdom) still get resize events.
  window.addEventListener("resize", onChange);
  return () => {
    if (mq !== null) {
      mq.wide.removeEventListener("change", onChange);
      mq.medium.removeEventListener("change", onChange);
      mq.narrow.removeEventListener("change", onChange);
    }
    window.removeEventListener("resize", onChange);
  };
}

/** The live breakpoint of the current viewport — re-renders on every
 * crossing, including zoom-driven ones. */
export function useBreakpoint(): Breakpoint {
  return useSyncExternalStore(subscribe, current);
}
