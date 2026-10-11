import type { DayState } from "@/lib/habit-plan";
import type { Habit } from "@/lib/planner-types";
import { colorHex } from "@/lib/task-colors";

export const ICONS = ["💧", "📖", "🏃", "🧘", "🚶", "💪", "🥗", "😴", "🦷", "💊", "✍️", "🎸", "🇬🇧", "🧹", "🌱", "☀️", "📵", "💰"];

export const MOODS = [
  { value: 1, icon: "😣", label: "Плохо" },
  { value: 2, icon: "😕", label: "Так себе" },
  { value: 3, icon: "😐", label: "Нормально" },
  { value: 4, icon: "🙂", label: "Хорошо" },
  { value: 5, icon: "😄", label: "Отлично" },
];

export const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
/** «в октябре» for «Дневник в октябре». */
export const MONTHS_IN = ["январе", "феврале", "марте", "апреле", "мае", "июне", "июле", "августе", "сентябре", "октябре", "ноябре", "декабре"];

export const STATE_LABEL: Record<DayState, string> = {
  done: "выполнено",
  partial: "частично",
  skip: "пропуск",
  fail: "не выполнено",
  open: "не отмечено",
  off: "не по плану",
  before: "до старта",
  future: "впереди",
};

export type Template = { name: string; hint: string; extra: Partial<Habit> };
/** Ready-made habits: one tap creates a ready habit (it can be edited later). */
export const TEMPLATES: Template[] = [
  { name: "Пить воду", hint: "8 стаканов в день", extra: { icon: "💧", color: "peacock", goal: 8, unit: "стаканов", section: "other", reminders: ["10:00", "14:00", "18:00"] } },
  { name: "Чтение", hint: "10 страниц вечером", extra: { icon: "📖", color: "grape", goal: 10, unit: "страниц", step: 5, section: "evening" } },
  { name: "Зарядка", hint: "по будням утром", extra: { icon: "💪", color: "tangerine", section: "morning", freq: { kind: "weekdays", days: [1, 2, 3, 4, 5] } } },
  { name: "Пробежка", hint: "3 раза в неделю", extra: { icon: "🏃", color: "sage", section: "morning", freq: { kind: "weekly", times: 3 } } },
  { name: "Медитация", hint: "10 минут, 21 день", extra: { icon: "🧘", color: "lavender", goal: 10, unit: "минут", step: 5, section: "morning", goalDays: 21 } },
  { name: "Лечь до 23:00", hint: "напомнит в 22:30", extra: { icon: "😴", color: "blueberry", section: "evening", reminders: ["22:30"] } },
  { name: "Прогулка", hint: "30 минут на воздухе", extra: { icon: "🚶", color: "basil", goal: 30, unit: "минут", step: 10, section: "afternoon" } },
  { name: "Без телефона", hint: "час перед сном", extra: { icon: "📵", color: "graphite", section: "evening" } },
];

/** Habit colour (falls back to the app accent). */
export function habitHex(habit: Pick<Habit, "color">): string {
  return colorHex(habit.color) ?? "var(--accent)";
}


/** «Мотивация» ↻: short motivation lines (proverbs and plain advice). */
export const QUOTES = [
  "Маленькие шаги каждый день",
  "Дорогу осилит идущий",
  "Капля камень точит",
  "Терпение и труд всё перетрут",
  "Привычка — вторая натура",
  "Повторение — мать учения",
  "Тише едешь — дальше будешь",
  "Не жди идеального момента — начни сейчас",
  "Сделай сегодня то, за что завтра скажешь спасибо",
  "Главное — не пропускать два дня подряд",
  "Лучше немного, но каждый день",
  "Сегодняшнее усилие — завтрашняя лёгкость",
  "Не ради идеала, а ради движения",
  "Ты сильнее, чем думаешь",
];

export function randomQuote(current: string): string {
  const pool = QUOTES.filter((q) => q !== current);
  return pool[Math.floor(Math.random() * pool.length)] ?? QUOTES[0]!;
}
