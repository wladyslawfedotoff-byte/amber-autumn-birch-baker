import { useMemo, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from "react";
import { ChevronLeft, ChevronRight, GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  boardBounds,
  freeWindows,
  fromMinutes,
  placeSpans,
  taskSpan,
  toMinutes,
  type Placed,
} from "@/lib/day-board";
import { formatLong, shiftIso, todayIso, occursOn } from "@/lib/dates";
import { cn } from "@/lib/cn";
import { usePlanner } from "@/lib/planner-store";
import type { Task } from "@/lib/planner-types";

const HOUR = 4;

type CardPreview = { id: string; title: string; start: number; end: number };

function blockStyle(span: Placed, from: number): { top: string; height: string; left: string; width: string } {
  const minutes = Math.max(span.end - span.start, 15);
  return {
    top: `${((span.start - from) / 60) * HOUR}rem`,
    height: `${Math.max((minutes / 60) * HOUR, 2.75)}rem`,
    left: `calc(3rem + (100% - 3rem) * ${span.lane} / ${span.lanes})`,
    width: `calc((100% - 3rem) / ${span.lanes} - 0.25rem)`,
  };
}

export function ScheduleView({
  onOpen,
  onOpenProjects,
}: {
  onOpen: (id: string) => void;
  onOpenProjects: (id: string) => void;
}) {
  const tasks = usePlanner((s) => s.tasks);
  const projects = usePlanner((s) => s.projects) ?? [];
  const workStart = usePlanner((s) => s.workStart) ?? "09:00";
  const workEnd = usePlanner((s) => s.workEnd) ?? "18:00";
  const setWorkHours = usePlanner((s) => s.setWorkHours);
  const addTask = usePlanner((s) => s.addTask);
  const updateTask = usePlanner((s) => s.updateTask);
  const today = todayIso();
  const [day, setDay] = useState(today);
  const [title, setTitle] = useState("");
  const [from, setFrom] = useState("14:00");
  const [to, setTo] = useState("15:00");
  const [draft, setDraft] = useState<{ id: string; start: number; end: number } | null>(null);
  const [preview, setPreview] = useState<CardPreview | null>(null);
  const [ghost, setGhost] = useState<{ title: string; x: number; y: number } | null>(null);
  const [holding, setHolding] = useState<string | null>(null);
  const draftRef = useRef(draft);
  const previewRef = useRef<CardPreview | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  draftRef.current = draft;

  const spans = useMemo(
    () =>
      tasks
        .filter((task) => occursOn(task, day))
        .map(taskSpan)
        .filter((span): span is NonNullable<typeof span> => span != null),
    [tasks, day],
  );
  const live = useMemo(() => {
    const mapped = spans.map((span) =>
      draft && span.id === draft.id ? { ...span, start: draft.start, end: draft.end, assumed: false } : span,
    );
    if (!preview) return mapped;
    return [
      ...mapped.filter((span) => span.id !== preview.id),
      { id: preview.id, title: preview.title, start: preview.start, end: preview.end, done: false, assumed: false },
    ];
  }, [spans, draft, preview]);
  const placed = useMemo(() => placeSpans(live), [live]);
  const workFrom = toMinutes(workStart) ?? 9 * 60;
  const workTo = toMinutes(workEnd) ?? 18 * 60;
  const hoursOk = workTo > workFrom;
  const gaps = useMemo(
    () => (hoursOk ? freeWindows(workFrom, workTo, spans) : []),
    [hoursOk, workFrom, workTo, spans],
  );
  const bounds = useMemo(() => boardBounds(spans, workFrom, workTo), [spans, workFrom, workTo]);
  const hours = Math.max(1, Math.round((bounds.to - bounds.from) / 60));
  const clashes = placed.filter((span) => span.clash && !span.done);
  const untimed = tasks.filter((task) => occursOn(task, day) && !task.done && !taskSpan(task));
  const cards = tasks
    .filter((task) => occursOn(task, day) && !task.done)
    .sort((a, b) => (taskSpan(a)?.start ?? 24 * 60) - (taskSpan(b)?.start ?? 24 * 60));
  const running = projects.filter((project) => {
    if (!project.start || !project.end) return false;
    return project.start <= day && project.end >= day;
  });
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const showNow = day === today && nowMin >= bounds.from && nowMin <= bounds.to;
  const rangeOk = (toMinutes(to) ?? 0) > (toMinutes(from) ?? 0);

  function addBlock(event: FormEvent) {
    event.preventDefault();
    if (!title.trim() || !rangeOk) return;
    addTask({
      title,
      listId: null,
      due: day,
      startAt: from,
      endAt: to,
      remindAt: from,
    });
    setTitle("");
  }

  function clock(total: number): string {
    return fromMinutes(Math.max(0, Math.min(total, 24 * 60 - 1)));
  }

  function beginDrag(event: ReactPointerEvent<HTMLElement>, span: Placed, mode: "move" | "resize") {
    if (event.button !== 0) return;
    event.stopPropagation();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const startY = event.clientY;
    const origin = { start: span.start, end: span.end };
    const boardFrom = bounds.from;
    const boardTo = bounds.to;
    let moved = false;
    const apply = (next: { id: string; start: number; end: number }) => {
      draftRef.current = next;
      setDraft(next);
    };
    const move = (ev: PointerEvent) => {
      const rect = boardRef.current?.getBoundingClientRect();
      if (!rect || rect.height === 0) return;
      const delta = ((ev.clientY - startY) / rect.height) * (boardTo - boardFrom);
      if (Math.abs(ev.clientY - startY) > 6) moved = true;
      if (mode === "move") {
        const duration = Math.max(origin.end - origin.start, 15);
        let start = Math.round((origin.start + delta) / 15) * 15;
        start = Math.max(boardFrom, Math.min(start, boardTo - duration));
        apply({ id: span.id, start, end: start + duration });
        return;
      }
      let end = Math.round((origin.end + delta) / 15) * 15;
      end = Math.max(origin.start + 15, Math.min(end, boardTo));
      apply({ id: span.id, start: origin.start, end });
    };
    const finish = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", finish);
      handle.removeEventListener("pointercancel", finish);
      const current = draftRef.current;
      draftRef.current = null;
      setDraft(null);
      if (!moved || !current || current.id !== span.id) {
        if (!moved && mode === "move") onOpen(span.id);
        return;
      }
      updateTask(span.id, {
        due: day,
        startAt: clock(current.start),
        endAt: clock(current.end),
        remindAt: clock(current.start),
      });
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
  }

  function nudgeScroll(y: number) {
    let node = rootRef.current?.parentElement ?? null;
    while (node) {
      const overflow = getComputedStyle(node).overflowY;
      if (overflow === "auto" || overflow === "scroll") break;
      node = node.parentElement;
    }
    if (!node) return;
    const rect = node.getBoundingClientRect();
    if (y < rect.top + 64) node.scrollTop -= 18;
    else if (y > rect.bottom - 88) node.scrollTop += 18;
  }

  function beginCard(event: ReactPointerEvent<HTMLElement>, task: Task) {
    if (event.button !== 0) return;
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startY = event.clientY;
    const existing = spans.find((span) => span.id === task.id);
    const duration = existing ? Math.max(existing.end - existing.start, 15) : 60;
    let moved = false;
    const show = (next: CardPreview | null) => {
      previewRef.current = next;
      setPreview(next);
    };
    const move = (ev: PointerEvent) => {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > 8) moved = true;
      if (!moved) return;
      setHolding(task.id);
      setGhost({ title: task.title, x: ev.clientX, y: ev.clientY });
      nudgeScroll(ev.clientY);
      const gap = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>("[data-gap]");
      if (gap?.dataset.gap) {
        const [gapStart, gapEnd] = gap.dataset.gap.split(":").map(Number);
        const room = Math.max((gapEnd ?? 0) - (gapStart ?? 0), 15);
        const length = existing ? Math.min(duration, room) : Math.min(room, 120);
        show({ id: task.id, title: task.title, start: gapStart ?? bounds.from, end: (gapStart ?? bounds.from) + length });
        return;
      }
      const rect = boardRef.current?.getBoundingClientRect();
      const over =
        rect != null &&
        ev.clientX >= rect.left &&
        ev.clientX <= rect.right &&
        ev.clientY >= rect.top &&
        ev.clientY <= rect.bottom;
      if (!over || !rect || rect.height === 0) {
        show(null);
        return;
      }
      let start = Math.round((bounds.from + ((ev.clientY - rect.top) / rect.height) * (bounds.to - bounds.from)) / 15) * 15;
      start = Math.max(bounds.from, Math.min(start, bounds.to - duration));
      show({ id: task.id, title: task.title, start, end: start + duration });
    };
    const finish = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", finish);
      handle.removeEventListener("pointercancel", finish);
      const current = previewRef.current;
      previewRef.current = null;
      setPreview(null);
      setGhost(null);
      setHolding(null);
      if (!moved) return;
      if (!current) return;
      updateTask(task.id, {
        due: day,
        startAt: clock(current.start),
        endAt: clock(current.end),
        remindAt: clock(current.start),
      });
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
  }

  return (
    <div ref={rootRef} className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      <div className="flex items-center gap-2">
        <Button size="icon" variant="soft" aria-label="Предыдущий день" onClick={() => setDay(shiftIso(day, -1))}>
          <ChevronLeft className="size-5" />
        </Button>
        <div className="min-w-0 flex-1 text-center">
          <p className="truncate font-display text-2xl tracking-tight">{formatLong(day)}</p>
          {day !== today ? (
            <button type="button" className="h-11 text-xs text-muted" onClick={() => setDay(today)}>
              Вернуться к сегодня
            </button>
          ) : (
            <p className="text-xs text-subtle">{clashes.length > 0 ? "Есть накладка" : "Накладок нет"}</p>
          )}
        </div>
        <Button size="icon" variant="soft" aria-label="Следующий день" onClick={() => setDay(shiftIso(day, 1))}>
          <ChevronRight className="size-5" />
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs font-medium text-subtle">
          Работаю с
          <input
            type="time"
            value={workStart}
            onChange={(event) => setWorkHours(event.target.value || "09:00", workEnd)}
            className="mt-2 h-11 w-full rounded-md border border-line bg-elevated px-3 text-base text-fg"
          />
        </label>
        <label className="block text-xs font-medium text-subtle">
          до
          <input
            type="time"
            value={workEnd}
            onChange={(event) => setWorkHours(workStart, event.target.value || "18:00")}
            className="mt-2 h-11 w-full rounded-md border border-line bg-elevated px-3 text-base text-fg"
          />
        </label>
      </div>
      {!hoursOk ? <p className="text-sm text-danger">Конец рабочего дня раньше начала.</p> : null}

      {gaps.length > 0 ? (
        <div>
          <p className="text-xs font-medium text-subtle">Свободно</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {gaps.map((gap) => (
              <button
                key={`${gap.start}-${gap.end}`}
                type="button"
                data-gap={`${gap.start}:${gap.end}`}
                onClick={() => {
                  setFrom(fromMinutes(gap.start));
                  setTo(fromMinutes(gap.end));
                }}
                className="h-11 rounded-full border border-line bg-elevated px-3 text-sm tabular-nums text-fg"
              >
                {fromMinutes(gap.start)}–{fromMinutes(gap.end)}
              </button>
            ))}
          </div>
        </div>
      ) : hoursOk ? (
        <p className="text-sm text-muted">В рабочих часах свободных окон нет.</p>
      ) : null}

      <form onSubmit={addBlock} className="grid gap-2 sm:grid-cols-4">
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Задача на это время"
          aria-label="Задача на это время"
          className="h-11 rounded-md border border-line bg-elevated px-3 text-base outline-none placeholder:text-subtle sm:col-span-2"
        />
        <div className="grid grid-cols-2 gap-2">
          <input
            type="time"
            aria-label="Начало"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            className="h-11 rounded-md border border-line bg-elevated px-2 text-base text-fg"
          />
          <input
            type="time"
            aria-label="Конец"
            value={to}
            onChange={(event) => setTo(event.target.value)}
            className="h-11 rounded-md border border-line bg-elevated px-2 text-base text-fg"
          />
        </div>
        <Button type="submit" variant="primary" disabled={!title.trim() || !rangeOk}>
          На доску
        </Button>
      </form>
      {!rangeOk ? <p className="text-sm text-danger">Конец раньше начала.</p> : null}

      <div>
        <p className="text-xs font-medium text-subtle">Карточки</p>
        <p className="mt-1 text-xs text-muted">
          Потяните карточку за полоску и положите на доску или на свободное окно.
          {untimed.length > 0 ? ` Без времени: ${untimed.length}.` : ""}
        </p>
        {cards.length === 0 ? (
          <p className="mt-3 text-sm text-muted">На этот день открытых дел нет.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {cards.map((task) => {
              const span = placed.find((item) => item.id === task.id);
              const meta = span
                ? `${fromMinutes(span.start)}–${fromMinutes(Math.min(span.end, 24 * 60 - 1))}`
                : "без времени";
              return (
                <li
                  key={task.id}
                  className={cn(
                    "flex items-stretch rounded-lg border bg-elevated",
                    span?.clash ? "border-danger" : "border-line",
                    holding === task.id && "opacity-40",
                  )}
                >
                  <button
                    type="button"
                    aria-label={`Поставить ${task.title} на доску`}
                    className="drag-handle flex w-11 shrink-0 items-center justify-center text-subtle"
                    onPointerDown={(event) => beginCard(event, task)}
                  >
                    <GripVertical className="size-4" />
                  </button>
                  <button type="button" onClick={() => onOpen(task.id)} className="min-w-0 flex-1 px-2 py-3 text-left">
                    <span className="block truncate text-sm text-fg">{task.title}</span>
                    <span className={cn("mt-1 block text-xs tabular-nums", span?.clash ? "text-danger" : "text-muted")}>
                      {meta}
                      {span?.clash ? " · накладка" : ""}
                      {span?.assumed ? " · час" : ""}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <p className="text-xs text-muted">На доске потяните блок, чтобы сдвинуть время. Нижний край меняет длину.</p>

      <div ref={boardRef} data-board="" className="relative" style={{ height: `${hours * HOUR}rem` }}>
        {Array.from({ length: hours + 1 }, (_, index) => {
          const minute = bounds.from + index * 60;
          if (minute > bounds.to) return null;
          return (
            <div
              key={minute}
              className="absolute right-0 left-12 border-t border-line"
              style={{ top: `${index * HOUR}rem` }}
            >
              <span className="absolute -top-2 left-0 w-12 -translate-x-full pr-2 text-right text-xs tabular-nums text-subtle">
                {fromMinutes(minute)}
              </span>
            </div>
          );
        })}
        {hoursOk ? (
          <div
            className="work-band pointer-events-none absolute right-0 left-12"
            style={{
              top: `${((Math.max(workFrom, bounds.from) - bounds.from) / 60) * HOUR}rem`,
              height: `${((Math.min(workTo, bounds.to) - Math.max(workFrom, bounds.from)) / 60) * HOUR}rem`,
            }}
          />
        ) : null}
        {showNow ? (
          <div
            className="pointer-events-none absolute right-0 left-12 z-10 h-px bg-danger"
            style={{ top: `${((nowMin - bounds.from) / 60) * HOUR}rem` }}
          />
        ) : null}
        {placed.map((span) => (
          <div
            key={span.id}
            role="button"
            tabIndex={0}
            aria-label={`${span.title}, ${fromMinutes(span.start)}–${fromMinutes(Math.min(span.end, 24 * 60 - 1))}`}
            onPointerDown={(event) => beginDrag(event, span, "move")}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") onOpen(span.id);
            }}
            style={blockStyle(span, bounds.from)}
            className={cn(
              "drag-handle absolute z-10 overflow-hidden rounded-lg border px-2 py-1 text-left",
              span.clash ? "border-danger bg-elevated" : "border-line bg-elevated",
              span.done && "opacity-50",
            )}
          >
            <span className={cn("block truncate text-sm", span.done && "line-through")}>{span.title}</span>
            <span className={cn("block text-xs tabular-nums", span.clash ? "text-danger" : "text-muted")}>
              {fromMinutes(span.start)}–{fromMinutes(Math.min(span.end, 24 * 60 - 1))}
              {span.clash ? " · накладка" : ""}
              {span.assumed ? " · час" : ""}
            </span>
            <div
              aria-hidden="true"
              onPointerDown={(event) => beginDrag(event, span, "resize")}
              className="absolute inset-x-0 bottom-0 flex h-6 items-end px-2 pb-1"
            >
              <span className="h-1 w-full rounded-full bg-line" />
            </div>
          </div>
        ))}
      </div>

      {running.length > 0 ? (
        <div>
          <p className="text-xs font-medium text-subtle">Проекты в этот день</p>
          <div className="mt-1 flex flex-col">
            {running.map((project) => (
              <button
                key={project.id}
                type="button"
                onClick={() => onOpenProjects(project.id)}
                className="h-11 text-left text-sm text-fg"
              >
                {project.title}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {ghost ? (
        <div
          className="pointer-events-none fixed z-50 max-w-48 truncate rounded-lg border border-line bg-elevated px-3 py-2 text-sm text-fg"
          style={{ left: ghost.x + 12, top: ghost.y + 12 }}
        >
          {ghost.title}
        </div>
      ) : null}
    </div>
  );
}
