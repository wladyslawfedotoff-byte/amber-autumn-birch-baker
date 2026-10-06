import { useState } from "react";
import { Check, Copy, ListChecks, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { dueLabel, shiftIso, todayIso } from "@/lib/dates";
import { usePlanner } from "@/lib/planner-store";
import type { Task } from "@/lib/planner-types";
import { listInNotes, subtaskProgress } from "@/lib/task-tools";

const field =
  "w-full rounded-md border border-line bg-elevated px-3 text-base font-normal text-fg outline-none placeholder:text-subtle";

/** «Заметка»: free text; a list typed here can be turned into subtasks in one tap. */
export function NotesField({ task }: { task: Task }) {
  const updateTask = usePlanner((s) => s.updateTask);
  const notesToSubtasks = usePlanner((s) => s.notesToSubtasks);
  const found = listInNotes(task.notes).items.length;
  return (
    <div className="mt-6">
      <label className="block text-xs font-medium text-subtle">
        Заметка
        <textarea
          value={task.notes}
          onChange={(event) => updateTask(task.id, { notes: event.target.value })}
          rows={task.notes ? Math.min(10, Math.max(3, task.notes.split("\n").length + 1)) : 3}
          placeholder={"Контекст, ссылки, что не забыть.\nСписок — по строке с «- »:\n- паспорт\n- зарядка"}
          className={cn(field, "mt-2 resize-y py-3 leading-normal")}
        />
      </label>
      <p className="mt-1 text-xs text-muted">
        Первая строка заметки видна в списке под названием. Пункты с «- », «• » или «1. » можно сделать подзадачами.
      </p>
      {found > 0 ? (
        <Button variant="soft" size="sm" className="mt-2" onClick={() => notesToSubtasks(task.id)}>
          <ListChecks className="size-4" aria-hidden="true" />
          Сделать подзадачами ({found})
        </Button>
      ) : null}
    </div>
  );
}

/** «Подзадачи — шаги внутри дела»: progress, tick, delete, add (Enter, button or leaving the field). */
export function SubtasksBlock({ task }: { task: Task }) {
  const addSubtask = usePlanner((s) => s.addSubtask);
  const toggleSubtask = usePlanner((s) => s.toggleSubtask);
  const deleteSubtask = usePlanner((s) => s.deleteSubtask);
  const [draft, setDraft] = useState("");
  const subs = task.subtasks ?? [];
  const progress = subtaskProgress(task);
  const commit = () => {
    if (!draft.trim()) return;
    addSubtask(task.id, draft);
    setDraft("");
  };
  return (
    <section className="mt-6" aria-labelledby={`subtasks-${task.id}`}>
      <div className="flex items-baseline gap-2">
        <h3 id={`subtasks-${task.id}`} className="text-xs font-medium text-subtle">
          Подзадачи — шаги внутри дела
        </h3>
        {progress.total ? (
          <span className="ml-auto text-xs tabular-nums text-muted" data-testid="subtask-progress">
            {progress.done} из {progress.total}
          </span>
        ) : null}
      </div>
      {progress.total ? (
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-elevated" aria-hidden="true">
          <div className="h-full rounded-full bg-accent" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
        </div>
      ) : (
        <p className="mt-1 text-xs text-muted">
          Разбейте дело на шаги: «Поездка» → «купить билеты», «забронировать отель». В списке появится счётчик «0/2», шаги можно
          отмечать прямо там. Можно вставить сразу несколько строк.
        </p>
      )}
      <ul className="mt-1">
        {subs.map((item) => (
          <li key={item.id} className="flex items-center gap-1">
            <button
              type="button"
              aria-pressed={item.done}
              aria-label={`${item.done ? "Снять отметку" : "Отметить"}: ${item.title}`}
              onClick={() => toggleSubtask(task.id, item.id)}
              className="flex h-11 min-w-0 flex-1 items-center gap-3 text-left text-sm"
            >
              <span
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-full border",
                  item.done ? "border-accent bg-accent text-accent-fg" : "border-line",
                )}
              >
                {item.done ? <Check className="size-3" strokeWidth={3} /> : null}
              </span>
              <span className={item.done ? "text-subtle line-through" : "text-fg"}>{item.title}</span>
            </button>
            <Button size="icon" variant="ghost" aria-label={`Удалить подзадачу ${item.title}`} onClick={() => deleteSubtask(task.id, item.id)}>
              <X className="size-4" />
            </Button>
          </li>
        ))}
      </ul>
      <form
        className="mt-1 flex gap-2"
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
        <Button type="submit" variant={draft.trim() ? "primary" : "soft"} size="icon" aria-label="Добавить подзадачу">
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
    <section className="mt-6" aria-label="Дублировать задачу">
      <div className="flex flex-wrap gap-2">
        <Button variant="soft" size="sm" onClick={() => copy()}>
          <Copy className="size-4" aria-hidden="true" />
          Дублировать
        </Button>
        <Button variant="soft" size="sm" aria-expanded={picking} onClick={() => setPicking(!picking)}>
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
            className={cn(field, "h-11 w-auto")}
          />
          <Button type="submit" variant="primary" size="sm" disabled={!date}>
            Создать копию{date ? ` на ${dueLabel(date, today)}` : ""}
          </Button>
        </form>
      ) : null}
      <p className="mt-1 text-xs text-muted">
        Копия с тем же названием, заметкой, тегами, списком, приоритетом и шагами (без галочек) откроется сразу — останется поменять дату.
        Удобно для дел, которые повторяются нерегулярно: «Отчёт для бухгалтера», «Уборка на даче».
      </p>
    </section>
  );
}
