// Checkpoint 15 acceptance (A): the exported SVG/PNG is the SAME
// figure the screen draws — same layout and support-label placement —
// in both the rooted-on-outgroup and the computed (unrooted) views,
// for cytochrome-c after the seeded bootstrap run. The exported
// document carries data-split on every node and support label, each
// label's value equals its grouping's tally support, it sits within
// 30 px of its node, branch lengths match the on-screen drawing within
// 1%, the PNG is the fitted SVG at 2×, and the downloaded Newick's
// per-grouping support equals the tally in both views.

import { readFile } from "node:fs/promises";

import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

import { stepToEnd, waitForApp } from "./helpers";

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    window.localStorage.setItem("neophylo-e2e", "1");
  });
});

/** Engine state, recomputed in the page: the drawn tree in both views
 * plus the run's tally keyed by canonical grouping. */
async function expectedFigure(page: Page) {
  return page.evaluate(async () => {
    const w = window as unknown as {
      __neophylo: {
        engine: {
          parseFasta(t: string): { ok: boolean; value: unknown };
          parseNewick(t: string): { ok: boolean; value: unknown };
          distances(a: unknown, m: string): { ok: boolean; value: unknown };
          buildTree(
            m: unknown,
            method: string,
            opts: { trace: boolean },
          ): { ok: boolean; value: { tree: unknown } };
          bootstrapBatch(
            a: unknown,
            model: string,
            method: string,
            seed: number,
            start: number,
            count: number,
          ): {
            ok: boolean;
            value: {
              labels: string[];
              counts: { labels: string[]; count: number }[];
              successful: number;
            };
          };
          supportOnTree(t: unknown, tally: unknown): {
            ok: boolean;
            value: {
              nodes: { children: number[]; parent: number | null; label: string | null }[];
              branches: { support: number | null }[];
              root: number;
            };
          };
          referenceOutgroup(t: unknown): { ok: boolean; value: string[] };
          rerootOnOutgroup(
            t: unknown,
            og: string[],
          ): {
            ok: boolean;
            value: {
              tree: {
                nodes: { children: number[]; parent: number | null; label: string | null }[];
                branches: { support: number | null }[];
                root: number;
              };
            };
          };
        };
      };
    };
    interface T {
      nodes: { children: number[]; parent: number | null; label: string | null }[];
      branches: { support: number | null }[];
      root: number;
    }
    const { engine } = w.__neophylo;
    const ex = await fetch("/exercises/cytochrome-c.json").then((r) => r.json());
    const aln = engine.parseFasta(ex.data.fasta);
    if (!aln.ok) throw new Error("parseFasta failed");
    const m = engine.distances(aln.value, "Jtt");
    if (!m.ok) throw new Error("distances failed");
    const built = engine.buildTree(m.value, "Nj", { trace: false });
    if (!built.ok) throw new Error("buildTree failed");
    const tally = engine.bootstrapBatch(aln.value, "Jtt", "Nj", 1, 0, 100);
    if (!tally.ok) throw new Error("bootstrapBatch failed");
    const support = engine.supportOnTree(built.value.tree, tally.value);
    if (!support.ok) throw new Error("supportOnTree failed");
    const ref = engine.parseNewick(ex.reference.newick);
    if (!ref.ok) throw new Error("parseNewick failed");
    const og = engine.referenceOutgroup(ref.value);
    if (!og.ok) throw new Error("referenceOutgroup failed");
    const rr = engine.rerootOnOutgroup(support.value, og.value);
    if (!rr.ok) throw new Error("rerootOnOutgroup failed");

    const leafSet = (t: T, id: number, out = new Set<string>()) => {
      const n = t.nodes[id];
      if (n.children.length === 0) {
        if (n.label !== null) out.add(n.label);
      } else {
        for (const c of n.children) leafSet(t, c, out);
      }
      return out;
    };
    // The canonical unrooted side: the side NOT holding taxa[0] (the
    // same convention as data-split and the tally's rows).
    const canon = (t: T, id: number) => {
      const under = leafSet(t, id);
      const side = under.has(tally.value.labels[0])
        ? new Set(tally.value.labels.filter((l) => !under.has(l)))
        : under;
      return [...side].sort().join("|");
    };
    // grouping key -> drawn label text and integer Newick percent.
    const expectLabel = new Map<string, { text: string; pct: number }>();
    const visit = (t: T) => {
      for (let i = 0; i < t.nodes.length; i++) {
        const s = t.branches[i].support;
        if (s === null || t.nodes[i].parent === null) continue;
        expectLabel.set(canon(t, i), {
          text: `${Math.round(100 * s)}${s < 0.5 ? "*" : ""}`,
          pct: Math.round(100 * s),
        });
      }
    };
    visit(support.value as T);
    visit(rr.value.tree as T);
    // Every drawn grouping must be a tally row.
    const rows = new Set(
      tally.value.counts.map((c) => c.labels.slice().sort().join("|")),
    );
    for (const key of expectLabel.keys()) {
      if (!rows.has(key)) throw new Error(`drawn grouping ${key} not in tally`);
    }
    return {
      labels: tally.value.labels,
      rooted: Object.fromEntries(expectLabel),
    };
  });
}

