// The shared markdown renderer (v1.4c plan Task 13, spec §7.5):
// `[text](href)` becomes an <a> only for the internal `?route` forms
// links.ts whitelists; every other target — javascript: included —
// renders as literal text. Raw HTML is never injected. The registry
// pin at the bottom is what keeps LabPage byte-identical after the
// move: no shipped handout contains `](`, so the new link branch can
// never fire on lab markdown.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { listLabs, loadLab } from "../../labs/registry";

import { Md, MdBlock } from "./Md";

afterEach(cleanup);

describe("inline links", () => {
  it("renders an internal href as an anchor", () => {
    render(<MdBlock block="open [the lesson](?lesson=nj-by-hand) next" />);
    const a = screen.getByRole("link", { name: "the lesson" });
    expect(a.getAttribute("href")).toBe("?lesson=nj-by-hand");
  });

  it.each([
    "https://evil.example",
    "javascript:alert(1)",
    "data:text/html,<b>x</b>",
    "//example.com/x",
    "/?lesson=x",
    "?lesson=x&lab=y",
    "?library&foo=1",
  ])("renders %s as literal text, never an anchor", (href) => {
    const { container } = render(
      <MdBlock block={`see [click me](${href}) now`} />,
    );
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain(`[click me](${href})`);
  });
});

describe("MdBlock", () => {
  it("keeps the handout subset: headings, lists, bold and code", () => {
    const { container } = render(
      <Md
        source={[
          "## Objectives",
          "- **bold** item",
          "- `code` item",
          "a paragraph with **both** and `c`",
        ].join("\n\n")}
      />,
    );
    expect(container.querySelector("h3")?.textContent).toBe("Objectives");
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(container.querySelector("strong")?.textContent).toBe("bold");
    expect(container.querySelector("code")?.textContent).toBe("code");
  });

  it("renders no element for HTML-looking source", () => {
    const { container } = render(
      <MdBlock block={'<img src=x onerror=alert(1)> and <a href="?labs">fake</a>'} />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelectorAll("a")).toHaveLength(0);
    expect(container.textContent).toContain("<img src=x");
  });

  it("appends linkExtra inside the anchor for internal links", () => {
    render(
      <MdBlock
        block="1. [item](?lesson=nj-basics)"
        linkExtra={() => " — 20 min"}
      />,
    );
    expect(
      screen.getByRole("link", { name: "item — 20 min" }).getAttribute("href"),
    ).toBe("?lesson=nj-basics");
  });
});

// The safety pin: the shared renderer only just learned `[text](href)`.
// If a handout field ever grows a markdown-looking link it would start
// rendering as an anchor (for internal hrefs) — this test makes that a
// deliberate, reviewed change instead of a silent rendering drift.
describe("shipped lab markdown carries no [text](href) tokens", () => {
  it("no handout_md or note field contains `](`", () => {
    for (const summary of listLabs()) {
      const r = loadLab(summary.id);
      if (!r.ok) throw new Error(`lab ${summary.id} must load`);
      const lab = r.value.lab;
      const fields: [string, string][] = [["handout_md", lab.handout_md]];
      if (lab.tool === "mega") {
        fields.push(["mega_note_md", lab.mega_note_md]);
      } else {
        fields.push(["phylip_note_md", lab.phylip_note_md]);
      }
      for (const [field, md] of fields) {
        expect(
          !md.includes("]("),
          `${summary.id}.${field} contains a markdown link — the shared renderer would now render it`,
        ).toBe(true);
      }
    }
  });
});
