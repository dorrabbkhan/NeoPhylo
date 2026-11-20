// parseFilters / filtersQuery round-trips (v1.4c Task 12, spec §7.1).
// The pinned case: the empty `type=` filtersQuery writes when all four
// type boxes are unticked must decode back to no types — it used to hit
// the "no valid entries → every type" fallback, so a reload restored
// everything. A `type=` whose values are all unknown (`type=foo`)
// still means every type — unknown values are ignored, not an error.

import { describe, expect, it } from "vitest";

import type { CardItem, Filters, TypeKey } from "./items";
import {
  filtersQuery,
  matches,
  parseFilters,
  TYPE_ORDER,
} from "./items";

const ALL = new Set<TypeKey>(TYPE_ORDER);

function filters(types: ReadonlySet<TypeKey>): Filters {
  return { types: new Set(types), level: "all", short: false };
}

describe("library filters — type= URL round-trip", () => {
  it("no types writes ?library&type= and reads back as no types", () => {
    const q = filtersQuery(filters(new Set()));
    expect(q).toBe("?library&type=");
    expect(parseFilters(q).types.size).toBe(0);
  });

  it("all types writes bare ?library and reads back as all types", () => {
    const q = filtersQuery(filters(ALL));
    expect(q).toBe("?library");
    expect(parseFilters(q).types).toEqual(ALL);
  });

  it("one type writes ?library&type=<t> and reads back as that type", () => {
    const q = filtersQuery(filters(new Set<TypeKey>(["mega"])));
    expect(q).toBe("?library&type=mega");
    expect(parseFilters(q).types).toEqual(new Set(["mega"]));
  });

  it("a subset keeps the canonical type order in the query", () => {
    expect(
      filtersQuery(filters(new Set<TypeKey>(["datasets", "phylip"]))),
    ).toBe("?library&type=phylip,datasets");
  });

  it("a type= whose values are all unknown still means every type", () => {
    expect(parseFilters("?library&type=foo").types).toEqual(ALL);
    expect(parseFilters("?library&type=foo,bar").types).toEqual(ALL);
  });

  it("a mixed list keeps the known entries and drops the unknown", () => {
    expect(parseFilters("?library&type=mega,bogus").types).toEqual(
      new Set(["mega"]),
    );
  });

  it("level and short ride along on the same query", () => {
    const q = filtersQuery({
      types: new Set<TypeKey>(["lessons"]),
      level: "intro",
      short: true,
    });
    expect(q).toBe("?library&type=lessons&level=intro&short=1");
    expect(parseFilters(q)).toEqual({
      types: new Set(["lessons"]),
      level: "intro",
      short: true,
    });
  });
});

// v1.4d Task 9 (spec §7.1/§8.4): the "reading" TypeKey — the header's
// "Reading trees" link lands on `?library&type=reading`, so the value
// must parse, combine with the other filters and round-trip through a
// reload like every other type.
describe("library filters — the reading type (v1.4d Task 9)", () => {
  it("type=reading parses, writes canonically and reads back", () => {
    expect(parseFilters("?library&type=reading").types).toEqual(
      new Set(["reading"]),
    );
    const q = filtersQuery(filters(new Set<TypeKey>(["reading"])));
    expect(q).toBe("?library&type=reading");
    expect(parseFilters(q).types).toEqual(new Set(["reading"]));
  });

  it("reading combines with level and short and survives a reload", () => {
    const q = filtersQuery({
      types: new Set<TypeKey>(["reading", "lessons"]),
      level: "intro",
      short: true,
    });
    // Canonical type order keeps reading beside lessons.
    expect(q).toBe("?library&type=lessons,reading&level=intro&short=1");
    expect(parseFilters(q)).toEqual({
      types: new Set(["lessons", "reading"]),
      level: "intro",
      short: true,
    });
  });

  it("a reading card filters by type, level and minutes like the other kinds", () => {
    const card: CardItem = {
      id: "trees-sample",
      type: "reading",
      title: "Sample reading set",
      tag: "Tree reading",
      level: "intro",
      minutes: 20,
      objectives: [],
      preparesFor: [],
      follows: [],
    };
    const readingOnly = filters(new Set<TypeKey>(["reading"]));
    expect(matches(card, readingOnly)).toBe(true);
    expect(matches(card, filters(new Set<TypeKey>(["lessons"])))).toBe(false);
    expect(
      matches(card, { ...readingOnly, level: "intro" }),
    ).toBe(true);
    expect(
      matches(card, { ...readingOnly, level: "advanced" }),
    ).toBe(false);
    expect(matches(card, { ...readingOnly, short: true })).toBe(true);
    // Like every kind, a reading set without minutes is hidden by the
    // "≤ 30 min" filter.
    expect(
      matches({ ...card, minutes: undefined }, { ...readingOnly, short: true }),
    ).toBe(false);
  });
});
