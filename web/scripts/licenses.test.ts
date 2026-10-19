// licenses.html generator tests (v1.1 release docs §C). The shipped
// page must carry the PHYLIP notice ("Felsenstein", BSD-2-Clause binary
// clause), the UniProtKB attribution (CC BY 4.0) and the npm production
// deps ("react") — the pieces whose licenses require redistribution
// notices — plus the acceptance gate on license expressions.

import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  buildLicensesHtml,
  licenseAccepted,
  markdownToHtml,
  npmProdDeps,
} from "./licenses.ts";

// Vitest runs with cwd = web/ (and rewrites import.meta.url inside new
// URL()), so the repo root is simply its parent.
const REPO_ROOT = resolve(process.cwd(), "..");

describe("licenses page", () => {
  it("contains the PHYLIP, UniProt and npm notices the licenses require", () => {
    const html = buildLicensesHtml(REPO_ROOT);
    expect(html).toContain("Felsenstein"); // PHYLIP BSD-2-Clause notice
    expect(html).toContain("UniProt"); // UniProtKB CC BY 4.0 attribution
    expect(html).toMatch(/<code>react<\/code> [\d.]+ — MIT/);
  });

  it("lists only production npm deps, never dev-only ones", () => {
    const deps = npmProdDeps(`${REPO_ROOT}/web`);
    const names = deps.map((d) => d.name);
    expect(names).toContain("react");
    expect(names).toContain("lz-string");
    expect(names).not.toContain("vitest");
    expect(names).not.toContain("eslint");
    // Every production dep stays on the accepted list.
    for (const d of deps) {
      expect(licenseAccepted(d.license), `${d.name}: ${d.license}`).toBe(
        true,
      );
    }
  });
});

describe("licenseAccepted", () => {
  it("accepts the listed licenses and SPDX expressions over them", () => {
    for (const ok of [
      "MIT",
      "Apache-2.0",
      "MIT OR Apache-2.0",
      "(MIT OR Apache-2.0) AND Unicode-3.0",
      "Apache-2.0 WITH LLVM-exception OR MIT",
      "BSD-2-Clause",
      "ISC",
      "Zlib",
    ]) {
      expect(licenseAccepted(ok), ok).toBe(true);
    }
  });

  it("rejects unlisted licenses and empty expressions", () => {
    for (const bad of [
      "GPL-3.0-only",
      "AGPL-3.0-only",
      "CC-BY-4.0",
      "",
      "MIT AND GPL-3.0-only",
      "UNKNOWN",
    ]) {
      expect(licenseAccepted(bad), bad).toBe(false);
    }
  });
});

describe("markdownToHtml", () => {
  it("renders headings, code, links and escapes HTML", () => {
    const html = markdownToHtml(
      "# Title\n\nSee `code` and [a link](https://x.test) — <script>.",
    );
    expect(html).toContain("<h2>Title</h2>");
    expect(html).toContain("<code>code</code>");
    expect(html).toContain('<a href="https://x.test">a link</a>');
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });
});
