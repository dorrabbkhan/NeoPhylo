# v1.5 navigation and v1.6 landing page mockups (owner choices, 2026-11-23)

Throwaway HTML mockups from the 2026-11-23 brainstorming session. They show look and motion, not
code to copy: colours come from `web/src/design/tokens.ts`, icons are placeholders, and every number
in them is illustrative. The `nav-*` files are fragments made for the brainstorming viewer; opened
directly they lose the option-card frame, but each mockup carries its own styles.

| File | What it shows | Owner's choice |
|---|---|---|
| `nav-styles.html` | Three navigation styles: A left tool rail, B top tray whose icons expand into labels, C always-labelled icon toolbar | **B** |
| `nav-mode-right.html` | Lesson \| Sandbox at the right end of the header: R1 quiet pill, R2 accent-filled pill | **R1** (quiet pill, far right) |
| `nav-b-mode-touch.html` | Section 1: earlier placements next to the title (superseded by R1). Section 2: B on a touch tablet | Tablet behaviour accepted |
| `nav-mobile-r1.html` | 360 px phone: M1 switch in the header, M2 switch inside the menu sheet | **M2** (phone-only users are few) |
| `landing-v1.html` | Full landing page, light and dark (v1.6) | Accepted as shown |

Rules that go with the choices:
- Tray labels expand on hover **and** keyboard focus; the current page is always labelled; every
  icon has an accessible name; no animation under `prefers-reduced-motion`.
- Touch: a tap always navigates, never only reveals a label; targets at least 44 px; long-press
  shows the name.
- Phones: one menu button opens a sheet of labelled tiles (a modal dialog: Escape, ✕ and any tile
  close it); the lesson stepper stays at the bottom, so there is no bottom tab bar.
