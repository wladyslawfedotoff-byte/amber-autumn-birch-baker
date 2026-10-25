import { useState } from "react";
import { Check } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { Hint } from "@/components/ui/hint";
import { cn } from "@/lib/cn";
import { formatShortDay } from "@/lib/dates";
import { goalOf } from "@/lib/habit-plan";
import { checkinDraft, checkinPatch } from "@/lib/habit-view";
import { usePlanner } from "@/lib/planner-store";
import type { Habit } from "@/lib/planner-types";
import { MOODS, habitHex } from "@/components/planner/habits/habit-meta";

type Status = "done" | "fail" | "skip";

/**
 * «8 окт.» check-in sheet: Выполнено [4] кружек / Не выполнено / Пропуск,
 * mood, note; saved with the round «✓». Mount it with `key={day}` only while open.
 */
export function CheckinSheet({ habit, day, onClose }: { habit: Habit; day: string; onClose: () => void }) {
  const setHabitDay = usePlanner((s) => s.setHabitDay);
  const [draft, setDraft] = useState(() => checkinDraft(habit, day));
  const goal = goalOf(habit);
  const hex = habitHex(habit);
  const save = () => {
    setHabitDay(habit.id, day, checkinPatch(habit, draft));
    onClose();
  };
  const radio = (status: Status, label: string, extra?: React.ReactNode) => (
    <label className="flex min-h-12 items-center gap-3 px-3">
      <input
        type="radio"
        name="checkin"
        checked={draft.status === status}
        onChange={() => setDraft({ ...draft, status })}
        className="size-5 shrink-0"
        style={{ accentColor: hex }}
      />
      <span className="shrink-0 text-[0.9375rem]">{label}</span>
      {extra}
    </label>
  );
  return (
    <Sheet open title={formatShortDay(day)} onClose={onClose} action={{ label: "Сохранить отметку", onClick: save, icon: <Check className="size-5" strokeWidth={2.5} /> }}>
    <form
      aria-label={`${habit.name}, ${formatShortDay(day)}`}
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <div className="divide-y divide-line overflow-hidden rounded-xl bg-elevated">
        {radio(
          "done",
          "Выполнено",
          goal > 1 ? (
            <span className="ml-auto flex items-center gap-2">
              <input
                type="number"
                inputMode="decimal"
                min={0}
                aria-label="Сколько сделано"
                value={draft.amount}
                onFocus={() => setDraft((d) => ({ ...d, status: "done" }))}
                onChange={(event) => setDraft({ ...draft, status: "done", amount: Number(event.target.value) || 0 })}
                className="h-9 w-20 rounded-lg bg-surface px-2 text-center tabular-nums outline-none"
              />
              <span className="max-w-24 truncate text-sm text-muted">{habit.unit || `из ${goal}`}</span>
            </span>
          ) : null,
        )}
        {radio("fail", "Не выполнено")}
        {radio(
          "skip",
          "Пропуск",
          <span className="ml-auto">
            <Hint label="Что такое пропуск">Заболели, в отъезде: серия не прервётся, и день не считается в проценте.</Hint>
          </span>,
        )}
      </div>
      {goal > 1 && draft.status === "done" && draft.amount < goal ? (
        <p className="mt-2 px-1 text-xs text-muted">
          Меньше цели ({goal}) — день засчитается частично.
        </p>
      ) : null}
      <div className="mt-4 flex justify-between px-2" role="radiogroup" aria-label="Настроение">
        {MOODS.map((mood) => {
          const on = draft.mood === mood.value;
          return (
            <button
              key={mood.value}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={mood.label}
              title={mood.label}
              onClick={() => setDraft({ ...draft, mood: on ? null : mood.value })}
              className={cn("flex size-12 items-center justify-center rounded-full text-[1.75rem] transition", on ? "scale-110" : "opacity-45 grayscale")}
              style={on ? { background: `color-mix(in srgb, ${hex} 18%, transparent)` } : undefined}
            >
              {mood.icon}
            </button>
          );
        })}
      </div>
      <textarea
        value={draft.note}
        rows={4}
        maxLength={2000}
        aria-label="Заметка"
        placeholder="Как прошло? Пара слов для себя"
        onChange={(event) => setDraft({ ...draft, note: event.target.value })}
        className="mt-4 w-full resize-none rounded-xl bg-elevated p-3 text-base outline-none placeholder:text-subtle"
      />
    </form>
    </Sheet>
  );
}
