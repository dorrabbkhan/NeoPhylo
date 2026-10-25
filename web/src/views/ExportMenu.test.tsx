// Export menu tests (v1.1 plan Task 13): the "Distance matrix (PHYLIP)"
// item downloads distances.phy produced by engine.writePhylipMatrix
// (Auto names) and explains the Relaxed fallback when names are too long.

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { engine } from "../engine/index";
import type { Alignment } from "../engine/generated/Alignment";
import type { DistanceMatrix } from "../engine/generated/DistanceMatrix";
import type { Tree } from "../engine/generated/Tree";

import { ExportMenu } from "./ExportMenu";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const ALN: Alignment = {
  labels: ["a", "b", "c"],
  seqs: [
    [65, 67, 71, 84],
    [65, 67, 71, 65],
    [65, 67, 65, 84],
  ],
  alphabet: "dna",
};

const MATRIX: DistanceMatrix = {
  labels: ["a", "b", "c"],
  model: "Jc69",
  cells: [
    { Value: 0 },
    { Value: 0.1 },
    { Value: 0.2 },
    { Value: 0.1 },
    { Value: 0 },
    { Value: 0.15 },
    { Value: 0.2 },
    { Value: 0.15 },
    { Value: 0 },
  ],
};

/** Stub object URLs and capture every downloaded file name. The spies
 * leave `URL` a real constructor — the lazy export chunks' dynamic
 * import goes through vitest's module runner, which does `new URL()`. */
function stubDownloads(): string[] {
  const names: string[] = [];
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:fake");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
    function (this: HTMLAnchorElement) {
      names.push(this.download);
    },
  );
  return names;
}

const MENU_LABEL = "Distance matrix (PHYLIP)";

describe("ExportMenu PHYLIP matrix", () => {
  it("downloads distances.phy via writePhylipMatrix with Auto names", async () => {
    const downloads = stubDownloads();
    render(
      <ExportMenu
        tree={null}
        alignment={ALN}
        correction="Jc69"
        method="Nj"
        clampNegative={false}
        matrix={MATRIX}
        treeView={{ kind: "plain" }}
        consensusTree={null}
        bootstrap={null}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: MENU_LABEL }));
    await waitFor(() => expect(downloads).toEqual(["distances.phy"]));
  });

  it("is disabled while no distance matrix exists", () => {
    render(
      <ExportMenu
        tree={null}
        alignment={ALN}
        correction="Jc69"
        method="Nj"
        clampNegative={false}
        matrix={null}
        treeView={{ kind: "plain" }}
        consensusTree={null}
        bootstrap={null}
      />,
    );
    expect(
      screen.getByRole("button", { name: MENU_LABEL }),
    ).toHaveProperty("disabled", true);
  });

  it("explains the Relaxed fallback when a name exceeds 10 characters", async () => {
    stubDownloads();
    const long: DistanceMatrix = {
      ...MATRIX,
      labels: ["Homo_sapiens", "b", "c"],
    };
    render(
      <ExportMenu
        tree={null}
        alignment={ALN}
        correction="Jc69"
        method="Nj"
        clampNegative={false}
        matrix={long}
        treeView={{ kind: "plain" }}
        consensusTree={null}
        bootstrap={null}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: MENU_LABEL }));
    expect(await screen.findByText(/Relaxed names/)).toBeTruthy();
  });
});

// ---- v1.2 Task 15: exports follow the current display (spec §6.8) ----

function parse(nwk: string): Tree {
  const r = engine.parseNewick(nwk);
  if (!r.ok) throw new Error(`parseNewick failed: ${JSON.stringify(r.error)}`);
  return r.value;
}

/** A tree carrying bootstrap support on one internal branch. */
function supportTree(): Tree {
  const t = parse("((A:0.1,B:0.2):0.05,C:0.3);");
  const internal = t.nodes.findIndex(
    (n, i) => n.children.length > 0 && n.parent !== null && i !== t.root,
  );
  t.branches[internal].support = 0.87;
  return t;
}

