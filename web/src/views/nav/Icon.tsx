// Static UI icons (v1.5 Task 2, spec §16.2 — conductor's call): the
// outline glyphs live once in public/icons/ui.svg as <symbol id>s
// (Lucide ISC where one fits, same-style custom otherwise — 24 px
// grid, 1.8 stroke, round caps, currentColor, no fills). This
// component stamps <svg><use href="ui.svg#id"/></svg>; no path data is
// ever duplicated into JavaScript. Decorative only — every caller
// supplies its own accessible name.

export type IconName =
  | "lessons"
  | "library"
  | "labs"
  | "reading"
  | "guides"
  | "moon"
  | "sun"
  | "presenter"
  | "settings"
  | "more"
  | "menu"
  | "close"
  | "chevron"
  | "play"
  | "pause"
  | "prev"
  | "next"
  | "download"
  | "check"
  | "info"
  | "tour"
  | "licenses"
  | "code"
  | "help"
  | "back";

export interface IconProps {
  name: IconName;
  className?: string;
}

export function Icon({ name, className }: IconProps) {
  return (
    <svg
      className={className ?? "ui-icon"}
      aria-hidden="true"
      focusable="false"
    >
      <use href={`${import.meta.env.BASE_URL}icons/ui.svg#${name}`} />
    </svg>
  );
}
