import { useState } from "react";
import { Archive, ArchiveRestore, ArrowDown, ArrowUp, Bell, ChevronLeft, ChevronRight, Minus, Pencil, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PickerInput } from "@/components/planner/picker-input";
import { Sheet } from "@/components/ui/sheet";
import { Hint } from "@/components/ui/hint";
import { cn } from "@/lib/cn";
import { dayNumber, formatShort, shiftIso, todayIso, weekdayLetter, weekDays } from "@/lib/dates";
import { usePlanner } from "@/lib/planner-store";
import type { Habit, HabitFreq } from "@/lib/planner-types";
import { monthGrid, shiftMonth } from "@/lib/habit-stats";
import {
  SECTIONS,
  WEEKDAY_SHORT,
  dayState,
  entryOf,
  freqLabel,
  goalOf,
  goalProgress,
  isDue,
  normalizeFreq,
  rate,
  reminderTimes,
  sectionOf,
  sortHabits,
  stepOf,
  streaks,
  totalChecks,
  type DayState,
} from "@/lib/habit-plan";
import { TASK_COLORS, colorHex } from "@/lib/task-colors";
import { DAYS, plural, pluralN } from "@/lib/plural";

const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
const WEEKS: readonly [string, string, string] = ["неделя", "недели", "недель"];
const ICONS = ["💧", "📖", "🏃", "🧘", "🚶", "💪", "🥗", "😴", "🦷", "💊", "✍️", "🎸", "🇬🇧", "🧹", "🌱", "☀️", "📵", "💰"];
const MOODS = [
  { value: 1, icon: "😣", label: "Плохо" },
  { value: 2, icon: "😕", label: "Так себе" },
  { value: 3, icon: "😐", label: "Нормально" },
  { value: 4, icon: "🙂", label: "Хорошо" },
  { value: 5, icon: "😄", label: "Отлично" },
];

type Template = { name: string; extra: Partial<Habit> };
/** «Галерея» like in TickTick: one tap creates a ready habit (then it can be edited). */
const TEMPLATES: Template[] = [
  { name: "Пить воду", extra: { icon: "💧", color: "peacock", goal: 8, unit: "стаканов", section: "other", reminders: ["10:00", "14:00", "18:00"] } },
  { name: "Чтение", extra: { icon: "📖", color: "grape", goal: 10, unit: "страниц", step: 5, section: "evening" } },
  { name: "Зарядка", extra: { icon: "💪", color: "tangerine", section: "morning", freq: { kind: "weekdays", days: [1, 2, 3, 4, 5] } } },
  { name: "Пробежка", extra: { icon: "🏃", color: "sage", section: "morning", freq: { kind: "weekly", times: 3 } } },
  { name: "Медитация", extra: { icon: "🧘", color: "lavender", goal: 10, unit: "минут", step: 5, section: "morning", goalDays: 21 } },
  { name: "Лечь до 23:00", extra: { icon: "😴", color: "blueberry", section: "evening", reminders: ["22:30"] } },
];

function monthTitle(month: string): string {
  return `${MONTHS[Number(month.slice(5, 7)) - 1] ?? ""} ${month.slice(0, 4)}`;
}

