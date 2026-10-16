// The built-in default lesson is the real exercises/nj-basics.json file
// (Task 23, spec §7), embedded at build time so loading "/" needs no
// fetch. The string still goes through engine.loadExercise, so the wasm
// schema validation path is exercised exactly as for file-based lessons.

import njBasicsJson from "../../../exercises/nj-basics.json?raw";

export const defaultLessonJson: string = njBasicsJson;
