import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { TaskRow } from "@/components/planner/task-row";
import { ScheduleView } from "@/components/planner/schedule-view";
import { cn } from "@/lib/cn";
import { hostOf, taskSpan } from "@/lib/day-board";
import { formatLong, formatRange, formatShortDay, isoFromTs, occursOn, shiftIso, todayIso } from "@/lib/dates";
import { usePlanner } from "@/lib/planner-store";
import { habitChip, habitsForDay } from "@/lib/habit-plan";
import type { Task } from "@/lib/planner-types";
import { ageLabel, iconOf, occursOnDay } from "@/lib/special-dates";

export const SCHEDULE_RANGES = [1, 2, 3, 5, 7] as const;

function rangeLabel(days: number): string {
  if (days === 1) return "1 день";
  return `${days} ${days < 5 ? "дня" : "дн."}`;
}

/** One-row segmented control (never wraps on a phone). */
export function RangeControl({ value, onChange }: { value: number; onChange: (days: number) => void }) {
  return (
    <div className="mb-1 grid grid-cols-5 gap-1 rounded-lg bg-elevated p-1" role="radiogroup" aria-label="Сколько дней показывать">
      {SCHEDULE_RANGES.map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          onClick={() => onChange(n)}
          className={cn("h-7 rounded-md text-xs", value === n ? "bg-surface font-semibold text-fg shadow-sm" : "text-muted")}
        >
          {rangeLabel(n)}
        </button>
      ))}
    </div>
  );
}

/** «Вмещает дела» (1.23): tasks fully inside a host's time are listed under it, indented. */
function nestOpen(open: Task[]): { task: Task; inner: Task[] }[] {
  const spans = open.map(taskSpan).filter((span): span is NonNullable<typeof span> => span != null);
  const parent = hostOf(spans);
  const inner = new Map<string, Task[]>();
  for (const task of open) {
    const host = parent.get(task.id);
    if (host) inner.set(host.id, [...(inner.get(host.id) ?? []), task]);
  }
  return open.filter((task) => !parent.has(task.id)).map((task) => ({ task, inner: inner.get(task.id) ?? [] }));
}

function timeKey(task: Task): string {
  return task.startAt ?? task.remindAt ?? "99:99";
}

/** «Расписание на 1, 2, 3, 5 или 7 дней»: 1 = the hour board, more = days one under another (choice remembered on this device). */
export function ScheduleScreen({
  onOpen,
  onOpenProjects,
  onDayChange,
  onQuickAdd,
}: {
  onOpen: (id: string) => void;
  onOpenProjects: (id: string) => void;
  onDayChange?: (day: string) => void;
  /** Opens the bottom composer for this day (focus inside the tap for iOS). */
  onQuickAdd?: (day: string) => void;
}) {
  const days = usePlanner((s) => s.scheduleDays) ?? 1;
  const setDays = usePlanner((s) => s.setScheduleDays);
  const control = <RangeControl value={days} onChange={setDays} />;
  return days === 1 ? (
    <ScheduleView onOpen={onOpen} onOpenProjects={onOpenProjects} onDayChange={onDayChange} rangeControl={control} />
  ) : (
    <AgendaDays count={days} onOpen={onOpen} onDayChange={onDayChange} onQuickAdd={onQuickAdd} control={control} />
  );
}

