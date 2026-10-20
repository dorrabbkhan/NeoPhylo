// The consensus-tab metadata shared by ConsensusTabs (the strip) and
// App (which picks the tree to draw) — kept out of the .tsx so the
// component file exports only the component (react-refresh rule).

import type { ConsensusKind } from "../engine/generated/ConsensusKind";
import type { DroppedGroup } from "../engine/generated/DroppedGroup";
import type { BootstrapView } from "../state/session";

/** The four views in tab order (spec §6.4). `kind` maps a view to its
 * ConsensusKind; null for the original support tree. */
export const CONSENSUS_TABS: {
  view: BootstrapView;
  label: string;
  kind: ConsensusKind | null;
}[] = [
  { view: "support", label: "Your tree with support", kind: null },
  { view: "majority", label: "Majority-rule", kind: "Majority" },
  { view: "extended", label: "Extended majority", kind: "Extended" },
  { view: "strict", label: "Strict", kind: "Strict" },
];

/** The ConsensusKind a view draws (null for "support"). */
export function consensusKind(view: BootstrapView): ConsensusKind | null {
  return CONSENSUS_TABS.find((t) => t.view === view)?.kind ?? null;
}

/** The tab's label — App uses it for the tree panel's caption. */
export function viewLabel(view: BootstrapView): string {
  return CONSENSUS_TABS.find((t) => t.view === view)?.label ?? "";
}

/** "Dropped from this consensus: (C, D) 42%, …" (spec §6.4), support
 * descending — a stable sort keeps the tally order on ties. "None"
 * when the consensus dropped no grouping. */
export function droppedLine(dropped: DroppedGroup[]): string {
  if (dropped.length === 0) return "Dropped from this consensus: None.";
  const sorted = [...dropped].sort((a, b) => b.support - a.support);
  const parts = sorted.map(
    (d) => `(${d.labels.join(", ")}) ${Math.round(100 * d.support)}%`,
  );
  return `Dropped from this consensus: ${parts.join(", ")}.`;
}