/** Capture downloaded (name, text) pairs by stubbing URL.createObjectURL. */
async function stubDownloadTexts(): Promise<{
  names: string[];
  texts: () => Promise<string[]>;
}> {
  const names: string[] = [];
  const blobs: Blob[] = [];
  vi.spyOn(URL, "createObjectURL").mockImplementation((b) => {
    blobs.push(b as Blob);
    return "blob:fake";
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
    function (this: HTMLAnchorElement) {
      names.push(this.download);
    },
  );
  return { names, texts: () => Promise.all(blobs.map((b) => b.text())) };
}

const BASE = {
  alignment: ALN,
  correction: "Jc69" as const,
  method: "Nj" as const,
  clampNegative: false,
  matrix: null,
};

describe("ExportMenu bootstrap exports (v1.2 spec §6.8)", () => {
  it("names the tree items after the display's rooting", () => {
    render(
      <ExportMenu
        {...BASE}
        tree={supportTree()}
        treeView={{ kind: "rooted", outgroup: ["wheat"] }}
        consensusTree={parse("((A,B),(C,D),E);")}
        bootstrap={null}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Newick (rooted on wheat)" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "SVG (rooted on wheat)" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "PNG (rooted on wheat)" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: "Consensus (Newick, rooted on wheat)",
      }),
    ).toBeTruthy();
  });

  it("names the tree items after the computed (unrooted) view", () => {
    render(
      <ExportMenu
        {...BASE}
        tree={supportTree()}
        treeView={{ kind: "computed" }}
        consensusTree={parse("((A,B),(C,D),E);")}
        bootstrap={null}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Newick (as computed, unrooted)" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "SVG (as computed, unrooted)" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "PNG (as computed, unrooted)" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: "Consensus (Newick, as computed, unrooted)",
      }),
    ).toBeTruthy();
  });

  it("the label follows the toggle immediately", () => {
    const { rerender } = render(
      <ExportMenu
        {...BASE}
        tree={supportTree()}
        treeView={{ kind: "rooted", outgroup: ["wheat"] }}
        consensusTree={null}
        bootstrap={null}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Newick (rooted on wheat)" }),
    ).toBeTruthy();
    rerender(
      <ExportMenu
        {...BASE}
        tree={supportTree()}
        treeView={{ kind: "computed" }}
        consensusTree={null}
        bootstrap={null}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Newick (as computed, unrooted)" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Newick (rooted on wheat)" }),
    ).toBeNull();
  });

  it("keeps the items plain when no reroot view exists", () => {
    render(
      <ExportMenu
        {...BASE}
        tree={supportTree()}
        treeView={{ kind: "plain" }}
        consensusTree={parse("((A,B),(C,D),E);")}
        bootstrap={null}
      />,
    );
    expect(screen.getByRole("button", { name: "Newick" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "SVG" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "PNG" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Consensus (Newick)" }),
    ).toBeTruthy();
  });

  it("Newick export writes support as integer-% internal labels", async () => {
    const { names, texts } = await stubDownloadTexts();
    render(
      <ExportMenu
        {...BASE}
        tree={supportTree()}
        treeView={{ kind: "plain" }}
        consensusTree={null}
        bootstrap={null}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Newick" }));
    expect(names).toEqual(["neophylo-tree.nwk"]);
    const [nwk] = await texts();
    expect(nwk).toContain(")87:0.05");
  });

  it("Consensus (Newick) exports the current tab's tree, disabled without one", async () => {
    const { names, texts } = await stubDownloadTexts();
    const consensus = parse("((A,B),(C,D),E);");
    render(
      <ExportMenu
        {...BASE}
        tree={supportTree()}
        treeView={{ kind: "plain" }}
        consensusTree={consensus}
        bootstrap={{ replicates: 100, seed: 1 }}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Consensus (Newick)" }),
    );
    expect(names).toEqual(["neophylo-consensus.nwk"]);
    const [nwk] = await texts();
    expect(nwk).toContain("((A,B),(C,D),E);");
  });

  it("Consensus (Newick) is disabled when no bootstrap result exists", () => {
    render(
      <ExportMenu
        {...BASE}
        tree={supportTree()}
        treeView={{ kind: "plain" }}
        consensusTree={null}
        bootstrap={null}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Consensus (Newick)" }),
    ).toHaveProperty("disabled", true);
  });

  it("the R script gains a bootstrap loop when a run happened", async () => {
    const { names, texts } = await stubDownloadTexts();
    render(
      <ExportMenu
        {...BASE}
        tree={supportTree()}
        treeView={{ kind: "plain" }}
        consensusTree={null}
        bootstrap={{ replicates: 100, seed: 1 }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "R script" }));
    await waitFor(() => expect(names).toEqual(["neophylo-analysis.R"]));
    const [script] = await texts();
    expect(script).not.toContain("boot.phylo(tree");
    expect(script).toContain("for (i in seq_len(B))");
    expect(script).toContain("B <- 100");
    expect(script).toContain("set.seed(1)");
  });
});

