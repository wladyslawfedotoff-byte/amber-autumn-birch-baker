/**
 * Task colours like in Google Calendar. Stored on the task as `color` (an id
 * from this palette, null = no colour) and synced per field like any other
 * field. The same hue is used in both themes: the stripe is drawn at full
 * strength, the background is a light tint mixed into the theme surface, so
 * the text keeps the theme's own (readable) colour.
 */
export const TASK_COLORS = [
  { id: "tomato", label: "Томат", hex: "#d50000" },
  { id: "tangerine", label: "Мандарин", hex: "#f4511e" },
  { id: "banana", label: "Банан", hex: "#f6bf26" },
  { id: "basil", label: "Базилик", hex: "#0b8043" },
  { id: "sage", label: "Шалфей", hex: "#33b679" },
  { id: "peacock", label: "Павлин", hex: "#039be5" },
  { id: "blueberry", label: "Черника", hex: "#3f51b5" },
  { id: "lavender", label: "Лаванда", hex: "#7986cb" },
  { id: "grape", label: "Виноград", hex: "#8e24aa" },
  { id: "graphite", label: "Графит", hex: "#616161" },
] as const;

export type TaskColor = (typeof TASK_COLORS)[number]["id"];

export function isTaskColor(value: unknown): value is TaskColor {
  return typeof value === "string" && TASK_COLORS.some((item) => item.id === value);
}

export function colorHex(value: unknown): string | null {
  return TASK_COLORS.find((item) => item.id === value)?.hex ?? null;
}

export function colorLabel(value: unknown): string {
  return TASK_COLORS.find((item) => item.id === value)?.label ?? "Без цвета";
}

/** Inline style for a coloured card: stripe on the left + a light tint (readable in both themes). */
export function colorStyle(value: unknown, tint = 10): { borderLeft?: string; background?: string } {
  const hex = colorHex(value);
  if (!hex) return {};
  return {
    borderLeft: `4px solid ${hex}`,
    background: `color-mix(in oklab, ${hex} ${tint}%, var(--elevated))`,
  };
}