interface ScreenNode {
  split: string | null;
  cx: number;
  cy: number;
  branch: number | null;
  label: { text: string; split: string | null; x: number; y: number } | null;
}

/** Extract node/label geometry from an svg — works on the live DOM
 * element and on a parsed export document (all attrs, no getBBox). */
function figureNodes(el: Element): Record<string, ScreenNode> {
  const nodes: Record<string, ScreenNode> = {};
  el.querySelectorAll("g[data-node]").forEach((g) => {
    const circle = g.querySelector(":scope > circle");
    const branch = g.querySelector(":scope > line.branch");
    const lab = g.querySelector(":scope > g.support > text.support-label");
    nodes[g.getAttribute("data-node")!] = {
      split: g.getAttribute("data-split"),
      cx: Number(circle!.getAttribute("cx")),
      cy: Number(circle!.getAttribute("cy")),
      branch:
        branch === null
          ? null
          : Number(branch.getAttribute("x2")) -
            Number(branch.getAttribute("x1")),
      label:
        lab === null
          ? null
          : {
              text: lab.textContent ?? "",
              split: lab.getAttribute("data-split"),
              x: Number(lab.getAttribute("x")),
              y: Number(lab.getAttribute("y")),
            },
    };
  });
  return nodes;
}

interface ExpectLabel {
  text: string;
  pct: number;
}

/** Assert the exported document equals the on-screen figure and the
 * tally, node for node (same data-node ids — it is the same tree). */
function checkFigure(
  screen: Record<string, ScreenNode>,
  exported: Record<string, ScreenNode>,
  expected: Record<string, ExpectLabel>,
  view: string,
) {
  expect(Object.keys(exported).sort(), `${view}: node set`).toEqual(
    Object.keys(screen).sort(),
  );
  const ids = Object.keys(screen);
  let labels = 0;
  let branches = 0;
  for (const id of ids) {
    const s = screen[id];
    const e = exported[id];
    // Every node carries the same canonical grouping key on screen
    // and in the export.
    expect(e.split, `${view}: data-split node ${id}`).toBe(s.split);
    expect(e.split, `${view}: data-split node ${id}`).not.toBeNull();
    // Branch lengths match the screen within 1%.
    if (s.branch !== null) {
      expect(e.branch, `${view}: branch node ${id}`).not.toBeNull();
      branches += 1;
      expect(
        Math.abs((e.branch as number) - s.branch) / s.branch,
        `${view}: branch length node ${id}`,
      ).toBeLessThanOrEqual(0.01);
    }
    if (s.label !== null) {
      labels += 1;
      // Same grouping and value as on screen.
      expect(e.label, `${view}: label node ${id}`).not.toBeNull();
      expect(e.label!.split).toBe(s.label.split);
      expect(e.label!.text).toBe(s.label.text);
      // The label's grouping key equals its node's — and its value
      // equals the tally support for that grouping.
      expect(s.label.split).toBe(s.split);
      const want = expected[s.split as string];
      expect(want, `${view}: tally row for ${s.split}`).toBeDefined();
      expect(s.label.text).toBe(want.text);
      // Within 30 px of its node (in the document's own coordinates).
      const d = Math.hypot(e.label!.x - e.cx, e.label!.y - e.cy);
      expect(d, `${view}: label distance node ${id}`).toBeLessThanOrEqual(30);
    }
  }
  expect(labels, `${view}: support labels drawn`).toBeGreaterThan(0);
  expect(branches, `${view}: branches drawn`).toBeGreaterThan(0);
}

/** Click an export item and return the downloaded bytes. */
async function downloadBytes(page: Page, name: string) {
  const [dl] = await Promise.all([
    page.waitForEvent("download"),
    page
      .locator(".export-menu")
      .getByRole("button", { name, exact: true })
      .click(),
  ]);
  return readFile((await dl.path())!);
}

