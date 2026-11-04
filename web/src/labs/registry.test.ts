// Lab registry tests (v1.4 plan Task 11, spec §6.2/§6.5). The shipped
// registry is exercises/labs/*.json — Task 12's packs land
// dnadist-neighbor and protdist-neighbor there — plus the e2e-only files in __fixtures__/
// that join only under the `neophylo-e2e` localStorage flag. A lab file is an
// exercise with a `lab` block: loadLab validates the whole file
// against exercises/schema.json and through engine.loadExercise, and
// a registry file without the block is refused with the reason.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { listLabs, loadLab } from "./registry";

beforeEach(() => {
  window.localStorage.setItem("neophylo-e2e", "1");
});

afterEach(() => {
  window.localStorage.removeItem("neophylo-e2e");
});

describe("lab registry", () => {
  it("lists lab files and skips registry files without a valid lab block", () => {
    const labs = listLabs();
    const ids = labs.map((l) => l.id);
    expect(ids).toContain("test-lab");
    expect(ids).toContain("mega-test-lab");
    expect(ids).not.toContain("no-lab-block");
    expect(ids).not.toContain("bad-lab");
    const lab = labs.find((l) => l.id === "test-lab");
    expect(lab?.title).toBe("Test lab: dnadist → neighbor");
    expect(lab?.objectives.length).toBe(2);
    expect(lab?.chain).toEqual(["dnadist", "neighbor"]);
    expect(lab?.settings.length).toBe(3);
  });

  it("resolves tool: absent means phylip, \"mega\" marks a MEGA lab", () => {
    const labs = listLabs();
    expect(labs.find((l) => l.id === "test-lab")?.tool).toBe("phylip");
    const mega = labs.find((l) => l.id === "mega-test-lab");
    expect(mega?.tool).toBe("mega");
    expect(mega?.chain).toEqual([
      "Distances → Compute pairwise distances",
      "Phylogeny → NJ",
    ]);
    // The MEGA settings rows carry mega_menu/mega_setting, not
    // phylip_default.
    const row = mega?.settings[0];
    expect(row !== undefined && "mega_menu" in row).toBe(true);
    expect(row !== undefined && "mega_setting" in row).toBe(true);
  });

  it("loadLab returns a MEGA lab's exercise and lab block", () => {
    const r = loadLab("mega-test-lab");
    if (!r.ok) {
      throw new Error(`mega-test-lab must load: ${JSON.stringify(r.error)}`);
    }
    expect(r.value.lab.tool).toBe("mega");
    expect(r.value.lab.title).toBe("Test MEGA lab: distances → NJ");
    expect(r.value.exercise.analysis.site_filter).toEqual({
      kind: "partial",
      cutoff_pct: 95,
    });
  });

  // Each refusal below names a field path — the same convention the
  // bad-lab test pins. The null and array cases cover serde's
  // null-is-absent gap (plan Global Constraints; conductor note 5).
  const REFUSALS: [string, RegExp][] = [
    // a mega lab carrying phylip_note_md (and no mega_note_md)
    ["mega-lab-phylip-note", /mega_note_md/],
    // tool: null — serde would read it as absent, the schema must not
    ["mega-lab-null-tool", /tool/],
    // tool: []
    ["mega-lab-array-tool", /tool/],
    // mega_note_md: null on an otherwise valid mega lab
    ["mega-lab-null-note", /mega_note_md/],
    // a settings item's mega_menu: null
    ["mega-lab-null-menu", /mega_menu/],
    // a settings item's mega_menu: []
    ["mega-lab-array-menu", /mega_menu/],
    // a settings item's mega_setting: null
    ["mega-lab-null-setting", /mega_setting/],
    // a settings item's mega_setting: []
    ["mega-lab-array-setting", /mega_setting/],
    // mega_note_md: [] on an otherwise valid mega lab
    ["mega-lab-array-note", /mega_note_md/],
    // a MEGA lab's chain item: null
    ["mega-lab-null-chain-item", /chain/],
    // a MEGA lab's chain item: []
    ["mega-lab-array-chain-item", /chain/],
    // a phylip lab (tool absent) missing phylip_note_md
    ["phylip-lab-no-note", /phylip_note_md/],
    // lab.minutes (v1.4b Task 13 handout 1, spec §7.3): optional
    // integer 5–180 on either tool — null, array, float, out of range
    // and a string are each refused naming the field.
    ["mega-lab-null-minutes", /minutes/],
    ["mega-lab-array-minutes", /minutes/],
    ["mega-lab-float-minutes", /minutes/],
    ["mega-lab-low-minutes", /minutes/],
    ["mega-lab-high-minutes", /minutes/],
    ["mega-lab-string-minutes", /minutes/],
  ];
  for (const [id, path] of REFUSALS) {
    it(`refuses ${id} naming its field path`, () => {
      const r = loadLab(id);
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.error.kind).toBe("InvalidExercise");
      if (r.error.kind === "InvalidExercise") {
        expect(`${r.error.field}: ${r.error.msg}`).toMatch(path);
      }
      expect(listLabs().map((l) => l.id)).not.toContain(id);
    });
  }

  it("with the e2e flag off only shipped labs list — the three PHYLIP packs and the MEGA handouts", () => {
    window.localStorage.removeItem("neophylo-e2e");
    expect(listLabs().map((l) => l.id)).toEqual([
      "dnadist-neighbor",
      "mega-bootstrap-100",
      "mega-jc69-vs-k2p",
      "mega-nj-vs-upgma",
      "protdist-neighbor",
      "seqboot-consense",
    ]);
  });

  it("listLabs carries lab.minutes when the block declares it", () => {
    // mega-jc69-vs-k2p ships minutes (Task 13 handout 1); the e2e-only
    // mega-test-lab has none, and minutes stays off its summary.
    const lab = listLabs().find((l) => l.id === "mega-jc69-vs-k2p");
    expect(lab?.minutes).toBeGreaterThanOrEqual(5);
    expect(lab?.minutes).toBeLessThanOrEqual(180);
    expect(
      listLabs().find((l) => l.id === "mega-test-lab")?.minutes,
    ).toBeUndefined();
  });

  it("loadLab returns the exercise and the lab block for a valid lab file", () => {
    const r = loadLab("test-lab");
    if (!r.ok) throw new Error(`test-lab must load: ${JSON.stringify(r.error)}`);
    expect(r.value.lab.title).toBe("Test lab: dnadist → neighbor");
    expect(r.value.exercise.title).toBe("Test lab: dnadist chain");
    expect(r.value.exercise.analysis.method).toBe("Nj");
    expect(r.value.exercise.bootstrap).toEqual({ replicates: 100, seed: 7 });
  });

  it("a registry file without its lab block is refused at load with the reason", () => {
    const r = loadLab("no-lab-block");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe("InvalidExercise");
    if (r.error.kind === "InvalidExercise") {
      expect(r.error.msg).toMatch(/lab block/i);
    }
  });

  it("a lab file whose lab block fails the schema is refused naming the field", () => {
    const r = loadLab("bad-lab");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe("InvalidExercise");
    if (r.error.kind === "InvalidExercise") {
      expect(`${r.error.field}: ${r.error.msg}`).toMatch(/chain/i);
    }
  });

  it("an unknown lab id is a readable refusal, not a throw", () => {
    const r = loadLab("no-such-lab");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe("InvalidExercise");
  });
});
