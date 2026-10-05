import { countdownLabel, daysBetween, nextOccurrence, shiftIso, todayIso, weekdayLetter } from "@/lib/dates";
import { usePlanner } from "@/lib/planner-store";
import { cn } from "@/lib/cn";

export function TodaySummary() {
  const tasks = usePlanner((s) => s.tasks);
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
  const todayN = tasks.filter((task) => !task.done && task.due === today).length;
  const overdueN = tasks.filter((task) => !task.done && task.due != null && task.due < today).length;
  const habitLeft = habits.filter((habit) => !habit.checks.includes(today)).length;
  const nextDate = soon[0];
  const line = [
    todayN === 0 && overdueN === 0 ? "На сегодня задач нет" : `${todayN} на сегодня`,
    overdueN > 0 ? `${overdueN} просрочено` : "",
    habits.length === 0 ? "" : habitLeft === 0 ? "привычки отмечены" : `привычки ${habitLeft}`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="mb-3">
      <p className="font-display text-xl tracking-tight text-fg">{line}</p>
      {nextDate ? (
        <p className="text-xs text-muted">
          {nextDate.item.title} — {countdownLabel(nextDate.days)}
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
        const count = tasks.filter((task) => !task.done && task.due === day).length;
        const habitsDone = habits.length > 0 && habits.every((habit) => habit.checks.includes(day));
        const on = day === selected;
        return (
          <button
            key={day}
            type="button"
            aria-pressed={on}
            aria-label={`${weekdayLetter(day)} ${Number(day.slice(8))}, задач ${count}`}
            onClick={() => onPick(day)}
            className={cn(
              "flex min-h-14 flex-col items-center justify-center rounded-xl px-1 py-1.5 text-xs",
              on ? "bg-accent text-accent-fg" : "text-muted",
            )}
          >
            <span>{weekdayLetter(day)}</span>
            <span className="tabular-nums">{Number(day.slice(8))}</span>
            <span className="mt-1 tabular-nums">{count > 0 ? count : "·"}</span>
            <span className={cn("mt-0.5 size-1.5 rounded-full", habitsDone ? "bg-current" : "bg-transparent")} />
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

  return (
    <div className="mt-8 space-y-3">
      <WeekDays selected={today} onPick={onPick} />

      {habits.length > 0 ? (
        <div>
          <p className="text-xs font-medium text-subtle">Привычки сегодня</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {habits.map((habit) => {
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
                  {habit.name}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
