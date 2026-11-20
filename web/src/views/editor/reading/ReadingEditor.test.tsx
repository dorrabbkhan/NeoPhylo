// Reading-editor tests (v1.4d plan Task 10, spec §7.5): a set built
// through the forms produces exactly the expected JSON on Share; an
// item the engine's load_reading_set refuses shows the InvalidReading
// message beside the item and disables Share/Save/Preview; and an
// imported #r= link edits and shares back out unchanged.
//
// The engine is real wasm (test setup): validation and answers are
// always the engine's, never recomputed here.

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { EditorHistory } from "../../../editor/history";
import { engine } from "../../../engine/index";
import type { Tree } from "../../../engine/generated/Tree";
import { decodeReadingLink } from "../../../reading/url";

import { ReadingEditor } from "./ReadingEditor";

afterEach(cleanup);

function parse(newick: string): Tree {
  const r = engine.parseNewick(newick);
  if (!r.ok) throw new Error(`fixture Newick must parse: ${newick}`);
  return r.value;
}

function renderEditor(): EditorHistory {
  const model = new EditorHistory(parse("((a,b),(c,d));"));
  render(<ReadingEditor model={model} />);
  return model;
}

const NEWICK = "((a,b),(c,d));";

function treeSlot(name: string): HTMLElement {
  return screen.getByRole("group", { name: `Tree ${name}` });
}

function itemSection(label: string | RegExp): HTMLElement {
  return screen.getByRole("group", { name: label });
}

function tapClade(scope: HTMLElement, clade: string[]): void {
  const key = JSON.stringify([...clade].sort());
  const el = scope.querySelector<SVGGElement>(
    `.rt-hit[data-clade='${key}']`,
  );
  if (el === null) throw new Error(`no hit for clade ${key}`);
  fireEvent.click(el);
}

function fillSetBasics(): void {
  fireEvent.change(screen.getByRole("textbox", { name: "Set title" }), {
    target: { value: "Mammal reading" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "Set id" }), {
    target: { value: "trees-mini" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "Summary" }), {
    target: { value: "A small set" },
  });
}

function shareUrl(): string {
  const out = screen.getByRole("textbox", {
    name: "Share link URL",
  }) as HTMLInputElement;
  return out.value;
}

describe("ReadingEditor", () => {
  it("builds a set through the forms that equals the expected JSON", () => {
    renderEditor();
    fillSetBasics();

    const slot = treeSlot("t1");
    fireEvent.change(
      within(slot).getByRole("textbox", { name: "Newick" }),
      { target: { value: NEWICK } },
    );

    // Add an mrca item; its preview of t1 lets tips be tapped.
    fireEvent.change(
      screen.getByRole("combobox", { name: "New item type" }),
      { target: { value: "mrca" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Add item" }));
    const item = itemSection("Item q1");
    fireEvent.change(
      within(item).getByRole("textbox", { name: "Question text" }),
      { target: { value: "Tap the MRCA of {set}." } },
    );
    tapClade(item, ["a"]);
    tapClade(item, ["b"]);

    // The engine's answer shows live under the item.
    expect(
      within(item).getByText(/most recent common ancestor/),
    ).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Share link" }));
    const r = decodeReadingLink(shareUrl());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual({
      schema_version: 1,
      kind: "reading",
      id: "trees-mini",
      title: "Mammal reading",
      summary: "A small set",
      mode: "practice",
      taxa_pool: {},
      trees: {
        t1: {
          newick: NEWICK,
          node_letters: [],
          marks: [],
          traits: [],
          points: [],
        },
      },
      items: [
        {
          id: "q1",
          text: "Tap the MRCA of {set}.",
          trees: ["t1"],
          tips: ["a", "b"],
          question: { type: "mrca" },
          rotate_tool: true,
        },
      ],
    } satisfies object);
  });

  it("shows an item's InvalidReading message beside it and disables Share", () => {
    renderEditor();
    fillSetBasics();
    const slot = treeSlot("t1");
    fireEvent.change(
      within(slot).getByRole("textbox", { name: "Newick" }),
      { target: { value: NEWICK } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Add item" }));
    const item = itemSection("Item q1");
    // {a} is never bound — the loader's refusal names the item's text.
    fireEvent.change(
      within(item).getByRole("textbox", { name: "Question text" }),
      { target: { value: "Compare {a} to {b}." } },
    );
    const alert = within(item).getByRole("alert");
    expect(alert.textContent).toMatch(/text/);
    const disabled = (name: string) =>
      (screen.getByRole("button", { name }) as HTMLButtonElement)
        .disabled;
    expect(disabled("Share link")).toBe(true);
    expect(disabled("Save file")).toBe(true);
    expect(disabled("Preview")).toBe(true);
  });

  it("imports a #r= link, edits and shares the round trip", () => {
    renderEditor();
    fillSetBasics();
    const slot = treeSlot("t1");
    fireEvent.change(
      within(slot).getByRole("textbox", { name: "Newick" }),
      { target: { value: NEWICK } },
    );
    // A set needs at least one item before it loads — and shares.
    fireEvent.change(
      screen.getByRole("combobox", { name: "New item type" }),
      { target: { value: "count_clades" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Add item" }));
    const item = itemSection("Item q1");
    fireEvent.change(
      within(item).getByRole("textbox", { name: "Question text" }),
      { target: { value: "How many clades are there?" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Share link" }));
    const first = shareUrl();
    expect(first).toContain("#r=");

    // Re-import through the text field, then change the title.
    fireEvent.change(
      screen.getByRole("textbox", {
        name: "Import a file or #r= link",
      }),
      { target: { value: first } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Import text" }),
    );
    const title = screen.getByRole("textbox", {
      name: "Set title",
    }) as HTMLInputElement;
    expect(title.value).toBe("Mammal reading");
    fireEvent.change(title, { target: { value: "Mammal reading 2" } });

    fireEvent.click(screen.getByRole("button", { name: "Share link" }));
    const r = decodeReadingLink(shareUrl());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.title).toBe("Mammal reading 2");
    expect(r.value.trees.t1.newick).toBe(NEWICK);
  });
});
