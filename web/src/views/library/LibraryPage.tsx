// The library, `?library` and `?labs` (v1.4c plan Task 12, spec §7.1):
// one card per lesson, lab and dataset — every title, level, minutes
// figure and objective read from the registries (catalog meta,
// labs/registry.ts, library/registry.ts), never typed into the page.
// `?labs` is the same page pre-filtered to the two lab types; its URL
// holds until the visitor touches a filter, at which point the state
// moves into `?library&…` via history.replaceState.
//
// Cards carry the type tag, level, minutes, objectives, the
// prepares-for / follows lines (the reverse is derived at runtime over
// lessons and labs), and the open / worksheet / answer-key actions the
// Task-11 route builders produce — the paper worksheet only when
// paperSheet returns a sheet (the ≤8-taxa rule stays inside Task 11's
// code). Datasets open through the same `?ds=` path as the dataset
// sheet; they have no worksheet or key actions.
//
// The header carries the instructor-guide link to `?guide` — the route
// itself is Task 13; the link goes live when it lands (conductor's
// call 3). Like the lab index before it this page is a lazy route
// (Root.tsx): the registries, ajv and the worksheet builders never
// enter the initial bundle.

import { useEffect, useMemo, useRef, useState } from "react";

import { initEngine } from "../../engine";
import { loadLab } from "../../labs/registry";
import type { DatasetSummary } from "../../library/registry";
import { listDatasets, loadProvenance } from "../../library/registry";
import { loadLesson } from "../../lessons/loader";
import { listReadingSets } from "../../reading/registry";
import type { ReadingSetSummary } from "../../reading/registry";
import { exerciseLink } from "../worksheets/load";
import { paperSheet } from "../../worksheets/build";
import { Wordmark } from "../Wordmark";
import { LabPrintStyles } from "../labs/LabPrintStyles";
import { CopyLmsText } from "./CopyLmsText";

import "../labs/labs.css";
import "./library.css";

import {
  buildItems,
  cardActions,
  datasetItem,
  filtersQuery,
  LEVEL_LABEL,
  matches,
  parseFilters,
  readingItem,
  TYPE_GROUP,
  TYPE_ORDER,
} from "./items";
import type { CardItem, Filters, TypeKey } from "./items";

const LAB_TYPES = new Set<TypeKey>(["phylip", "mega"]);

function sameTypes(a: Set<TypeKey>, b: Set<TypeKey>): boolean {
  return a.size === b.size && [...a].every((t) => b.has(t));
}

/** The paper-worksheet flag per exercise id — resolved lazily: each
 * lesson is fetched once and run through Task 11's paperSheet (which
 * owns the ≤8-taxa rule); labs load synchronously from the registry.
 * `undefined` while unsettled so the key link can wait for the kind. */
async function paperFlags(
  items: CardItem[],
): Promise<Record<string, boolean>> {
  const out: Record<string, boolean> = {};
  await initEngine();
  for (const it of items) {
    if (it.type === "datasets") continue;
    if (it.lab !== undefined) {
      const r = loadLab(it.id);
      out[it.id] =
        r.ok &&
        paperSheet(r.value, exerciseLink({ kind: "lab", lab: r.value }, it.id)) !==
          null;
    } else {
      const r = await loadLesson(it.id);
      out[it.id] =
        r.ok &&
        paperSheet(
          r.value,
          exerciseLink({ kind: "lesson", exercise: r.value }, it.id),
        ) !== null;
    }
  }
  return out;
}

function LabChain({ chain }: { chain: string[] }) {
  return (
    <p className="lab-chain">
      {chain.map((step, i) => (
        <span key={i}>
          {i > 0 && <span aria-hidden="true"> → </span>}
          <code>{step}</code>
        </span>
      ))}
    </p>
  );
}

