// The Action union dispatched to `reducer` (kept in its own module so
// session.ts stays a small composer, v1.3 spec §7.1). Field types
// reference the slice interfaces, matching the old `Session[...]`
// types field for field.

import type { BootstrapResult } from "../engine/bootstrapProtocol";
import type { Alignment } from "../engine/generated/Alignment";
import type { Alphabet } from "../engine/generated/Alphabet";
import type { Exercise } from "../engine/generated/Exercise";
import type { NeoError } from "../engine/generated/NeoError";
import type { SimSpec } from "../engine/generated/SimSpec";
import type { Tree } from "../engine/generated/Tree";

import type { AnalysisState } from "./analysis";
import type { BootstrapView } from "./bootstrap";
import type { LessonState } from "./lesson";
import type { UiState } from "./ui";

export type Action =
  | { type: "load"; exercise: Exercise; source: LessonState["source"] }
  | { type: "setSim"; patch: Partial<SimSpec> }
  | { type: "setAnalysis"; patch: Partial<Exercise["analysis"]> }
  | { type: "setAlphabet"; alphabet: Alphabet }
  | { type: "importAlignment"; alignment: Alignment }
  | { type: "importTree"; tree: Tree }
  | { type: "step"; to: number }
  | { type: "setMode"; mode: UiState["mode"] }
  | { type: "toggleClamp" }
  | { type: "setMatrixView"; view: AnalysisState["matrixView"] }
  | { type: "setBranchScale"; scale: number }
  | { type: "hover"; cell: AnalysisState["hover"] }
  | { type: "enterSandbox" }
  | { type: "exitSandbox" }
  // v1.2 Task 10: bootstrap run lifecycle (spec §5, §6.1).
  // `jobId` is the client-assigned id; when omitted (a `ran: true`
  // link), the first job message adopts its id.
  | { type: "bootstrapRequested"; jobId?: number; autorun?: boolean }
  | {
      type: "bootstrapEstimated";
      jobId: number;
      msPerReplicate: number;
      totalMs: number;
    }
  | { type: "bootstrapConfirmed"; jobId: number }
  | {
      type: "bootstrapProgress";
      jobId: number;
      done: number;
      total: number;
      failed: number;
      etaMs: number;
      support: Tree;
    }
  | { type: "bootstrapDone"; jobId: number; result: BootstrapResult }
  | { type: "bootstrapFailed"; jobId: number; error: NeoError }
  // v1.2 Task 11: the panel's Cancel button moves the current job into
  // `cancelJobId` for the page to cancel; `bootstrapCancelled` is the
  // page's ack. A jobId-scoped ack settles only that pending cancel —
  // a newer request may already be estimating in its place.
  | { type: "bootstrapCancelRequested" }
  | { type: "bootstrapCancelled"; jobId?: number }
  | {
      type: "setBootstrapSettings";
      patch: { replicates?: number; seed?: number };
    }
  | { type: "setBootstrapView"; view: BootstrapView }
  | { type: "setReplicateIndex"; index: number | null }
  | { type: "toggleRerootDisplay" };
