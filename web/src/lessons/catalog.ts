// Lesson catalog (checkpoint 13): the header's "Lessons" menu lists the
// built-in lessons in teaching order. Metadata comes straight from the
// exercise files — the same files loadLesson fetches from /exercises/ —
// so the menu can't drift from the lesson content. `summary` is a file
// field the schema requires for repo lessons but the engine ignores
// (§3.6), so it is read from the file, not the parsed Exercise.
//
// The imports are per-key named JSON imports, not `?raw`: only the
// id/title/summary strings reach the initial bundle (Vite tree-shakes
// the unused keys), which keeps the menu under the initial-JS budget
// now that every file also carries `meta` (v1.4c Task 10).

import {
  id as bootstrapBasicsId,
  title as bootstrapBasicsTitle,
  summary as bootstrapBasicsSummary,
} from "../../../exercises/bootstrap-basics.json";
import {
  id as cytochromeCId,
  title as cytochromeCTitle,
  summary as cytochromeCSummary,
} from "../../../exercises/cytochrome-c.json";
import {
  id as njBasicsId,
  title as njBasicsTitle,
  summary as njBasicsSummary,
} from "../../../exercises/nj-basics.json";
import {
  id as njByHandId,
  title as njByHandTitle,
  summary as njByHandSummary,
} from "../../../exercises/nj-by-hand.json";
import {
  id as proteinModelsId,
  title as proteinModelsTitle,
  summary as proteinModelsSummary,
} from "../../../exercises/protein-models.json";
import {
  id as saturationId,
  title as saturationTitle,
  summary as saturationSummary,
} from "../../../exercises/saturation.json";
import {
  id as upgmaFailsId,
  title as upgmaFailsTitle,
  summary as upgmaFailsSummary,
} from "../../../exercises/upgma-fails.json";
import {
  id as upgmaVsNjMatrixId,
  title as upgmaVsNjMatrixTitle,
  summary as upgmaVsNjMatrixSummary,
} from "../../../exercises/upgma-vs-nj-matrix.json";

export interface LessonMeta {
  id: string;
  title: string;
  /** One-line description shown under the title in the Lessons menu. */
  summary: string;
}

/** Built-in lessons in the order the menu teaches them (checkpoint 13). */
export const LESSONS: LessonMeta[] = [
  { id: njByHandId, title: njByHandTitle, summary: njByHandSummary },
  { id: njBasicsId, title: njBasicsTitle, summary: njBasicsSummary },
  { id: upgmaFailsId, title: upgmaFailsTitle, summary: upgmaFailsSummary },
  {
    id: upgmaVsNjMatrixId,
    title: upgmaVsNjMatrixTitle,
    summary: upgmaVsNjMatrixSummary,
  },
  { id: saturationId, title: saturationTitle, summary: saturationSummary },
  {
    id: bootstrapBasicsId,
    title: bootstrapBasicsTitle,
    summary: bootstrapBasicsSummary,
  },
  {
    id: proteinModelsId,
    title: proteinModelsTitle,
    summary: proteinModelsSummary,
  },
  { id: cytochromeCId, title: cytochromeCTitle, summary: cytochromeCSummary },
];
