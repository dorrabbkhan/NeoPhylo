// `#a=` assignment-link tests (v1.5 plan Task 6, spec §7.1). Named
// tests:
// - a link round-trips: decode(encode(file)) loads the same
//   assignment;
// - `builtin` content resolves to the currently-served file, so a
//   link written before a lesson edit still opens and grading can
//   flag the recorded `content_hash` as stale;
// - a malformed link is a `LinkError` — "the assignment could not be
//   decompressed" for `#a=zzz`, never the engine's load message
//   (checkpoint §21(h)).
//
// Compression uses the repo's lz-string pattern, like `#r=` links.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { compressToEncodedURIComponent } from "lz-string";
import { describe, expect, it } from "vitest";

import { decodeAssignmentLink, encodeAssignmentLink } from "./url";
import type { AssignmentFile } from "./url";

const NJ_BASICS = JSON.parse(
  readFileSync(resolve("..", "exercises", "nj-basics.json"), "utf8"),
) as unknown;

function embedded(): AssignmentFile {
  return {
    schema_version: 1,
    kind: "assignment",
    id: "hw3",
    title: "Homework 3",
    content: { exercise: NJ_BASICS },
    id_prompt: { label: "Student ID", rule: "trim_lower" },
    mode: "practice",
    variation: true,
    tasks: [
      { task: { kind: "predict_pair", step: 1 } },
      { task: { kind: "predict_pair", step: 2 }, points: 2 },
    ],
  };
}

function builtinRef(): AssignmentFile {
  return {
    ...embedded(),
    content: { builtin: "nj-basics", content_hash: "0123456789abcdef" },
  };
}

describe("encodeAssignmentLink / decodeAssignmentLink", () => {
  it("round-trips an embedded-exercise assignment", async () => {
    const link = encodeAssignmentLink(embedded());
    expect(link.startsWith("#a=")).toBe(true);
    const r = await decodeAssignmentLink(link);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.id).toBe("hw3");
      expect(r.value.content.kind).toBe("exercise");
      if (r.value.content.kind === "exercise") {
        expect(r.value.content.value.id).toBe("nj-basics");
      }
      expect(r.value.tasks).toHaveLength(2);
    }
  });

  it("round-trips inside a full URL", async () => {
    const link = encodeAssignmentLink(embedded());
    const r = await decodeAssignmentLink(`http://localhost:5173/${link}`);
    expect(r.ok).toBe(true);
  });

  it("resolves a builtin reference to the served file", async () => {
    const link = encodeAssignmentLink(builtinRef());
    const r = await decodeAssignmentLink(link);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.content.kind).toBe("exercise");
      expect(r.value.content_hash).toBe("0123456789abcdef");
    }
  });

  it("resolves a builtin reading set", async () => {
    const file: AssignmentFile = {
      ...embedded(),
      content: {
        builtin: "trees-form-a",
        content_hash: "0123456789abcdef",
      },
      tasks: [{ task: { kind: "reading", item: 0 } }],
    };
    const r = await decodeAssignmentLink(encodeAssignmentLink(file));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.content.kind).toBe("reading");
  });

  it("reports no #a= payload", async () => {
    const r = await decodeAssignmentLink("#r=abc");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("InvalidAssignment");
  });

  it("reports an undecompressible payload", async () => {
    const r = await decodeAssignmentLink("#a=zzz");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe("InvalidAssignment");
      if (r.error.kind === "InvalidAssignment") {
        // Never the engine-load message (checkpoint §21(h)).
        expect(r.error.msg).toBe(
          "the assignment could not be decompressed",
        );
      }
    }
  });

  it("reports non-JSON payloads", async () => {
    const payload = compressToEncodedURIComponent("this is not json");
    const r = await decodeAssignmentLink(`#a=${payload}`);
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.kind === "InvalidAssignment") {
      expect(r.error.msg).toMatch(/JSON/i);
    }
  });

  it("reports the wrong envelope version", async () => {
    const payload = compressToEncodedURIComponent(
      JSON.stringify({ v: 9, assignment: {} }),
    );
    const r = await decodeAssignmentLink(`#a=${payload}`);
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.kind === "InvalidAssignment") {
      expect(r.error.msg).toMatch(/version|format/i);
    }
  });

  it("reports an unknown builtin id", async () => {
    const file: AssignmentFile = {
      ...embedded(),
      content: { builtin: "no-such-lesson", content_hash: "0123456789abcdef" },
    };
    const r = await decodeAssignmentLink(encodeAssignmentLink(file));
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.kind === "InvalidAssignment") {
      expect(r.error.msg).toMatch(/no-such-lesson/);
    }
  });

  it("shows the engine's message when the assignment is invalid", async () => {
    const bad = { v: 1, assignment: { ...embedded(), tasks: [] } };
    const link = `#a=${compressToEncodedURIComponent(JSON.stringify(bad))}`;
    const r = await decodeAssignmentLink(link);
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.kind === "InvalidAssignment") {
      expect(r.error.field).toBe("tasks");
    }
  });
});