function AgendaDays({
  count,
  onOpen,
  onDayChange,
  onQuickAdd,
  control,
}: {
  count: number;
  onOpen: (id: string) => void;
  onDayChange?: (day: string) => void;
  onQuickAdd?: (day: string) => void;
  control: ReactNode;
}) {
  const tasks = usePlanner((s) => s.tasks);
  const habits = usePlanner((s) => s.habits);
  const milestones = usePlanner((s) => s.milestones) ?? [];
  const toggleHabit = usePlanner((s) => s.toggleHabit);
  const today = todayIso();
  const [start, setStart] = useState(today);
  const days = Array.from({ length: count }, (_, i) => shiftIso(start, i));

  useEffect(() => {
    onDayChange?.(start);
  }, [start, onDayChange]);
  const rootRef = useRef<HTMLDivElement>(null);
  // Switching from the hour board (scrolled to «now») starts the agenda at the top.
  useEffect(() => {
    rootRef.current?.closest(".overflow-y-auto")?.scrollTo({ top: 0 });
  }, [count]);

  return (
    <div ref={rootRef} className="mx-auto max-w-3xl">
      <div className="sticky -top-2 z-20 -mx-4 -mt-2 bg-surface px-3 pt-2 pb-1 md:static md:mx-0 md:px-0">
        {control}
        <div className="flex items-center gap-1">
          <button type="button" aria-label="Раньше" onClick={() => setStart(shiftIso(start, -count))} className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted">
            <ChevronLeft className="size-5" />
          </button>
          <div className="min-w-0 flex-1 text-center leading-tight">
            <p className="truncate text-body font-semibold">{formatRange(days[0]!, days[days.length - 1]!)}</p>
            {start !== today ? (
              <button type="button" className="text-[0.6875rem] text-accent-ink" onClick={() => setStart(today)}>
                к сегодня
              </button>
            ) : (
              <p className="text-[0.6875rem] text-subtle">с сегодняшнего дня</p>
            )}
          </div>
          <button type="button" aria-label="Позже" onClick={() => setStart(shiftIso(start, count))} className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted">
            <ChevronRight className="size-5" />
          </button>
        </div>
      </div>
      <div className={cn("grid gap-x-4", count === 2 ? "md:grid-cols-2" : "md:grid-cols-2 xl:grid-cols-3")}>
        {days.map((day) => {
          const open = tasks.filter((task) => !task.done && occursOn(task, day)).sort((a, b) => timeKey(a).localeCompare(timeKey(b)));
          const closed = tasks.filter((task) => task.done && typeof task.completedAt === "number" && isoFromTs(task.completedAt) === day);
          const special = milestones.filter((item) => occursOnDay(item, day));
          const future = day > today;
          const dayHabits = habitsForDay(habits, day);
          return (
            <section key={day} className="mt-3" aria-label={formatLong(day)}>
              <div className="flex items-center gap-2 px-1 pb-1">
                <h2 className={cn("min-w-0 flex-1 truncate text-xs font-semibold uppercase", day === today ? "text-accent-ink" : "text-muted")}>
                  {day === today ? "Сегодня · " : ""}
                  {formatShortDay(day, true)}
                </h2>
                {closed.length > 0 ? <span className="text-[0.6875rem] text-subtle">готово {closed.length}</span> : null}
                {onQuickAdd ? (
                  <button
                    type="button"
                    aria-label={`Добавить задачу на ${formatLong(day).toLowerCase()}`}
                    onClick={() => onQuickAdd(day)}
                    className="-my-2 flex size-9 items-center justify-center rounded-full text-subtle"
                  >
                    <Plus className="size-4" />
                  </button>
                ) : null}
              </div>
              {special.map((item) => {
                const age = ageLabel(item, day, today);
                return (
                  <p key={item.id} className="mb-1 flex h-9 items-center gap-2 rounded-card bg-card px-3 text-sm">
                    <span aria-hidden="true">{iconOf(item)}</span>
                    <span className="min-w-0 flex-1 truncate">{item.title}</span>
                    {age ? <span className="text-xs text-muted">{age}</span> : null}
                  </p>
                );
              })}
              {open.length === 0 ? <p className="px-1 py-1 text-sm text-subtle">Свободно</p> : null}
              {nestOpen(open).map(({ task, inner }) =>
                inner.length > 0 ? (
                  <div key={task.id}>
                    <TaskRow task={task} today={today} selected={false} showDue={false} showList onOpen={onOpen} />
                    <div role="group" aria-label={`Внутри «${task.title}»`} className="ml-5 border-l-2 border-accent/40 pl-2">
                      {inner.map((child) => (
                        <TaskRow key={child.id} task={child} today={today} selected={false} showDue={false} showList onOpen={onOpen} />
                      ))}
                    </div>
                  </div>
                ) : (
                  <TaskRow key={task.id} task={task} today={today} selected={false} showDue={false} showList onOpen={onOpen} />
                ),
              )}
              {dayHabits.length > 0 ? (
                <div className="no-scrollbar mt-2 flex gap-1 overflow-x-auto">
                  {dayHabits.map((habit) => {
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
                          "flex h-7 shrink-0 items-center gap-1 rounded-full px-3 text-xs",
                          on ? "bg-accent text-accent-fg" : "bg-elevated text-muted",
                          future && "opacity-50",
                        )}
                      >
                        {on ? <Check className="size-3" strokeWidth={3} aria-hidden="true" /> : null}
                        {habitChip(habit, day)}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}
