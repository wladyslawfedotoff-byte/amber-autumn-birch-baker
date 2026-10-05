export const ACCENTS = [
  { id: "ink", name: "Чернила", swatch: "swatch-ink" },
  { id: "blue", name: "Синий", swatch: "swatch-blue" },
  { id: "teal", name: "Бирюза", swatch: "swatch-teal" },
  { id: "green", name: "Зелёный", swatch: "swatch-green" },
  { id: "orange", name: "Оранжевый", swatch: "swatch-orange" },
  { id: "red", name: "Красный", swatch: "swatch-red" },
  { id: "purple", name: "Фиолетовый", swatch: "swatch-purple" },
  { id: "pink", name: "Розовый", swatch: "swatch-pink" },
] as const;

export type AccentId = (typeof ACCENTS)[number]["id"];

export function isAccent(value: unknown): value is AccentId {
  return ACCENTS.some((item) => item.id === value);
}
