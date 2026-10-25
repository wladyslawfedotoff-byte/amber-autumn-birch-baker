import { TASK_COLOR_HEX } from "./design/tokens.ts";
/**
 * Task colours: our own palette of 10 colours. Stored on the task as `color` (an id
 * from this palette, null = no colour) and synced per field like any other
 * field. The same hue is used in both themes: the stripe is drawn at full
 * strength, the background is a light tint mixed into the theme surface, so
 * the text keeps the theme's own (readable) colour.
 */
export const TASK_COLORS = [
  { id: "tomato", label: "Красный", hex: TASK_COLOR_HEX.tomato },
  { id: "tangerine", label: "Оранжевый", hex: TASK_COLOR_HEX.tangerine },
  { id: "banana", label: "Жёлтый", hex: TASK_COLOR_HEX.banana },
  { id: "basil", label: "Зелёный", hex: TASK_COLOR_HEX.basil },
  { id: "sage", label: "Мятный", hex: TASK_COLOR_HEX.sage },
  { id: "peacock", label: "Голубой", hex: TASK_COLOR_HEX.peacock },
  { id: "blueberry", label: "Синий", hex: TASK_COLOR_HEX.blueberry },
  { id: "lavender", label: "Сиреневый", hex: TASK_COLOR_HEX.lavender },
  { id: "grape", label: "Фиолетовый", hex: TASK_COLOR_HEX.grape },
  { id: "graphite", label: "Серый", hex: TASK_COLOR_HEX.graphite },
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
    background: `color-mix(in oklab, ${hex} ${tint}%, var(--card))`,
  };
}
