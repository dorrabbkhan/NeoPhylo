// The built-in lesson, embedded as the exercise-file JSON of spec §7
// (identical to crates/neophylo-core/fuzz/seeds/exercise/spec_example.json).
// Task 23 will replace this with the real exercises/nj-basics.json file;
// until then this string is parsed through engine.loadExercise, so the wasm
// schema validation path is exercised exactly as for file-based lessons.

export const defaultLessonJson = `{
  "schema_version": 1,
  "id": "nj-basics",
  "title": "How Neighbor-Joining works",
  "true_tree": "((A:0.1,B:0.2):0.05,C:0.3,(D:0.1,E:0.15):0.1);",
  "sim": { "model": "JC69", "length": 1000, "seed": 42 },
  "analysis": { "correction": "JC69", "method": "NJ" },
  "locked": ["sim.model", "analysis.method"],
  "prompts": [
    {
      "at_step": 1,
      "type": "predict_pair",
      "concept": "Which two taxa will join first?",
      "math": "Find the minimum Q(i,j)."
    },
    { "at_step": 3, "type": "note", "concept": "…", "math": "…" }
  ]
}`;
