// Lesson catalog tests (checkpoint 13): the header's Lessons menu reads
// src/lessons/catalog.ts. It must list every exercises/*.json file in
// teaching order, and each entry's id/title/summary must come from the
// file itself — with summary a real, non-empty line (the schema also
// requires it, but the catalog is what the menu renders).

import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { LESSONS } from "./catalog";

const EXERCISES = resolve("..", "exercises");

const lessonFiles = () =>
  readdirSync(EXERCISES)
    .filter((f) => f.endsWith(".json") && f !== "schema.json")
    .sort();

const ORDER = [
  "nj-basics",
  "upgma-fails",
  "saturation",
  "protein-models",
  "cytochrome-c",
];

describe("lessons/catalog", () => {
  it("lists every built-in lesson in teaching order", () => {
    expect(LESSONS.map((l) => l.id)).toEqual(ORDER);
    // The catalog can't silently skip a new lesson file — file stem is
    // the id loadLesson fetches.
    expect(LESSONS.map((l) => l.id).sort()).toEqual(
      lessonFiles().map((f) => f.replace(/\.json$/, "")),
    );
  });

  it("each entry's title and summary come from its file, summary non-empty", () => {
    for (const l of LESSONS) {
      const json = JSON.parse(
        readFileSync(resolve(EXERCISES, `${l.id}.json`), "utf8"),
      ) as { title: string; summary?: string };
      expect(l.title, `${l.id} title`).toBe(json.title);
      expect(l.summary, `${l.id} summary`).toBe(json.summary);
      expect(l.summary.trim(), `${l.id} summary`).not.toBe("");
      expect(l.summary.trim(), `${l.id} summary`).not.toBe("…");
    }
  });
});
