import { useState } from "react";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { AddTaskForm, TaskRow } from "@/components/planner/task-row";
import { ScheduleView } from "@/components/planner/schedule-view";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { formatLong, isoFromTs, occursOn, shiftIso, todayIso } from "@/lib/dates";
import { usePlanner } from "@/lib/planner-store";
import type { Task } from "@/lib/planner-types";
import { ageLabel, occursOnDay } from "@/lib/special-dates";

export const SCHEDULE_RANGES = [1, 2, 3, 5, 7] as const;

function rangeLabel(days: number): string {
  if (days === 1) return "1 день";
  return `${days} ${days < 5 ? "дня" : "дней"}`;
}

function timeKey(task: Task): string {
  return task.startAt ?? task.remindAt ?? "99:99";
}

/** «Расписание на 1, 2, 3, 5 или 7 дней»: 1 = the hour board, more = days side by side (choice remembered on this device). */
export function ScheduleScreen({ onOpen, onOpenProjects }: { onOpen: (id: string) => void; onOpenProjects: (id: string) => void }) {
  const days = usePlanner((s) => s.scheduleDays) ?? 1;
  const setDays = usePlanner((s) => s.setScheduleDays);
  return (
    <div>
      <div className="mx-auto mb-4 flex max-w-3xl flex-wrap items-center gap-2" role="radiogroup" aria-label="Сколько дней показывать">
        <span className="text-xs font-medium text-subtle">Показать</span>
        {SCHEDULE_RANGES.map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={days === n}
            onClick={() => setDays(n)}
            className={cn("h-10 rounded-full px-3 text-sm", days === n ? "bg-accent text-accent-fg" : "card-lift bg-elevated text-muted hover:text-fg")}
          >
            {rangeLabel(n)}
          </button>
        ))}
      </div>
      {days === 1 ? <ScheduleView onOpen={onOpen} onOpenProjects={onOpenProjects} /> : <AgendaDays count={days} onOpen={onOpen} />}
    </div>
  );
}

function AgendaDays({ count, onOpen }: { count: number; onOpen: (id: string) => void }) {
  const tasks = usePlanner((s) => s.tasks);
  const habits = usePlanner((s) => s.habits);
  const milestones = usePlanner((s) => s.milestones) ?? [];
  const toggleHabit = usePlanner((s) => s.toggleHabit);
  const addTask = usePlanner((s) => s.addTask);
  const today = todayIso();
  const [start, setStart] = useState(today);
  const days = Array.from({ length: count }, (_, i) => shiftIso(start, i));

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <Button size="icon" variant="soft" aria-label="Раньше" onClick={() => setStart(shiftIso(start, -count))}>
          <ChevronLeft className="size-5" />
        </Button>
        <p className="min-w-0 flex-1 text-center text-sm text-muted">
          {formatLong(days[0]!)} — {formatLong(days[days.length - 1]!)}
          {start !== today ? (
            <button type="button" className="ml-2 h-9 text-xs text-accent" onClick={() => setStart(today)}>
              к сегодня
            </button>
          ) : null}
        </p>
        <Button size="icon" variant="soft" aria-label="Позже" onClick={() => setStart(shiftIso(start, count))}>
          <ChevronRight className="size-5" />
        </Button>
      </div>
      <div className={cn("grid gap-4", count === 2 ? "md:grid-cols-2" : "md:grid-cols-2 xl:grid-cols-3")}>
        {days.map((day) => {
          const open = tasks.filter((task) => !task.done && occursOn(task, day)).sort((a, b) => timeKey(a).localeCompare(timeKey(b)));
          const closed = tasks.filter((task) => task.done && typeof task.completedAt === "number" && isoFromTs(task.completedAt) === day);
          const special = milestones.filter((item) => occursOnDay(item, day));
          const future = day > today;
          return (
            <section key={day} className={cn("rounded-2xl p-3", day === today ? "bg-elevated/60 ring-1 ring-accent" : "bg-bg/40")}>
              <h2 className="font-display text-lg tracking-tight">
                {day === today ? "Сегодня · " : ""}
                {formatLong(day)}
              </h2>
              {special.map((item) => {
                const age = ageLabel(item, day, today);
                return (
                  <p key={item.id} className="mt-2 flex items-center gap-2 rounded-xl bg-elevated px-3 py-2 text-sm">
                    <span aria-hidden="true">{item.kind === "birthday" ? "🎂" : item.kind === "anniversary" ? "💍" : "★"}</span>
                    <span className="min-w-0 flex-1 truncate">{item.title}</span>
                    {age ? <span className="text-xs text-muted">{age}</span> : null}
                  </p>
                );
              })}
              <div className="mt-2">
                {open.length === 0 ? <p className="py-3 text-sm text-subtle">Свободный день — добавьте задачу ниже.</p> : null}
                {open.map((task) => (
                  <TaskRow key={task.id} task={task} today={today} selected={false} showDue={false} showList onOpen={onOpen} />
                ))}
                {closed.length > 0 ? <p className="mt-1 px-1 text-xs text-subtle">Готово: {closed.length}</p> : null}
              </div>
              <AddTaskForm placeholder="Например: «в 18 тренировка»" onAdd={(title, quick) => addTask({ title, ...quick, due: day, listId: null })} />
              {habits.length > 0 ? (
                <div className="mt-3">
                  <p className="text-xs font-medium text-subtle">Привычки</p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {habits.map((habit) => {
                      const on = habit.checks.includes(day);
                      return (
                        <button
                          key={habit.id}
                          type="button"
                          disabled={future}
                          aria-pressed={on}
                          onClick={() => toggleHabit(habit.id, day)}
                          title={future ? "Отметить можно в сам день" : on ? "Снять отметку" : "Отметить"}
                          className={cn(
                            "flex h-9 items-center gap-1 rounded-full border px-3 text-xs",
                            on ? "border-accent bg-accent text-accent-fg" : "border-line text-muted",
                            future && "opacity-50",
                          )}
                        >
                          {on ? <Check className="size-3" strokeWidth={3} aria-hidden="true" /> : null}
                          {habit.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}
