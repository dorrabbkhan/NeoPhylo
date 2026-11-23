// QuestionControls tests (v1.4d plan Task 8, spec §4.3/§7.3). Named
// test: `order_nodes` controls produce `Response::Order`. Every other
// control also must emit exactly the `Response` kind the engine's
// check pairs with that question — controls never compute the answer.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { useState } from "react";

import { afterEach, describe, expect, it, vi } from "vitest";

import { engine } from "../../engine/index";
import type { Item } from "../../engine/generated/Item";
import type { ReadingSet } from "../../engine/generated/ReadingSet";
import type { ReadingTreeView } from "../../engine/generated/ReadingTreeView";
import {
  effectiveResponse,
  fillItemText,
  submittable,
  type ResponseDraft,
} from "../../reading/state";

import { QuestionControls } from "./QuestionControls";

function loadDemo(): ReadingSet {
  const r = engine.loadReadingSet(
    readFileSync(
      resolve("..", "exercises", "reading", "trees-demo.json"),
      "utf8",
    ),
  );
  if (!r.ok) throw new Error("demo set refused");
  return r.value;
}

const DEMO = loadDemo();

function item(id: string): Item {
  const it = DEMO.items.find((x) => x.id === id);
  if (it === undefined) throw new Error(`no item ${id}`);
  return it;
}

function view(it: Item): ReadingTreeView {
  const r = engine.readingTree(DEMO, it.trees[0]);
  if (!r.ok) throw new Error(`view for ${it.trees[0]} refused`);
  return r.value;
}

// The controls are controlled — multi-step interactions need the
// harness to feed each emitted response back in, like the page does.
// The question element renders with it so the labelled-by-the-question
// assertions resolve real text, like ItemView's `.read-question`.
const QUESTION_ID = "test-question";

function Harness({
  it,
  view,
  initial,
  spy,
}: {
  it: Item;
  view: ReadingTreeView;
  initial: ResponseDraft | null;
  spy: (r: ResponseDraft | null) => void;
}) {
  const [r, setR] = useState<ResponseDraft | null>(initial);
  return (
    <>
      <p id={QUESTION_ID}>{fillItemText(it)}</p>
      <QuestionControls
        item={it}
        view={view}
        response={r}
        onResponse={(next) => {
          setR(next);
          spy(next);
        }}
        questionId={QUESTION_ID}
      />
    </>
  );
}

function setup(it: Item, response: ResponseDraft | null = null) {
  const onResponse = vi.fn();
  const ui = render(
    <Harness it={it} view={view(it)} initial={response} spy={onResponse} />,
  );
  return { onResponse, ...ui };
}

const lastResponse = (spy: ReturnType<typeof vi.fn>) =>
  spy.mock.calls.at(-1)?.[0] as ResponseDraft | null;

afterEach(cleanup);

