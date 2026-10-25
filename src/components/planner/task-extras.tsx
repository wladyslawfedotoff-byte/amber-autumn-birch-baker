import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Copy, GripVertical, ListChecks, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FieldLabel } from "@/components/ui/hint";
import { cn } from "@/lib/cn";
import { CheckCircle, Chip, FIELD } from "@/components/ui/kit";
import { dueLabel, shiftIso, todayIso } from "@/lib/dates";
import { usePlanner } from "@/lib/planner-store";
import type { Task } from "@/lib/planner-types";
import { dropIndex, placeItem } from "@/lib/reorder";
import { listInNotes, subtaskProgress } from "@/lib/task-tools";

// Общий стиль поля из набора (16 px, рамка-разделитель, кольцо фокуса акцентом).
const field = cn(FIELD, "border-separator");

/** «Заметка»: free text; a list typed here can be turned into subtasks in one tap. */
export function NotesField({ task }: { task: Task }) {
  const updateTask = usePlanner((s) => s.updateTask);
  const notesToSubtasks = usePlanner((s) => s.notesToSubtasks);
  const found = listInNotes(task.notes).items.length;
  return (
    <div className="mt-3">
      <FieldLabel hint="Первая строка видна в списке под названием. Пункты с «- », «• » или «1. » можно одним нажатием сделать подзадачами.">
        Заметка
      </FieldLabel>
      <textarea
        value={task.notes}
        aria-label="Заметка"
        onChange={(event) => updateTask(task.id, { notes: event.target.value })}
        rows={task.notes ? Math.min(10, Math.max(2, task.notes.split("\n").length + 1)) : 2}
        placeholder={"Контекст, ссылки… Список — строки с «- »"}
        className={cn(field, "mt-1 h-auto resize-y py-2 leading-normal")}
      />
      {found > 0 ? (
        <Button variant="secondary" size="sm" className="mt-2" onClick={() => notesToSubtasks(task.id)}>
          <ListChecks className="size-4" aria-hidden="true" />
          Сделать подзадачами ({found})
        </Button>
      ) : null}
    </div>
  );
}

/** «Подзадачи — шаги внутри дела»: progress, tick, delete, add (Enter, button or leaving the field). */
const LONG_PRESS_MS = 500;

