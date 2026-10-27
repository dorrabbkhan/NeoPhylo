// Editor settings form (v1.4 plan Task 10, spec §5.3): the exercise's
// model, κ, base frequencies, seed, sequence length, method and file
// metadata. The one Model select drives a matched (simulation model,
// distance correction, alphabet) preset — see draft.ts for the
// mapping.
//
// κ shows only for K2P_PHYLIP; the four base-frequency inputs show
// only for F84. Live verdicts come from `settingsProblems` — the SAME
// function that gates Save, Share and Preview — so a value the form
// accepts never fails the save path and a value the save path refuses
// is never shown as valid (Review Focus 1). A κ in (0, 0.5] warns with
// dnadist's clamping rule instead of refusing, because the engine —
// like dnadist — accepts it (owner decision, PR #88).

import type { EditorSettings } from "../../editor/draft";
import { settingsProblems } from "../../editor/draft";
import type { Method } from "../../engine/generated/Method";

export interface SettingsFormProps {
  settings: EditorSettings;
  onChange: (next: EditorSettings) => void;
}

/** The select's display labels; the option values are
 * EditorModelChoice. The K2P label is the plan's pinned wording. */
const MODEL_OPTIONS: { value: EditorSettings["model"]; label: string }[] =
  [
    { value: "JC69", label: "JC69" },
    { value: "K80", label: "K80" },
    { value: "F84", label: "F84" },
    { value: "K2P_PHYLIP", label: "K2P (dnadist, κ = 2.0)" },
    { value: "Kimura", label: "Kimura" },
    { value: "JTT", label: "JTT" },
  ];

const BASE_NAMES = ["A", "C", "G", "T"] as const;

function FieldProblems({
  problems,
  field,
}: {
  problems: ReturnType<typeof settingsProblems>;
  field: string;
}) {
  const mine = problems.filter((p) => p.field === field);
  if (mine.length === 0) return null;
  return (
    <>
      {mine.map((p) =>
        p.level === "error" ? (
          <p key={p.msg} role="alert" className="editor-error">
            {p.msg}
          </p>
        ) : (
          <p key={p.msg} className="editor-warning">
            {p.msg}
          </p>
        ),
      )}
    </>
  );
}

export function SettingsForm({ settings, onChange }: SettingsFormProps) {
  const problems = settingsProblems(settings);
  const patch = (p: Partial<EditorSettings>) =>
    onChange({ ...settings, ...p });
  const hasError = (field: string) =>
    problems.some((p) => p.field === field && p.level === "error");

  const freqSum = settings.baseFreqs.reduce((a, t) => {
    const v = Number(t);
    return a + (Number.isFinite(v) && t.trim() !== "" ? v : 0);
  }, 0);
  const freqSumText = (Math.round(freqSum * 1e6) / 1e6).toString();

  return (
    <div className="settings-form">
      <div className="settings-row">
        <label className="field">
          <span>Title</span>
          <input
            type="text"
            value={settings.title}
            aria-invalid={hasError("title") || undefined}
            onChange={(e) => patch({ title: e.target.value })}
          />
        </label>
        <label className="field">
          <span>Exercise id</span>
          <input
            type="text"
            value={settings.id}
            onChange={(e) => patch({ id: e.target.value })}
          />
        </label>
      </div>
      <FieldProblems problems={problems} field="title" />
      <div className="settings-row">
        <label className="field">
          <span>Short description</span>
          <input
            type="text"
            value={settings.summary}
            onChange={(e) => patch({ summary: e.target.value })}
          />
        </label>
        <label className="field">
          <span>Author</span>
          <input
            type="text"
            value={settings.author}
            onChange={(e) => patch({ author: e.target.value })}
          />
        </label>
      </div>
      <div className="settings-row">
        <label className="field">
          <span>Model</span>
          <select
            aria-label="Model"
            value={settings.model}
            onChange={(e) =>
              patch({
                model: e.target.value as EditorSettings["model"],
              })
            }
          >
            {MODEL_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Method</span>
          <select
            aria-label="Tree-building method"
            value={settings.method}
            onChange={(e) =>
              patch({ method: e.target.value as Method })
            }
          >
            <option value="Nj">Neighbor-Joining</option>
            <option value="Upgma">UPGMA</option>
          </select>
        </label>
      </div>
      {(settings.model === "Kimura" || settings.model === "JTT") && (
        <p className="editor-hint">
          A protein exercise: sequences are simulated under JTT and
          corrected with {settings.model === "Kimura" ? "Kimura" : "JTT"}.
        </p>
      )}
      {settings.model === "K2P_PHYLIP" && (
        <>
          <div className="settings-row">
            <label className="field">
              <span>Kappa (κ)</span>
              <input
                type="text"
                inputMode="decimal"
                value={settings.kappa}
                aria-invalid={hasError("kappa") || undefined}
                onChange={(e) => patch({ kappa: e.target.value })}
              />
            </label>
          </div>
          <FieldProblems problems={problems} field="kappa" />
          <p className="editor-hint">
            Sequences are simulated under K80 at this ratio, and
            distances are corrected with PHYLIP&apos;s K2P estimator at
            the same κ — not K80&apos;s closed form.
          </p>
        </>
      )}
      {settings.model === "F84" && (
        <>
          <fieldset className="freq-set">
            <legend>Base frequencies (simulation)</legend>
            <div className="settings-row">
              {BASE_NAMES.map((name, i) => (
                <label className="field freq-field" key={name}>
                  <span>{name}</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    aria-label={`Base frequency ${name}`}
                    value={settings.baseFreqs[i]}
                    aria-invalid={hasError("baseFreqs") || undefined}
                    onChange={(e) =>
                      patch({
                        baseFreqs: settings.baseFreqs.map((t, k) =>
                          k === i ? e.target.value : t,
                        ) as EditorSettings["baseFreqs"],
                      })
                    }
                  />
                </label>
              ))}
            </div>
            <p
              className={
                hasError("baseFreqs") ? "editor-error" : "editor-hint"
              }
            >
              Sum: {freqSumText} — must be 1.
            </p>
            <FieldProblems problems={problems} field="baseFreqs" />
          </fieldset>
          <p className="editor-hint">
            The frequencies apply to simulation; distance estimation
            uses the observed frequencies, as dnadist does.
          </p>
        </>
      )}
      <div className="settings-row">
        <label className="field">
          <span>Seed</span>
          <input
            type="text"
            inputMode="numeric"
            value={settings.seed}
            aria-invalid={hasError("seed") || undefined}
            onChange={(e) => patch({ seed: e.target.value })}
          />
        </label>
        <label className="field">
          <span>Sequence length</span>
          <input
            type="text"
            inputMode="numeric"
            value={settings.length}
            aria-invalid={hasError("length") || undefined}
            onChange={(e) => patch({ length: e.target.value })}
          />
        </label>
      </div>
      <FieldProblems problems={problems} field="seed" />
      <FieldProblems problems={problems} field="length" />
    </div>
  );
}