describe("choice controls emit Response::Choice", () => {
  it("which_differs lists the trees plus 'all show the same'", () => {
    const { onResponse, getByRole } = setup(item("q-differs"));
    fireEvent.click(getByRole("radio", { name: /tree 3/i }));
    expect(lastResponse(onResponse)).toEqual({ kind: "choice", index: 2 });
    fireEvent.click(
      getByRole("radio", { name: /all show the same/i }),
    );
    expect(lastResponse(onResponse)).toEqual({ kind: "choice", index: 3 });
  });

  it("which_fits lists the candidate trees", () => {
    const { onResponse, getByRole } = setup(item("q-fits"));
    fireEvent.click(getByRole("radio", { name: /tree 2/i }));
    expect(lastResponse(onResponse)).toEqual({ kind: "choice", index: 1 });
  });

  it("is_clade offers yes/no", () => {
    const { onResponse, getByRole } = setup(item("q-clade"));
    fireEvent.click(getByRole("radio", { name: /yes/i }));
    expect(lastResponse(onResponse)).toEqual({ kind: "choice", index: 0 });
    fireEvent.click(getByRole("radio", { name: /no/i }));
    expect(lastResponse(onResponse)).toEqual({ kind: "choice", index: 1 });
  });

  it("is_clade by_trait offers mono/para/poly", () => {
    const { onResponse, getByRole } = setup(item("q-clade-trait"));
    fireEvent.click(getByRole("radio", { name: /paraphyletic/i }));
    expect(lastResponse(onResponse)).toEqual({ kind: "choice", index: 1 });
  });

  it("trait which_shared offers the trait names", () => {
    const { onResponse, getByRole } = setup(item("q-trait-shared"));
    fireEvent.click(getByRole("radio", { name: /^fur$/i }));
    expect(lastResponse(onResponse)).toEqual({ kind: "choice", index: 2 });
  });

  it("trait ancestral_or_derived offers the authored state names", () => {
    const { onResponse, getByRole } = setup(item("q-trait-ancder"));
    fireEvent.click(getByRole("radio", { name: /bare|ancestral/i }));
    expect(lastResponse(onResponse)).toEqual({ kind: "choice", index: 0 });
  });

  it("trait homologous offers homologous/independent", () => {
    const { onResponse, getByRole } = setup(item("q-trait-homo"));
    fireEvent.click(getByRole("radio", { name: /independent/i }));
    expect(lastResponse(onResponse)).toEqual({ kind: "choice", index: 1 });
  });

  it("closest_relative pairwise emits Response::Pairwise", () => {
    const { onResponse, getByRole } = setup(item("q-pair"));
    fireEvent.click(getByRole("radio", { name: /gorilla/i }));
    expect(lastResponse(onResponse)).toEqual({
      kind: "pairwise",
      answer: "C",
    });
    fireEvent.click(getByRole("radio", { name: /equally/i }));
    expect(lastResponse(onResponse)).toEqual({
      kind: "pairwise",
      answer: "Equal",
    });
  });
});

describe("multi-choice controls emit Response::Choices", () => {
  it("concept toggles option indices", () => {
    const { onResponse, getByRole } = setup(item("q-concept"));
    fireEvent.click(
      getByRole("checkbox", { name: /hypothetical common ancestor/i }),
    );
    expect(lastResponse(onResponse)).toEqual({
      kind: "choices",
      indices: [1],
    });
  });

  it("concept untoggles an already-picked option", () => {
    const { onResponse, getByRole } = setup(item("q-concept"), {
      kind: "choices",
      indices: [0, 1],
    });
    fireEvent.click(getByRole("checkbox", { name: /living species/i }));
    expect(lastResponse(onResponse)).toEqual({
      kind: "choices",
      indices: [1],
    });
  });

  it("select_true toggles statement indices", () => {
    const { onResponse, getAllByRole } = setup(item("q-select"));
    const boxes = getAllByRole("checkbox");
    expect(boxes).toHaveLength(5);
    fireEvent.click(boxes[0]);
    fireEvent.click(boxes[3]);
    expect(lastResponse(onResponse)).toEqual({
      kind: "choices",
      indices: [0, 3],
    });
  });

  it("trait profile toggles trait indices", () => {
    const { onResponse, getByRole } = setup(item("q-trait-profile"));
    fireEvent.click(getByRole("checkbox", { name: /hair/i }));
    fireEvent.click(getByRole("checkbox", { name: /nails/i }));
    expect(lastResponse(onResponse)).toEqual({
      kind: "choices",
      indices: [0, 3],
    });
  });
});

describe("number steppers emit Response::Number", () => {
  it("count_clades steps up and down from a typed value", () => {
    const { onResponse, getByRole } = setup(item("q-count"));
    fireEvent.click(getByRole("button", { name: /increase/i }));
    expect(lastResponse(onResponse)).toEqual({ kind: "number", value: 1 });
    const input = getByRole("spinbutton");
    fireEvent.change(input, { target: { value: "7" } });
    expect(lastResponse(onResponse)).toEqual({ kind: "number", value: 7 });
    fireEvent.click(getByRole("button", { name: /decrease/i }));
    expect(lastResponse(onResponse)).toEqual({ kind: "number", value: 6 });
  });

  it("the value never goes below zero", () => {
    const { onResponse, getByRole } = setup(item("q-count"), {
      kind: "number",
      value: 0,
    });
    fireEvent.click(getByRole("button", { name: /decrease/i }));
    expect(lastResponse(onResponse)).toEqual({ kind: "number", value: 0 });
  });
});

