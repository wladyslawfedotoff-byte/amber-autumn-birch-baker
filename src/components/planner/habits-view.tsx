import { useState } from "react";
import { ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { dayNumber, shiftIso, todayIso, weekdayLetter, weekDays } from "@/lib/dates";
import { usePlanner } from "@/lib/planner-store";
import type { Habit } from "@/lib/planner-types";
import { bestStreak, completion, currentStreak, monthGrid, shiftMonth } from "@/lib/habit-stats";
import { DAYS, plural, pluralN } from "@/lib/plural";

const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];

function monthTitle(month: string): string {
  return `${MONTHS[Number(month.slice(5, 7)) - 1] ?? ""} ${month.slice(0, 4)}`;
}

/** Month heatmap: one cell per day, filled = ticked. Tapping a past day ticks it. */
function HabitMonth({ habit, today }: { habit: Habit; today: string }) {
  const toggleHabit = usePlanner((s) => s.toggleHabit);
  const [month, setMonth] = useState(today.slice(0, 7));
  const weeks = monthGrid(month, habit.checks, today);
  const inMonth = habit.checks.filter((day) => day.startsWith(month)).length;
  return (
    <div className="mt-3 max-w-xs rounded-xl bg-elevated p-3">
      <div className="flex items-center gap-1">
        <Button size="icon" variant="ghost" aria-label="Прошлый месяц" onClick={() => setMonth(shiftMonth(month, -1))}>
          <ChevronLeft className="size-4" />
        </Button>
        <p className="min-w-0 flex-1 text-center text-sm">
          {monthTitle(month)} · <span className="tabular-nums">{inMonth}</span> {plural(inMonth, ["отметка", "отметки", "отметок"])}
        </p>
        <Button
          size="icon"
          variant="ghost"
          aria-label="Следующий месяц"
          disabled={month >= today.slice(0, 7)}
          onClick={() => setMonth(shiftMonth(month, 1))}
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>
      <div className="mt-2 grid grid-cols-7 gap-1 text-center text-[10px] text-subtle">
        {["пн", "вт", "ср", "чт", "пт", "сб", "вс"].map((d) => (
          <span key={d}>{d}</span>
        ))}
        {weeks.flat().map((cell, index) =>
          cell ? (
            <button
              key={cell.day}
              type="button"
              disabled={cell.future}
              aria-pressed={cell.on}
              aria-label={`${habit.name}, ${cell.day}`}
              onClick={() => toggleHabit(habit.id, cell.day)}
              className={cn(
                "flex aspect-square items-center justify-center rounded-md text-[11px] tabular-nums",
                cell.on ? "bg-accent text-accent-fg" : "bg-bg text-muted",
                cell.day === today && !cell.on && "ring-1 ring-accent",
                cell.future && "opacity-30",
              )}
            >
              {Number(cell.day.slice(8))}
            </button>
          ) : (
            <span key={`pad-${index}`} />
          ),
        )}
      </div>
    </div>
  );
}

export function HabitsView() {
  const habits = usePlanner((s) => s.habits);
  const toggleHabit = usePlanner((s) => s.toggleHabit);
  const addHabit = usePlanner((s) => s.addHabit);
  const deleteHabit = usePlanner((s) => s.deleteHabit);
  const today = todayIso();
  const [offset, setOffset] = useState(0);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [statsId, setStatsId] = useState<string | null>(null);
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

      {habits.length === 0 ? (
        <div className="py-10 text-center">
          <p className="font-display text-2xl tracking-tight">Привычек пока нет</p>
          <p className="mt-2 text-sm text-muted">
            Начните с одной маленькой: «Стакан воды утром», «10 минут чтения», «Прогулка без телефона». Отмечайте каждый день — здесь появятся серия,
            лучший результат и процент за месяц.
          </p>
        </div>
      ) : null}
      <ul className="mt-4 divide-y divide-line">
        {habits.map((habit) => {
          const streak = currentStreak(habit.checks, today);
          const best = bestStreak(habit.checks, today);
          const rate = completion(habit.checks, today, 30);
          return (
            <li key={habit.id} className="py-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">{habit.name}</p>
                  {habit.why ? <p className="text-xs text-muted">{habit.why}</p> : null}
                  <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-subtle">
                    <span title="Дней подряд до сегодня">
                      🔥 серия <span className="tabular-nums text-fg">{pluralN(streak, DAYS)}</span>
                    </span>
                    <span title="Самая длинная серия">
                      лучшая <span className="tabular-nums text-fg">{pluralN(best, DAYS)}</span>
                    </span>
                    <span title={`${rate.done} из ${rate.total} дней`}>
                      за 30 дней <span className="tabular-nums text-fg">{rate.percent}%</span>
                    </span>
                  </p>
                  <button
                    type="button"
                    aria-expanded={statsId === habit.id}
                    onClick={() => setStatsId(statsId === habit.id ? null : habit.id)}
                    className="mt-1 h-8 text-xs text-accent"
                  >
                    {statsId === habit.id ? "Скрыть месяц" : "Статистика по месяцам"}
                  </button>
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
              {statsId === habit.id ? <HabitMonth habit={habit} today={today} /> : null}
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
          placeholder="Новая привычка, например: «10 минут чтения»"
          className="h-11 min-w-0 flex-1 rounded-md border border-line bg-elevated px-3 text-base outline-none placeholder:text-subtle"
        />
        <Button type="submit" variant="primary">
          Добавить
        </Button>
      </form>
    </div>
  );
}
