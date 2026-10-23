// Font-ready gate (v1.3 spec §4.2, plan Task 4). Layout and text
// measurement wait for the bundled faces, up to 3 s; on timeout the
// layout proceeds on fallback metrics and re-lays out ONCE when the
// fonts arrive — onFontsLateLoad is the single-fire signal TreeView
// subscribes to.
//
// The faces "in use" are the four bundled stacks: Inter 400/500/600 and
// JetBrains Mono 400 (spec §4.1). document.fonts.load() is driven with a
// sample covering all four subsets so the latin-ext/greek/cyrillic faces
// fetch too — a taxon name in any of them must measure with real metrics.
//
// Module state is page-level by design: every TreeView shares one watch,
// so the 3 s budget and the single late pass are global, not per tree.

import "./fonts.css";

type FontsStatus = "pending" | "loaded" | "timeout";

let status: FontsStatus = "pending";
let started = false;
let lateFired = false;
const lateCallbacks = new Set<() => void>();
let resolveSettled: (v: "loaded" | "timeout") => void = () => {};
const settled = new Promise<"loaded" | "timeout">((resolve) => {
  resolveSettled = resolve;
});

// One character from each bundled subset (latin, latin-ext, greek,
// cyrillic) so load() fetches every declared face, not just latin.
const SAMPLE = "aĀαЯ";
const FACE_SPECS = [
  '400 12px "Inter"',
  '500 12px "Inter"',
  '600 12px "Inter"',
  '400 12px "JetBrains Mono"',
];

function supported(): boolean {
  return typeof document !== "undefined" && document.fonts !== undefined;
}

function bumpE2ECounter(): void {
  // e2e hook (same neophylo-e2e flag as window.__neophylo): lets the
  // fonts spec count late re-layout passes.
  try {
    if (window.localStorage.getItem("neophylo-e2e") !== "1") return;
  } catch {
    return;
  }
  const w = window as unknown as { __neophyloFontLateLoads?: number };
  w.__neophyloFontLateLoads = (w.__neophyloFontLateLoads ?? 0) + 1;
}

function fireLate(): void {
  if (lateFired) return;
  lateFired = true;
  bumpE2ECounter();
  for (const cb of lateCallbacks) cb();
  lateCallbacks.clear();
}

function start(timeoutMs: number): void {
  const loads = FACE_SPECS.map((spec) =>
    document.fonts.load(spec, SAMPLE).then(
      () => undefined,
      // A face that fails (offline, 404) must not hang the gate: the
      // fallback metrics are the designed answer for missing fonts.
      () => undefined,
    ),
  );
  void Promise.all(loads).then(() => {
    const late = status === "timeout";
    status = "loaded";
    if (late) {
      fireLate();
    } else {
      resolveSettled("loaded");
    }
  });
  setTimeout(() => {
    if (status === "pending") {
      status = "timeout";
      resolveSettled("timeout");
    }
  }, timeoutMs);
}

/**
 * Resolves "loaded" once the bundled faces are usable, "timeout" if they
 * are still pending after `timeoutMs` (default 3 s per §4.2). Callers
 * that get "timeout" should proceed with fallback metrics — a later
 * arrival is reported via onFontsLateLoad. Where font loading is
 * unsupported (jsdom, very old engines) it resolves "loaded" at once.
 */
export function whenFontsReady(
  timeoutMs = 3000,
): Promise<"loaded" | "timeout"> {
  if (!supported()) return Promise.resolve("loaded");
  if (!started) {
    started = true;
    start(timeoutMs);
  }
  if (status === "pending") return settled;
  return Promise.resolve(status);
}

/**
 * Synchronous snapshot of the gate: "pending" until the loads finish or
 * the budget expires. Components mounting after fonts settled read this
 * to open the gate on their first render instead of replaying a
 * settled wait as a blank frame.
 */
export function fontsStatus(): "pending" | "loaded" | "timeout" {
  return status;
}

/**
 * Subscribes to the one-shot "fonts arrived after the timeout" event;
 * returns an unsubscribe. The callback fires at most once — spec §4.2
 * budgets a single re-layout. If fonts already loaded on time, or the
 * late pass already ran, the callback never fires.
 */
export function onFontsLateLoad(cb: () => void): () => void {
  if (!supported() || status === "loaded" || lateFired) return () => {};
  lateCallbacks.add(cb);
  return () => {
    lateCallbacks.delete(cb);
  };
}