describe("order_nodes emits Response::Order", () => {
  it("tapping letter chips builds the sequence", () => {
    const { onResponse, getByRole } = setup(item("q-order"));
    fireEvent.click(getByRole("button", { name: /add r|node r/i }));
    fireEvent.click(getByRole("button", { name: /add p|node p/i }));
    expect(lastResponse(onResponse)).toEqual({
      kind: "order",
      letters: ["R", "P"],
    });
  });

  it("move-up/down and remove edit the sequence", () => {
    const { onResponse, getAllByRole, getByRole } = setup(item("q-order"), {
      kind: "order",
      letters: ["P", "Q", "R"],
    });
    // The harness is stateful, so each edit builds on the last:
    // P Q R → P R Q → R P Q → R Q.
    const ups = getAllByRole("button", { name: /move .*up/i });
    fireEvent.click(ups[2]);
    expect(lastResponse(onResponse)).toEqual({
      kind: "order",
      letters: ["P", "R", "Q"],
    });
    const downs = getAllByRole("button", { name: /move .*down/i });
    fireEvent.click(downs[0]);
    expect(lastResponse(onResponse)).toEqual({
      kind: "order",
      letters: ["R", "P", "Q"],
    });
    fireEvent.click(getByRole("button", { name: /remove p|p.*remove/i }));
    expect(lastResponse(onResponse)).toEqual({
      kind: "order",
      letters: ["R", "Q"],
    });
  });
});

describe("selection lists", () => {
  it("a tips response lists each picked tip with a remove button", () => {
    const { onResponse, getByRole } = setup(item("q-trait-have"), {
      kind: "tips",
      tips: ["bat", "cat"],
    });
    fireEvent.click(getByRole("button", { name: /remove bat/i }));
    expect(lastResponse(onResponse)).toEqual({
      kind: "tips",
      tips: ["cat"],
    });
  });

  it("a node response shows the picked clade and can be cleared", () => {
    const { onResponse, getByRole } = setup(item("q-mrca"), {
      kind: "node",
      clade: ["chimp", "gorilla", "gibbon", "human"],
    });
    fireEvent.click(getByRole("button", { name: /clear|remove/i }));
    expect(lastResponse(onResponse)).toBeNull();
  });

  it("a point response shows the letter and can be cleared", () => {
    const { onResponse, getByRole } = setup(item("q-mrca-points"), {
      kind: "point",
      letter: "W",
    });
    fireEvent.click(getByRole("button", { name: /clear|remove/i }));
    expect(lastResponse(onResponse)).toBeNull();
  });
});

describe("every group is labelled by the question (§21(p))", () => {
  // A screen reader entering a group must hear the question first,
  // then the bare instruction — "…different relationships from the
  // others. Which one? Choose one" — never "Choose one" alone.
  it("a radio group's name is the question plus its instruction", () => {
    setup(item("q-clade"));
    const group = screen.getByRole("radiogroup", {
      name: /do gibbon and gorilla form a clade\? choose one/i,
    });
    expect(group).toBeTruthy();
  });

  it("a checkbox group's name is the question plus its instruction", () => {
    setup(item("q-select"));
    const group = screen.getByRole("group", {
      name: /select every true statement\. tick every true statement/i,
    });
    expect(group).toBeTruthy();
  });

  it("the number input keeps its name and carries the question as description", () => {
    setup(item("q-count"));
    const input = screen.getByRole("spinbutton", { name: "Answer" });
    expect(input.getAttribute("aria-describedby")).toBe(QUESTION_ID);
  });

  it("the order builder and selection readout group under the question", () => {
    setup(item("q-order"));
    const builder = screen.getByRole("group", {
      name: /tap the lettered nodes in order/i,
    });
    expect(builder.classList.contains("read-order")).toBe(true);

    cleanup();
    setup(item("q-mrca"), {
      kind: "node",
      clade: ["chimp", "gorilla", "gibbon", "human"],
    });
    const sel = screen.getByRole("group", {
      name: /tap the most recent common ancestor/i,
    });
    expect(sel.classList.contains("read-sel")).toBe(true);
  });

  it("the two-tier Why? group names itself question plus Why?", () => {
    setup(item("q-two"));
    const why = screen.getByRole("radiogroup", {
      name: /form a clade — and why\? why\?/i,
    });
    expect(why).toBeTruthy();
  });
});