export function SubtasksBlock({ task }: { task: Task }) {
  const addSubtask = usePlanner((s) => s.addSubtask);
  const toggleSubtask = usePlanner((s) => s.toggleSubtask);
  const deleteSubtask = usePlanner((s) => s.deleteSubtask);
  const moveSubtask = usePlanner((s) => s.moveSubtask);
  const placeSubtask = usePlanner((s) => s.placeSubtask);
  const [draft, setDraft] = useState("");
  const [drag, setDrag] = useState<{ id: string; order: string[] } | null>(null);
  // Long press (or right click) on a step: «Выше / Ниже» instead of tiny arrows.
  const [menuId, setMenuId] = useState<string | null>(null);
  const pressTimer = useRef<number | undefined>(undefined);
  const pressed = useRef(false);
  const real = task.subtasks ?? [];
  const order = drag?.order ?? real.map((s) => s.id);
  const byId = Object.fromEntries(real.map((s) => [s.id, s]));
  const subs = order.map((id) => byId[id]).filter(Boolean) as typeof real;
  const progress = subtaskProgress(task);
  const commit = () => {
    if (!draft.trim()) return;
    addSubtask(task.id, draft);
    setDraft("");
  };
  function beginDrag(event: ReactPointerEvent<HTMLElement>, id: string) {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget;
    try {
      handle.setPointerCapture(event.pointerId);
    } catch {
      /* window listeners below still follow the finger */
    }
    const pointer = event.pointerId;
    let next = real.map((s) => s.id);
    setDrag({ id, order: next });
    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointer) return;
      ev.preventDefault();
      const rows = [...document.querySelectorAll<HTMLElement>(`[data-sub-row="${task.id}"]`)];
      const index = dropIndex(
        ev.clientY,
        rows.map((row) => {
          const rect = row.getBoundingClientRect();
          return { top: rect.top, height: rect.height };
        }),
      );
      next = placeItem(
        next.map((sid) => ({ id: sid })),
        id,
        index,
      ).map((row) => row.id);
      setDrag({ id, order: next });
    };
    const finish = (ev: PointerEvent) => {
      if (ev.pointerId !== pointer) return;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      setDrag(null);
      const at = next.indexOf(id);
      if (at >= 0 && next.join() !== real.map((s) => s.id).join()) placeSubtask(task.id, id, at);
    };
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  }
  return (
    <section className="mt-3" aria-labelledby={`subtasks-${task.id}`} data-testid="checklist-block">
      <div className="flex items-center gap-2">
        <div id={`subtasks-${task.id}`}>
          <FieldLabel hint="Шаги дела со счётчиком «0/2» в списке. Потяните ⋮⋮ пальцем или удерживайте шаг — «Выше / Ниже».">
            Чек-лист
          </FieldLabel>
        </div>
        {progress.total ? (
          <span className="ml-auto text-caption tabular-nums text-secondary-label" data-testid="subtask-progress">
            {progress.done} из {progress.total}
          </span>
        ) : null}
      </div>
      {progress.total ? (
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-separator" aria-hidden="true">
          <div className="h-full rounded-full bg-accent" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
        </div>
      ) : null}
      <ul className={cn("mt-2", subs.length > 0 && "menu-card overflow-hidden rounded-card")}>
        {subs.map((item, index) => (
          <li
            key={item.id}
            data-sub-row={task.id}
            className={cn("relative", drag?.id === item.id && "z-10 bg-card shadow-[var(--shadow-pop)]")}
          >
            <div className="flex items-center gap-1">
              <span
                role="button"
                tabIndex={0}
                aria-label={`Перетащить «${item.title}»`}
                title="Потяните, чтобы поменять порядок"
                onPointerDown={(event) => beginDrag(event, item.id)}
                onKeyDown={(event) => {
                  if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
                  event.preventDefault();
                  moveSubtask(task.id, item.id, event.key === "ArrowUp" ? -1 : 1);
                }}
                className="drag-handle flex size-11 shrink-0 cursor-grab touch-none items-center justify-center text-tertiary-label"
              >
                <GripVertical className="size-5" />
              </span>
              <button
                type="button"
                aria-pressed={item.done}
                aria-label={`${item.done ? "Снять отметку" : "Отметить"}: ${item.title}`}
                onClick={() => {
                  if (pressed.current) {
                    pressed.current = false;
                    return;
                  }
                  toggleSubtask(task.id, item.id);
                }}
                onPointerDown={() => {
                  window.clearTimeout(pressTimer.current);
                  pressTimer.current = window.setTimeout(() => {
                    pressed.current = true;
                    setMenuId(item.id);
                  }, LONG_PRESS_MS);
                }}
                onPointerUp={() => window.clearTimeout(pressTimer.current)}
                onPointerLeave={() => window.clearTimeout(pressTimer.current)}
                onPointerCancel={() => window.clearTimeout(pressTimer.current)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setMenuId(item.id);
                }}
                style={{ WebkitTouchCallout: "none" }}
                className="flex min-h-11 min-w-0 flex-1 items-center gap-3 text-left text-body"
              >
                <CheckCircle checked={item.done} />
                <span className={item.done ? "text-tertiary-label line-through" : "text-label"}>{item.title}</span>
              </button>
              <Button size="icon" variant="ghost" className="text-tertiary-label" aria-label={`Удалить подзадачу ${item.title}`} onClick={() => deleteSubtask(task.id, item.id)}>
                <X className="size-4" />
              </Button>
            </div>
            {menuId === item.id ? (
              <div role="menu" aria-label={`Порядок «${item.title}»`} className="mb-2 ml-12 flex gap-2">
                <Chip
                  tone="outline"
                  role="menuitem"
                  disabled={index === 0}
                  onClick={() => {
                    moveSubtask(task.id, item.id, -1);
                    setMenuId(null);
                  }}
                  className="h-8 px-3 text-[0.8125rem]"
                >
                  Выше
                </Chip>
                <Chip
                  tone="outline"
                  role="menuitem"
                  disabled={index === subs.length - 1}
                  onClick={() => {
                    moveSubtask(task.id, item.id, 1);
                    setMenuId(null);
                  }}
                  className="h-8 px-3 text-[0.8125rem]"
                >
                  Ниже
                </Chip>
                <Chip tone="tint" onClick={() => setMenuId(null)} className="h-8 px-3 text-[0.8125rem]">
                  Готово
                </Chip>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      <form
        className="mt-2 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          commit();
        }}
      >
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onPaste={(event) => {
            const text = event.clipboardData.getData("text");
            if (!text.includes("\n")) return;
            event.preventDefault();
            addSubtask(task.id, `${draft}${text}`);
            setDraft("");
          }}
          placeholder={subs.length ? "Ещё шаг" : "Например: купить билеты"}
          aria-label="Новая подзадача"
          enterKeyHint="done"
          className={cn(field, "h-11 min-w-0 flex-1")}
        />
        <Button type="submit" variant={draft.trim() ? "primary" : "secondary"} size="icon" aria-label="Добавить подзадачу">
          <Plus className="size-5" />
        </Button>
      </form>
    </section>
  );
}

/** «Дублировать» / «Дублировать на дату…»: the copy opens right away. */
export function DuplicateControls({ task, onOpen }: { task: Task; onOpen?: (id: string) => void }) {
  const duplicateTask = usePlanner((s) => s.duplicateTask);
  const [picking, setPicking] = useState(false);
  const today = todayIso();
  const [date, setDate] = useState(() => shiftIso(task.due && task.due >= today ? task.due : today, 1));
  const copy = (due?: string | null) => {
    const id = duplicateTask(task.id, due);
    setPicking(false);
    if (id) onOpen?.(id);
  };
  return (
    <section aria-label="Дублировать задачу">
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={() => copy()}>
          <Copy className="size-4" aria-hidden="true" />
          Дублировать
        </Button>
        <Button variant="secondary" size="sm" aria-expanded={picking} onClick={() => setPicking(!picking)}>
          Дублировать на дату…
        </Button>
      </div>
      {picking ? (
        <form
          className="mt-2 flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (date) copy(date);
          }}
        >
          <input
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            aria-label="Дата копии"
            className={cn(field, "w-auto")}
          />
          <Button type="submit" variant="primary" size="sm" disabled={!date}>
            Создать копию{date ? ` на ${dueLabel(date, today)}` : ""}
          </Button>
        </form>
      ) : null}
      <p className="mt-1 text-caption text-secondary-label">Копия со всеми полями (без галочек) откроется сразу — например, «Отчёт для бухгалтера».</p>
    </section>
  );
}
