// The graded-task picker (v1.5 plan Task 7, spec §6 step "graded
// tasks", §5.3): the exercise's gradable prompts (predict_pair,
// predict_branch) and a reading set's items as checkboxes, plus
// numeric tasks added by picking a join step, a quantity and a role
// — plain-word labels everywhere, never the TaskRef JSON. Each task
// row shows the engine's answer on the base variant so the
// instructor sees exactly what the task grades.

import { useState } from "react";

import { engine } from "../../../engine/index";
import { errorMessage } from "../../../explain/errors";
import type { GradedTask } from "../../../engine/generated/GradedTask";
import type { PairRole } from "../../../engine/generated/PairRole";
import type { Quantity } from "../../../engine/generated/Quantity";
import type { TaskRef } from "../../../engine/generated/TaskRef";
import type { Variant } from "../../../engine/generated/Variant";

import {
  formatAccepted,
  joinCount,
  sameTask,
  servedLabels,
  taskDecimals,
  taskLabel,
} from "./builder";
import type { ResolvedContent } from "./builder";

const QUANTITIES: { value: Quantity; label: string }[] = [
  { value: "q_value", label: "Q-value" },
  { value: "branch_length", label: "Branch length" },
  { value: "new_distance", label: "New distance" },
  { value: "corrected_distance", label: "Corrected distance" },
];

const ROLES: { value: PairRole; label: string }[] = [
  { value: "chosen", label: "The pair joined at the step" },
  { value: "closest_raw", label: "The closest pair at the step" },
  {
    value: "chosen_first_to_new",
    label: "The first member's branch to the new node",
  },
  {
    value: "chosen_second_to_new",
    label: "The second member's branch to the new node",
  },
];

export interface TaskPickerProps {
  /** The resolved content — null while nothing is picked. */
  resolved: ResolvedContent | null;
  /** The variation-off probe — the variant answers are quoted on. */
  baseVariant: Variant | null;
  tasks: GradedTask[];
  decimals: Map<Quantity, number>;
  onChange(tasks: GradedTask[]): void;
}

/** The task a prompt grades — null for notes and anything else that
 *  carries no assignment task. */
function promptTask(
  type: string,
  atStep: number,
): TaskRef | null {
  if (type === "predict_pair") {
    return { kind: "predict_pair", step: atStep };
  }
  if (type === "predict_branch") return { kind: "predict_branch" };
  return null;
}

export function TaskPicker({
  resolved,
  baseVariant,
  tasks,
  decimals,
  onChange,
}: TaskPickerProps) {
  const [step, setStep] = useState(1);
  const [quantity, setQuantity] = useState<Quantity>("q_value");
  const [role, setRole] = useState<PairRole>("chosen");

  if (resolved === null) {
    return (
      <section className="editor-section" aria-labelledby="ab-tasks">
        <h2 id="ab-tasks">Graded tasks</h2>
        <p className="editor-hint">
          Pick the assignment's content first — its gradable prompts
          and numeric targets list here.
        </p>
      </section>
    );
  }

  const exercise = resolved.exercise;
  const reading = resolved.reading;
  const set = reading;

  const answerFor = (task: TaskRef): string => {
    if (baseVariant === null) return "—";
    const r = engine.taskKey(baseVariant, task);
    if (!r.ok) return `— ${errorMessage(r.error).title}`;
    return formatAccepted(
      r.value,
      servedLabels(baseVariant.content),
      taskDecimals(task, decimals),
    );
  };

  // The gradable prompts (exercise) or items (reading set) — each a
  // checkbox whose task joins/leaves the list.
  const promptRows: { task: TaskRef; label: string }[] =
    exercise !== null
      ? exercise.prompts.flatMap((p) => {
          const t = promptTask(p.type, p.at_step);
          return t === null ? [] : [{ task: t, label: taskLabel(t, null) }];
        })
      : (set?.items ?? []).map((item, i) => ({
          task: { kind: "reading", item: i } as TaskRef,
          label: `Item ${i + 1} — ${item.text}`,
        }));

  const has = (t: TaskRef) => tasks.some((g) => sameTask(g.task, t));

  const toggle = (t: TaskRef, checked: boolean) => {
    if (checked && !has(t)) {
      onChange([...tasks, { task: t, points: 1 }]);
    } else if (!checked) {
      onChange(tasks.filter((g) => !sameTask(g.task, t)));
    }
  };

  const joins = exercise !== null ? joinCount(exercise) : 0;

  const addNumeric = () => {
    const t: TaskRef = { kind: "numeric", step, quantity, role };
    if (!has(t)) onChange([...tasks, { task: t, points: 1 }]);
  };

  return (
    <section className="editor-section" aria-labelledby="ab-tasks">
      <h2 id="ab-tasks">Graded tasks</h2>
      <p className="editor-hint">
        Tick the prompts the assignment grades, or add numeric tasks
        by step, quantity and role. Answers shown are the engine's on
        the base variant — each student's variant has its own.
      </p>
      {promptRows.length > 0 && (
        <ul className="builder-prompts">
          {promptRows.map(({ task, label }) => (
            <li key={JSON.stringify(task)}>
              <label>
                <input
                  type="checkbox"
                  checked={has(task)}
                  onChange={(e) => toggle(task, e.target.checked)}
                />
                <span>{label}</span>
              </label>{" "}
              <span className="builder-answer">
                Answer: {answerFor(task)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {exercise !== null && (
        <div className="builder-numeric">
          <label className="field">
            <span>Join step</span>
            <select
              value={step}
              onChange={(e) => setStep(Number(e.target.value))}
            >
              {Array.from({ length: joins }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  {i + 1}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Quantity</span>
            <select
              value={quantity}
              onChange={(e) => setQuantity(e.target.value as Quantity)}
            >
              {QUANTITIES.map((q) => (
                <option key={q.value} value={q.value}>
                  {q.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Target</span>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as PairRole)}
            >
              {ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={addNumeric}
          >
            Add numeric task
          </button>
        </div>
      )}
      {tasks.length > 0 && (
        <ul className="builder-tasks">
          {tasks.map((g, i) => (
            <li key={JSON.stringify(g.task)} className="builder-task">
              <span>{taskLabel(g.task, set)}</span>{" "}
              <span className="builder-answer">
                Answer: {answerFor(g.task)}
              </span>{" "}
              <label>
                Points{" "}
                <input
                  type="number"
                  min={0}
                  value={g.points}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (!Number.isFinite(n)) return;
                    onChange(
                      tasks.map((x, j) =>
                        j === i ? { ...x, points: n } : x,
                      ),
                    );
                  }}
                />
              </label>{" "}
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() =>
                  onChange(tasks.filter((_, j) => j !== i))
                }
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
