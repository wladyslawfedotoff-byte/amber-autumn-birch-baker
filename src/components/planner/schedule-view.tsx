import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, GripVertical } from "lucide-react";
import { HintButton } from "@/components/ui/hint";
import { Sheet } from "@/components/ui/sheet";
import {
  boardBounds,
  focusMinute,
  freeWindows,
  fromMinutes,
  placeSpans,
  slotAt,
  taskSpan,
  toMinutes,
  type Placed,
} from "@/lib/day-board";
import { formatShortDay, shiftIso, todayIso, occursOn } from "@/lib/dates";
import { cn } from "@/lib/cn";
import { usePlanner } from "@/lib/planner-store";
import type { Task } from "@/lib/planner-types";
import { colorStyle } from "@/lib/task-colors";

const HOUR = 3;

type CardPreview = { id: string; title: string; start: number; end: number };

function blockStyle(span: Placed, from: number): { top: string; height: string; left: string; width: string } {
  const minutes = Math.max(span.end - span.start, 15);
  return {
    top: `${((span.start - from) / 60) * HOUR}rem`,
    height: `${Math.max((minutes / 60) * HOUR - 0.125, 1.75)}rem`,
    left: `calc(3rem + (100% - 3rem) * ${span.lane} / ${span.lanes})`,
    width: `calc((100% - 3rem) / ${span.lanes} - 0.25rem)`,
  };
}