/** Big-endian IHDR width/height of a PNG. */
function pngSize(buf: Buffer): { w: number; h: number } {
  expect(buf.subarray(1, 4).toString("ascii")).toBe("PNG");
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

test("cytochrome-c: exported SVG/PNG is the on-screen figure, both views", async ({
  page,
}) => {
  await page.goto("/?lesson=cytochrome-c");
  await waitForApp(page);
  await stepToEnd(page);
  await page.getByRole("button", { name: /Run bootstrap/ }).click();
  await expect(
    page.locator(".bootstrap-panel [role=status]"),
  ).toContainText("Run complete", { timeout: 30_000 });

  const expected = await expectedFigure(page);
  const svg = page.locator('svg[aria-label="Inferred tree"]');
  await expect(svg.locator(".support-label").first()).toBeVisible();

  interface View {
    item: string;
    nwk: string;
  }
  const views: View[] = [
    { item: "SVG (rooted on wheat)", nwk: "Newick (rooted on wheat)" },
    {
      item: "SVG (as computed, unrooted)",
      nwk: "Newick (as computed, unrooted)",
    },
  ];

  for (const [i, v] of views.entries()) {
    if (i === 1) {
      await page
        .getByRole("button", { name: "Show as computed (unrooted)" })
        .click();
      await expect(
        page.getByRole("button", {
          name: "Show rooted like the reference",
        }),
      ).toHaveAttribute("aria-pressed", "false");
    }
    const view = i === 0 ? "rooted" : "computed";

    const screen = await svg.evaluate(figureNodes);
    const svgText = (await downloadBytes(page, v.item)).toString("utf8");
    const parsed = await page.evaluate(
      (args) => {
        const fn = new Function(
          `return (${args.src})`,
        )() as (el: Element) => Record<string, ScreenNode>;
        const doc = new DOMParser().parseFromString(
          args.text,
          "image/svg+xml",
        );
        const err = doc.querySelector("parsererror");
        if (err !== null)
          throw new Error(`export not valid XML: ${err.textContent}`);
        const vb = doc.documentElement.getAttribute("viewBox")!.split(" ");
        return {
          nodes: fn(doc.documentElement),
          vw: Number(vb[2]),
          vh: Number(vb[3]),
        };
      },
      { src: figureNodes.toString(), text: svgText },
    );

    checkFigure(
      screen,
      parsed.nodes as Record<string, ScreenNode>,
      expected.rooted,
      view,
    );

    // PNG = the fitted SVG rasterized at 2× its viewBox size.
    const png = await downloadBytes(
      page,
      view === "rooted" ? "PNG (rooted on wheat)" : "PNG (as computed, unrooted)",
    );
    const size = pngSize(png);
    expect(size.w).toBe(Math.max(1, Math.ceil(parsed.vw * 2)));
    expect(size.h).toBe(Math.max(1, Math.ceil(parsed.vh * 2)));

    // Regression guard (v1.2 §6.8): every grouping's support in the
    // downloaded Newick equals the tally — in BOTH views.
    const nwkText = (await downloadBytes(page, v.nwk)).toString("utf8");
    const mismatches = await page.evaluate(
      (args) => {
        const { text, expected, taxa } = args as {
          text: string;
          expected: Record<string, { text: string; pct: number }>;
          taxa: string[];
        };
        const w = window as unknown as {
          __neophylo: {
            engine: {
              parseNewick(t: string): {
                ok: boolean;
                value: {
                  nodes: {
                    children: number[];
                    parent: number | null;
                    label: string | null;
                  }[];
                };
              };
            };
          };
        };
        const r = w.__neophylo.engine.parseNewick(text);
        if (!r.ok) throw new Error("downloaded Newick failed to parse");
        const t = r.value;
        const leafSet = (id: number, out = new Set<string>()) => {
          const n = t.nodes[id];
          if (n.children.length === 0) {
            if (n.label !== null) out.add(n.label);
          } else {
            for (const c of n.children) leafSet(c, out);
          }
          return out;
        };
        const canon = (id: number) => {
          const under = leafSet(id);
          const side = under.has(taxa[0])
            ? new Set(taxa.filter((l) => !under.has(l)))
            : under;
          return [...side].sort().join("|");
        };
        const bad: string[] = [];
        let labeled = 0;
        for (let i = 0; i < t.nodes.length; i++) {
          const n = t.nodes[i];
          if (n.children.length === 0 || n.label === null) continue;
          if (!/^\d+$/.test(n.label)) continue;
          labeled += 1;
          const want = expected[canon(i)];
          if (want === undefined) {
            bad.push(`unknown grouping ${canon(i)} -> ${n.label}`);
          } else if (want.pct !== Number(n.label)) {
            bad.push(`${canon(i)}: file ${n.label}, tally ${want.pct}`);
          }
        }
        return { bad, labeled };
      },
      { text: nwkText, expected: expected.rooted, taxa: expected.labels },
    );
    expect(mismatches.bad, `${view}: Newick support`).toEqual([]);
    expect(mismatches.labeled, `${view}: Newick has support`).toBeGreaterThan(0);
  }
});
