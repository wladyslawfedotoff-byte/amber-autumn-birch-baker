import { CAPS, CheckCircle, ListRow } from "@/components/ui/kit";
import { maintAsset, shortMaintTitle } from "@/lib/maintenance/short-title";
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  isSameMonth,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { Check, ChevronLeft, ChevronRight, GripVertical, LayoutGrid } from "lucide-react";
import { AddTaskForm } from "@/components/planner/task-row";
import { HintButton } from "@/components/ui/hint";
import { SwitchRow } from "@/components/ui/rows";
import { cn } from "@/lib/cn";
import { cleanDates, daysBetween, formatLong, formatMonth, occursOn, shiftIso, todayIso } from "@/lib/dates";
import { dotsFor, isoWeek, layoutDay, rangeStart, timeKey, timeRange } from "@/lib/calendar-layout";
import { CALENDAR_MODES, modeDays } from "@/lib/ui-prefs";
import type { Asset, Milestone, Project, Task } from "@/lib/planner-types";
import { usePlanner } from "@/lib/planner-store";
import { useDismiss, usePopover } from "@/lib/popover";
import { stageRange } from "@/lib/stage-range";
import { colorHex } from "@/lib/task-colors";
import { ageLabel, iconOf, occursOnDay } from "@/lib/special-dates";

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

const LETTERS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const HOUR = 44;

