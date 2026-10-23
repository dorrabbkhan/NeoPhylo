// Generates web/public/licenses.html — the third-party notices page the
// app footer links to (v1.1 release docs, task §C). It combines:
//
//   1. THIRD_PARTY_NOTICES.md — data and content redistributed in the
//      repo (PHYLIP JTT constants, UniProtKB cytochrome c sequences);
//   2. the Rust crates compiled into the wasm engine, rendered by
//      `cargo about generate` against about.toml / about.hbs;
//   3. npm production dependencies, read from package-lock.json (the
//      lockfile's "dev" flag excludes dev-only packages that never ship).
//
// `licenses.html` is generated at build time (vite.config.ts runs
// writeLicensesPage on buildStart and once per dev server) into public/
// and is gitignored; the BSD-2-Clause binary-distribution clause and the
// MIT/Apache notice requirements are why the texts ship in the bundle at
// all.
//
// License gate: npm packages with a license outside ACCEPTED_LICENSES
// throw here, failing `npm run build` and the web CI job. The Rust side
// is gated by cargo-about's `accepted` list in about.toml — its nonzero
// exit also fails the build. The licenses CI job
// (scripts/ci/licenses.sh) runs `cargo about generate` itself and the
// web job passes the rendered file at web/.licenses/rust-licenses.html;
// a local build without cargo-about falls back to a placeholder section
// and prints a warning rather than failing.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Licenses acceptable for redistributed dependencies; must match
 * about.toml's `accepted` list (the cargo-about gate). OFL-1.1 is the
 * bundled fonts' license (spec §4.4 — the aggregation's
 * web/public/fonts material); it appears here so the font subsets are
 * covered by the same accepted list as the packaged dependencies. */
export const ACCEPTED_LICENSES = [
  "MIT",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "OFL-1.1",
  "Unicode-3.0",
  "Zlib",
];

const RUST_ARTIFACT = ".licenses/rust-licenses.html";
const NOTICES_MD = "THIRD_PARTY_NOTICES.md";
const OUT_PATH = "web/public/licenses.html";

