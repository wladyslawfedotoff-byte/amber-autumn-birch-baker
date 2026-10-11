import { Check, ChevronDown, ChevronRight, GripVertical, ListChecks, NotebookText, Plus } from "lucide-react";
import { useState, type PointerEvent } from "react";
import { cn } from "@/lib/cn";
import { dueLabel, repeatLabel, shiftIso, todayIso } from "@/lib/dates";
import { parseQuick } from "@/lib/quick-add";
import { usePlanner } from "@/lib/planner-store";
import type { Priority, Task } from "@/lib/planner-types";
import { listName } from "@/lib/queries";
import { ShareBadges } from "@/components/planner/sharing";
import { notesPreview, progressLabel, subtaskProgress } from "@/lib/task-tools";
import { useSubtasksOpen } from "@/lib/use-subtasks-open";
import { colorStyle } from "@/lib/task-colors";
import { useDoneToast } from "@/lib/done-toast";

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
  ticked = false,
}: {
  /** A repeating task shown in «Готово» because it was ticked today: the check undoes the tick. */
  ticked?: boolean;
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
  const undoRepeat = usePlanner((s) => s.undoRepeat);
  const showToast = useDoneToast((s) => s.show);
  const toggleSubtask = usePlanner((s) => s.toggleSubtask);
  const updateTask = usePlanner((s) => s.updateTask);
  const addSubtask = usePlanner((s) => s.addSubtask);
  const subs = task.subtasks ?? [];
  const progress = subtaskProgress(task);
  const [open, setOpen] = useSubtasksOpen(task.id, !task.done);
  const [step, setStep] = useState("");
  const preview = notesPreview(task.notes);
  const overdue = !task.done && task.due != null && task.due < today;
  const tomorrow = shiftIso(today, 1);
  const canPostpone = !task.done && !onDragStart && overdue && !ticked;
  const checked = task.done || ticked;

  function tick() {
    if (ticked) {
      undoRepeat(task.id);
      return;
    }
    const wasDone = task.done;
    toggleTask(task.id);
    if (wasDone) return;
    const after = usePlanner.getState().tasks.find((t) => t.id === task.id);
    showToast({ id: task.id, title: task.title, repeat: Boolean(after && !after.done), next: after && !after.done ? after.due : null, at: Date.now() });
  }

  return (
    <div
      className={cn(
        "card-lift mb-2 flex items-start overflow-hidden rounded-xl bg-elevated",
        selected ? "ring-1 ring-accent" : "",
        checked && "opacity-75",
      )}
      style={colorStyle(task.color, checked ? 5 : 10)}
    >
      <button
        type="button"
        aria-label={ticked ? "Отменить отметку" : task.done ? "Вернуть в работу" : "Выполнить"}
        aria-pressed={checked}
        title={ticked ? "Отменить отметку — задача вернётся на прежнюю дату" : task.done ? "Вернуть в работу" : "Выполнить"}
        onClick={tick}
        className="flex size-11 shrink-0 items-center justify-center"
      >
        <span
          className={cn(
            "flex size-6 items-center justify-center rounded-full border-2 transition-[background-color,border-color] duration-150",
            checked ? "border-accent bg-accent text-accent-fg" : ring(task.priority),
          )}
        >
          {checked ? <Check className="size-3" strokeWidth={3} /> : null}
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
                checked ? "text-subtle line-through decoration-subtle" : "text-fg",
              )}
            >
              {task.title}
            </span>
            {preview ? (
              <span className="mt-0.5 flex items-center gap-1 text-xs text-muted">
                <NotebookText className="size-3 shrink-0" aria-hidden="true" />
                <span className="min-w-0 truncate">{preview}</span>
              </span>
            ) : null}
            <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
              {ticked ? <span className="text-ok">отмечено · дальше {task.due ? dueLabel(task.due, today) : "—"}</span> : null}
              {showDue && task.due && !ticked ? (
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
              {task.repeat ? <span>{repeatLabel(task.repeat, task.repeatDates)}</span> : null}
              {showList ? <span>{listName(lists, task.listId)}</span> : null}
              {(task.tags ?? []).slice(0, 2).map((tag) => (
                <span key={tag}>#{tag}</span>
              ))}
              <ShareBadges task={task} />
            </span>
          </button>
          {progress.total > 0 ? (
            <button
              type="button"
              aria-expanded={open}
              aria-label={`Подзадачи «${task.title}»: ${progress.done} из ${progress.total}. ${open ? "Свернуть" : "Показать"}`}
              title={open ? "Свернуть подзадачи" : "Показать подзадачи"}
              onClick={() => setOpen(!open)}
              className={cn(
                "flex h-11 shrink-0 items-center gap-1 rounded-full px-2 text-xs tabular-nums",
                progress.done === progress.total ? "text-accent" : "text-muted",
              )}
            >
              <ListChecks className="size-3.5" aria-hidden="true" />
              {progressLabel(progress)}
              {open ? <ChevronDown className="size-3.5" aria-hidden="true" /> : <ChevronRight className="size-3.5" aria-hidden="true" />}
            </button>
          ) : null}
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
        {open && subs.length > 0 ? (
          <ul className="mt-1" aria-label={`Подзадачи «${task.title}»`}>
            {subs.map((sub) => (
              <li key={sub.id}>
                <button
                  type="button"
                  aria-pressed={sub.done}
                  aria-label={`${sub.done ? "Снять отметку" : "Отметить"}: ${sub.title}`}
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
            {!task.done ? (
              <li>
                <form
                  className="flex h-10 items-center gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    addSubtask(task.id, step);
                    setStep("");
                  }}
                >
                  <Plus className="size-4 shrink-0 text-subtle" aria-hidden="true" />
                  <input
                    value={step}
                    onChange={(event) => setStep(event.target.value)}
                    onBlur={() => {
                      if (!step.trim()) return;
                      addSubtask(task.id, step);
                      setStep("");
                    }}
                    placeholder="Ещё шаг"
                    aria-label={`Добавить подзадачу к «${task.title}»`}
                    enterKeyHint="done"
                    className="h-10 min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-subtle"
                  />
                </form>
              </li>
            ) : null}
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

export type QuickOptions = { noDate?: boolean; noTime?: boolean };

export function AddTaskForm({
  placeholder,
  onAdd,
}: {
  placeholder: string;
  /** `options`: the user dropped the recognised date / time — pass them on to addTask. */
  onAdd: (title: string, options: QuickOptions) => void;
}) {
  const [value, setValue] = useState("");
  const [noDate, setNoDate] = useState(false);
  const [noTime, setNoTime] = useState(false);
  const parsed = parseQuick(value);
  const timeText = parsed.startAt ? (parsed.endAt ? `${parsed.startAt}–${parsed.endAt}` : parsed.startAt) : "";
  return (
    <div>
      <form
        className="card-lift flex items-center gap-2 rounded-2xl bg-elevated pr-1 pl-3"
        onSubmit={(event) => {
          event.preventDefault();
          const title = value.trim();
          if (!title || !parseQuick(title).title) return;
          onAdd(title, { noDate, noTime: noTime || noDate });
          setValue("");
          setNoDate(false);
          setNoTime(false);
        }}
      >
        <span className="size-2 shrink-0 rounded-full border-2 border-subtle" aria-hidden="true" />
        <input
          name="title"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            if (!event.target.value) {
              setNoDate(false);
              setNoTime(false);
            }
          }}
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
      {parsed.due || parsed.startAt ? (
        <p className="mt-1 flex flex-wrap items-center gap-1 px-2 text-xs text-muted">
          <span className="text-subtle">Распознано:</span>
          {parsed.due ? (
            <QuickChip label={dueLabel(parsed.due, todayIso())} off={noDate} onToggle={() => setNoDate(!noDate)} what="дату" />
          ) : null}
          {timeText ? <QuickChip label={timeText} off={noTime || noDate} onToggle={() => setNoTime(!noTime)} what="время" /> : null}
          {noDate ? <span>· без даты</span> : noTime && timeText ? <span>· на весь день</span> : null}
        </p>
      ) : null}
    </div>
  );
}

function QuickChip({ label, off, onToggle, what }: { label: string; off: boolean; onToggle: () => void; what: string }) {
  return (
    <button
      type="button"
      aria-pressed={!off}
      onClick={onToggle}
      title={off ? `Вернуть ${what}` : `Сбросить ${what}`}
      aria-label={off ? `Вернуть ${what} ${label}` : `Сбросить ${what} ${label}`}
      className={cn(
        "inline-flex h-8 items-center gap-1 rounded-full border px-2 tabular-nums",
        off ? "border-dashed border-line text-subtle line-through" : "border-line bg-elevated text-fg",
      )}
    >
      {label}
      <span aria-hidden="true">{off ? "↺" : "×"}</span>
    </button>
  );
}