// ---- fix/newick-compatible-names: label mode (checkpoint-15) ----

/** A tree whose leaf names force quoting under standard Newick. */
function quotedTree(): Tree {
  return parse("('Homo sapiens':0.1,'O''Brien':0.15,Dog:0.3);");
}

const MODE_LABEL = /Newick names/;

describe("ExportMenu Newick label mode (checkpoint-15)", () => {
  it("defaults to Exact when no name needs quoting", async () => {
    const { names, texts } = await stubDownloadTexts();
    render(
      <ExportMenu
        {...BASE}
        tree={supportTree()}
        treeView={{ kind: "plain" }}
        consensusTree={null}
        bootstrap={null}
      />,
    );
    const sel = screen.getByLabelText(MODE_LABEL);
    expect(sel).toHaveProperty("value", "exact");
    fireEvent.click(screen.getByRole("button", { name: "Newick" }));
    expect(names).toEqual(["neophylo-tree.nwk"]);
    const [nwk] = await texts();
    expect(nwk).toContain(")87:0.05");
    expect(nwk).not.toContain("'");
  });

  it("defaults to Compatible when a name needs quoting, and explains why", () => {
    render(
      <ExportMenu
        {...BASE}
        tree={quotedTree()}
        treeView={{ kind: "plain" }}
        consensusTree={null}
        bootstrap={null}
      />,
    );
    expect(screen.getByLabelText(MODE_LABEL)).toHaveProperty(
      "value",
      "compatible",
    );
    expect(screen.getByText(/Compatible names are the default/)).toBeTruthy();
    expect(screen.getByText(/O'Brien → O_Brien/)).toBeTruthy();
  });

  it("compatible Newick writes mapped names plus a name-map CSV", async () => {
    const { names, texts } = await stubDownloadTexts();
    render(
      <ExportMenu
        {...BASE}
        tree={quotedTree()}
        treeView={{ kind: "plain" }}
        consensusTree={null}
        bootstrap={null}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Newick" }));
    expect(names).toEqual([
      "neophylo-tree.nwk",
      "neophylo-name-map.csv",
    ]);
    const [nwk, csv] = await texts();
    expect(nwk).toBe("(Homo_sapiens:0.1,O_Brien:0.15,Dog:0.3);");
    expect(csv).toBe(
      "original,exported\nHomo sapiens,Homo_sapiens\nO'Brien,O_Brien\n",
    );
  });

  it("Exact mode stays quoted when the user picks it", async () => {
    const { names, texts } = await stubDownloadTexts();
    render(
      <ExportMenu
        {...BASE}
        tree={quotedTree()}
        treeView={{ kind: "plain" }}
        consensusTree={null}
        bootstrap={null}
      />,
    );
    fireEvent.change(screen.getByLabelText(MODE_LABEL), {
      target: { value: "exact" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Newick" }));
    expect(names).toEqual(["neophylo-tree.nwk"]);
    const [nwk] = await texts();
    expect(nwk).toBe("('Homo sapiens':0.1,'O''Brien':0.15,Dog:0.3);");
  });

  it("the mode applies to Consensus (Newick) too", async () => {
    const { names, texts } = await stubDownloadTexts();
    const consensus = parse("('Homo sapiens','O''Brien',Dog);");
    render(
      <ExportMenu
        {...BASE}
        tree={quotedTree()}
        treeView={{ kind: "plain" }}
        consensusTree={consensus}
        bootstrap={null}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Consensus (Newick)" }),
    );
    expect(names).toEqual([
      "neophylo-consensus.nwk",
      "neophylo-name-map.csv",
    ]);
    const [nwk] = await texts();
    expect(nwk).toBe("(Homo_sapiens,O_Brien,Dog);");
  });
});
