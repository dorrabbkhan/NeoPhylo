// parseFilters / filtersQuery round-trips (v1.4c Task 12, spec §7.1).
// The pinned case: the empty `type=` filtersQuery writes when all four
// type boxes are unticked must decode back to no types — it used to hit
// the "no valid entries → every type" fallback, so a reload restored
// everything. A `type=` whose values are all unknown (`type=foo`)
// still means every type — unknown values are ignored, not an error.

import { describe, expect, it } from "vitest";

import type { Filters, TypeKey } from "./items";
import { filtersQuery, parseFilters, TYPE_ORDER } from "./items";

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
