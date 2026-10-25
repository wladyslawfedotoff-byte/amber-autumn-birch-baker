/**
 * Design tokens, TS side (1.20). The CSS variables live in src/tokens.css;
 * this file names them for components and holds the few raw values that
 * code needs as strings (meta theme colour, task colours stored in data).
 * Raw hex values are allowed only here and in tokens.css
 * (scripts/check-raw-colors.mjs).
 */

export const ICON_COLORS = ["blue", "orange", "green", "red", "purple", "teal", "indigo", "pink", "grey", "mint", "brown"] as const;
export type IconColor = (typeof ICON_COLORS)[number];

/** CSS value of an icon-palette colour. */
export const icon = (name: IconColor) => `var(--icon-${name})`;

/** Lists, projects and tags have no colour of their own: they cycle this order. */
export const CYCLE: readonly IconColor[] = ["blue", "orange", "green", "purple", "pink", "teal", "indigo", "red"];
export const cycleColor = (index: number) => icon(CYCLE[index % CYCLE.length]);

/** Browser bar colour of the installed app (meta theme-color). */
export const THEME_COLOR = { light: "#f6f4ef", dark: "#000000" } as const;

/** Colours a task can carry (stored by id; hex kept for the calendar dots). */
export const TASK_COLOR_HEX = {
  tomato: "#c8483f",
  tangerine: "#e07a3c",
  banana: "#dcae3a",
  basil: "#2f7d4f",
  sage: "#4fa57e",
  peacock: "#3a8fc4",
  blueberry: "#4a5aa8",
  lavender: "#8a90c9",
  grape: "#8a4fa3",
  graphite: "#6b6763",
} as const;

/** Matrix quadrants: do now, plan, quick or delegate, later. */
export const QUADRANT_COLORS = ["#d50000", "#f6a609", "#039be5", "#33b679"] as const;

export const SPACE = { 1: "var(--space-1)", 2: "var(--space-2)", 3: "var(--space-3)", 4: "var(--space-4)", 6: "var(--space-6)", 8: "var(--space-8)" } as const;
export const RADIUS = { sm: "var(--r-sm)", md: "var(--r-md)", lg: "var(--r-lg)", card: "var(--r-card)", sheet: "var(--r-sheet)", badge: "var(--r-badge)" } as const;
export const FONT_SIZE = { caption: "var(--fs-caption)", body: "var(--fs-body)", title: "var(--fs-title)", large: "var(--fs-large)" } as const;
export const MOTION = { fast: "var(--dur-fast)", base: "var(--dur-base)", slow: "var(--dur-slow)", ease: "var(--ease-standard)" } as const;
export const ICON_SIZE = { sm: "var(--icon-sm)", md: "var(--icon-md)", lg: "var(--icon-lg)", badge: "var(--badge)", badgeLg: "var(--badge-lg)" } as const;
/** lucide strokeWidth for thin iOS-like icons. */
export const ICON_STROKE = 1.75;

/** Every colour token, for the /kit page. */
export const COLOR_TOKENS = [
  "bg", "surface", "surface-2", "card", "separator", "label", "secondary-label", "tertiary-label",
  "accent", "accent-fg", "success", "warning", "danger", "info", "link",
] as const;
