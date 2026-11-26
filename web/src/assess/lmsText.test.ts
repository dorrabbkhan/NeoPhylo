// lmsText.ts unit tests (v1.5 plan Task 8, spec §7.5): every LMS
// variant names the link, the ID to type and where the code is
// pasted — the owner-review wording lives here.

import { describe, expect, it } from "vitest";

import { LMS_KINDS, lmsText, type LmsKind } from "./lmsText";

const A = {
  title: "Homework 3 — neighbour joining",
  link: "https://neophylo.example/app/#a=XYZ",
  idLabel: "student number",
  code: true,
};

describe("lmsText", () => {
  it("covers the four LMS shapes", () => {
    expect(LMS_KINDS).toEqual(["canvas", "moodle", "forms", "plain"]);
  });

  it.each(LMS_KINDS)("the %s text names the link, the id and the paste spot", (k: LmsKind) => {
    const t = lmsText(A, k);
    expect(t.plain).toContain(A.title);
    expect(t.plain).toContain(A.link);
    expect(t.plain).toContain("student number");
    expect(t.plain).toContain("completion code");
    expect(t.html).toContain(`href="${A.link}"`);
    expect(t.html).toContain("student number");
  });

  it("each variant is the owner wording verbatim, in both shapes", () => {
    const SPOT: Record<LmsKind, string> = {
      canvas: "into this Canvas assignment's text-entry box",
      moodle: "into the Moodle answer box for this assignment",
      forms: "into the form's answer field",
      plain: "where your instructor collects answers",
    };
    for (const k of LMS_KINDS) {
      const t = lmsText(A, k);
      expect(t.plain).toBe(
        `Homework 3 — neighbour joining — open https://neophylo.example/app/#a=XYZ and work through it in NeoPhylo. When the page asks for an ID, type your student number. When you finish, copy the completion code NeoPhylo shows and paste it ${SPOT[k]}.`,
      );
      expect(t.html).toBe(
        `<p>Homework 3 — neighbour joining — open <a href="https://neophylo.example/app/#a=XYZ">https://neophylo.example/app/#a=XYZ</a> and work through it in NeoPhylo. When the page asks for an ID, type your student number. When you finish, copy the completion code NeoPhylo shows and paste it ${SPOT[k]}.</p>`,
      );
    }
  });

  it("a plain-lesson source asks for no id and names no code", () => {
    const t = lmsText(
      { title: "L", link: "https://x/?lesson=1", idLabel: null, code: false },
      "canvas",
    );
    expect(t.plain).not.toContain("ID");
    expect(t.plain).not.toContain("completion code");
    expect(t.plain).toContain("https://x/?lesson=1");
  });

  it("escapes markup in the html variant", () => {
    const t = lmsText(
      {
        title: "A <b>title</b>",
        link: "https://x/?a=1&b=2",
        idLabel: "id",
        code: true,
      },
      "plain",
    );
    expect(t.html).toContain("A &lt;b&gt;title&lt;/b&gt;");
    expect(t.html).toContain("?a=1&amp;b=2");
  });
});
