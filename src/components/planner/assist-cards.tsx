/**
 * «Помощник»: answers the app draws itself — task rows with quick actions,
 * free time by day, a day plan as a timeline, «было → стало» for changes and
 * one-tap follow-ups. All of it is built from the planner data on the device;
 * no model and no tokens.
 */
import { useState } from "react";
import { ArrowRight, CalendarArrowUp, Check, ChevronRight, Sparkles, Undo2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { dueLabel, shiftIso, todayIso } from "@/lib/dates";
import { usePlanner } from "@/lib/planner-store";
import { diffLines, dotColor } from "@/lib/assistant/view";
import type { Task } from "@/lib/planner-types";
import type { AnswerView, Chip, ProposalItem } from "@/lib/assistant/types";

function Dot({ color, className }: { color: string; className?: string }) {
  return <span aria-hidden="true" className={cn("size-2.5 shrink-0 rounded-full", className)} style={{ background: color }} />;
}

function when(due: string | null | undefined, start?: string | null, end?: string | null): string {
  const today = todayIso();
  const parts = [due ? dueLabel(due, today) : "без даты", start ? (end ? `${start}–${end}` : start) : ""].filter(Boolean);
  return parts.join(" ");
}

/* ---- task rows: tap opens the task, «На завтра» and «Готово» work at once -- */

function TaskRow({ task, mode, onOpen }: { task: Task; mode: "overdue" | "day"; onOpen: (id: string) => void }) {
  const updateTask = usePlanner((s) => s.updateTask);
  const toggleTask = usePlanner((s) => s.toggleTask);
  const lists = usePlanner((s) => s.lists);
  const [movedFrom, setMovedFrom] = useState<{ due: string | null } | null>(null);
  const [ticked, setTicked] = useState(false);
  const today = todayIso();
  const tomorrow = shiftIso(today, 1);
  const list = task.listId ? lists.find((l) => l.id === task.listId)?.name : null;
  const time = task.startAt ? (task.endAt ? `${task.startAt}–${task.endAt}` : task.startAt) : null;
  const overdue = !task.done && task.due !== null && task.due < today;
  // A day's rows show the time on the left; overdue rows show how late they are.
  const meta = (mode === "overdue" ? [task.due ? dueLabel(task.due, today) : null, time, list] : [list]).filter(Boolean);
  const finished = task.done || ticked;
  return (
    <li className="flex items-center gap-2.5 py-1.5 pr-1 pl-3" data-task-row={task.id}>
      {mode === "day" ? (
        <span className={cn("w-11 shrink-0 text-[0.8125rem] tabular-nums", time ? "font-medium" : "text-subtle")}>{task.startAt ?? "—"}</span>
      ) : null}
      <Dot color={dotColor(task)} />
      <button type="button" onClick={() => onOpen(task.id)} className="min-w-0 flex-1 py-1 text-left">
        <span className={cn("block truncate text-[0.9375rem]", finished && "text-muted line-through")}>{task.title}</span>
        {meta.length || movedFrom ? (
          <span className={cn("block truncate text-xs", overdue ? "text-danger" : "text-muted")}>
            {movedFrom ? `перенесено на ${dueLabel(task.due ?? tomorrow, today)}` : meta.join(" · ")}
          </span>
        ) : null}
      </button>
      {finished ? (
        task.done ? (
          <button type="button" aria-label={`Вернуть «${task.title}»`} onClick={() => toggleTask(task.id)} className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted">
            <Undo2 className="size-4" />
          </button>
        ) : (
          <Check className="mr-2.5 size-4 shrink-0 text-ok" aria-label="Готово" />
        )
      ) : (
        <>
          {movedFrom ? (
            <button
              type="button"
              aria-label={`Вернуть срок «${task.title}»`}
              onClick={() => {
                updateTask(task.id, { due: movedFrom.due });
                setMovedFrom(null);
              }}
              className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted"
            >
              <Undo2 className="size-4" />
            </button>
          ) : task.due !== tomorrow ? (
            <button
              type="button"
              aria-label={`Перенести «${task.title}» на завтра`}
              title="На завтра"
              onClick={() => {
                setMovedFrom({ due: task.due });
                updateTask(task.id, { due: tomorrow });
              }}
              className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted active:bg-surface"
            >
              <CalendarArrowUp className="size-[1.125rem]" />
            </button>
          ) : null}
          <button
            type="button"
            aria-label={`Готово: «${task.title}»`}
            title="Готово"
            onClick={() => {
              const repeating = Boolean(task.repeat);
              toggleTask(task.id);
              if (repeating) setTicked(true);
            }}
            className="flex size-9 shrink-0 items-center justify-center rounded-full border border-line text-muted active:bg-ok/15 active:text-ok"
          >
            <Check className="size-4" />
          </button>
        </>
      )}
    </li>
  );
}

export function AnswerViewCard({ view, onOpen }: { view: AnswerView; onOpen: (id: string) => void }) {
  const tasks = usePlanner((s) => s.tasks);
  if (view.kind === "free") {
    return (
      <div className="mt-1" data-answer-view="free">
        <p className="text-[0.9375rem]">{view.title}</p>
        <ul className="mt-1.5 overflow-hidden rounded-2xl bg-elevated">
          {view.days.map((d) => (
            <li key={d.date} className="flex items-start gap-3 border-b border-line/60 px-3 py-2 last:border-0">
              <span className="w-24 shrink-0 pt-0.5 text-[0.8125rem] font-medium">{d.label}</span>
              <span className="flex min-w-0 flex-1 flex-wrap gap-1.5">
                {d.slots.length ? (
                  d.slots.map((s) => (
                    <span key={s} className="rounded-full bg-ok/12 px-2 py-0.5 text-[0.8125rem] text-ok tabular-nums">
                      {s}
                    </span>
                  ))
                ) : (
                  <span className="text-[0.8125rem] text-muted">занято</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const rows = view.ids.map((id) => byId.get(id)).filter((t): t is Task => Boolean(t));
  return (
    <div className="mt-1" data-answer-view={view.mode}>
      <p className="text-[0.9375rem]">{view.title}</p>
      <ul className="mt-1.5 divide-y divide-line/60 overflow-hidden rounded-2xl bg-elevated">
        {rows.map((t) => (
          <TaskRow key={t.id} task={t} mode={view.mode} onOpen={onOpen} />
        ))}
        {view.more ? <li className="px-3 py-2 text-xs text-muted">…и ещё {view.more}</li> : null}
      </ul>
      {view.note ? <p className="mt-1.5 text-[0.8125rem] text-muted">{view.note}</p> : null}
    </div>
  );
}

/* ---- «было → стало» ------------------------------------------------------ */

type Update = Extract<ProposalItem, { op: "update" }>;

export function DiffRows({ item, done }: { item: Update; done: boolean }) {
  const current = usePlanner((s) => s.tasks.find((t) => t.id === item.taskId));
  const lists = usePlanner((s) => s.lists);
  const listName = current?.listId ? (lists.find((l) => l.id === current.listId)?.name ?? null) : null;
  // After «Применить» the task already has the new values: keep the stored «было».
  const lines = diffLines(item, done ? undefined : current, done ? null : listName);
  if (!lines.length) return null;
  return (
    <span className="mt-0.5 block space-y-0.5">
      {lines.map((l) => (
        <span key={l.label} className="flex items-center gap-1.5 text-xs">
          <span className="shrink-0 text-subtle">{l.label}</span>
          <span className="truncate text-muted line-through decoration-muted/60">{l.was}</span>
          <ArrowRight className="size-3 shrink-0 text-subtle" aria-label="стало" />
          <span className="truncate font-medium text-fg">{l.now}</span>
        </span>
      ))}
    </span>
  );
}

/* ---- day plan as a timeline ------------------------------------------------ */

export function PlanTimeline({ items, pending, onRemove }: { items: Update[]; pending: boolean; onRemove: (key: string) => void }) {
  const tasks = usePlanner((s) => s.tasks);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const sorted = [...items].sort((a, b) => (a.start ?? "").localeCompare(b.start ?? ""));
  const day = sorted[0]?.due;
  return (
    <div className="px-3 pt-1 pb-1" data-plan-timeline="">
      {day ? <p className="pb-1 text-xs text-muted">{when(day)}</p> : null}
      <ol className="relative">
        {sorted.map((item, index) => {
          const task = byId.get(item.taskId);
          const before = item.was && "start" in item.was ? item.was.start : null;
          return (
            <li key={item.key} className="relative flex items-stretch gap-3">
              <span className="w-11 shrink-0 py-1.5 text-right tabular-nums">
                <span className="block text-[0.8125rem] font-semibold">{item.start}</span>
                {item.end ? <span className="block text-[0.6875rem] text-muted">{item.end}</span> : null}
              </span>
              <span className="relative flex w-3 shrink-0 justify-center">
                <span aria-hidden="true" className={cn("absolute w-px bg-line", index === 0 ? "top-1/2" : "top-0", index === sorted.length - 1 ? "bottom-1/2" : "bottom-0")} />
                <Dot color={dotColor(task)} className="relative mt-[0.6rem] ring-2 ring-elevated" />
              </span>
              <span className="min-w-0 flex-1 py-1.5">
                <span className="line-clamp-2 block text-[0.9375rem] leading-snug">{item.taskTitle}</span>
                {before && before !== item.start ? <span className="block text-xs text-muted">было {before}</span> : null}
              </span>
              {pending ? (
                <button type="button" aria-label={`Убрать «${item.taskTitle}»`} onClick={() => onRemove(item.key)} className="flex size-9 shrink-0 items-center justify-center self-center text-subtle">
                  <span aria-hidden="true" className="text-lg leading-none">×</span>
                </button>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/* ---- one-tap follow-ups -------------------------------------------------- */

export function ChipRow({ chips, disabled, onChip }: { chips: Chip[]; disabled: boolean; onChip: (chip: Chip) => void }) {
  return (
    <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Быстрые действия">
      {chips.map((chip) => (
        <button
          key={chip.label}
          type="button"
          disabled={disabled}
          onClick={() => onChip(chip)}
          className={cn(
            "flex h-8 shrink-0 items-center gap-1 rounded-full border px-3 text-[0.8125rem] whitespace-nowrap disabled:opacity-40",
            chip.proposal ? "border-accent/30 bg-accent/10 text-accent" : "border-line bg-surface text-fg",
          )}
        >
          {chip.proposal ? <Sparkles className="size-3.5" aria-hidden="true" /> : null}
          {chip.label}
          {chip.ask ? <ChevronRight className="-mr-1 size-3.5 text-subtle" aria-hidden="true" /> : null}
        </button>
      ))}
    </div>
  );
}