describe("two_tier", () => {
  it("nests the first question's response and a reason", () => {
    const { onResponse, getByRole } = setup(item("q-two"));
    fireEvent.click(getByRole("radio", { name: /yes/i }));
    expect(lastResponse(onResponse)).toEqual({
      kind: "two_tier",
      first: { kind: "choice", index: 0 },
      reason: -1,
    });
  });

  it("picking a reason completes the two-part answer", () => {
    const { onResponse, getByRole } = setup(item("q-two"), {
      kind: "two_tier",
      first: { kind: "choice", index: 0 },
      reason: -1,
    });
    fireEvent.click(getByRole("radio", { name: /no other tip/i }));
    expect(lastResponse(onResponse)).toEqual({
      kind: "two_tier",
      first: { kind: "choice", index: 0 },
      reason: 0,
    });
  });
});

describe("two_tier over a pairwise first", () => {
  // `Response::Pairwise` has no untouched value ("B" is a real
  // answer), so the draft's `first` is the null marker until the
  // student picks — the inner radios start empty and the marker is
  // mapped away before anything reaches the engine.
  function twoPairItem(): Item {
    return {
      ...item("q-pair"),
      id: "q-two-pair",
      text: "Is {a} more closely related to {b} or to {c} — and why?",
      question: {
        type: "two_tier",
        first: { type: "closest_relative", form: "pairwise" },
        reasons: [
          "They share a node that nothing else descends from.",
          "Their names sit side by side.",
        ],
        correct_reason: 0,
      },
    };
  }

  it("renders the inner pairwise with nothing selected", () => {
    const { getAllByRole } = setup(twoPairItem());
    for (const r of getAllByRole("radio")) {
      expect((r as HTMLInputElement).checked).toBe(false);
    }
  });

  it("a reason alone keeps the inner null and unsubmittable", () => {
    const { onResponse, getByRole } = setup(twoPairItem());
    fireEvent.click(getByRole("radio", { name: /side by side/i }));
    const r = lastResponse(onResponse);
    expect(r).toEqual({ kind: "two_tier", first: null, reason: 1 });
    // Check stays disabled — this draft is not submittable.
    expect(submittable(twoPairItem(), r)).toBe(false);
    expect(effectiveResponse(twoPairItem(), r)).toBeNull();
  });

  it("pairwise pick plus reason submits the real two_tier response", () => {
    const { onResponse, getByRole } = setup(twoPairItem());
    fireEvent.click(getByRole("radio", { name: /closer to chimp/i }));
    expect(lastResponse(onResponse)).toEqual({
      kind: "two_tier",
      first: { kind: "pairwise", answer: "B" },
      reason: -1,
    });
    fireEvent.click(getByRole("radio", { name: /nothing else descends/i }));
    const r = lastResponse(onResponse);
    expect(r).toEqual({
      kind: "two_tier",
      first: { kind: "pairwise", answer: "B" },
      reason: 0,
    });
    expect(submittable(twoPairItem(), r)).toBe(true);
    // What the page hands `readingCheck`.
    expect(effectiveResponse(twoPairItem(), r)).toEqual({
      kind: "two_tier",
      first: { kind: "pairwise", answer: "B" },
      reason: 0,
    });
  });

  it("picking the B option explicitly works and is submittable", () => {
    // "B" was the old sentinel's value; a real pick of it must still
    // count.
    const { onResponse, getByRole } = setup(twoPairItem());
    fireEvent.click(getByRole("radio", { name: /closer to chimp/i }));
    fireEvent.click(getByRole("radio", { name: /side by side/i }));
    expect(submittable(twoPairItem(), lastResponse(onResponse))).toBe(true);
  });

  it("no emitted draft carries the marker into an engine Response", () => {
    const { onResponse, getByRole } = setup(twoPairItem());
    fireEvent.click(getByRole("radio", { name: /side by side/i }));
    fireEvent.click(getByRole("radio", { name: /closer to gorilla/i }));
    fireEvent.click(getByRole("radio", { name: /closer to chimp/i }));
    for (const call of onResponse.mock.calls) {
      const r = effectiveResponse(twoPairItem(), call[0] as ResponseDraft | null);
      if (r !== null) {
        expect(JSON.stringify(r)).not.toContain('"first":null');
      }
    }
  });
});
