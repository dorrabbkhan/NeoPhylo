// The re-route rule behind the hashchange watcher (checkpoint fix,
// owner decision 2026-11-22): reload only when a fragment change
// crosses a `#r=` boundary. The listener itself is a thin
// `window.location.reload()` over this predicate — the predicate is
// what the e2e same-tab `#r=` tests exercise end to end.

import { describe, expect, it } from "vitest";

import { rLinkChanged } from "./hashWatch";

describe("rLinkChanged", () => {
  it("fires when one #r= payload replaces another", () => {
    expect(rLinkChanged("#r=AAA", "#r=BBB")).toBe(true);
  });

  it("fires when #r= is added to a hash-less or anchored URL", () => {
    expect(rLinkChanged("", "#r=AAA")).toBe(true);
    expect(rLinkChanged("#main-content", "#r=AAA")).toBe(true);
  });

  it("fires when #r= leaves the URL", () => {
    expect(rLinkChanged("#r=AAA", "")).toBe(true);
    expect(rLinkChanged("#r=AAA", "#main-content")).toBe(true);
  });

  it("fires when an #x= share link becomes an #r= set", () => {
    expect(rLinkChanged("#x=AAA", "#r=BBB")).toBe(true);
  });

  it("ignores an unchanged #r= fragment", () => {
    expect(rLinkChanged("#r=AAA", "#r=AAA")).toBe(false);
  });

  it("ignores non-#r= changes like the Skip to content link", () => {
    expect(rLinkChanged("", "#main-content")).toBe(false);
    expect(rLinkChanged("#x=AAA", "#main-content")).toBe(false);
    expect(rLinkChanged("#x=AAA", "")).toBe(false);
    expect(rLinkChanged("#main-content", "#x=AAA")).toBe(false);
  });
});
