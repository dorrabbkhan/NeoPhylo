// The three-sample-student preview (v1.5 plan Task 7, spec §6):
// `makeVariant` on fixed student ids, side by side — each card shows
// the served data (the permuted order plus the variant's own seed)
// and the engine's answers for the graded tasks, so the instructor
// sees what different students actually get. A variant whose
// premises never held fell back to the base — the card says so,
// never silently (spec §5.2).

import { useMemo } from "react";

import { engine } from "../../../engine/index";
import { errorMessage } from "../../../explain/errors";
import type { GradedTask } from "../../../engine/generated/GradedTask";
import type { Quantity } from "../../../engine/generated/Quantity";
import type { Variant } from "../../../engine/generated/Variant";

import {
  dataFingerprint,
  formatAccepted,
  SAMPLE_IDS,
  servedLabels,
  taskDecimals,
  taskLabel,
} from "./builder";

export interface SamplePreviewProps {
  /** The probe JSON of the authored assignment (variation setting
   *  included), or null while the file can't be built. */
  probe: string | null;
  tasks: GradedTask[];
  decimals: Map<Quantity, number>;
}

interface Sample {
  id: string;
  variant: Variant | null;
  error: string | null;
}

export function SamplePreview({
  probe,
  tasks,
  decimals,
}: SamplePreviewProps) {
  const samples: Sample[] = useMemo(
    () =>
      SAMPLE_IDS.map((id) => {
        if (probe === null) return { id, variant: null, error: null };
        const r = engine.makeVariant(probe, id);
        return r.ok
          ? { id, variant: r.value, error: null }
          : { id, variant: null, error: errorMessage(r.error).title };
      }),
    [probe],
  );

  if (probe === null) return null;
  const anyFellBack = samples.some((s) => s.variant?.fell_back === true);
  const anyError = samples.find((s) => s.error !== null);

  return (
    <section className="editor-section" aria-labelledby="ab-samples">
      <h2 id="ab-samples">Three sample students</h2>
      {anyFellBack && (
        <p className="editor-warning">
          A premise could not be satisfied — the marked students fell
          back to the base exercise.
        </p>
      )}
      <div className="builder-samples">
        {samples.map((s) => (
          <article key={s.id} className="builder-sample" aria-label={s.id}>
            <h3>
              {s.id}
              {s.variant?.fell_back === true && (
                <span className="builder-fallback">
                  {" "}
                  — fell back to the base
                </span>
              )}
            </h3>
            {s.variant !== null && (
              <>
                <p className="builder-sample-data">
                  {dataFingerprint(s.variant.content)}
                </p>
                <ul>
                  {tasks.map((g) => {
                    const v = s.variant as Variant;
                    const r = engine.taskKey(v, g.task);
                    const set =
                      v.content.kind === "reading" ? v.content.value : null;
                    return (
                      <li key={JSON.stringify(g.task)}>
                        {taskLabel(g.task, set)}{" "}
                        <span className="builder-answer">
                          Answer:{" "}
                          {r.ok
                            ? formatAccepted(
                                r.value,
                                servedLabels(v.content),
                                taskDecimals(g.task, decimals),
                              )
                            : `— ${errorMessage(r.error).title}`}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </article>
        ))}
      </div>
      {anyError !== undefined && (
        <p role="alert" className="editor-error">
          {anyError.error}
        </p>
      )}
    </section>
  );
}