export interface NpmDep {
  name: string;
  version: string;
  license: string;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Minimal SPDX check: `X OR Y` passes when any operand is accepted,
 * `X AND Y` requires all, parentheses and a trailing `WITH …` exception
 * are stripped. Anything unparseable or unlisted returns false. */
export function licenseAccepted(expr: string): boolean {
  const cleaned = expr
    .replace(/[()]/g, "")
    .replace(/\s+WITH\s+\S+/gi, "")
    .replace(/\s*$/g, "")
    .trim();
  if (!cleaned) return false;
  const orParts = cleaned.split(/\s+OR\s+/i);
  return orParts.some((part) =>
    part
      .split(/\s+AND\s+/i)
      .every((id) => ACCEPTED_LICENSES.includes(id.trim().replace(/\+$/, ""))),
  );
}

/** npm production dependencies from package-lock.json v3: every
 * `node_modules/` entry not flagged `"dev": true`. The license field in
 * the lockfile wins; node_modules is the fallback. */
export function npmProdDeps(webRoot: string): NpmDep[] {
  const lockPath = join(webRoot, "package-lock.json");
  const lock = JSON.parse(readFileSync(lockPath, "utf8")) as {
    packages: Record<
      string,
      { version?: string; license?: string; dev?: boolean }
    >;
  };
  const deps: NpmDep[] = [];
  for (const [path, info] of Object.entries(lock.packages)) {
    const m = /^node_modules\/(.+)$/.exec(path);
    if (!m || info.dev === true) continue;
    const name = m[1];
    let license = info.license ?? "";
    if (!license) {
      const pkgJson = join(webRoot, path, "package.json");
      if (existsSync(pkgJson)) {
        const pkg = JSON.parse(readFileSync(pkgJson, "utf8")) as {
          license?: string;
          licenses?: { type?: string }[];
        };
        license = pkg.license ?? pkg.licenses?.[0]?.type ?? "";
      }
    }
    deps.push({ name, version: info.version ?? "?", license });
  }
  deps.sort((a, b) => a.name.localeCompare(b.name));
  return deps;
}

/** Fails the build when any npm production dep is off the accepted list. */
export function checkNpmLicenses(deps: NpmDep[]): void {
  const bad = deps.filter((d) => !licenseAccepted(d.license));
  if (bad.length > 0) {
    throw new Error(
      "npm dependencies with licenses outside the accepted list " +
        `(${ACCEPTED_LICENSES.join(", ")}):\n` +
        bad.map((d) => `  ${d.name}@${d.version}: ${d.license || "NONE"}`).join("\n"),
    );
  }
}

/** The Rust dependency section: prefer the CI artifact, else run
 * cargo-about locally (its nonzero exit = license gate failure, so it
 * propagates), else a placeholder with a warning. */
function rustLicensesHtml(repoRoot: string): {
  html: string;
  source: "artifact" | "cargo-about" | "placeholder";
} {
  const artifact = join(repoRoot, "web", RUST_ARTIFACT);
  if (existsSync(artifact)) {
    return { html: readFileSync(artifact, "utf8"), source: "artifact" };
  }
  const res = spawnSync("cargo", ["about", "generate", "about.hbs"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  // Tool absent can surface two ways: `cargo` itself missing (spawn
  // error), or cargo present but the about subcommand not installed
  // (exit 1 with "no such command"). Both mean "no gate run", so the
  // page gets a placeholder — the licenses CI job is the real gate.
  const toolMissing =
    res.error !== undefined ||
    (res.status !== 0 && /no such command/.test(res.stderr ?? ""));
  if (toolMissing) {
    console.warn(
      "licenses: cargo-about not found — the Rust section of " +
        "licenses.html is a placeholder. Install cargo-about or run " +
        "scripts/ci/licenses.sh for the real list.",
    );
    return {
      html:
        '<p><em>Rust dependency notices are generated by ' +
        "<code>cargo about generate</code> (see scripts/ci/licenses.sh); " +
        "they were unavailable when this page was built.</em></p>",
      source: "placeholder",
    };
  }
  if (res.status !== 0) {
    throw new Error(
      `cargo about generate failed (license gate):\n${res.stderr}`,
    );
  }
  return { html: res.stdout, source: "cargo-about" };
}

/** Minimal Markdown → HTML for THIRD_PARTY_NOTICES.md: headings,
 * paragraphs, `>` blockquotes, `- ` lists, inline code, links and bare
 * URLs. Input is escaped first — only Markdown syntax is interpreted. */
export function markdownToHtml(md: string): string {
  const inline = (s: string): string =>
    escapeHtml(s)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>')
      .replace(
        /(?<!["=>]|&quot;)(https?:\/\/[^\s<]+)/g,
        '<a href="$1">$1</a>',
      );

  const out: string[] = [];
  let para: string[] = [];
  let quote: string[] = [];
  let list: string[] = [];
  const flush = () => {
    if (para.length) {
      out.push(`<p>${inline(para.join(" "))}</p>`);
      para = [];
    }
    if (quote.length) {
      out.push(`<blockquote><pre>${escapeHtml(quote.join("\n"))}</pre></blockquote>`);
      quote = [];
    }
    if (list.length) {
      out.push(
        `<ul>${list.map((i) => `<li>${inline(i)}</li>`).join("")}</ul>`,
      );
      list = [];
    }
  };
  for (const line of md.split("\n")) {
    const t = line.trimEnd();
    const h = /^(#{1,4})\s+(.*)$/.exec(t);
    const li = /^[-*]\s+(.*)$/.exec(t);
    if (t === "") {
      flush();
    } else if (h) {
      flush();
      const level = Math.min(h[1].length + 1, 4);
      out.push(`<h${level}>${inline(h[2])}</h${level}>`);
    } else if (t.startsWith(">")) {
      flush();
      quote.push(t.replace(/^>\s?/, ""));
    } else if (li) {
      if (para.length || quote.length) flush();
      list.push(li[1]);
    } else {
      if (quote.length || list.length) flush();
      para.push(t);
    }
  }
  flush();
  return out.join("\n");
}

/** Assembles the full licenses.html document. */
export function buildLicensesHtml(repoRoot: string): string {
  const noticesPath = join(repoRoot, NOTICES_MD);
  const notices = readFileSync(noticesPath, "utf8");
  // Drop the file's own h1 — the page supplies the heading structure.
  const body = notices.replace(/^#[^\n]*\n+/, "");

  const deps = npmProdDeps(join(repoRoot, "web"));
  checkNpmLicenses(deps);
  const npmList =
    `<ul class="license-summary">` +
    deps
      .map(
        (d) =>
          `<li><code>${escapeHtml(d.name)}</code> ${escapeHtml(d.version)} — ${escapeHtml(
            d.license || "unknown",
          )}</li>`,
      )
      .join("") +
    `</ul>`;

  const rust = rustLicensesHtml(repoRoot);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>NeoPhylo — third-party licenses and notices</title>
<style>
  body { max-width: 56rem; margin: 2rem auto; padding: 0 1rem;
         font-family: system-ui, sans-serif; line-height: 1.5;
         color: #1f2937; }
  h1 { font-size: 1.6rem; }
  h2 { font-size: 1.25rem; margin-top: 2rem;
       border-bottom: 1px solid #e5e7eb; padding-bottom: .25rem; }
  code, pre { font-family: ui-monospace, monospace;
              background: #f3f4f6; border-radius: 4px; }
  code { padding: .1em .3em; }
  pre { padding: .75rem; overflow-x: auto; white-space: pre-wrap; }
  blockquote { margin: 0; }
  blockquote pre { background: #f9fafb; border-left: 3px solid #d1d5db; }
  a { color: #6d28d9; }
</style>
</head>
<body>
<h1>NeoPhylo — third-party licenses and notices</h1>
<p>NeoPhylo itself is <a href="https://github.com/dorrabbkhan/NeoPhylo">AGPL-3.0-only</a>.
This page carries the notices that the licenses of redistributed material
require in binary distributions (the BSD-2-Clause clause for the PHYLIP
JTT data, and the notice requirements of the MIT/Apache-licensed
dependencies below). It is generated at build time; see
<code>scripts/ci/licenses.sh</code> and <code>web/scripts/licenses.ts</code>.</p>

<h2>Redistributed data and content</h2>
${markdownToHtml(body)}

<h2>Rust crates compiled into the WebAssembly engine</h2>
${rust.html}

<h2>npm production dependencies bundled in the app</h2>
<p>Each package below is distributed under the license named; license
texts ship inside the packages (<code>node_modules/&lt;name&gt;/LICENSE</code>)
and are reproduced upstream in the package repositories.</p>
${npmList}
</body>
</html>
`;
}

/** Generates the page and writes it to web/public/licenses.html so the
 * dev server and `vite build` (publicDir copy) both serve it. The file
 * is gitignored — never committed. */
export function writeLicensesPage(repoRoot: string): void {
  const out = join(repoRoot, OUT_PATH);
  mkdirSync(join(out, ".."), { recursive: true });
  writeFileSync(out, buildLicensesHtml(repoRoot));
}
