// Internal-link forms (v1.4c plan Task 13, spec §7.5): the markdown
// renderer may only ever turn these `?route` hrefs into anchors. The
// rejected half of the matrix is the safety case — http:,
// javascript:, data:, //, bare paths, fragments and unknown params
// must stay literal text.

import { describe, expect, it } from "vitest";

import {
  isInternalHref,
  markdownLinks,
  parseInternalHref,
  planItemHrefs,
} from "./links";

describe("parseInternalHref: accepted forms", () => {
  it.each([
    ["?lesson=nj-by-hand", { route: "lesson", id: "nj-by-hand" }],
    ["?lab=mega-bootstrap-100", { route: "lab", id: "mega-bootstrap-100" }],
    [
      "?worksheet=nj-by-hand&kind=paper",
      { route: "worksheet", id: "nj-by-hand", kind: "paper" },
    ],
    [
      "?key=nj-by-hand&kind=app",
      { route: "key", id: "nj-by-hand", kind: "app" },
    ],
    // kind is optional — the route defaults it to "app".
    ["?worksheet=saturation", { route: "worksheet", id: "saturation" }],
    ["?library", { route: "library" }],
    ["?library&type=mega", { route: "library" }],
    ["?library&type=lessons,phylip&level=intro&short=1", { route: "library" }],
    ["?labs", { route: "labs" }],
    ["?editor", { route: "editor" }],
  ])("%s", (href, want) => {
    expect(parseInternalHref(href)).toEqual(want);
    expect(isInternalHref(href)).toBe(true);
  });
});

describe("parseInternalHref: rejected forms", () => {
  it.each([
    // Anything that is not a `?` query — schemes, protocol-relative,
    // bare paths and fragments.
    "https://evil.example",
    "http://example.com/?lesson=x",
    "javascript:alert(1)",
    "javascript:alert(1)?lesson=x",
    "data:text/html,<b>x</b>",
    "//example.com/?lesson=x",
    "/?lesson=x",
    "lesson=x",
    "#x=abc",
    "?lesson=x#fragment",
    // Malformed or ambiguous queries.
    "?",
    "??lesson=x",
    "?lesson=x?lab=y",
    "?lesson=",
    "?lesson=x y",
    "?lesson=a b",
    '?lesson=x"onclick=1',
    "?lesson=x&lab=y",
    "?lab=mega-bootstrap-100&foo=1",
    "?worksheet=x&kind=side",
    "?key=x&kind=",
    "?key=x&kind=paper&extra=1",
    "?labs&type=mega",
    "?labs=1",
    "?editor=1",
    "?library=1",
    "?library&type=unknown",
    "?library&level=beginner",
    "?library&short=2",
    "?library&foo=1",
    // Route names are exact: no case, no lookalikes.
    "?Lesson=x",
    "?labs2",
    "?editors",
  ])("%s is not an internal link", (href) => {
    expect(parseInternalHref(href)).toBeNull();
    expect(isInternalHref(href)).toBe(false);
  });
});

describe("markdownLinks", () => {
  it("collects every [text](href) in order", () => {
    const src =
      "see [the library](?library) then [x](https://bad) and [k](?key=a&kind=app)";
    expect(markdownLinks(src)).toEqual([
      { text: "the library", href: "?library" },
      { text: "x", href: "https://bad" },
      { text: "k", href: "?key=a&kind=app" },
    ]);
  });
});

describe("planItemHrefs", () => {
  it("returns the hrefs of an all-link ordered list", () => {
    const block = [
      "1. [A](?lesson=a)",
      "2. [B](?lab=b)",
      "3. [C](?worksheet=c&kind=paper)",
    ].join("\n");
    expect(planItemHrefs(block)).toEqual([
      "?lesson=a",
      "?lab=b",
      "?worksheet=c&kind=paper",
    ]);
  });

  it("is null when an item is not a single link", () => {
    expect(planItemHrefs("1. [A](?lesson=a)\n2. plain text")).toBeNull();
    expect(planItemHrefs("1. [A](?lesson=a) — extra")).toBeNull();
    expect(planItemHrefs("- [A](?lesson=a)")).toBeNull();
    expect(planItemHrefs("just a paragraph")).toBeNull();
  });
});