function monthEnd(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${month}-${String(new Date(y ?? 1970, m ?? 1, 0).getDate()).padStart(2, "0")}`;
}

function amountLabel(habit: Habit, day: string): string {
  const goal = goalOf(habit);
  const amount = entryOf(habit, day)?.amount ?? (habit.checks.includes(day) ? goal : 0);
  return `${amount} из ${goal}${habit.unit ? ` ${habit.unit}` : ""}`;
}

const STATE_CLASS: Record<DayState, string> = {
  done: "bg-accent text-accent-fg",
  partial: "bg-accent/25 text-fg",
  skip: "bg-elevated text-subtle line-through",
  fail: "bg-danger/15 text-danger",
  open: "bg-elevated text-muted",
  off: "bg-transparent text-subtle border border-dashed border-line",
  before: "bg-transparent text-subtle opacity-50",
  future: "bg-elevated text-muted opacity-40",
};

const STATE_LABEL: Record<DayState, string> = {
  done: "выполнено",
  partial: "частично",
  skip: "пропуск",
  fail: "не выполнено",
  open: "не отмечено",
  off: "не по плану",
  before: "до старта",
  future: "впереди",
};

function HabitIcon({ habit, size = "md" }: { habit: Habit; size?: "md" | "lg" }) {
  const hex = colorHex(habit.color) ?? "var(--color-accent, #888)";
  return (
    <span
      aria-hidden="true"
      className={cn("flex shrink-0 items-center justify-center rounded-full", size === "lg" ? "size-11 text-xl" : "size-9 text-base")}
      style={{ background: `color-mix(in srgb, ${hex} 18%, transparent)`, color: hex }}
    >
      {habit.icon || habit.name.slice(0, 1).toUpperCase()}
    </span>
  );
}

/** Edit one day: done / skip / not done, amount, mood and a note. Works for past days too. */
function DayEditor({ habit, day, today, onClose }: { habit: Habit; day: string; today: string; onClose: () => void }) {
  const setHabitDay = usePlanner((s) => s.setHabitDay);
  const entry = entryOf(habit, day);
  const state = dayState(habit, day, today);
  const goal = goalOf(habit);
  const step = stepOf(habit);
  const amount = entry?.amount ?? (habit.checks.includes(day) && goal > 1 ? goal : 0);
  const [note, setNote] = useState(entry?.note ?? "");
  const future = day > today;
  return (
    <div className="mt-3 rounded-xl border border-line bg-bg p-3" role="group" aria-label={`${habit.name}, ${formatShort(day)}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">
          {day === today ? "Сегодня" : formatShort(day)} · <span className="text-muted">{STATE_LABEL[state]}</span>
        </p>
        <Button size="icon" variant="ghost" aria-label="Закрыть" onClick={onClose}>
          <X className="size-4" />
        </Button>
      </div>
      {future ? (
        <p className="text-xs text-muted">Отметить можно в сам день или позже.</p>
      ) : (
        <>
          <div className="mt-1 grid grid-cols-3 gap-1.5">
            <Button size="sm" variant={state === "done" ? "primary" : "soft"} onClick={() => setHabitDay(habit.id, day, { done: state !== "done" })}>
              Готово
            </Button>
            <Button
              size="sm"
              variant={state === "skip" ? "primary" : "soft"}
              title="Уважительная причина: серия не прервётся"
              onClick={() => setHabitDay(habit.id, day, { status: state === "skip" ? null : "skip" })}
            >
              Пропуск
            </Button>
            <Button size="sm" variant={state === "fail" ? "primary" : "soft"} onClick={() => setHabitDay(habit.id, day, { status: state === "fail" ? null : "fail" })}>
              Не сделано
            </Button>
          </div>
          <p className="mt-1 text-[11px] text-subtle">«Пропуск» — заболели, в отъезде: серия не прервётся и день не считается в проценте.</p>
          {goal > 1 ? (
            <div className="mt-3 flex items-center gap-2">
              <Button size="icon" variant="soft" aria-label={`Минус ${step}`} onClick={() => setHabitDay(habit.id, day, { amount: Math.max(0, amount - step) })}>
                <Minus className="size-4" />
              </Button>
              <label className="flex min-w-0 flex-1 items-center gap-2 text-sm">
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  aria-label="Сколько сделано"
                  value={amount}
                  onChange={(event) => setHabitDay(habit.id, day, { amount: Number(event.target.value) || 0 })}
                  className="h-11 w-20 rounded-md border border-line bg-elevated px-2 text-center text-base tabular-nums"
                />
                <span className="truncate text-muted">
                  из {goal} {habit.unit ?? ""}
                </span>
              </label>
              <Button size="icon" variant="soft" aria-label={`Плюс ${step}`} onClick={() => setHabitDay(habit.id, day, { amount: amount + step })}>
                <Plus className="size-4" />
              </Button>
            </div>
          ) : null}
          <p className="mt-3 text-xs font-medium text-subtle">Настроение</p>
          <div className="mt-1 flex gap-1">
            {MOODS.map((mood) => (
              <button
                key={mood.value}
                type="button"
                aria-pressed={entry?.mood === mood.value}
                aria-label={mood.label}
                title={mood.label}
                onClick={() => setHabitDay(habit.id, day, { mood: entry?.mood === mood.value ? null : mood.value })}
                className={cn("flex size-11 items-center justify-center rounded-full text-xl", entry?.mood === mood.value ? "bg-accent/20 ring-2 ring-accent" : "bg-elevated")}
              >
                {mood.icon}
              </button>
            ))}
          </div>
          <label className="mt-3 block text-xs font-medium text-subtle">
            Заметка
            <textarea
              value={note}
              rows={2}
              maxLength={2000}
              placeholder="Например: «прочитал 12 страниц, легко пошло после прогулки»"
              onChange={(event) => setNote(event.target.value)}
              onBlur={() => {
                if (note !== (entry?.note ?? "")) setHabitDay(habit.id, day, { note });
              }}
              className="mt-1 w-full rounded-md border border-line bg-elevated p-2 text-base font-normal text-fg outline-none placeholder:text-subtle"
            />
          </label>
        </>
      )}
    </div>
  );
}

