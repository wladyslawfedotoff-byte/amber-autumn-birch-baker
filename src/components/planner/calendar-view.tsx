import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  isSameMonth,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { AddTaskForm, TaskRow } from "@/components/planner/task-row";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { daysBetween, formatLong, formatMonth, shiftIso, todayIso } from "@/lib/dates";
import { usePlanner } from "@/lib/planner-store";
import { byNewest } from "@/lib/queries";
import { stageRange } from "@/lib/stage-range";

type Drag =
  | {
      kind: "task";
      id: string;
      title: string;
      x: number;
      y: number;
      over: string | null;
      active: boolean;
    }
  | {
      kind: "stage";
      id: string;
      projectId: string;
      title: string;
      origin: string;
      start: string;
      end: string;
      x: number;
      y: number;
      over: string | null;
      active: boolean;
    };

function dayAt(x: number, y: number): string | null {
  const nodes = [...document.querySelectorAll<HTMLElement>("[data-day]")];
  for (const node of nodes) {
    const rect = node.getBoundingClientRect();
    if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
      return node.dataset.day ?? null;
    }
  }
  let best: { iso: string; dy: number } | null = null;
  for (const node of nodes) {
    const rect = node.getBoundingClientRect();
    if (x < rect.left || x > rect.right) continue;
    const dy = Math.abs(y - (rect.top + rect.height / 2));
    const iso = node.dataset.day ?? "";
    if (!best || dy < best.dy) best = { iso, dy };
  }
  if (!best || best.dy > 140 || !best.iso) return null;
  return best.iso;
}