export function ScheduleView({
  onOpen,
  onOpenProjects,
  onDayChange,
  rangeControl,
}: {
  onOpen: (id: string) => void;
  onOpenProjects: (id: string) => void;
  /** The «+» button adds to the shown day. */
  onDayChange?: (day: string) => void;
  /** «1 · 2 · 3 · 5 · 7 дн.» control, sticks to the top together with the day header. */
  rangeControl?: ReactNode;
}) {
  const tasks = usePlanner((s) => s.tasks);
  const projects = usePlanner((s) => s.projects) ?? [];
  const workStart = usePlanner((s) => s.workStart) ?? "09:00";
  const workEnd = usePlanner((s) => s.workEnd) ?? "18:00";
  const updateTask = usePlanner((s) => s.updateTask);
  const today = todayIso();
  const [day, setDay] = useState(today);
  const [slot, setSlot] = useState<{ start: number; end: number } | null>(null);
  const [hint, setHint] = useState(false);
  const [trayOpen, setTrayOpen] = useState(true);
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
  // The tray holds only tasks without a time; timed ones live on the board (no duplicates).
  const untimed = tasks.filter((task) => occursOn(task, day) && !task.done && !taskSpan(task));
  const running = projects.filter((project) => {
    if (!project.start || !project.end) return false;
    return project.start <= day && project.end >= day;
  });
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const showNow = day === today && nowMin >= bounds.from && nowMin <= bounds.to;

  useEffect(() => {
    onDayChange?.(day);
  }, [day, onDayChange]);

  // Open at «now» (today) or at the first block — not at the top of the board.
  useEffect(() => {
    const box = scrollBox();
    const board = boardRef.current;
    if (!box || !board) return;
    const minute = focusMinute({ isToday: day === today, now: nowMin, spans, workStart: workFrom });
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const top = board.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
    box.scrollTop = Math.max(0, top + ((Math.max(minute, bounds.from) - bounds.from) / 60) * HOUR * rem - 48);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day]);

  function scrollBox(): HTMLElement | null {
    let node = rootRef.current?.parentElement ?? null;
    while (node) {
      const overflow = getComputedStyle(node).overflowY;
      if (overflow === "auto" || overflow === "scroll") return node;
      node = node.parentElement;
    }
    return null;
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
    const node = scrollBox();
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

  const offBefore = hoursOk ? Math.max(0, Math.min(workFrom, bounds.to) - bounds.from) : 0;
  const offAfter = hoursOk ? Math.max(0, bounds.to - Math.max(workTo, bounds.from)) : 0;

  return (
    <div ref={rootRef} className="mx-auto flex w-full max-w-3xl flex-col">
      <div className="sticky -top-2 z-20 -mx-4 -mt-2 bg-surface px-3 pt-2 pb-1 md:static md:mx-0 md:px-0">
      {rangeControl}
      <div className="flex items-center gap-0.5">
        <button type="button" aria-label="Предыдущий день" onClick={() => setDay(shiftIso(day, -1))} className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted">
          <ChevronLeft className="size-5" />
        </button>
        <div className="min-w-0 flex-1 text-center leading-tight">
          <p className="truncate text-[0.9375rem] font-semibold">{day === today ? `Сегодня, ${formatShortDay(day)}` : formatShortDay(day, true)}</p>
          <p className={cn("text-[0.6875rem]", clashes.length > 0 ? "text-danger" : "text-subtle")}>
            {clashes.length > 0 ? `Накладка: ${clashes.length}` : day !== today ? (
              <button type="button" className="text-accent" onClick={() => setDay(today)}>
                к сегодня
              </button>
            ) : (
              "накладок нет"
            )}
          </p>
        </div>
        <button type="button" aria-label="Следующий день" onClick={() => setDay(shiftIso(day, 1))} className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted">
          <ChevronRight className="size-5" />
        </button>
        <span className="flex size-9 shrink-0 items-center justify-center">
          <HintButton open={hint} onToggle={() => setHint(!hint)} label="Как пользоваться расписанием" />
        </span>
      </div>
      </div>
      {hint ? (
        <p className="mb-2 px-1 text-xs text-muted">
          Нажмите на пустое место доски — новая задача на это время. Потяните блок, чтобы сдвинуть время; нижний край меняет длину. Задачи без
          времени лежат в «Без времени» — потяните за ⋮⋮ на доску или на свободное окно. Рабочие часы меняются в «Настройки» → «Дата и время».
        </p>
      ) : null}
      {!hoursOk ? <p className="mb-2 px-1 text-xs text-danger">Конец рабочего дня раньше начала — поправьте в «Настройках».</p> : null}

      {gaps.length > 0 ? (
        <div className="no-scrollbar -mx-4 flex items-center gap-1.5 overflow-x-auto px-4 py-1">
          <span className="shrink-0 text-[0.6875rem] text-subtle">Свободно</span>
          {gaps.map((gap) => (
            <button
              key={`${gap.start}-${gap.end}`}
              type="button"
              data-gap={`${gap.start}:${gap.end}`}
              aria-label={`Свободно ${fromMinutes(gap.start)}–${fromMinutes(gap.end)}: добавить задачу`}
              onClick={() => setSlot({ start: gap.start, end: Math.min(gap.end, gap.start + 60) })}
              className="h-7 shrink-0 rounded-full bg-elevated px-2.5 text-xs tabular-nums text-muted"
            >
              {fromMinutes(gap.start)}–{fromMinutes(gap.end)}
            </button>
          ))}
        </div>
      ) : null}

      {untimed.length > 0 ? (
        <section className="mt-1 overflow-hidden rounded-xl bg-elevated" aria-label="Без времени">
          <button type="button" aria-expanded={trayOpen} onClick={() => setTrayOpen(!trayOpen)} className="flex h-9 w-full items-center gap-1.5 px-3 text-left text-xs font-medium text-muted">
            <ChevronDown className={cn("size-3.5 transition-transform", !trayOpen && "-rotate-90")} aria-hidden="true" />
            Без времени · {untimed.length}
            <span className="ml-auto font-normal text-subtle">{trayOpen ? "потяните на доску" : ""}</span>
          </button>
          {trayOpen ? (
            <ul className="divide-y divide-line border-t border-line">
              {untimed.map((task) => (
                <li key={task.id} className={cn("flex h-10 items-center", holding === task.id && "opacity-40")} style={colorStyle(task.color, 8)}>
                  <button
                    type="button"
                    aria-label={`Поставить ${task.title} на доску`}
                    className="drag-handle flex h-10 w-9 shrink-0 items-center justify-center text-subtle"
                    onPointerDown={(event) => beginCard(event, task)}
                  >
                    <GripVertical className="size-4" />
                  </button>
                  <button type="button" onClick={() => onOpen(task.id)} className="h-10 min-w-0 flex-1 truncate pr-3 text-left text-sm text-fg">
                    {task.title}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      <div
        ref={boardRef}
        data-board=""
        className="relative mt-3 mb-2"
        style={{ height: `${hours * HOUR}rem` }}
        onClick={(event) => {
          if (event.target !== event.currentTarget && !(event.target as HTMLElement).dataset.slot) return;
          const rect = event.currentTarget.getBoundingClientRect();
          if (event.clientX < rect.left + 48) return;
          setSlot(slotAt((event.clientY - rect.top) / rect.height, bounds.from, bounds.to));
        }}
      >
        {offBefore > 0 ? (
          <div data-slot="1" className="off-band absolute right-0 left-12 top-0" style={{ height: `${(offBefore / 60) * HOUR}rem` }} />
        ) : null}
        {offAfter > 0 ? (
          <div data-slot="1" className="off-band absolute right-0 bottom-0 left-12" style={{ height: `${(offAfter / 60) * HOUR}rem` }} />
        ) : null}
        {Array.from({ length: hours + 1 }, (_, index) => {
          const minute = bounds.from + index * 60;
          if (minute > bounds.to) return null;
          return (
            <div key={minute} className="pointer-events-none absolute right-0 left-12 border-t border-line/70" style={{ top: `${index * HOUR}rem` }}>
              <span className="absolute -top-2 left-0 w-12 -translate-x-full pr-2 text-right text-[0.6875rem] tabular-nums text-subtle">
                {fromMinutes(minute)}
              </span>
            </div>
          );
        })}
        {showNow ? (
          <div className="pointer-events-none absolute right-0 left-12 z-20 h-px bg-danger" style={{ top: `${((nowMin - bounds.from) / 60) * HOUR}rem` }}>
            <span className="absolute -top-[3px] -left-[3px] size-[7px] rounded-full bg-danger" />
          </div>
        ) : null}
        {placed.map((span) => (
          <div
            key={span.id}
            role="button"
            tabIndex={0}
            aria-label={`${span.title}, ${fromMinutes(span.start)}–${fromMinutes(Math.min(span.end, 24 * 60 - 1))}`}
            onPointerDown={(event) => beginDrag(event, span, "move")}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") onOpen(span.id);
            }}
            style={{ ...blockStyle(span, bounds.from), ...colorStyle(span.color, 16) }}
            className={cn(
              "drag-handle absolute z-10 overflow-hidden rounded-md border-l-2 bg-elevated px-1.5 py-0.5 text-left shadow-sm",
              span.clash ? "border-danger" : "border-accent",
              span.done && "opacity-50",
            )}
          >
            <span className={cn("block truncate text-[0.8125rem] leading-tight font-medium", span.done && "line-through")}>{span.title}</span>
            <span className={cn("block text-[0.6875rem] leading-tight tabular-nums", span.clash ? "text-danger" : "text-muted")}>
              {fromMinutes(span.start)}–{fromMinutes(Math.min(span.end, 24 * 60 - 1))}
              {span.clash ? " · накладка" : ""}
              {span.assumed ? " · час" : ""}
            </span>
            <div
              aria-hidden="true"
              onPointerDown={(event) => beginDrag(event, span, "resize")}
              className="absolute inset-x-0 bottom-0 flex h-3 cursor-ns-resize items-end justify-center pb-0.5"
            >
              <span className="h-0.5 w-6 rounded-full bg-subtle/50" />
            </div>
          </div>
        ))}
      </div>

      {running.length > 0 ? (
        <div className="mt-2">
          <p className="px-1 text-xs font-medium text-subtle">Проекты в этот день</p>
          <div className="mt-1 divide-y divide-line overflow-hidden rounded-xl bg-elevated">
            {running.map((project) => (
              <button key={project.id} type="button" onClick={() => onOpenProjects(project.id)} className="flex h-10 w-full items-center px-3 text-left text-sm text-fg">
                {project.title}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <SlotSheet slot={slot} day={day} onClose={() => setSlot(null)} />
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

/** «Новая задача на 14:00–15:00»: opened by a tap on an empty slot or a free window. */
function SlotSheet({ slot, day, onClose }: { slot: { start: number; end: number } | null; day: string; onClose: () => void }) {
  const addTask = usePlanner((s) => s.addTask);
  const [title, setTitle] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [seen, setSeen] = useState<typeof slot>(null);
  if (slot !== seen) {
    setSeen(slot);
    if (slot) {
      setFrom(fromMinutes(slot.start));
      setTo(fromMinutes(Math.min(slot.end, 24 * 60 - 1)));
      setTitle("");
    }
  }
  const ok = title.trim().length > 0 && (toMinutes(to) ?? 0) > (toMinutes(from) ?? 0);
  const save = () => {
    if (!ok) return;
    addTask({ title, listId: null, due: day, startAt: from, endAt: to, remindAt: from });
    onClose();
  };
  return (
    <Sheet open={slot !== null} title="Новая задача" onClose={onClose} action={{ label: "Добавить", onClick: save, disabled: !ok }}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Например: созвон с командой"
          aria-label="Задача на это время"
          enterKeyHint="done"
          className="h-11 w-full rounded-xl bg-elevated px-3 text-base outline-none placeholder:text-subtle"
        />
        <div className="mt-3 divide-y divide-line overflow-hidden rounded-xl bg-elevated text-[0.9375rem]">
          <label className="flex min-h-11 items-center gap-3 px-3">
            <span className="flex-1">Начало</span>
            <input type="time" aria-label="Начало" value={from} onChange={(event) => setFrom(event.target.value)} className="h-9 w-24 rounded-lg bg-surface px-2 text-right tabular-nums outline-none" />
          </label>
          <label className="flex min-h-11 items-center gap-3 px-3">
            <span className="flex-1">Конец</span>
            <input type="time" aria-label="Конец" value={to} onChange={(event) => setTo(event.target.value)} className="h-9 w-24 rounded-lg bg-surface px-2 text-right tabular-nums outline-none" />
          </label>
        </div>
        {(toMinutes(to) ?? 0) <= (toMinutes(from) ?? 0) ? <p className="mt-2 text-xs text-danger">Конец раньше начала.</p> : null}
        <p className="mt-2 px-1 text-xs text-muted">Задача встанет на доску и напомнит в начале.</p>
      </form>
    </Sheet>
  );
}
