# NeoPhylo icon options — v1.3 owner gate

Three candidate marks for the spec §5 identity. All three meet the plan's
criteria: a single `accent` color, readable at 16 px, no text, each well
under 2 KB of SVG.

**Color:** each file draws in `currentColor` with `color="#aa3bff"` on the
root — the light-theme `accent` token, used as the canonical brand color
(brand assets like favicon/PWA/og-image are theme-independent). An inlined
copy can still be recolored with CSS `color` if a context wants the dark
accent instead.

**Rendered preview:** the matrix below rendered on the real light
(`#ffffff`) and dark (`#16171d`) grounds — plus a zoomed strip proving the
16 px read — is attached to this PR as a comment image (rendered by
Playwright in the pinned CI image; not committed). GitHub renders these
`<img>` tags on whichever theme you use.

## Option A — "Cladogram"

A balanced rooted binary tree drawn as diagonal strokes — the textbook
slanted cladogram.

| 16 px | 32 px | 180 px | 512 px |
|---|---|---|---|
| <img src="../../web/public/brand/options/option-a.svg" width="16" height="16" alt="A at 16px"> | <img src="../../web/public/brand/options/option-a.svg" width="32" height="32" alt="A at 32px"> | <img src="../../web/public/brand/options/option-a.svg" width="180" height="180" alt="A at 180px"> | <img src="../../web/public/brand/options/option-a.svg" width="512" height="512" alt="A at 512px"> |

Wordmark: <img src="../../web/public/brand/options/option-a.svg" width="24" height="24" alt="" valign="middle"> **NeoPhylo**

## Option B — "Bracket tree"

The same balanced tree drawn as a right-angle cladogram — the classic
PHYLIP/distance-program output shape, squarest of the three.

| 16 px | 32 px | 180 px | 512 px |
|---|---|---|---|
| <img src="../../web/public/brand/options/option-b.svg" width="16" height="16" alt="B at 16px"> | <img src="../../web/public/brand/options/option-b.svg" width="32" height="32" alt="B at 32px"> | <img src="../../web/public/brand/options/option-b.svg" width="180" height="180" alt="B at 180px"> | <img src="../../web/public/brand/options/option-b.svg" width="512" height="512" alt="B at 512px"> |

Wordmark: <img src="../../web/public/brand/options/option-b.svg" width="24" height="24" alt="" valign="middle"> **NeoPhylo**

## Option C — "Node link"

A rooted tree drawn node-link style — branches with filled dots at the
root, internal nodes and tips; the roundest, most "network" of the three.

| 16 px | 32 px | 180 px | 512 px |
|---|---|---|---|
| <img src="../../web/public/brand/options/option-c.svg" width="16" height="16" alt="C at 16px"> | <img src="../../web/public/brand/options/option-c.svg" width="32" height="32" alt="C at 32px"> | <img src="../../web/public/brand/options/option-c.svg" width="180" height="180" alt="C at 180px"> | <img src="../../web/public/brand/options/option-c.svg" width="512" height="512" alt="C at 512px"> |

Wordmark: <img src="../../web/public/brand/options/option-c.svg" width="24" height="24" alt="" valign="middle"> **NeoPhylo**

---

**Owner decision needed:** reply on the PR with `a`, `b` or `c` (or a
requested tweak). The unchosen options are then deleted in the same PR and
the chosen file is copied to `web/public/brand/icon.svg` for Task 8.