function dateOf(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

function letterOf(iso: string): string {
  return LETTERS[(dateOf(iso).getDay() + 6) % 7] ?? "";
}

function byTime(a: Task, b: Task): number {
  return Number(a.done) - Number(b.done) || timeKey(a).localeCompare(timeKey(b)) || a.title.localeCompare(b.title, "ru");
}

/** Stable fallbacks: a fresh `[]` on every render would re-run the memos below. */
const NO_MILESTONES: Milestone[] = [];
const NO_PROJECTS: Project[] = [];
const NO_ASSETS: Asset[] = [];

export function CalendarView({
  selectedId,
  onOpen,
  onDayChange,
}: {
  selectedId: string | null;
  onOpen: (id: string) => void;
  /** The «+» button adds to the chosen day. */
  onDayChange?: (day: string) => void;
}) {
  const tasks = usePlanner((s) => s.tasks);
  const milestones = usePlanner((s) => s.milestones) ?? NO_MILESTONES;
  const projects = usePlanner((s) => s.projects) ?? NO_PROJECTS;
  const addTask = usePlanner((s) => s.addTask);
  const updateTask = usePlanner((s) => s.updateTask);
  const toggleTask = usePlanner((s) => s.toggleTask);
  const placeStage = usePlanner((s) => s.placeStage);
  const setRepeatDates = usePlanner((s) => s.setRepeatDates);
  const mode = usePlanner((s) => s.calendarMode) ?? "month";
  const setMode = usePlanner((s) => s.setCalendarMode);
  const weekNumbers = usePlanner((s) => s.weekNumbers) ?? false;
  const setWeekNumbers = usePlanner((s) => s.setWeekNumbers);
  const today = todayIso();
  const [cursor, setCursor] = useState(() => new Date());
  const [day, setDayState] = useState(today);
  const [menu, setMenu] = usePopover("calendar-mode");
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useDismiss(menu, () => setMenu(false), [menuButtonRef, menuRef]);
  const [hint, setHint] = useState(false);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    onDayChange?.(day);
  }, [day, onDayChange]);

  function setDay(iso: string) {
    setDayState(iso);
    const date = dateOf(iso);
    if (!isSameMonth(date, cursor)) setCursor(date);
  }

  function step(dir: -1 | 1) {
    if (mode === "month") {
      setCursor((value) => addMonths(value, dir));
      return;
    }
    setDay(shiftIso(day, dir * (modeDays(mode) || 1)));
  }

  function nudgeScroll(y: number) {
    const node = scrollBox();
    if (!node) return;
    const rect = node.getBoundingClientRect();
    if (y < rect.top + 64) node.scrollTop -= 20;
    else if (y > rect.bottom - 72) node.scrollTop += 20;
  }

  function scrollBox(): HTMLElement | null {
    let node = rootRef.current?.parentElement ?? null;
    while (node) {
      const overflow = getComputedStyle(node).overflowY;
      if (overflow === "auto" || overflow === "scroll") return node;
      node = node.parentElement;
    }
    return null;
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

  // «Выбранные даты»: the task shows on every pending chosen date, not only on the next one.
  const tasksOn = (iso: string) => tasks.filter((task) => (task.done ? task.due === iso : occursOn(task, iso))).sort(byTime);
  const specialOn = (iso: string) => milestones.filter((item) => occursOnDay(item, iso));

  function track(event: ReactPointerEvent<HTMLElement>, initial: Drag) {
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startY = event.clientY;
    const fromDay = day;
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
        const moved = tasks.find((task) => task.id === current.id);
        if (moved?.repeat === "dates") {
          // Move just this occurrence: swap the date in the chosen set.
          setRepeatDates(current.id, [...cleanDates(moved.repeatDates).filter((date) => date !== fromDay), current.over]);
        } else {
          updateTask(current.id, { due: current.over });
        }
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

  function dragTask(event: ReactPointerEvent<HTMLElement>, task: Task) {
    if (event.button !== 0) return;
    track(event, { kind: "task", id: task.id, title: task.title, x: event.clientX, y: event.clientY, over: null, active: false });
  }

  const title = mode === "month" ? formatMonth(cursor) : formatMonth(dateOf(day));
  const unit = mode === "month" ? "месяц" : mode === "week" ? "неделя" : mode === "three" ? "3 дня" : mode === "day" ? "день" : "2 недели";
  const showToday = mode === "month" ? !isSameMonth(cursor, new Date()) || day !== today : day !== today;

  return (
    <div ref={rootRef} className="-mx-1 md:mx-0">
      <div className={cn("relative z-20 mb-1 flex items-center gap-1", mode !== "month" && mode !== "list" && "sticky -top-2 -mt-2 bg-surface pt-2")}>
        <h2 className="min-w-0 flex-1 truncate px-1 text-lg font-semibold tracking-tight">{title}</h2>
        {showToday ? (
          <button
            type="button"
            onClick={() => {
              setCursor(new Date());
              setDay(today);
            }}
            className="h-11 shrink-0 rounded-full px-3 text-sm text-accent-ink"
          >
            Сегодня
          </button>
        ) : null}
        <button type="button" aria-label={`Назад: ${unit}`} onClick={() => step(-1)} className="flex size-11 shrink-0 items-center justify-center rounded-full text-muted">
          <ChevronLeft className="size-5" />
        </button>
        <button type="button" aria-label={`Вперёд: ${unit}`} onClick={() => step(1)} className="flex size-11 shrink-0 items-center justify-center rounded-full text-muted">
          <ChevronRight className="size-5" />
        </button>
        <button
          type="button"
          ref={menuButtonRef}
          aria-label="Вид календаря"
          aria-expanded={menu}
          onClick={() => setMenu(!menu)}
          className={cn("flex size-11 shrink-0 items-center justify-center rounded-full", menu ? "bg-elevated text-fg" : "text-muted")}
        >
          <LayoutGrid className="size-[1.125rem]" />
        </button>
        <span className="flex size-11 shrink-0 items-center justify-center">
          <HintButton open={hint} onToggle={() => setHint(!hint)} label="Как пользоваться календарём" className="my-0 size-11" />
        </span>
        {menu ? (
          <>
            <button type="button" aria-label="Закрыть меню вида" tabIndex={-1} className="fixed inset-0 z-10 cursor-default" onClick={() => setMenu(false)} />
            <div ref={menuRef} className="card-lift absolute top-full right-0 z-20 mt-1 w-56 overflow-hidden rounded-card bg-card shadow-lg" role="menu" aria-label="Вид календаря">
              {CALENDAR_MODES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={mode === item.id}
                  onClick={() => {
                    setMode(item.id);
                    setMenu(false);
                  }}
                  className="flex h-11 w-full items-center gap-3 px-3 text-left text-body"
                >
                  <span className="min-w-0 flex-1">{item.label}</span>
                  {mode === item.id ? <Check className="size-4 text-accent-ink" /> : null}
                </button>
              ))}
              <div className="border-t border-line">
                <SwitchRow label="Номера недель" checked={weekNumbers} onChange={setWeekNumbers} />
              </div>
            </div>
          </>
        ) : null}
      </div>
      {hint ? (
        <p className="mb-2 px-1 text-xs text-muted">
          Нажмите на день — его задачи появятся ниже. Перетащите задачу за ⋮⋮ (или этап проекта) на другой день. Кнопка «+» внизу добавляет задачу
          на выбранный день, например «Встреча в 15». Вид (месяц, неделя, 3 дня, день, список) — в меню справа.
        </p>
      ) : null}

      {mode === "month" ? (
        <MonthGrid
          weeks={weeks}
          cursor={cursor}
          day={day}
          today={today}
          weekNumbers={weekNumbers}
          bars={bars}
          drag={drag}
          tasks={tasks}
          milestones={milestones}
          onPick={setDay}
          onStageDown={(event, bar) => {
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
        />
      ) : null}

      {mode === "week" || mode === "three" || mode === "day" ? (
        <TimeGrid
          days={Array.from({ length: modeDays(mode) }, (_, index) => shiftIso(rangeStart(mode, day), index))}
          day={day}
          today={today}
          drag={drag}
          weekNumbers={weekNumbers}
          tasksOn={tasksOn}
          specialOn={specialOn}
          onPick={setDay}
          onOpen={onOpen}
          scrollBox={scrollBox}
        />
      ) : null}

      {mode === "list" ? (
        <ListAgenda
          start={day}
          today={today}
          tasksOn={tasksOn}
          specialOn={specialOn}
          selectedId={selectedId}
          onOpen={onOpen}
          onToggle={toggleTask}
          onDrag={dragTask}
          drag={drag}
        />
      ) : (
        <section className="mt-3" aria-label={formatLong(day)}>
          <div className="mb-2 flex items-baseline gap-2 px-1">
            <h3 className="text-sm font-semibold">{day === today ? `Сегодня, ${formatLong(day).split(", ")[1] ?? ""}` : formatLong(day)}</h3>
            <span className="text-xs text-subtle">{countText(tasksOn(day).filter((task) => !task.done).length)}</span>
          </div>
          <AddTaskForm
            className="mb-2 hidden md:block"
            placeholder="Встреча в 15"
            onAdd={(text, quick) => addTask({ title: text, ...quick, due: day, listId: null })}
          />
          <DayRows
            iso={day}
            today={today}
            tasks={tasksOn(day)}
            special={specialOn(day)}
            selectedId={selectedId}
            onOpen={onOpen}
            onToggle={toggleTask}
            onDrag={dragTask}
            empty="Свободный день. Нажмите «+», чтобы добавить задачу, или перетащите сюда задачу с другого дня."
          />
        </section>
      )}

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

function countText(n: number): string {
  if (n === 0) return "";
  const mod10 = n % 10;
  const mod100 = n % 100;
  const word = mod10 === 1 && mod100 !== 11 ? "задача" : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? "задачи" : "задач";
  return `${n} ${word}`;
}

type Bar = { projectId: string; project: string; stageId: string; title: string; start: string; end: string };

function MonthGrid({
  weeks,
  cursor,
  day,
  today,
  weekNumbers,
  bars,
  drag,
  tasks,
  milestones,
  onPick,
  onStageDown,
}: {
  weeks: Date[][];
  cursor: Date;
  day: string;
  today: string;
  weekNumbers: boolean;
  bars: Bar[];
  drag: Drag | null;
  tasks: Task[];
  milestones: Milestone[];
  onPick: (iso: string) => void;
  onStageDown: (event: ReactPointerEvent<HTMLElement>, bar: Bar) => void;
}) {
  const columns = weekNumbers ? "1.5rem repeat(7, minmax(0, 1fr))" : "repeat(7, minmax(0, 1fr))";
  return (
    <div>
      <div className="grid text-center text-[0.6875rem] text-subtle" style={{ gridTemplateColumns: columns }}>
        {weekNumbers ? <div aria-hidden="true" /> : null}
        {LETTERS.map((letter, index) => (
          <div key={letter} className={cn("py-1", index >= 5 && "text-muted")}>
            {letter}
          </div>
        ))}
      </div>
      <div className="flex flex-col">
        {weeks.map((week) => {
          const weekStart = todayIso(week[0] ?? new Date());
          const weekEnd = todayIso(week[6] ?? new Date());
          const rowBars = bars
            .map((bar) => {
              if (bar.end < weekStart || bar.start > weekEnd) return null;
              const start = bar.start < weekStart ? weekStart : bar.start;
              const end = bar.end > weekEnd ? weekEnd : bar.end;
              return { ...bar, col: daysBetween(weekStart, start), span: daysBetween(start, end) + 1 };
            })
            .filter((bar): bar is NonNullable<typeof bar> => bar != null);
          const offset = weekNumbers ? 2 : 1;
          return (
            <div key={weekStart}>
              <div className="grid" style={{ gridTemplateColumns: columns }}>
                {weekNumbers ? (
                  <div className="flex h-11 items-start justify-center pt-2 text-[0.625rem] tabular-nums text-subtle" title={`Неделя ${isoWeek(weekStart)}`}>
                    {isoWeek(weekStart)}
                  </div>
                ) : null}
                {week.map((date) => {
                  const iso = todayIso(date);
                  const inMonth = isSameMonth(date, cursor);
                  const open = tasks.filter((task) => !task.done && occursOn(task, iso));
                  const special = milestones.filter((item) => occursOnDay(item, iso));
                  const dots = dotsFor(open.map((task) => colorHex(task.color)), special.length > 0 ? 2 : 3);
                  const selected = iso === day;
                  const isToday = iso === today;
                  const over = drag?.active && drag.over === iso;
                  const label = [
                    formatLong(iso),
                    open.length > 0 ? countText(open.length) : "",
                    special.map((item) => item.title).join(", "),
                  ]
                    .filter(Boolean)
                    .join(" · ");
                  return (
                    <button
                      key={iso}
                      type="button"
                      data-day={iso}
                      aria-label={label}
                      aria-pressed={selected}
                      onClick={() => onPick(iso)}
                      className={cn("flex h-11 flex-col items-center pt-1", over && "rounded-lg bg-accent/20")}
                    >
                      <span
                        className={cn(
                          "flex size-7 items-center justify-center rounded-full text-body tabular-nums",
                          selected ? "bg-accent font-semibold text-accent-fg" : isToday ? "font-semibold text-accent-ink" : inMonth ? "text-fg" : "text-subtle",
                        )}
                      >
                        {date.getDate()}
                      </span>
                      <span className="mt-1 flex h-1.5 items-center gap-[3px]" aria-hidden="true">
                        {dots.map((hex, index) => (
                          <span key={index} className={cn("size-[5px] rounded-full", hex ? "" : "bg-subtle")} style={hex ? { background: hex } : undefined} />
                        ))}
                        {special.length > 0 ? <span className="size-[5px] rounded-full bg-warn" /> : null}
                      </span>
                    </button>
                  );
                })}
              </div>
              {rowBars.length > 0 ? (
                <div className="mb-1 flex flex-col gap-1">
                  {rowBars.map((bar) => (
                    <div key={`${bar.stageId}-${weekStart}`} className="grid" style={{ gridTemplateColumns: columns }}>
                      <div
                        role="button"
                        tabIndex={0}
                        aria-label={`${bar.project}, этап ${bar.title}`}
                        onPointerDown={(event) => onStageDown(event, bar)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") onPick(bar.start);
                        }}
                        className="drag-handle mx-1 flex h-5 items-center overflow-hidden rounded bg-accent/15 px-2 text-left text-[0.6875rem] text-fg"
                        style={{ gridColumn: `${bar.col + offset} / span ${bar.span}` }}
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
    </div>
  );
}

function DayRows({
  iso,
  today,
  tasks,
  special,
  selectedId,
  onOpen,
  onToggle,
  onDrag,
  empty,
}: {
  iso: string;
  today: string;
  tasks: Task[];
  special: Milestone[];
  selectedId: string | null;
  onOpen: (id: string) => void;
  onToggle: (id: string) => void;
  onDrag: (event: ReactPointerEvent<HTMLElement>, task: Task) => void;
  empty?: string;
}) {
  const assets = usePlanner((s) => s.assets) ?? NO_ASSETS;
  if (tasks.length === 0 && special.length === 0) {
    return empty ? <p className="px-1 py-4 text-sm text-secondary-label">{empty}</p> : null;
  }
  return (
    <ul className="menu-card overflow-hidden rounded-card">
      {special.map((item) => {
        const age = ageLabel(item, iso, today);
        return (
          <ListRow
            key={item.id}
            lead={
              <span className="w-5 shrink-0 text-center" aria-hidden="true">
                {iconOf(item)}
              </span>
            }
            title={item.title}
            trailing={age ? <span className="shrink-0 text-caption text-secondary-label">{age}</span> : undefined}
          />
        );
      })}
      {tasks.map((task) => {
        const hex = colorHex(task.color);
        const time = timeRange(task);
        return (
          <li key={task.id} className={cn("relative flex min-h-11 items-center", selectedId === task.id && "bg-accent/10")}>
            {hex ? <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-r" style={{ background: hex }} aria-hidden="true" /> : null}
            <button
              type="button"
              aria-label={task.done ? `Вернуть «${task.title}»` : `Выполнить «${task.title}»`}
              aria-pressed={task.done}
              onClick={() => onToggle(task.id)}
              className="flex size-11 shrink-0 items-center justify-center"
            >
              <CheckCircle checked={task.done} ring={task.priority === 3 ? "border-danger" : task.priority === 2 ? "border-warn" : task.priority === 1 ? "border-accent" : undefined} />
            </button>
            <button type="button" onClick={() => onOpen(task.id)} className="flex min-h-11 min-w-0 flex-1 items-center gap-2 pr-1 text-left">
              <span className={cn("min-w-0 flex-1 truncate text-body", task.done ? "text-tertiary-label line-through" : "text-label")}>
                {task.maint ? shortMaintTitle(task, assets) : task.title}
                {task.maint ? <span className="block truncate text-caption text-secondary-label">🔧 {maintAsset(task, assets)?.name ?? "Обслуживание"}</span> : null}
              </span>
              {time ? <span className={cn("shrink-0 text-caption tabular-nums", task.done ? "text-tertiary-label" : "text-accent-ink")}>{time}</span> : null}
            </button>
            <button
              type="button"
              aria-label={`Перенести ${task.title}`}
              className="hit drag-handle flex h-11 w-8 shrink-0 items-center justify-center text-tertiary-label"
              onPointerDown={(event) => onDrag(event, task)}
            >
              <GripVertical className="size-3.5" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function ListAgenda({
  start,
  today,
  tasksOn,
  specialOn,
  selectedId,
  onOpen,
  onToggle,
  onDrag,
  drag,
}: {
  start: string;
  today: string;
  tasksOn: (iso: string) => Task[];
  specialOn: (iso: string) => Milestone[];
  selectedId: string | null;
  onOpen: (id: string) => void;
  onToggle: (id: string) => void;
  onDrag: (event: ReactPointerEvent<HTMLElement>, task: Task) => void;
  drag: Drag | null;
}) {
  const days = Array.from({ length: modeDays("list") }, (_, index) => shiftIso(start, index));
  const filled = days.filter((iso) => tasksOn(iso).length > 0 || specialOn(iso).length > 0);
  if (filled.length === 0) return <p className="px-1 py-8 text-sm text-secondary-label">Ближайшие две недели свободны. Нажмите «+», чтобы добавить задачу.</p>;
  return (
    <div className="mt-2 flex flex-col gap-3">
      {filled.map((iso) => (
        <section key={iso} data-day={iso} className={cn("rounded-card", drag?.active && drag.over === iso && "ring-2 ring-accent")}>
          <h3 className={cn("mb-1 px-1", CAPS)}>
            {iso === today ? "Сегодня · " : iso === shiftIso(today, 1) ? "Завтра · " : ""}
            {formatLong(iso)}
          </h3>
          <DayRows iso={iso} today={today} tasks={tasksOn(iso)} special={specialOn(iso)} selectedId={selectedId} onOpen={onOpen} onToggle={onToggle} onDrag={onDrag} />
        </section>
      ))}
    </div>
  );
}

function TimeGrid({
  days,
  day,
  today,
  drag,
  weekNumbers,
  tasksOn,
  specialOn,
  onPick,
  onOpen,
  scrollBox,
}: {
  days: string[];
  day: string;
  today: string;
  drag: Drag | null;
  weekNumbers: boolean;
  tasksOn: (iso: string) => Task[];
  specialOn: (iso: string) => Milestone[];
  onPick: (iso: string) => void;
  onOpen: (id: string) => void;
  scrollBox: () => HTMLElement | null;
}) {
  const gridRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => {
      const date = new Date();
      setNow(date.getHours() * 60 + date.getMinutes());
    };
    tick();
    const id = window.setInterval(tick, 60_000);
    return () => window.clearInterval(id);
  }, []);
  // Open at 7:00 (or a bit before «now») instead of midnight.
  useEffect(() => {
    const box = scrollBox();
    const grid = gridRef.current;
    if (!box || !grid) return;
    const date = new Date();
    const hour = Math.max(0, Math.min(date.getHours() - 1, 7));
    const top = grid.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
    // Minus the sticky toolbar (2.25rem) and the sticky day header.
    box.scrollTop = top + hour * HOUR - 36 - (headRef.current?.offsetHeight ?? 0) - 12;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days.length]);

  const columns = `2.5rem repeat(${days.length}, minmax(0, 1fr))`;
  const lists = days.map((iso) => {
    const all = tasksOn(iso);
    const layout = layoutDay(all);
    return { iso, all, layout, special: specialOn(iso) };
  });
  const hasAllDay = lists.some((item) => item.layout.allDay.length > 0 || item.special.length > 0);

  return (
    <div className="mt-1">
      <div ref={headRef} className="sticky top-9 z-10 bg-surface">
      <div className="grid border-b border-separator pb-1" style={{ gridTemplateColumns: columns }}>
        <div className="flex items-end justify-center pb-1 text-[0.625rem] text-tertiary-label">{weekNumbers ? `Н${isoWeek(days[0] ?? day)}` : ""}</div>
        {days.map((iso) => {
          const selected = iso === day;
          const isToday = iso === today;
          const over = drag?.active && drag.over === iso;
          return (
            <button
              key={iso}
              type="button"
              data-day={iso}
              aria-pressed={selected}
              aria-label={formatLong(iso)}
              onClick={() => onPick(iso)}
              className={cn("flex h-12 flex-col items-center justify-center rounded-lg", over && "bg-accent/20")}
            >
              <span className={cn("text-[0.6875rem]", isToday ? "text-accent-ink" : "text-tertiary-label")}>{letterOf(iso)}</span>
              <span
                className={cn(
                  "flex size-7 items-center justify-center rounded-full text-body tabular-nums",
                  selected ? "bg-accent font-semibold text-accent-fg" : isToday ? "font-semibold text-accent-ink" : "text-label",
                )}
              >
                {dateOf(iso).getDate()}
              </span>
            </button>
          );
        })}
      </div>
      {hasAllDay ? (
        <div className="grid border-b border-separator py-1" style={{ gridTemplateColumns: columns }}>
          <div className="pt-1 text-center text-[0.625rem] leading-tight text-tertiary-label">весь день</div>
          {lists.map(({ iso, all, layout, special }) => {
            const items = [
              ...special.map((item) => ({ id: item.id, title: `${iconOf(item)} ${item.title}`, task: null as Task | null })),
              ...layout.allDay.map((id) => {
                const task = all.find((item) => item.id === id) ?? null;
                return { id, title: task?.title ?? "", task };
              }),
            ];
            const shown = items.slice(0, 3);
            return (
              <div key={iso} className="flex min-w-0 flex-col gap-1 px-px">
                {shown.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => (item.task ? onOpen(item.id) : onPick(iso))}
                    className={cn(
                      // 1.18: two lines (with hyphenation) instead of a cut-off title.
                      "line-clamp-2 rounded px-1 py-1 text-left text-[0.6875rem] leading-tight break-words hyphens-auto",
                      item.task?.done ? "bg-card text-tertiary-label line-through" : "bg-accent/15 text-label",
                    )}
                    style={item.task?.color ? { background: `color-mix(in oklab, ${colorHex(item.task.color)} 22%, transparent)` } : undefined}
                  >
                    {item.title}
                  </button>
                ))}
                {items.length > shown.length ? (
                  <button type="button" onClick={() => onPick(iso)} className="px-1 text-left text-[0.625rem] text-tertiary-label">
                    +{items.length - shown.length}
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
      </div>
      <div ref={gridRef} className="relative grid" style={{ gridTemplateColumns: columns, height: HOUR * 24 }}>
        <div className="relative">
          {Array.from({ length: 24 }, (_, hour) => (
            <span key={hour} className="absolute right-1.5 -translate-y-1/2 text-[0.625rem] tabular-nums text-tertiary-label" style={{ top: hour * HOUR }}>
              {hour === 0 ? "" : `${String(hour).padStart(2, "0")}:00`}
            </span>
          ))}
        </div>
        {lists.map(({ iso, all, layout }) => (
          <div key={iso} data-day={iso} className="relative border-l border-separator">
            {Array.from({ length: 24 }, (_, hour) => (
              <span key={hour} className="absolute inset-x-0 border-t border-separator/70" style={{ top: hour * HOUR }} aria-hidden="true" />
            ))}
            {iso === today && now != null ? (
              <span className="absolute inset-x-0 z-10 h-px bg-danger" style={{ top: (now / 60) * HOUR }} aria-hidden="true">
                <span className="absolute -top-[3px] -left-[3px] size-[7px] rounded-full bg-danger" />
              </span>
            ) : null}
            {layout.timed.map((block) => {
              const task = all.find((item) => item.id === block.id);
              if (!task) return null;
              const hex = colorHex(task.color) ?? "var(--accent)";
              const height = Math.max(18, ((block.end - block.start) / 60) * HOUR - 2);
              return (
                <button
                  key={block.id}
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpen(task.id);
                  }}
                  title={`${timeRange(task)} ${task.title}`}
                  className={cn("absolute overflow-hidden rounded-[0.3125rem] px-1 py-px text-left text-[0.6875rem] leading-tight", task.done && "line-through opacity-60")}
                  style={{
                    top: (block.start / 60) * HOUR + 1,
                    height,
                    left: `calc(${(block.lane / block.lanes) * 100}% + 1px)`,
                    width: `calc(${100 / block.lanes}% - 2px)`,
                    background: `color-mix(in oklab, ${hex} 22%, var(--surface))`,
                    borderLeft: `2px solid ${hex}`,
                  }}
                >
                  <span className={cn("block font-medium break-words hyphens-auto text-label", height > 30 ? "line-clamp-2" : "truncate")}>{task.title}</span>
                  {height > 30 ? <span className="block truncate text-[0.625rem] text-secondary-label tabular-nums">{timeRange(task)}</span> : null}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