function Card({
  item,
  paper,
  source,
  collapseSettings,
}: {
  item: CardItem;
  /** undefined while the paperSheet pass is still running. */
  paper: boolean | undefined;
  /** The dataset's provenance source line, when it has loaded. */
  source: string | undefined;
  /** The library folds each lab's option table behind a
   * "Settings (N options)" disclosure (owner request 2026-11-17);
   * the lab index passes false and keeps the tables in the open. */
  collapseSettings: boolean;
}) {
  const lab = item.lab;
  const ds = item.dataset;
  // issue #135: the same scroll-in-place region the lab pages use —
  // the card shrinks to the column and a too-wide settings table
  // scrolls inside it.
  const settingsRegion =
    lab === undefined ? null : (
      <div
        className="lab-settings-scroll"
        role="region"
        tabIndex={0}
        aria-label={`${lab.title} settings`}
      >
        <table className="lab-settings">
          <thead>
            <tr>
              <th scope="col">Option</th>
              <th scope="col">NeoPhylo</th>
            </tr>
          </thead>
          <tbody>
            {lab.settings.map((s, i) => (
              <tr key={i}>
                <td>{s.option}</td>
                <td>{s.neophylo}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  const actions = cardActions(item, paper);
  // v1.5 Task 7 (spec §6): every card offers the assignment builder —
  // content cards seed it with their own id; a dataset opens the
  // builder for the instructor to pick content.
  const assignHref =
    ds !== undefined
      ? "?editor&assign"
      : `?editor&assign=${encodeURIComponent(item.id)}`;
  return (
    <li
      className={lab !== undefined ? "lab-card lib-card" : "lib-card"}
      data-kind={item.type}
    >
      <div className="lab-card-head">
        <p className="lib-tags">
          <span className="lib-tag">{item.tag}</span>
          {item.level !== undefined && (
            <span className="lib-tag lib-tag-level">
              {LEVEL_LABEL[item.level]}
            </span>
          )}
        </p>
        <h3>{item.title}</h3>
        {lab !== undefined && <LabChain chain={lab.chain} />}
        {item.minutes !== undefined && (
          <p className="lab-minutes">About {item.minutes} min</p>
        )}
        {ds !== undefined && (
          <p className="lib-dataset-meta">
            {ds.taxa} taxa × {ds.sites} sites ·{" "}
            {ds.alphabet === "dna" ? "DNA" : "protein"}
          </p>
        )}
      </div>
      {item.objectives.length > 0 && (
        <ul className="lab-objectives">
          {item.objectives.map((o, i) => (
            <li key={i}>{o}</li>
          ))}
        </ul>
      )}
      {item.goodFor !== undefined && (
        <p className="lib-rel">Good for: {item.goodFor}</p>
      )}
      {ds !== undefined && (
        <p className="lib-dataset-source">
          Source: {source ?? "—"} · License: {ds.license}
        </p>
      )}
      {item.preparesFor.length > 0 && (
        <p className="lib-rel">
          Prepares for:{" "}
          {item.preparesFor.map((r, i) => (
            <span key={r.id}>
              {i > 0 && ", "}
              <a href={r.href}>{r.title}</a>
            </span>
          ))}
        </p>
      )}
      {item.follows.length > 0 && (
        <p className="lib-rel">
          Follows:{" "}
          {item.follows.map((r, i) => (
            <span key={r.id}>
              {i > 0 && ", "}
              <a href={r.href}>{r.title}</a>
            </span>
          ))}
        </p>
      )}
      {lab !== undefined &&
        (collapseSettings ? (
          <details className="lib-settings-details">
            <summary>
              Settings ({lab.settings.length} options)
            </summary>
            {settingsRegion}
          </details>
        ) : (
          settingsRegion
        ))}
      <p className="lab-card-actions">
        {actions.map((a) => (
          <a key={a.label} href={a.href}>
            {a.label}
          </a>
        ))}
        <a href={assignHref}>Make an assignment</a>
      </p>
      {actions[0] !== undefined && (
        <CopyLmsText title={item.title} href={actions[0].href} />
      )}
    </li>
  );
}

export function LibraryPage({
  initialTypes,
  collapseSettings = true,
}: {
  /** The type set used when the URL names none — LabIndex passes the
   * two lab types so `?labs` (or a bare mount in tests) opens filtered. */
  initialTypes?: ReadonlySet<TypeKey>;
  /** Owner request (2026-11-17): the library folds every lab card's
   * settings table behind a collapsed-by-default disclosure so the
   * page scans as a list; print reopens them all. LabIndex passes
   * false — the lab index keeps showing its tables, as before. */
  collapseSettings?: boolean;
}) {
  const root = useRef<HTMLElement>(null);
  const [items] = useState<CardItem[]>(() => buildItems());
  const [datasets, setDatasets] = useState<DatasetSummary[] | null>(null);
  const [datasetError, setDatasetError] = useState<string | null>(null);
  const [readingSets, setReadingSets] = useState<
    ReadingSetSummary[] | null
  >(null);
  const [sources, setSources] = useState<Map<string, string>>(new Map());
  const [paper, setPaper] = useState<Record<string, boolean>>({});
  const [filters, setFilters] = useState<Filters>(() =>
    parseFilters(window.location.search, initialTypes),
  );

  // Print shows every folded settings table: beforeprint/afterprint
  // cover real printing in Chromium and Firefox, and the print media
  // query's change event covers both those and the e2e's emulateMedia.
  // Only folds the page itself closed are reopened — a table the
  // visitor already opened stays open and is not closed afterwards.
  useEffect(() => {
    const el = root.current;
    if (el === null) return;
    const FLAG = "data-print-opened";
    const openAll = (): void => {
      for (const d of el.querySelectorAll<HTMLDetailsElement>(
        "details.lib-settings-details:not([open])",
      )) {
        d.setAttribute(FLAG, "");
        d.open = true;
      }
    };
    const restore = (): void => {
      for (const d of el.querySelectorAll<HTMLDetailsElement>(
        `details.lib-settings-details[${FLAG}]`,
      )) {
        d.open = false;
        d.removeAttribute(FLAG);
      }
    };
    const onPrintMedia = (e: MediaQueryListEvent): void => {
      if (e.matches) openAll();
      else restore();
    };
    window.addEventListener("beforeprint", openAll);
    window.addEventListener("afterprint", restore);
    // jsdom has no matchMedia — the unit tests render this page.
    const mq =
      typeof window.matchMedia === "function"
        ? window.matchMedia("print")
        : null;
    mq?.addEventListener("change", onPrintMedia);
    return () => {
      window.removeEventListener("beforeprint", openAll);
      window.removeEventListener("afterprint", restore);
      mq?.removeEventListener("change", onPrintMedia);
    };
  }, []);

  // Datasets and their provenance lines arrive over the network; the
  // lesson/lab cards are all synchronous.
  useEffect(() => {
    let live = true;
    listDatasets()
      .then((list) => {
        if (!live) return;
        setDatasets(list);
        for (const d of list) {
          loadProvenance(d)
            .then((p) => {
              if (!live || p === null) return;
              setSources((m) => new Map(m).set(d.id, p.source));
            })
            .catch(() => undefined);
        }
      })
      .catch((e: unknown) => {
        if (live) {
          setDatasetError(e instanceof Error ? e.message : String(e));
        }
      });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const flags = await paperFlags(items);
        if (live) setPaper(flags);
      } catch {
        // An engine failure only loses the paper/key actions; the
        // cards themselves are registry data and already rendered.
      }
    })();
    return () => {
      live = false;
    };
  }, [items]);

  // The shipped reading sets arrive with the engine like the datasets
  // (v1.4d Task 9): each file loads through loadReadingSet inside the
  // registry, so an unloadable file silently drops out rather than
  // erroring the page — an empty list is the failure mode. The list
  // must wait for initEngine: a call before wasm is ready throws and
  // the catch below would leave the cards empty for the session
  // (v1.4d Task 11).
  useEffect(() => {
    let live = true;
    void initEngine()
      .then(() => listReadingSets())
      .then((list) => {
        if (live) setReadingSets(list);
      })
      .catch(() => {
        if (live) setReadingSets([]);
      });
    return () => {
      live = false;
    };
  }, []);

  /** Write the filter state back to the URL as `?library&…` — a filter
   * change on `?labs` leaves the short URL for the canonical one. */
  const applyFilters = (next: (f: Filters) => Filters): void => {
    setFilters((f) => {
      const n = next(f);
      history.replaceState(null, "", filtersQuery(n));
      return n;
    });
  };

  const allItems = useMemo(
    () => [
      ...items,
      ...(datasets ?? []).map(datasetItem),
      ...(readingSets ?? []).map(readingItem),
    ],
    [items, datasets, readingSets],
  );
  const visible = allItems.filter((i) => matches(i, filters));
  const labsOnly = sameTypes(filters.types, LAB_TYPES);
  // The zero-match line waits on the async lists whenever they could
  // still match — while either is in flight "no items" would be a lie.
  const nothingMatches =
    visible.length === 0 &&
    (datasets !== null ||
      datasetError !== null ||
      !filters.types.has("datasets")) &&
    (readingSets !== null || !filters.types.has("reading"));

  const groupBody = (type: TypeKey, shown: CardItem[]) => {
    const anyOfType = allItems.some((i) => i.type === type);
    if (shown.length > 0) {
      return (
        <ol className="lab-list lib-list">
          {shown.map((item) => (
            <Card
              key={`${item.type}:${item.id}`}
              item={item}
              paper={paper[item.id]}
              source={sources.get(item.id)}
              collapseSettings={collapseSettings}
            />
          ))}
        </ol>
      );
    }
    if (type === "datasets") {
      if (datasets === null && datasetError === null) {
        return <p className="labs-empty">Loading datasets…</p>;
      }
      if (datasetError !== null) {
        return (
          <p className="labs-empty">
            The datasets couldn't be loaded — {datasetError}
          </p>
        );
      }
    }
    if (type === "reading" && readingSets === null) {
      return <p className="labs-empty">Loading reading sets…</p>;
    }
    if (anyOfType) {
      return (
        <p className="labs-empty">
          Nothing in this group matches the filters.
        </p>
      );
    }
    return (
      <p className="labs-empty">
        {type === "mega" ? "MEGA handouts are coming." : `No ${TYPE_GROUP[type].toLowerCase()} yet.`}
      </p>
    );
  };

  return (
    <main ref={root} className="lab-page lab-print library-page">
      <LabPrintStyles />
      <header className="lab-page-head lab-nav">
        <a
          className="editor-home"
          href={import.meta.env.BASE_URL}
          aria-label="Back to NeoPhylo"
        >
          <Wordmark size="sm" />
        </a>
        <a className="lab-nav-link" href="?guide">
          Instructor guide
        </a>
        <a className="lab-nav-link" href="?editor">
          Exercise editor
        </a>
      </header>
      <div className="lab-main">
        <h1>{labsOnly ? "Labs" : "Library"}</h1>
        <p className="lab-intro">
          Every lesson, lab and dataset in one place — open one, or take
          it as an in-app or paper worksheet with a gated answer key.
        </p>
        <fieldset className="lib-filters">
          <legend>Filter</legend>
          {TYPE_ORDER.map((t) => (
            <label className="lib-filter" key={t}>
              <input
                type="checkbox"
                checked={filters.types.has(t)}
                onChange={(e) =>
                  applyFilters((f) => {
                    const types = new Set(f.types);
                    if (e.target.checked) types.add(t);
                    else types.delete(t);
                    return { ...f, types };
                  })
                }
              />
              {TYPE_GROUP[t]}
            </label>
          ))}
          <label className="lib-filter lib-filter-level">
            Level
            <select
              value={filters.level}
              onChange={(e) =>
                applyFilters((f) => ({
                  ...f,
                  level: e.target.value as Filters["level"],
                }))
              }
            >
              <option value="all">All levels</option>
              <option value="intro">Intro</option>
              <option value="intermediate">Intermediate</option>
              <option value="advanced">Advanced</option>
            </select>
          </label>
          <label className="lib-filter">
            <input
              type="checkbox"
              checked={filters.short}
              onChange={(e) =>
                applyFilters((f) => ({ ...f, short: e.target.checked }))
              }
            />
            ≤ 30 min
          </label>
        </fieldset>
        {nothingMatches && (
          <p className="labs-empty">No items match these filters.</p>
        )}
        {TYPE_ORDER.map((t) => {
          if (!filters.types.has(t)) return null;
          const shown = visible.filter((i) => i.type === t);
          return (
            <section aria-label={TYPE_GROUP[t]} key={t}>
              <h2>{TYPE_GROUP[t]}</h2>
              {groupBody(t, shown)}
            </section>
          );
        })}
      </div>
    </main>
  );
}
