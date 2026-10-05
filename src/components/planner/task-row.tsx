import { Check, GripVertical, Plus } from "lucide-react";
import { useState, type PointerEvent } from "react";
import { cn } from "@/lib/cn";
import { dueLabel, repeatLabel, shiftIso, todayIso } from "@/lib/dates";
import { parseQuick } from "@/lib/quick-add";
import { usePlanner } from "@/lib/planner-store";
import type { Priority, Task } from "@/lib/planner-types";
import { listName } from "@/lib/queries";

function ring(priority: Priority): string {
  if (priority === 3) return "border-danger";
  if (priority === 2) return "border-warn";
  if (priority === 1) return "border-accent";
  return "border-line";
}

export function TaskRow({
  task,
  today,
  selected,
  showDue,
  showList,
  onOpen,
  onDragStart,
}: {
  task: Task;
  today: string;
  selected: boolean;
  showDue: boolean;
  showList: boolean;
  onOpen: (id: string) => void;
  onDragStart?: (event: PointerEvent<HTMLButtonElement>) => void;
}) {
  const lists = usePlanner((s) => s.lists);
  const toggleTask = usePlanner((s) => s.toggleTask);
  const toggleSubtask = usePlanner((s) => s.toggleSubtask);
  const updateTask = usePlanner((s) => s.updateTask);
  const subs = task.subtasks ?? [];
  const doneSubs = subs.filter((s) => s.done).length;
  const overdue = !task.done && task.due != null && task.due < today;
  const tomorrow = shiftIso(today, 1);
  const canPostpone = !task.done && !onDragStart && overdue;

  return (
    <div
      className={cn(
        "card-lift mb-2 flex items-start rounded-xl bg-elevated",
        selected ? "ring-1 ring-accent" : "",
      )}
    >
      <button
        type="button"
        aria-label={task.done ? "Вернуть в работу" : "Выполнить"}
        aria-pressed={task.done}
        onClick={() => toggleTask(task.id)}
        className="flex size-11 shrink-0 items-center justify-center"
      >
        <span
          className={cn(
            "flex size-6 items-center justify-center rounded-full border-2 transition-[background-color,border-color] duration-150",
            task.done ? "border-accent bg-accent text-accent-fg" : ring(task.priority),
          )}
        >
          {task.done ? <Check className="size-3" strokeWidth={3} /> : null}
        </span>
      </button>
      <div className="min-w-0 flex-1 py-2 pr-1">
        <div className="flex items-start">
          <button
            type="button"
            onClick={() => onOpen(task.id)}
            className="min-w-0 flex-1 pr-2 text-left"
          >
            <span
              className={cn(
                "block text-pretty text-base",
                task.done ? "text-subtle line-through decoration-subtle" : "text-fg",
              )}
            >
              {task.title}
            </span>
            <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
              {showDue && task.due ? (
                <span className={overdue ? "text-danger" : undefined}>{dueLabel(task.due, today)}</span>
              ) : null}
              {task.startAt ? (
                <span className="tabular-nums">
                  {task.startAt}
                  {task.endAt ? `–${task.endAt}` : ""}
                </span>
              ) : task.remindAt ? (
                <span className="tabular-nums">{task.remindAt}</span>
              ) : null}
              {task.repeat ? <span>{repeatLabel(task.repeat)}</span> : null}
              {showList ? <span>{listName(lists, task.listId)}</span> : null}
              {subs.length > 0 && task.done ? (
                <span className="tabular-nums">
                  {doneSubs}/{subs.length}
                </span>
              ) : null}
              {(task.tags ?? []).slice(0, 2).map((tag) => (
                <span key={tag}>#{tag}</span>
              ))}
            </span>
          </button>
          {canPostpone ? (
            <button
              type="button"
              aria-label={`Перенести «${task.title}» на завтра`}
              onClick={() => updateTask(task.id, { due: tomorrow })}
              className={cn(
                "flex h-11 shrink-0 items-center rounded-full px-3 text-xs",
                overdue ? "bg-bg text-danger" : "text-subtle",
              )}
            >
              завтра
            </button>
          ) : null}
        </div>
        {!task.done && subs.length > 0 ? (
          <ul className="mt-1">
            {subs.map((sub) => (
              <li key={sub.id}>
                <button
                  type="button"
                  aria-pressed={sub.done}
                  onClick={() => toggleSubtask(task.id, sub.id)}
                  className="flex h-10 w-full items-center gap-2 text-left text-sm"
                >
                  <span
                    className={cn(
                      "flex size-4 shrink-0 items-center justify-center rounded-full border",
                      sub.done ? "border-accent bg-accent text-accent-fg" : "border-line",
                    )}
                  >
                    {sub.done ? <Check className="size-2.5" strokeWidth={3} /> : null}
                  </span>
                  <span className={cn("min-w-0 flex-1 truncate", sub.done ? "text-subtle line-through" : "text-fg")}>
                    {sub.title}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {onDragStart ? (
        <button
          type="button"
          aria-label={`Перенести ${task.title}`}
          className="drag-handle flex size-11 shrink-0 items-center justify-center text-subtle"
          onPointerDown={onDragStart}
        >
          <GripVertical className="size-4" />
        </button>
      ) : null}
    </div>
  );
}

export function AddTaskForm({
  placeholder,
  onAdd,
}: {
  placeholder: string;
  onAdd: (title: string) => void;
}) {
  const [value, setValue] = useState("");
  const parsed = parseQuick(value);
  const hint =
    parsed.due || parsed.startAt
      ? [
          parsed.due ? dueLabel(parsed.due, todayIso()) : null,
          parsed.startAt ? (parsed.endAt ? `${parsed.startAt}–${parsed.endAt}` : parsed.startAt) : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : "";
  return (
    <div>
      <form
        className="card-lift flex items-center gap-2 rounded-2xl bg-elevated pr-1 pl-3"
        onSubmit={(event) => {
          event.preventDefault();
          const title = value.trim();
          if (!title || !parseQuick(title).title) return;
          onAdd(title);
          setValue("");
        }}
      >
        <span className="size-2 shrink-0 rounded-full border-2 border-subtle" aria-hidden="true" />
        <input
          name="title"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          aria-label={placeholder}
          placeholder={placeholder}
          autoComplete="off"
          className="h-11 min-w-0 flex-1 bg-transparent text-base text-fg outline-none placeholder:text-subtle"
          suppressHydrationWarning
        />
        <button
          type="submit"
          aria-label="Добавить"
          className={cn(
            "flex size-11 shrink-0 items-center justify-center rounded-full",
            value.trim() ? "bg-accent text-accent-fg" : "text-subtle",
          )}
        >
          <Plus className="size-5" />
        </button>
      </form>
      {hint ? <p className="mt-1 px-3 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}
