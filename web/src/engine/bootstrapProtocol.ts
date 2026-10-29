// Message protocol between the page and the bootstrap worker
// (v1.2 spec §5), plus the shared params/handlers/result types the
// client exposes. The worker runs bootstrap jobs only; everything else
// stays on the main thread.
//
// Spec §5's cancel rule ("acknowledged within 1 s, or terminate and
// respawn") needs an acknowledgement the spec table doesn't name —
// `cancelled` is that message (docs/decisions.md, Task 9).

import type { Alignment } from "./generated/Alignment";
import type { BootstrapTally } from "./generated/BootstrapTally";
import type { ConsensusKind } from "./generated/ConsensusKind";
import type { DistModel } from "./generated/DistModel";
import type { DroppedGroup } from "./generated/DroppedGroup";
import type { Method } from "./generated/Method";
import type { NeoError } from "./generated/NeoError";
import type { ReplicateDetail } from "./generated/ReplicateDetail";
import type { SiteFilter } from "./generated/SiteFilter";
import type { Tree } from "./generated/Tree";

/** Everything a bootstrap run needs (spec §5 `start` fields).
 * `filter` is the MEGA gap treatment (v1.4b spec §3.1); absent means
 * `{ kind: "pairwise" }`, the pre-v1.4b behavior. */
export interface BootstrapParams {
  alignment: Alignment;
  model: DistModel;
  method: Method;
  seed: number;
  replicates: number;
  filter?: SiteFilter;
}

/** Everything a one-replicate `replicate_detail` job needs (spec §6.5:
 * for estimates over ~2 s the detail runs in the worker instead of on
 * the main thread). `index` is the 0-based replicate index. `filter`
 * is the gap treatment the run used (v1.4b spec §3.2); absent means
 * pairwise. */
export interface ReplicateDetailParams {
  alignment: Alignment;
  model: DistModel;
  method: Method;
  seed: number;
  index: number;
  filter?: SiteFilter;
}

/** Page → worker (spec §5, plus the §6.5 detail job). */
export type PageToWorker =
  | ({ type: "start"; jobId: number } & BootstrapParams)
  | ({ type: "detail"; jobId: number } & ReplicateDetailParams)
  | { type: "confirm"; jobId: number }
  | { type: "cancel"; jobId: number };

/** Worker → page (spec §5 plus the `cancelled` acknowledgement). */
export type WorkerToPage =
  | {
      type: "estimate";
      jobId: number;
      msPerReplicate: number;
      totalMs: number;
    }
  | {
      type: "progress";
      jobId: number;
      done: number;
      total: number;
      failed: number;
      etaMs: number;
      support: Tree;
    }
  | {
      type: "result";
      jobId: number;
      tally: BootstrapTally;
      support: Tree;
      consensus: Record<ConsensusKind, Tree>;
      dropped: Record<ConsensusKind, DroppedGroup[]>;
      failed: number;
    }
  | { type: "detail"; jobId: number; detail: ReplicateDetail }
  | { type: "error"; jobId: number; error: NeoError }
  | { type: "cancelled"; jobId: number };

/** The payloads `runBootstrapJob` emits. The job doesn't know its
 * jobId — the worker stamps it onto every message (docs/decisions.md),
 * so this union is `WorkerToPage` minus the `jobId` field and minus
 * `cancelled`, which only the worker sends. */
export type WorkerToPageJob = Exclude<
  WorkerToPage extends infer M
    ? M extends { jobId: number }
      ? Omit<M, "jobId">
      : never
    : never,
  { type: "cancelled" }
>;

/** Page-side callbacks for one job (spec §5's worker messages minus
 * the wire envelope). */
export interface BootstrapHandlers {
  /** Fired only when confirmation is required (`totalMs` over the
   * client's threshold); under it the client confirms immediately. */
  onEstimate(e: { msPerReplicate: number; totalMs: number }): void;
  onProgress(p: {
    done: number;
    total: number;
    failed: number;
    etaMs: number;
    support: Tree;
  }): void;
  onResult(r: BootstrapResult): void;
  onError(e: NeoError): void;
}

/** Page-side callbacks for a one-replicate detail job (spec §6.5). */
export interface ReplicateDetailHandlers {
  onDetail(d: ReplicateDetail): void;
  onError(e: NeoError): void;
}

/** The `result` payload (spec §5): the merged tally, the original tree
 * with support, one consensus tree and dropped list per kind, and the
 * total number of skipped replicates. */
export interface BootstrapResult {
  tally: BootstrapTally;
  support: Tree;
  consensus: Record<ConsensusKind, Tree>;
  dropped: Record<ConsensusKind, DroppedGroup[]>;
  failed: number;
}
