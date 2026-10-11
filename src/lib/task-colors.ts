/**
 * Task colours: our own palette of 10 colours. Stored on the task as `color` (an id
 * from this palette, null = no colour) and synced per field like any other
 * field. The same hue is used in both themes: the stripe is drawn at full
 * strength, the background is a light tint mixed into the theme surface, so
 * the text keeps the theme's own (readable) colour.
 */
export const TASK_COLORS = [
  { id: "tomato", label: "Красный", hex: "#c8483f" },
  { id: "tangerine", label: "Оранжевый", hex: "#e07a3c" },
  { id: "banana", label: "Жёлтый", hex: "#dcae3a" },
  { id: "basil", label: "Зелёный", hex: "#2f7d4f" },
  { id: "sage", label: "Мятный", hex: "#4fa57e" },
  { id: "peacock", label: "Голубой", hex: "#3a8fc4" },
  { id: "blueberry", label: "Синий", hex: "#4a5aa8" },
  { id: "lavender", label: "Сиреневый", hex: "#8a90c9" },
  { id: "grape", label: "Фиолетовый", hex: "#8a4fa3" },
  { id: "graphite", label: "Серый", hex: "#6b6763" },
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
