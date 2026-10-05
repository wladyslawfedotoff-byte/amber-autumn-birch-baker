import { useState } from "react";
import { ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { dayNumber, shiftIso, todayIso, weekdayLetter, weekDays } from "@/lib/dates";
import { usePlanner } from "@/lib/planner-store";

function streakOf(checks: string[], today: string): number {
  const set = new Set(checks);
  let cursor = today;
  if (!set.has(today)) {
    const yesterday = shiftIso(today, -1);
    if (!set.has(yesterday)) return 0;
    cursor = yesterday;
  }
  let count = 0;
  while (set.has(cursor)) {
    count += 1;
    cursor = shiftIso(cursor, -1);
  }
  return count;
}

export function HabitsView() {
  const habits = usePlanner((s) => s.habits);
  const toggleHabit = usePlanner((s) => s.toggleHabit);
  const addHabit = usePlanner((s) => s.addHabit);
  const deleteHabit = usePlanner((s) => s.deleteHabit);
  const today = todayIso();
  const [offset, setOffset] = useState(0);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const anchor = shiftIso(today, offset * 7);
  const days = weekDays(anchor);
  const doneToday = habits.filter((habit) => habit.checks.includes(today)).length;

  return (
    <div>
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-sm text-muted">
            Сегодня{" "}
            <span className="tabular-nums text-fg">
              {doneToday} из {habits.length}
            </span>
          </p>
        </div>
        <div className="flex items-center">
          <Button size="icon" variant="ghost" aria-label="Прошлая неделя" onClick={() => setOffset((n) => n - 1)}>
            <ChevronLeft className="size-5" />
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setOffset(0)} disabled={offset === 0}>
            Эта неделя
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Следующая неделя"
            onClick={() => setOffset((n) => n + 1)}
            disabled={offset >= 0}
          >
            <ChevronRight className="size-5" />
          </Button>
        </div>
      </div>

      <ul className="mt-4 divide-y divide-line">
        {habits.map((habit) => {
          const streak = streakOf(habit.checks, today);
          return (
            <li key={habit.id} className="py-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">{habit.name}</p>
                  {habit.why ? <p className="text-xs text-muted">{habit.why}</p> : null}
                  <p className="text-xs text-subtle">
                    серия <span className="tabular-nums">{streak}</span>
                  </p>
                </div>
                {confirmId === habit.id ? (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => {
                      deleteHabit(habit.id);
                      setConfirmId(null);
                    }}
                  >
                    Удалить
                  </Button>
                ) : (
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Удалить привычку ${habit.name}`}
                    onClick={() => setConfirmId(habit.id)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </div>
              <div className="mt-3 grid grid-cols-7 gap-1">
                {days.map((day) => {
                  const on = habit.checks.includes(day);
                  const future = day > today;
                  return (
                    <button
                      key={day}
                      type="button"
                      disabled={future}
                      aria-pressed={on}
                      aria-label={`${habit.name}, ${day}`}
                      onClick={() => toggleHabit(habit.id, day)}
                      className={cn(
                        "flex h-12 flex-col items-center justify-center rounded-md text-xs tabular-nums",
                        on ? "bg-accent text-accent-fg" : "bg-elevated text-muted",
                        day === today && !on && "ring-1 ring-accent",
                        future && "opacity-40",
                      )}
                    >
                      <span>{weekdayLetter(day)}</span>
                      <span>{dayNumber(day)}</span>
                    </button>
                  );
                })}
              </div>
            </li>
          );
        })}
      </ul>

      <form
        className="mt-4 flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          addHabit(String(data.get("name") ?? ""));
          event.currentTarget.reset();
        }}
      >
        <input
          name="name"
          aria-label="Новая привычка"
          placeholder="Новая привычка"
          className="h-11 min-w-0 flex-1 rounded-md border border-line bg-elevated px-3 text-base outline-none placeholder:text-subtle"
        />
        <Button type="submit" variant="primary">
          Добавить
        </Button>
      </form>
    </div>
  );
}
