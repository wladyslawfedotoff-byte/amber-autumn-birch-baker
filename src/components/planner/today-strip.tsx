import { ageLabel, daysLeftLabel, iconOf, showInTodayNow } from "@/lib/special-dates";
import { daysBetween, nextOccurrence, shiftIso, todayIso, weekdayLetter, occursOn } from "@/lib/dates";
import { usePlanner } from "@/lib/planner-store";
import { cn } from "@/lib/cn";
import { habitChip, habitsForDay } from "@/lib/habit-plan";
import { isTaskOverdue } from "@/lib/maintenance/honest-due";

export function TodaySummary() {
  const tasks = usePlanner((s) => s.tasks);
  const assets = usePlanner((s) => s.assets);
  const habits = usePlanner((s) => s.habits);
  const milestones = usePlanner((s) => s.milestones);
  const today = todayIso();
  const soon = (milestones ?? [])
    .map((item) => {
      const when = nextOccurrence(item.date, item.yearly, today);
      return { item, days: daysBetween(today, when) };
    })
    .filter((row) => row.days >= 0 && row.days <= 14)
    .sort((a, b) => a.days - b.days);
  const overdueN = tasks.filter((task) => isTaskOverdue(task, assets, today)).length;
  const todayN = tasks.filter((task) => !task.done && task.due != null && task.due <= today).length - overdueN;
  const planned = habitsForDay(habits, today);
  const habitLeft = planned.filter((habit) => !habit.checks.includes(today)).length;
  const nextDate = soon[0];
  // «Показать в Сегодня»: dates within their lead window, soonest first.
  const flagged = (milestones ?? [])
    .map((item) => showInTodayNow(item, today))
    .filter((row): row is NonNullable<typeof row> => Boolean(row))
    .sort((a, b) => a.days - b.days);
  const line = [
    todayN === 0 && overdueN === 0 ? "На сегодня задач нет" : `${todayN} на сегодня`,
    overdueN > 0 ? `${overdueN} просрочено` : "",
    planned.length === 0 ? "" : habitLeft === 0 ? "привычки отмечены" : `привычки ${habitLeft}`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="mb-3">
      <p className="text-base font-semibold tracking-tight text-fg">{line}</p>
      {flagged.length ? (
        <ul className="mt-1 space-y-1">
          {flagged.map((row) => (
            <li key={row.item.id} className="truncate text-sm">
              <span aria-hidden="true">{iconOf(row.item)} </span>
              {row.item.title} — <span className={row.days === 0 ? "font-medium text-accent" : "text-muted"}>{daysLeftLabel(row.days)}</span>
              {row.age ? <span className="text-muted">, {row.age}</span> : null}
            </li>
          ))}
        </ul>
      ) : nextDate ? (
        <p className="text-xs text-muted">
          {nextDate.item.title} — {daysLeftLabel(nextDate.days)}
          {ageLabel(nextDate.item, shiftIso(today, nextDate.days), today) ? `, ${ageLabel(nextDate.item, shiftIso(today, nextDate.days), today)}` : ""}
        </p>
      ) : null}
    </div>
  );
}

export function WeekDays({
  selected,
  onPick,
}: {
  selected: string;
  onPick: (day: string) => void;
}) {
  const tasks = usePlanner((s) => s.tasks);
  const habits = usePlanner((s) => s.habits);
  const today = todayIso();
  const days = Array.from({ length: 7 }, (_, index) => shiftIso(today, index));

  return (
    <div className="grid grid-cols-7 gap-1">
      {days.map((day) => {
        const count = tasks.filter((task) => !task.done && occursOn(task, day)).length;
        const dayHabits = habitsForDay(habits, day);
        const habitsDone = dayHabits.length > 0 && dayHabits.every((habit) => habit.checks.includes(day));
        const on = day === selected;
        return (
          <button
            key={day}
            type="button"
            aria-pressed={on}
            aria-label={`${weekdayLetter(day)} ${Number(day.slice(8))}, задач ${count}`}
            onClick={() => onPick(day)}
            className={cn(
              "flex min-h-14 flex-col items-center justify-center rounded-xl px-1 py-2 text-xs",
              on ? "bg-accent text-accent-fg" : "text-muted",
            )}
          >
            <span>{weekdayLetter(day)}</span>
            <span className="tabular-nums">{Number(day.slice(8))}</span>
            <span className="mt-1 tabular-nums">{count > 0 ? count : "·"}</span>
            <span className={cn("mt-1 size-1.5 rounded-full", habitsDone ? "bg-current" : "bg-transparent")} />
          </button>
        );
      })}
    </div>
  );
}

export function TodayStrip({ onPick }: { onPick: (day: string) => void }) {
  const habits = usePlanner((s) => s.habits);
  const toggleHabit = usePlanner((s) => s.toggleHabit);
  const today = todayIso();
  const planned = habitsForDay(habits, today);

  return (
    <div className="mt-8 space-y-3">
      <WeekDays selected={today} onPick={onPick} />

      {planned.length > 0 ? (
        <div>
          <p className="text-xs font-medium text-subtle">Привычки сегодня</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {planned.map((habit) => {
              const on = habit.checks.includes(today);
              return (
                <button
                  key={habit.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleHabit(habit.id, today)}
                  className={cn(
                    "h-11 rounded-full border px-3 text-sm",
                    on ? "border-accent bg-accent text-accent-fg" : "border-line bg-elevated text-fg",
                  )}
                >
                  {habitChip(habit, today)}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