export function CalendarView({
  selectedId,
  onOpen,
}: {
  selectedId: string | null;
  onOpen: (id: string) => void;
}) {
  const tasks = usePlanner((s) => s.tasks);
  const projects = usePlanner((s) => s.projects) ?? [];
  const addTask = usePlanner((s) => s.addTask);
  const updateTask = usePlanner((s) => s.updateTask);
  const placeStage = usePlanner((s) => s.placeStage);
  const today = todayIso();
  const [cursor, setCursor] = useState(() => new Date());
  const [day, setDay] = useState(today);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  function nudgeScroll(y: number) {
    let node = rootRef.current?.parentElement ?? null;
    while (node) {
      const overflow = getComputedStyle(node).overflowY;
      if (overflow === "auto" || overflow === "scroll") break;
      node = node.parentElement;
    }
    if (!node) return;
    const rect = node.getBoundingClientRect();
    if (y < rect.top + 64) node.scrollTop -= 20;
    else if (y > rect.bottom - 72) node.scrollTop += 20;
  }

  const cells = useMemo(() => {
    const start = startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end });
  }, [cursor]);

  const weeks = useMemo(() => {
    const rows: Date[][] = [];
    for (let index = 0; index < cells.length; index += 7) rows.push(cells.slice(index, index + 7));
    return rows;
  }, [cells]);

  const bars = useMemo(() => {
    return projects.flatMap((project) =>
      project.stages.flatMap((stage, index) => {
        const range = stageRange(project, stage, index);
        if (!range) return [];
        return [{ projectId: project.id, project: project.title, stageId: stage.id, title: stage.title, ...range }];
      }),
    );
  }, [projects]);

  const dayTasks = tasks.filter((task) => task.due === day).sort(byNewest);
  const letters = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

  function track(event: ReactPointerEvent<HTMLElement>, initial: Drag) {
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startY = event.clientY;
    dragRef.current = initial;
    let frame = 0;
    const tick = () => {
      const current = dragRef.current;
      if (current?.active) nudgeScroll(current.y);
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);

    const move = (ev: PointerEvent) => {
      const active = Math.hypot(ev.clientX - startX, ev.clientY - startY) > 8;
      const next = {
        ...dragRef.current,
        x: ev.clientX,
        y: ev.clientY,
        over: active ? dayAt(ev.clientX, ev.clientY) : null,
        active,
      } as Drag;
      dragRef.current = next;
      setDrag(next);
    };
    const finish = () => {
      window.cancelAnimationFrame(frame);
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", finish);
      handle.removeEventListener("pointercancel", finish);
      const current = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (!current?.active || !current.over) return;
      if (current.kind === "task") {
        updateTask(current.id, { due: current.over });
        setDay(current.over);
        return;
      }
      const delta = daysBetween(current.origin, current.over);
      if (delta === 0) return;
      placeStage(current.projectId, current.id, shiftIso(current.start, delta), shiftIso(current.end, delta));
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
  }

  return (
    <div ref={rootRef}>
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="font-display text-2xl tracking-tight">{formatMonth(cursor)}</h2>
        <div className="flex items-center">
          <Button
            size="icon"
            variant="ghost"
            aria-label="Предыдущий месяц"
            onClick={() => setCursor((value) => addMonths(value, -1))}
          >
            <ChevronLeft className="size-5" />
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setCursor(new Date())}>
            Сегодня
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Следующий месяц"
            onClick={() => setCursor((value) => addMonths(value, 1))}
          >
            <ChevronRight className="size-5" />
          </Button>
        </div>
      </div>
      <p className="mb-3 text-sm text-muted">Перетащите задачу или этап на другой день.</p>

      <div className="grid grid-cols-7 gap-1 text-center text-xs text-subtle">
        {letters.map((letter) => (
          <div key={letter} className="py-2">
            {letter}
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        {weeks.map((week) => {
          const weekStart = todayIso(week[0] ?? new Date());
          const weekEnd = todayIso(week[6] ?? new Date());
          const rowBars = bars
            .map((bar) => {
              if (bar.end < weekStart || bar.start > weekEnd) return null;
              const start = bar.start < weekStart ? weekStart : bar.start;
              const end = bar.end > weekEnd ? weekEnd : bar.end;
              return {
                ...bar,
                col: daysBetween(weekStart, start),
                span: daysBetween(start, end) + 1,
              };
            })
            .filter((bar): bar is NonNullable<typeof bar> => bar != null);
          return (
            <div key={weekStart}>
              <div className="grid grid-cols-7 gap-1">
                {week.map((date) => {
                  const iso = todayIso(date);
                  const inMonth = isSameMonth(date, cursor);
                  const count = tasks.filter((task) => !task.done && task.due === iso).length;
                  const selected = iso === day;
                  const isToday = iso === today;
                  const over = drag?.active && drag.over === iso;
                  return (
                    <button
                      key={iso}
                      type="button"
                      data-day={iso}
                      onClick={() => setDay(iso)}
                      className={cn(
                        "flex h-14 flex-col items-center justify-center rounded-md text-sm",
                        selected ? "bg-elevated" : "hover:bg-elevated",
                        inMonth ? "text-fg" : "text-subtle",
                        over && "bg-accent text-accent-fg",
                      )}
                    >
                      <span
                        className={cn(
                          "flex size-7 items-center justify-center rounded-full tabular-nums",
                          isToday && !over && "bg-accent text-accent-fg",
                        )}
                      >
                        {date.getDate()}
                      </span>
                      {count > 0 ? <span className="text-xs tabular-nums text-muted">{count}</span> : null}
                    </button>
                  );
                })}
              </div>
              {rowBars.length > 0 ? (
                <div className="mt-1 flex flex-col gap-1">
                  {rowBars.map((bar) => (
                    <div key={`${bar.stageId}-${weekStart}`} className="grid grid-cols-7 gap-1">
                      <div
                        role="button"
                        tabIndex={0}
                        aria-label={`${bar.project}, этап ${bar.title}`}
                        onPointerDown={(event) => {
                          if (event.button !== 0) return;
                          const origin = dayAt(event.clientX, event.clientY) ?? bar.start;
                          track(event, {
                            kind: "stage",
                            id: bar.stageId,
                            projectId: bar.projectId,
                            title: `${bar.project} · ${bar.title}`,
                            origin,
                            start: bar.start,
                            end: bar.end,
                            x: event.clientX,
                            y: event.clientY,
                            over: null,
                            active: false,
                          });
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") setDay(bar.start);
                        }}
                        className="drag-handle flex h-11 items-center overflow-hidden rounded-md border border-line bg-elevated px-2 text-left text-xs text-fg"
                        style={{ gridColumn: `${bar.col + 1} / span ${bar.span}` }}
                      >
                        <span className="truncate">
                          {bar.project} · {bar.title}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <section className="mt-8">
        <h3 className="font-display text-xl tracking-tight">{formatLong(day)}</h3>
        <div className="mt-3">
          <AddTaskForm
            placeholder="Встреча в 15"
            onAdd={(title) => addTask({ title, due: day, listId: null })}
          />
        </div>
        <div className="mt-3">
          {dayTasks.length === 0 ? (
            <p className="py-8 text-sm text-muted">На этот день задач нет. Можно перетащить сюда задачу с другого дня.</p>
          ) : (
            dayTasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                today={today}
                selected={selectedId === task.id}
                showDue={false}
                showList
                onOpen={onOpen}
                onDragStart={(event) => {
                  if (event.button !== 0) return;
                  track(event, {
                    kind: "task",
                    id: task.id,
                    title: task.title,
                    x: event.clientX,
                    y: event.clientY,
                    over: null,
                    active: false,
                  });
                }}
              />
            ))
          )}
        </div>
      </section>

      {drag?.active ? (
        <div
          className="pointer-events-none fixed z-50 max-w-48 truncate rounded-md border border-line bg-elevated px-3 py-2 text-sm text-fg"
          style={{ left: drag.x + 16, top: drag.y + 16 }}
        >
          {drag.title}
        </div>
      ) : null}
    </div>
  );
}
