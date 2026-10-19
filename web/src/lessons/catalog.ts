// Lesson catalog (checkpoint 13): the header's "Lessons" menu lists the
// built-in lessons in teaching order. Metadata comes straight from the
// exercise files — imported here as raw text at build time, the same
// files loadLesson fetches from /exercises/ — so the menu can't drift
// from the lesson content. `summary` is a v2 file field the schema
// requires for repo lessons but the engine ignores (§3.6), so it is
// read from the file, not the parsed Exercise.

import cytochromeCJson from "../../../exercises/cytochrome-c.json?raw";
import njBasicsJson from "../../../exercises/nj-basics.json?raw";
import proteinModelsJson from "../../../exercises/protein-models.json?raw";
import saturationJson from "../../../exercises/saturation.json?raw";
import upgmaFailsJson from "../../../exercises/upgma-fails.json?raw";

export interface LessonMeta {
  id: string;
  title: string;
  /** One-line description shown under the title in the Lessons menu. */
  summary: string;
}

/** The id, title and summary of one raw exercise file. */
function meta(raw: string): LessonMeta {
  const { id, title, summary } = JSON.parse(raw) as {
    id: string;
    title: string;
    summary: string;
  };
  return { id, title, summary };
}

/** Built-in lessons in the order the menu teaches them (checkpoint 13). */
export const LESSONS: LessonMeta[] = [
  njBasicsJson,
  upgmaFailsJson,
  saturationJson,
  proteinModelsJson,
  cytochromeCJson,
].map(meta);
