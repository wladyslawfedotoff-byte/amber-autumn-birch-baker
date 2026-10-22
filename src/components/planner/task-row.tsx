import { kmAssetOf, openMileage } from "@/lib/mileage-prompt";
import { maintAsset, shortMaintTitle } from "@/lib/maintenance/short-title";
import type { Asset } from "@/lib/planner-types";
import { objectCount } from "@/lib/objects/count";
import { Check, ChevronDown, ChevronRight, GripVertical, ListChecks, NotebookText, Lock, Paperclip, Plus } from "lucide-react";
import { memo, useRef, useState, type PointerEvent, type Ref } from "react";
import { cn } from "@/lib/cn";
import { dueLabel, repeatLabel, shiftIso, todayIso } from "@/lib/dates";
import { parseQuick } from "@/lib/quick-add";
import { pastedLines } from "@/lib/paste-lines";
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

const NO_ASSETS: Asset[] = [];
/** Swipe distance (px) that triggers the action, and the furthest the row moves. */
const SWIPE_AT = 72;
const SWIPE_MAX = 120;

/** Memoized (1.15): ticking one task redraws only that row. */
export const TaskRow = memo(function TaskRow({
  task,
  today,
  selected,
  showDue,
  showList,
  onOpen,
  onDragStart,
  ticked = false,
  foldSubtasks = false,
}: {
  /** Checklist starts folded (counter only) unless the user opened it. */
  foldSubtasks?: boolean;
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
  const assets = usePlanner((s) => s.assets) ?? NO_ASSETS;
  const lists = usePlanner((s) => s.lists);
  const toggleTask = usePlanner((s) => s.toggleTask);
  const undoRepeat = usePlanner((s) => s.undoRepeat);
  const showToast = useDoneToast((s) => s.show);
  const toggleSubtask = usePlanner((s) => s.toggleSubtask);
  const updateTask = usePlanner((s) => s.updateTask);
  const addSubtask = usePlanner((s) => s.addSubtask);
  const subs = task.subtasks ?? [];
  const progress = subtaskProgress(task);
  const blockedBy = usePlanner((s) => {
    if (!task.dependsOn || task.done) return null;
    const prereq = s.tasks.find((item) => item.id === task.dependsOn);
    return prereq && !prereq.done ? prereq : null;
  });
  const files = objectCount(task);
  const [open, setOpen] = useSubtasksOpen(task.id, !task.done && !foldSubtasks);
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

  // Swipe (1.15): right = done (or undo), left = tomorrow. Touch only; a vertical move scrolls as usual.
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const swiped = useRef(false);
  const canTomorrow = !checked && !task.done;
  function onSwipeStart(event: PointerEvent<HTMLDivElement>) {
    // A swipe that ended without a click must not eat the next real tap (1.15.1).
    swiped.current = false;
    if (event.pointerType === "mouse" || event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest("input, textarea, .drag-handle")) return;
    const startX = event.clientX;
    const startY = event.clientY;
    let mode: "undecided" | "swipe" | "scroll" = "undecided";
    let last = 0;
    let buzzed = false;
    const move = (ev: globalThis.PointerEvent) => {
      const mx = ev.clientX - startX;
      const my = ev.clientY - startY;
      if (mode === "undecided") {
        if (Math.abs(my) > 10 && Math.abs(my) > Math.abs(mx)) mode = "scroll";
        else if (Math.abs(mx) > 12 && Math.abs(mx) > Math.abs(my) * 1.5) {
          mode = "swipe";
          setDragging(true);
        }
      }
      if (mode !== "swipe") return;
      last = Math.max(canTomorrow ? -SWIPE_MAX : 0, Math.min(SWIPE_MAX, mx));
      if (!buzzed && Math.abs(last) >= SWIPE_AT) {
        buzzed = true;
        navigator.vibrate?.(8);
      }
      setDx(last);
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      if (mode !== "swipe") return;
      swiped.current = true;
      // Only the click that belongs to this very gesture is swallowed.
      window.setTimeout(() => {
        swiped.current = false;
      }, 400);
      setDragging(false);
      setDx(0);
      if (last >= SWIPE_AT) tick();
      else if (last <= -SWIPE_AT && canTomorrow) updateTask(task.id, { due: tomorrow });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  }
  const kmAsset = kmAssetOf(task);
  const tint = colorStyle(task.color, checked ? 5 : 10);

  return (
    <div
      data-selected={selected ? "true" : undefined}
      className={cn("task-row flex items-start overflow-hidden bg-elevated", checked && "opacity-75")}
      style={dx > 0 ? { background: "var(--accent)", touchAction: "pan-y" } : dx < 0 ? { background: "var(--warn)", touchAction: "pan-y" } : { ...tint, touchAction: "pan-y" }}
      onPointerDown={onSwipeStart}
      onClickCapture={(event) => {
        if (!swiped.current) return;
        swiped.current = false;
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      {dx !== 0 ? (
        <span
          aria-hidden="true"
          className={cn("pointer-events-none absolute inset-y-0 flex items-center px-4 text-sm font-semibold text-accent-fg", dx > 0 ? "left-0" : "right-0", Math.abs(dx) < SWIPE_AT && "opacity-60")}
        >
          {dx > 0 ? (checked ? "Вернуть" : "Готово") : "Завтра"}
        </span>
      ) : null}
      <div
        className={cn("flex min-w-0 flex-1 items-start", !dragging && "transition-transform duration-150")}
        style={dx !== 0 ? { transform: `translateX(${dx}px)`, background: tint.background ?? "var(--elevated)" } : undefined}
      >
      <button
        type="button"
        aria-label={ticked ? "Отменить отметку" : task.done ? "Вернуть в работу" : "Выполнить"}
        aria-pressed={checked}
        title={ticked ? "Отменить отметку — задача вернётся на прежнюю дату" : task.done ? "Вернуть в работу" : "Выполнить"}
        onClick={tick}
        className="flex h-10 w-10 shrink-0 items-center justify-center"
      >
        <span
          className={cn(
            "flex size-[1.125rem] items-center justify-center rounded-full border-2 transition-[background-color,border-color] duration-150",
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
                "block text-pretty text-[0.9375rem] leading-snug",
                checked ? "text-subtle line-through decoration-subtle" : "text-fg",
              )}
            >
              {task.maint ? shortMaintTitle(task, assets) : task.title}
            </span>
            {preview ? (
              <span className="mt-0.5 flex items-center gap-1 text-[0.75rem] text-muted">
                <NotebookText className="size-3 shrink-0" aria-hidden="true" />
                <span className="min-w-0 truncate">{preview}</span>
              </span>
            ) : null}
            <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.75rem] leading-4 text-muted empty:hidden">
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
              {task.via === "phone" ? <span>📱 с iPhone</span> : null}
              {task.repeat ? <span>{repeatLabel(task.repeat, task.repeatDates)}</span> : null}
              {showList ? <span>{task.maint && !task.listId ? `🔧 ${maintAsset(task, assets)?.name ?? "Обслуживание"}` : listName(lists, task.listId)}</span> : null}
              {(task.tags ?? []).slice(0, 2).map((tag) => (
                <span key={tag}>#{tag}</span>
              ))}
              <ShareBadges task={task} />
              {blockedBy ? (
                <span className="flex min-w-0 items-center gap-0.5 text-warn" data-testid="blocked-badge">
                  <Lock className="size-3 shrink-0" aria-hidden="true" />
                  <span className="max-w-40 truncate">ждёт: {blockedBy.title}</span>
                </span>
              ) : null}
              {files > 0 ? (
                <span className="flex items-center gap-0.5" aria-label={`Вложения, ссылки, контакты: ${files}`} data-testid="objects-badge">
                  <Paperclip className="size-3" aria-hidden="true" />
                  <span className="tabular-nums">{files}</span>
                </span>
              ) : null}
            </span>
          </button>
          {kmAsset && !checked ? (
            <button
              type="button"
              onClick={() => openMileage(kmAsset)}
              className="mt-0.5 h-7 shrink-0 rounded-full bg-accent/10 px-2.5 text-xs font-medium text-accent"
            >
              Обновить пробег
            </button>
          ) : null}
          {progress.total > 0 ? (
            <button
              type="button"
              aria-expanded={open}
              aria-label={`Подзадачи «${task.title}»: ${progress.done} из ${progress.total}. ${open ? "Свернуть" : "Показать"}`}
              title={open ? "Свернуть подзадачи" : "Показать подзадачи"}
              onClick={() => setOpen(!open)}
              className={cn(
                "-my-2 flex h-10 shrink-0 items-center gap-1 rounded-full px-1.5 text-[0.75rem] tabular-nums",
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
              className="-my-2 flex h-10 shrink-0 items-center px-0.5"
            >
              <span className="rounded-full bg-bg px-1.5 text-[0.6875rem] leading-[1.125rem] text-danger">завтра</span>
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
                  className="flex h-9 w-full items-center gap-2 text-left text-sm"
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
          className="drag-handle flex size-10 shrink-0 items-center justify-center text-subtle"
          onPointerDown={onDragStart}
        >
          <GripVertical className="size-4" />
        </button>
      ) : null}
      </div>
    </div>
  );
});

export type QuickOptions = { noDate?: boolean; noTime?: boolean };

export function AddTaskForm({
  placeholder,
  onAdd,
  inputRef,
  className,
  onEscape,
}: {
  placeholder: string;
  /** Lets the bottom composer focus the field inside the tap (iOS opens the keyboard only then). */
  inputRef?: Ref<HTMLInputElement>;
  className?: string;
  onEscape?: () => void;
  /** `options`: the user dropped the recognised date / time — pass them on to addTask. */
  onAdd: (title: string, options: QuickOptions) => void;
}) {
  const [value, setValue] = useState("");
  const [noDate, setNoDate] = useState(false);
  const [noTime, setNoTime] = useState(false);
  const [pasted, setPasted] = useState(0);
  const parsed = parseQuick(value);
  const timeText = parsed.startAt ? (parsed.endAt ? `${parsed.startAt}–${parsed.endAt}` : parsed.startAt) : "";
  return (
    <div className={className}>
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
          ref={inputRef}
          name="title"
          enterKeyHint="done"
          onKeyDown={(event) => {
            if (event.key === "Escape" && onEscape) onEscape();
          }}
          onPaste={(event) => {
            // Several lines pasted → one task per line (replaces the old «Все» textarea).
            const text = event.clipboardData.getData("text");
            if (!/\r?\n/.test(text.trim())) return;
            const lines = pastedLines(text);
            if (lines.length < 2) return;
            event.preventDefault();
            for (const line of lines) if (parseQuick(line).title) onAdd(line, {});
            setValue("");
            setPasted(lines.length);
          }}
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setPasted(0);
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
      {pasted > 0 ? (
        <p role="status" className="mt-1 px-2 text-xs text-muted">
          Добавлено задач: {pasted}
        </p>
      ) : null}
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