/** Statistics like TickTick: totals, monthly rate, streaks, challenge, month calendar and the log. */
function HabitDetails({ habit, today }: { habit: Habit; today: string }) {
  const [month, setMonth] = useState(today.slice(0, 7));
  const [day, setDay] = useState<string | null>(null);
  const weeks = monthGrid(month, habit.checks, today);
  const monthRate = rate(habit, `${month}-01`, monthEnd(month), today);
  const s = streaks(habit, today);
  const challenge = goalProgress(habit, today);
  const notes = (habit.log ?? []).filter((e) => e.id.startsWith(month) && (e.note || e.mood)).sort((a, b) => (a.id < b.id ? 1 : -1));
  const unit = s.unit === "week" ? WEEKS : DAYS;
  return (
    <div className="mt-3 rounded-xl bg-elevated p-3">
      <dl className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
        {[
          { label: "Всего отметок", value: String(totalChecks(habit, today)) },
          { label: "За месяц", value: `${monthRate.percent}%` },
          { label: "Серия", value: pluralN(s.current, unit) },
          { label: "Лучшая серия", value: pluralN(s.best, unit) },
        ].map((item) => (
          <div key={item.label} className="rounded-lg bg-bg p-2">
            <dt className="text-[11px] text-subtle">{item.label}</dt>
            <dd className="text-sm font-medium tabular-nums">{item.value}</dd>
          </div>
        ))}
      </dl>
      {challenge ? (
        <div className="mt-3">
          <p className="text-xs text-muted">
            Цель: {pluralN(challenge.target, DAYS)} · выполнено {challenge.done}
            {challenge.reached ? " — цель достигнута! Можно продлить: увеличьте «Цель в днях»." : ""}
          </p>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-bg">
            <div className="h-full bg-accent" style={{ width: `${Math.round((challenge.done / challenge.target) * 100)}%` }} />
          </div>
        </div>
      ) : null}
      <div className="mt-3 flex items-center gap-1">
        <Button size="icon" variant="ghost" aria-label="Прошлый месяц" onClick={() => setMonth(shiftMonth(month, -1))}>
          <ChevronLeft className="size-4" />
        </Button>
        <p className="min-w-0 flex-1 text-center text-sm">
          {monthTitle(month)} · <span className="tabular-nums">{monthRate.done}</span> {plural(monthRate.done, ["отметка", "отметки", "отметок"])}
        </p>
        <Button size="icon" variant="ghost" aria-label="Следующий месяц" disabled={month >= today.slice(0, 7)} onClick={() => setMonth(shiftMonth(month, 1))}>
          <ChevronRight className="size-4" />
        </Button>
      </div>
      <div className="mx-auto mt-2 grid max-w-xs grid-cols-7 gap-1 text-center text-[10px] text-subtle">
        {WEEKDAY_SHORT.map((d) => (
          <span key={d}>{d}</span>
        ))}
        {weeks.flat().map((cell, index) => {
          if (!cell) return <span key={`pad-${index}`} />;
          const state = dayState(habit, cell.day, today);
          const mood = entryOf(habit, cell.day)?.mood;
          return (
            <button
              key={cell.day}
              type="button"
              disabled={cell.future}
              aria-label={`${cell.day}: ${STATE_LABEL[state]}`}
              aria-pressed={day === cell.day}
              onClick={() => setDay(day === cell.day ? null : cell.day)}
              className={cn(
                "relative flex aspect-square items-center justify-center rounded-md text-[11px] tabular-nums",
                STATE_CLASS[state],
                (state === "open" || state === "future") && "bg-bg",
                cell.day === today && state !== "done" && "ring-1 ring-accent",
                day === cell.day && "ring-2 ring-fg",
              )}
            >
              {Number(cell.day.slice(8))}
              {mood || entryOf(habit, cell.day)?.note ? <span className="absolute right-0.5 top-0.5 size-1 rounded-full bg-current" /> : null}
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-center text-[11px] text-subtle">Нажмите на день, чтобы отметить задним числом, поставить пропуск, количество, настроение или заметку.</p>
      {day ? <DayEditor key={day} habit={habit} day={day} today={today} onClose={() => setDay(null)} /> : null}
      {notes.length ? (
        <div className="mt-3">
          <p className="text-xs font-medium text-subtle">Дневник за месяц</p>
          <ul className="mt-1 space-y-1">
            {notes.map((entry) => (
              <li key={entry.id} className="rounded-lg bg-bg p-2 text-sm">
                <span className="text-xs text-subtle">{formatShort(entry.id)}</span> {MOODS.find((m) => m.value === entry.mood)?.icon ?? ""} {entry.note}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function Chip({ on, onClick, children, label }: { on: boolean; onClick: () => void; children: React.ReactNode; label?: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={label}
      onClick={onClick}
      className={cn("h-9 min-w-9 rounded-full border px-3 text-sm", on ? "border-accent bg-accent text-accent-fg" : "border-line bg-bg text-fg")}
    >
      {children}
    </button>
  );
}

function NumberField({ label, value, onValue, min, max, placeholder, hint }: { label: string; value: number | null | undefined; onValue: (n: number | null) => void; min: number; max: number; placeholder?: string; hint?: string }) {
  return (
    <label className="block text-xs font-medium text-subtle">
      {label}
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        placeholder={placeholder}
        value={value ?? ""}
        onChange={(event) => {
          const raw = event.target.value;
          if (!raw) return onValue(null);
          const n = Math.round(Number(raw));
          if (Number.isFinite(n)) onValue(Math.min(max, Math.max(min, n)));
        }}
        className="mt-1 h-11 w-full rounded-md border border-line bg-bg px-2 text-base font-normal text-fg"
      />
      {hint ? <span className="mt-0.5 block font-normal">{hint}</span> : null}
    </label>
  );
}

/** «Изменить привычку»: everything TickTick has in its habit editor. Every change saves (and syncs) at once. */
function HabitEditor({ habit }: { habit: Habit }) {
  const updateHabit = usePlanner((s) => s.updateHabit);
  const moveHabit = usePlanner((s) => s.moveHabit);
  const deleteHabit = usePlanner((s) => s.deleteHabit);
  const [confirm, setConfirm] = useState(false);
  const [name, setName] = useState(habit.name);
  const [time, setTime] = useState("");
  const freq = normalizeFreq(habit.freq);
  const goal = goalOf(habit);
  const times = reminderTimes(habit);
  const set = (patch: Partial<Habit>) => updateHabit(habit.id, patch);
  const setFreq = (next: HabitFreq) => set({ freq: next });

  return (
    <div className="space-y-4 pb-2">
      <label className="block text-xs font-medium text-subtle">
        Название
        <input
          value={name}
          maxLength={200}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => name.trim() && name !== habit.name && set({ name })}
          className="mt-1 h-11 w-full rounded-md border border-line bg-bg px-3 text-base font-normal text-fg"
        />
      </label>
      <label className="block text-xs font-medium text-subtle">
        Зачем (мотивация)
        <input
          defaultValue={habit.why ?? ""}
          maxLength={300}
          placeholder="Например: «чтобы просыпаться бодрым»"
          onBlur={(event) => event.target.value !== (habit.why ?? "") && set({ why: event.target.value })}
          className="mt-1 h-11 w-full rounded-md border border-line bg-bg px-3 text-base font-normal text-fg placeholder:text-subtle"
        />
      </label>

      <div>
        <p className="text-xs font-medium text-subtle">Значок и цвет</p>
        <div className="mt-1 flex flex-wrap gap-1">
          {ICONS.map((icon) => (
            <Chip key={icon} on={habit.icon === icon} label={`Значок ${icon}`} onClick={() => set({ icon: habit.icon === icon ? null : icon })}>
              {icon}
            </Chip>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {TASK_COLORS.map((color) => (
            <button
              key={color.id}
              type="button"
              aria-pressed={habit.color === color.id}
              aria-label={color.label}
              title={color.label}
              onClick={() => set({ color: habit.color === color.id ? null : color.id })}
              className={cn("size-8 rounded-full", habit.color === color.id && "ring-2 ring-fg ring-offset-2 ring-offset-elevated")}
              style={{ background: color.hex }}
            />
          ))}
        </div>
      </div>

      <div>
        <p className="text-xs font-medium text-subtle">Частота</p>
        <div className="mt-1 flex flex-wrap gap-1.5">
          <Chip on={freq.kind === "daily"} onClick={() => setFreq({ kind: "daily" })}>
            Каждый день
          </Chip>
          <Chip on={freq.kind === "weekdays"} onClick={() => setFreq({ kind: "weekdays", days: [1, 2, 3, 4, 5] })}>
            Дни недели
          </Chip>
          <Chip on={freq.kind === "weekly"} onClick={() => setFreq({ kind: "weekly", times: 3 })}>
            N раз в неделю
          </Chip>
          <Chip on={freq.kind === "interval"} onClick={() => setFreq({ kind: "interval", every: 2 })}>
            Раз в N дней
          </Chip>
        </div>
        {freq.kind === "weekdays" ? (
          <div className="mt-2 flex flex-wrap gap-1">
            {WEEKDAY_SHORT.map((label, index) => {
              const n = index + 1;
              const on = freq.days.includes(n);
              return (
                <Chip
                  key={label}
                  on={on}
                  onClick={() => {
                    const days = on ? freq.days.filter((d) => d !== n) : [...freq.days, n];
                    setFreq(days.length ? { kind: "weekdays", days } : { kind: "daily" });
                  }}
                >
                  {label}
                </Chip>
              );
            })}
          </div>
        ) : null}
        {freq.kind === "weekly" ? (
          <div className="mt-2 flex flex-wrap gap-1">
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <Chip key={n} on={freq.times === n} onClick={() => setFreq({ kind: "weekly", times: n })}>
                {n}
              </Chip>
            ))}
          </div>
        ) : null}
        {freq.kind === "interval" ? (
          <div className="mt-2 flex flex-wrap gap-1">
            {[2, 3, 4, 5, 7, 10, 14, 30].map((n) => (
              <Chip key={n} on={freq.every === n} onClick={() => setFreq({ kind: "interval", every: n })}>
                {n}
              </Chip>
            ))}
          </div>
        ) : null}
        <p className="mt-1 text-xs text-subtle">
          Сейчас: {freqLabel(freq)}
          <Hint>Дни вне плана не прерывают серию — например, выходные у привычки «по будням».</Hint>
        </p>
      </div>

      <div>
        <p className="text-xs font-medium text-subtle">Цель на день</p>
        <div className="mt-1 flex flex-wrap gap-1.5">
          <Chip on={goal <= 1} onClick={() => set({ goal: null })}>
            Просто отметить
          </Chip>
          <Chip on={goal > 1} onClick={() => goal <= 1 && set({ goal: 8, unit: habit.unit || "раз" })}>
            Количество
          </Chip>
        </div>
        {goal > 1 ? (
          <div className="mt-2 grid grid-cols-3 gap-2">
            <NumberField label="Сколько" value={goal} min={2} max={100000} onValue={(n) => set({ goal: n ?? null })} />
            <label className="block text-xs font-medium text-subtle">
              Единица
              <input
                defaultValue={habit.unit ?? ""}
                maxLength={20}
                placeholder="стаканов"
                onBlur={(event) => set({ unit: event.target.value.trim() || null })}
                className="mt-1 h-11 w-full rounded-md border border-line bg-bg px-2 text-base font-normal text-fg placeholder:text-subtle"
              />
            </label>
            <NumberField label="За нажатие" value={habit.step ?? 1} min={1} max={10000} onValue={(n) => set({ step: n })} />
          </div>
        ) : null}
        <p className="mt-1 text-xs text-subtle">
          Например: 8 стаканов воды
          <Hint>Каждое нажатие добавляет «за нажатие»; день засчитан, когда цель набрана. Можно 10 страниц, 20 минут.</Hint>
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="block text-xs font-medium text-subtle">
          Начало
          <PickerInput
            type="date"
            value={habit.startDate ?? ""}
            onValue={(value) => set({ startDate: value || null })}
            clearLabel="Убрать дату начала"
            className="mt-1 h-11 w-full rounded-md border border-line bg-bg px-2 text-base font-normal text-fg"
          />
        </label>
        <NumberField
          label="Цель в днях"
          value={habit.goalDays}
          min={1}
          max={3650}
          placeholder="21, 66, 100"
          onValue={(n) => set({ goalDays: n })}
        />
      </div>
      <div className="-mt-2 flex flex-wrap gap-1">
        {[7, 21, 30, 66, 100, 365].map((n) => (
          <Chip key={n} on={habit.goalDays === n} onClick={() => set({ goalDays: habit.goalDays === n ? null : n })}>
            {n}
          </Chip>
        ))}
      </div>

      <div>
        <p className="text-xs font-medium text-subtle">Раздел</p>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {SECTIONS.map((section) => (
            <Chip key={section.id} on={sectionOf(habit) === section.id} onClick={() => set({ section: section.id })}>
              {section.label}
            </Chip>
          ))}
        </div>
      </div>

      <div>
        <p className="text-xs font-medium text-subtle">Напоминания</p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {times.map((t) => (
            <span key={t} className="flex h-9 items-center gap-1 rounded-full border border-line bg-bg pl-3 text-sm tabular-nums">
              <Bell className="size-3.5 text-subtle" aria-hidden="true" />
              {t}
              <button
                type="button"
                aria-label={`Убрать напоминание ${t}`}
                className="flex size-9 items-center justify-center"
                onClick={() => set({ reminders: times.filter((x) => x !== t), remindAt: null })}
              >
                <X className="size-3.5" />
              </button>
            </span>
          ))}
          <form
            className="flex items-center gap-1"
            onSubmit={(event) => {
              event.preventDefault();
              if (!time) return;
              set({ reminders: [...new Set([...times, time])].sort(), remindAt: null });
              setTime("");
            }}
          >
            <PickerInput type="time" value={time} onValue={setTime} aria-label="Время напоминания" className="h-9 rounded-md border border-line bg-bg px-2 text-base" />
            <Button type="submit" size="sm" variant="soft" disabled={!time} className="h-9">
              Добавить
            </Button>
          </form>
        </div>
        <p className="mt-1 text-xs text-subtle">
          Можно несколько: 9:00, 13:00, 18:00
          <Hint>Напоминание не придёт, если день уже отмечен или не по плану.</Hint>
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 border-t border-line pt-3">
        <Button size="icon" variant="soft" aria-label="Выше" title="Выше в списке" onClick={() => moveHabit(habit.id, -1)}>
          <ArrowUp className="size-4" />
        </Button>
        <Button size="icon" variant="soft" aria-label="Ниже" title="Ниже в списке" onClick={() => moveHabit(habit.id, 1)}>
          <ArrowDown className="size-4" />
        </Button>
        <Button size="sm" variant="soft" onClick={() => set({ archived: !habit.archived })}>
          {habit.archived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />}
          {habit.archived ? "Вернуть" : "В архив"}
        </Button>
        {confirm ? (
          <Button size="sm" variant="destructive" onClick={() => deleteHabit(habit.id)}>
            Удалить навсегда
          </Button>
        ) : (
          <Button size="icon" variant="ghost" aria-label={`Удалить привычку ${habit.name}`} onClick={() => setConfirm(true)}>
            <Trash2 className="size-4" />
          </Button>
        )}
        <Hint label="Архив или удаление">Архив прячет привычку, но хранит все отметки. Удаление стирает и отметки.</Hint>
      </div>
    </div>
  );
}

function HabitCard({ habit, days, today, editing, onEdit }: { habit: Habit; days: string[]; today: string; editing: boolean; onEdit: (open: boolean) => void }) {
  const toggleHabit = usePlanner((s) => s.toggleHabit);
  const [details, setDetails] = useState(false);
  const goal = goalOf(habit);
  const s = streaks(habit, today);
  const month = rate(habit, shiftIso(today, -29), today, today);
  const challenge = goalProgress(habit, today);
  const times = reminderTimes(habit);
  const doneToday = habit.checks.includes(today);
  const dueToday = isDue(habit, today);
  const amount = entryOf(habit, today)?.amount ?? (doneToday ? goal : 0);
  const unit = s.unit === "week" ? WEEKS : DAYS;

  return (
    <li className="py-3">
      <div className="flex items-start gap-3">
        <HabitIcon habit={habit} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{habit.name}</p>
          <p className="text-xs text-subtle">
            {freqLabel(habit.freq)}
            {goal > 1 ? ` · ${goal} ${habit.unit ?? ""}` : ""}
            {times.length ? ` · 🔔 ${times.join(", ")}` : ""}
            {!dueToday && !doneToday && !habit.archived ? " · сегодня не по плану" : ""}
          </p>
          {habit.why ? <p className="truncate text-xs text-muted">{habit.why}</p> : null}
          <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-subtle">
            <span title={s.unit === "week" ? "Недель подряд с выполненным планом" : "Дней подряд; дни вне плана и пропуски не прерывают"}>
              🔥 <span className="tabular-nums text-fg">{pluralN(s.current, unit)}</span>
            </span>
            <span>
              лучшая <span className="tabular-nums text-fg">{pluralN(s.best, unit)}</span>
            </span>
            <span title={`${month.done} из ${month.planned} по плану`}>
              30 дней <span className="tabular-nums text-fg">{month.percent}%</span>
            </span>
            {challenge ? (
              <span>
                цель <span className="tabular-nums text-fg">{challenge.done}/{challenge.target}</span>
              </span>
            ) : null}
          </p>
        </div>
        <Button size="icon" variant="ghost" aria-label={`Изменить привычку ${habit.name}`} aria-expanded={editing} onClick={() => onEdit(!editing)}>
          <Pencil className="size-4" />
        </Button>
      </div>

      {goal > 1 && !habit.archived ? (
        <div className="mt-2 flex items-center gap-2">
          <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-elevated" aria-hidden="true">
            <div className="h-full bg-accent transition-all" style={{ width: `${Math.min(100, Math.round((amount / goal) * 100))}%` }} />
          </div>
          <span className="shrink-0 text-xs tabular-nums text-muted">{amountLabel(habit, today)}</span>
          <Button size="sm" variant={doneToday ? "soft" : "primary"} className="h-9 shrink-0" onClick={() => toggleHabit(habit.id, today)}>
            {doneToday ? "Сбросить" : `+${stepOf(habit)}`}
          </Button>
        </div>
      ) : null}

      <div className="mt-2 grid grid-cols-7 gap-1">
        {days.map((day) => {
          const state = dayState(habit, day, today);
          const future = day > today;
          return (
            <button
              key={day}
              type="button"
              disabled={future || habit.archived}
              aria-pressed={state === "done"}
              aria-label={`${habit.name}, ${day}: ${STATE_LABEL[state]}`}
              onClick={() => toggleHabit(habit.id, day)}
              className={cn(
                "flex h-11 flex-col items-center justify-center rounded-md text-xs leading-tight tabular-nums",
                STATE_CLASS[state],
                day === today && state !== "done" && "ring-1 ring-accent",
              )}
            >
              <span>{weekdayLetter(day)}</span>
              <span>{goal > 1 && state === "partial" ? `${entryOf(habit, day)?.amount}` : dayNumber(day)}</span>
            </button>
          );
        })}
      </div>
      <button type="button" aria-expanded={details} onClick={() => setDetails(!details)} className="mt-0.5 h-8 text-xs text-accent">
        {details ? "Скрыть статистику" : "Статистика и дневник"}
      </button>
      <Sheet open={editing} title={habit.name} onClose={() => onEdit(false)} action={{ label: "Готово", onClick: () => onEdit(false) }}>
        <HabitEditor habit={habit} />
      </Sheet>
      {details ? <HabitDetails habit={habit} today={today} /> : null}
    </li>
  );
}

export function HabitsView() {
  const habits = usePlanner((s) => s.habits);
  const addHabit = usePlanner((s) => s.addHabit);
  const today = todayIso();
  const [offset, setOffset] = useState(0);
  const [editId, setEditId] = useState<string | null>(null);
  const [showArchive, setShowArchive] = useState(false);
  const [gallery, setGallery] = useState(false);
  const anchor = shiftIso(today, offset * 7);
  const days = weekDays(anchor);
  const active = sortHabits(habits.filter((h) => !h.archived));
  const archived = sortHabits(habits.filter((h) => h.archived));
  const planned = active.filter((h) => isDue(h, today) || h.checks.includes(today));
  const doneToday = planned.filter((h) => h.checks.includes(today)).length;
  const shown = showArchive ? archived : active;
  const groups = SECTIONS.map((section) => ({ section, items: shown.filter((h) => sectionOf(h) === section.id) })).filter((g) => g.items.length);
  const create = (name: string, extra?: Partial<Habit>) => {
    const id = addHabit(name, extra);
    if (id) setEditId(id);
  };

  return (
    <div>
      <div className="flex items-end justify-between gap-3">
        <p className="min-w-0 text-sm text-muted">
          {showArchive ? (
            "Архив привычек"
          ) : (
            <>
              Сегодня по плану{" "}
              <span className="tabular-nums text-fg">
                {doneToday} из {planned.length}
              </span>
            </>
          )}
        </p>
        <div className="flex items-center">
          <Button size="icon" variant="ghost" aria-label="Прошлая неделя" onClick={() => setOffset((n) => n - 1)}>
            <ChevronLeft className="size-5" />
          </Button>
          <Button size="sm" variant="ghost" className="whitespace-nowrap px-2" onClick={() => setOffset(0)} disabled={offset === 0}>
            Эта неделя
          </Button>
          <Button size="icon" variant="ghost" aria-label="Следующая неделя" onClick={() => setOffset((n) => n + 1)} disabled={offset >= 0}>
            <ChevronRight className="size-5" />
          </Button>
        </div>
      </div>

      {!showArchive && active.length === 0 ? (
        <div className="py-8 text-center">
          <p className="text-base font-semibold">Привычек пока нет</p>
          <p className="mt-2 text-sm text-muted">
            Начните с одной маленькой — такой, что не найдётся причины не сделать: «Стакан воды утром», «2 страницы книги», «5 минут зарядки». Выберите
            готовую ниже или придумайте свою.
          </p>
        </div>
      ) : null}

      {groups.map(({ section, items }) => (
        <section key={section.id} className="mt-3">
          {groups.length > 1 || section.id !== "other" ? (
            <h3 className="px-1 text-xs font-semibold uppercase tracking-wide text-subtle">
              {section.label} <span className="font-normal normal-case">· {section.hint}</span>
            </h3>
          ) : null}
          <ul className="divide-y divide-line">
            {items.map((habit) => (
              <HabitCard
                key={habit.id}
                habit={habit}
                days={days}
                today={today}
                editing={editId === habit.id}
                onEdit={(open) => setEditId(open ? habit.id : null)}
              />
            ))}
          </ul>
        </section>
      ))}

      {!showArchive ? (
        <>
          <form
            className="mt-4 flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              create(String(data.get("name") ?? ""));
              event.currentTarget.reset();
            }}
          >
            <input
              name="name"
              aria-label="Новая привычка"
              placeholder="Новая привычка, например: «10 минут чтения»"
              className="h-11 min-w-0 flex-1 rounded-md border border-line bg-elevated px-3 text-base outline-none placeholder:text-subtle"
            />
            <Button type="submit" variant="primary">
              Добавить
            </Button>
          </form>
          {active.length > 0 ? (
            <button type="button" aria-expanded={gallery} onClick={() => setGallery(!gallery)} className="mt-1 h-9 text-xs text-accent">
              {gallery ? "Скрыть готовые привычки" : "Готовые привычки: вода, чтение, зарядка…"}
            </button>
          ) : (
            <p className="mt-3 text-xs font-medium text-subtle">Готовые привычки — нажмите, чтобы добавить и настроить</p>
          )}
          {gallery || active.length === 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {TEMPLATES.map((t) => (
                <button
                  key={t.name}
                  type="button"
                  onClick={() => create(t.name, t.extra)}
                  className="h-11 rounded-full border border-line bg-elevated px-3 text-sm"
                >
                  {t.extra.icon} {t.name}
                  <span className="ml-1 text-xs text-subtle">
                    {goalOf(t.extra) > 1 ? `${t.extra.goal} ${t.extra.unit}` : freqLabel(t.extra.freq)}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </>
      ) : null}

      {archived.length > 0 || showArchive ? (
        <Button size="sm" variant="ghost" className="mt-3 text-muted" onClick={() => setShowArchive(!showArchive)}>
          {showArchive ? <ChevronLeft className="size-4" /> : <Archive className="size-4" />}
          {showArchive ? "К активным привычкам" : `Архив (${archived.length})`}
        </Button>
      ) : null}
      {!showArchive && active.length > 0 ? (
        <p className="mt-2 text-xs text-subtle">
          Как отмечать
          <Hint label="Как отмечать привычки">
            Нажатие на день — отметка (для количества: +шаг). Пунктир — день не по плану, он не прерывает серию. Прошлые дни, пропуски и заметки — в
            «Статистика и дневник».
          </Hint>
        </p>
      ) : null}
    </div>
  );
}

