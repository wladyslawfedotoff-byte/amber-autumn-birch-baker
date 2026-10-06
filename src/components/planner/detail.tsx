import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { repeatLabel, todayIso } from "@/lib/dates";
import { usePlanner } from "@/lib/planner-store";
import { isImportant, isUrgent } from "@/lib/planner-types";
import type { Priority, Repeat } from "@/lib/planner-types";

const LEVELS: { value: Priority; label: string }[] = [
  { value: 0, label: "Нет" },
  { value: 1, label: "Низкий" },
  { value: 2, label: "Средний" },
  { value: 3, label: "Высокий" },
];

export function TaskDetail({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const task = usePlanner((s) => s.tasks.find((item) => item.id === taskId));
  const lists = usePlanner((s) => s.lists);
  const projects = usePlanner((s) => s.projects ?? []);
  const updateTask = usePlanner((s) => s.updateTask);
  const addProject = usePlanner((s) => s.addProject);
  const sendTaskToProject = usePlanner((s) => s.sendTaskToProject);
  const deleteTask = usePlanner((s) => s.deleteTask);
  const addSubtask = usePlanner((s) => s.addSubtask);
  const toggleSubtask = usePlanner((s) => s.toggleSubtask);
  const deleteSubtask = usePlanner((s) => s.deleteSubtask);
  const [tag, setTag] = useState("");
  const [sub, setSub] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [projectDraft, setProjectDraft] = useState("");
  const [makingProject, setMakingProject] = useState(false);

  if (!task) return null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 px-3 py-2">
        <p className="px-2 text-sm text-muted">Задача</p>
        <Button className="ml-auto" size="icon" variant="ghost" aria-label="Закрыть" onClick={onClose}>
          <X className="size-5" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-8">
        <input
          value={task.title}
          aria-label="Название"
          onChange={(event) => updateTask(task.id, { title: event.target.value })}
          onBlur={() => {
            if (!task.title.trim()) updateTask(task.id, { title: "Без названия" });
          }}
          className="w-full bg-transparent font-display text-3xl tracking-tight text-fg outline-none"
        />

        <label className="mt-6 block text-xs font-medium text-subtle">
          Заметка
          <textarea
            value={task.notes}
            onChange={(event) => updateTask(task.id, { notes: event.target.value })}
            rows={4}
            placeholder="Контекст, ссылки, что не забыть"
            className="mt-2 w-full resize-y rounded-md border border-line bg-elevated px-3 py-3 text-base font-normal leading-normal text-fg outline-none placeholder:text-subtle"
          />
        </label>

        <fieldset className="mt-5">
          <legend className="text-xs font-medium text-subtle">Приоритет</legend>
          <div className="mt-2 grid grid-cols-4 gap-1">
            {LEVELS.map((level) => {
              const active = task.priority === level.value;
              return (
                <button
                  key={level.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => updateTask(task.id, { priority: level.value })}
                  className={cn(
                    "h-11 rounded-md border text-xs font-medium",
                    active ? "border-current" : "border-line text-muted",
                    active && level.value === 3 && "text-danger",
                    active && level.value === 2 && "text-warn",
                    active && level.value === 1 && "text-accent",
                    active && level.value === 0 && "text-fg",
                  )}
                >
                  {level.label}
                </button>
              );
            })}
          </div>
        </fieldset>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            aria-pressed={isImportant(task)}
            onClick={() => updateTask(task.id, { important: !isImportant(task) })}
            className={cn(
              "h-11 rounded-md border text-sm",
              isImportant(task) ? "border-accent font-medium text-fg" : "border-line text-muted",
            )}
          >
            Важно
          </button>
          <button
            type="button"
            aria-pressed={isUrgent(task)}
            onClick={() => updateTask(task.id, { urgent: !isUrgent(task) })}
            className={cn(
              "h-11 rounded-md border text-sm",
              isUrgent(task) ? "border-danger font-medium text-danger" : "border-line text-muted",
            )}
          >
            Срочно
          </button>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
          <label className="block text-xs font-medium text-subtle">
            Дата
            <input
              type="date"
              value={task.due ?? ""}
              onChange={(event) => updateTask(task.id, { due: event.target.value || null })}
              className="mt-2 h-11 w-full rounded-md border border-line bg-elevated px-3 text-base font-normal text-fg"
            />
          </label>
          <label className="block text-xs font-medium text-subtle">
            Повтор
            <select
              value={task.repeat ?? ""}
              onChange={(event) => {
                const repeat = (event.target.value || null) as Repeat | null;
                updateTask(task.id, { repeat, due: repeat && !task.due ? todayIso() : task.due });
              }}
              className="mt-2 h-11 w-full rounded-md border border-line bg-elevated px-3 text-base font-normal text-fg"
            >
              <option value="">Не повторять</option>
              <option value="day">{repeatLabel("day")}</option>
              <option value="weekdays">{repeatLabel("weekdays")}</option>
              <option value="week">{repeatLabel("week")}</option>
              <option value="month">{repeatLabel("month")}</option>
            </select>
            {task.repeat ? (
              <span className="mt-2 block font-normal text-muted">Галочка ставит следующую дату, а не в архив.</span>
            ) : null}
          </label>
          <label className="block text-xs font-medium text-subtle">
            Напомнить
            <input
              type="time"
              value={task.remindAt ?? ""}
              onChange={(event) => {
                const remindAt = event.target.value || null;
                updateTask(task.id, {
                  remindAt,
                  due: remindAt && !task.due ? todayIso() : task.due,
                });
              }}
              className="mt-2 h-11 w-full rounded-md border border-line bg-elevated px-3 text-base font-normal text-fg"
            />
          </label>
          <label className="block text-xs font-medium text-subtle">
            Начало
            <input
              type="time"
              value={task.startAt ?? ""}
              onChange={(event) => {
                const startAt = event.target.value || null;
                updateTask(task.id, {
                  startAt,
                  due: startAt && !task.due ? todayIso() : task.due,
                });
              }}
              className="mt-2 h-11 w-full rounded-md border border-line bg-elevated px-3 text-base font-normal text-fg"
            />
          </label>
          <label className="block text-xs font-medium text-subtle">
            Конец
            <input
              type="time"
              value={task.endAt ?? ""}
              onChange={(event) => {
                const endAt = event.target.value || null;
                updateTask(task.id, {
                  endAt,
                  due: endAt && !task.due ? todayIso() : task.due,
                });
              }}
              className="mt-2 h-11 w-full rounded-md border border-line bg-elevated px-3 text-base font-normal text-fg"
            />
          </label>
          <label className="block text-xs font-medium text-subtle sm:col-span-2 lg:col-span-1">
            Список
            <select
              value={task.listId ?? ""}
              onChange={(event) => updateTask(task.id, { listId: event.target.value || null })}
              className="mt-2 h-11 w-full rounded-md border border-line bg-elevated px-3 text-base font-normal text-fg"
            >
              <option value="">Входящие</option>
              {lists.map((list) => (
                <option key={list.id} value={list.id}>
                  {list.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="mt-5 block text-xs font-medium text-subtle">
          Проект
          <select
            value={makingProject ? "new" : (projects.find((project) => project.stages.some((stage) => stage.cards.some((card) => card.taskId === task.id)))?.id ?? "")}
            onChange={(event) => {
              const value = event.target.value;
              if (value === "new") {
                setMakingProject(true);
                return;
              }
              setMakingProject(false);
              if (value) sendTaskToProject(task.id, value);
            }}
            className="mt-2 h-11 w-full rounded-md border border-line bg-elevated px-3 text-base font-normal text-fg"
          >
            <option value="">Не в проекте</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.title}
              </option>
            ))}
            <option value="new">Новый проект…</option>
          </select>
        </label>
        {makingProject ? (
          <form
            className="mt-2 flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const title = projectDraft.trim();
              if (!title) return;
              const existing = projects.find((project) => project.title.trim().toLowerCase() === title.toLowerCase());
              const id = existing?.id ?? addProject(title);
              sendTaskToProject(task.id, id);
              setProjectDraft("");
              setMakingProject(false);
            }}
          >
            <input
              value={projectDraft}
              onChange={(event) => setProjectDraft(event.target.value)}
              placeholder="Новый проект"
              aria-label="Название проекта"
              className="h-11 min-w-0 flex-1 rounded-md border border-line bg-elevated px-3 text-base text-fg outline-none"
            />
            <button type="submit" className="h-11 shrink-0 rounded-md bg-accent px-3 text-sm text-accent-fg">
              Передать
            </button>
          </form>
        ) : null}

        <div className="mt-5">
          <p className="text-xs font-medium text-subtle">Теги</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {task.tags.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() =>
                  updateTask(task.id, { tags: task.tags.filter((tagName) => tagName !== item) })
                }
                className="h-8 rounded-full border border-line bg-elevated px-3 text-xs text-fg"
              >
                #{item}
                <span className="sr-only"> убрать</span>
              </button>
            ))}
          </div>
          <form
            className="mt-2"
            onSubmit={(event) => {
              event.preventDefault();
              const next = tag.trim().toLowerCase();
              if (!next || task.tags.includes(next)) {
                setTag("");
                return;
              }
              updateTask(task.id, { tags: [...task.tags, next] });
              setTag("");
            }}
          >
            <input
              value={tag}
              onChange={(event) => setTag(event.target.value)}
              placeholder="Добавить тег"
              aria-label="Добавить тег"
              className="h-11 w-full rounded-md border border-line bg-elevated px-3 text-base outline-none placeholder:text-subtle"
            />
          </form>
        </div>

        <div className="mt-6">
          <p className="text-xs font-medium text-subtle">Подзадачи</p>
          <ul className="mt-2">
            {task.subtasks.map((item) => (
              <li key={item.id} className="flex items-center gap-1">
                <button
                  type="button"
                  aria-pressed={item.done}
                  onClick={() => toggleSubtask(task.id, item.id)}
                  className="flex h-11 min-w-0 flex-1 items-center gap-3 text-left text-sm"
                >
                  <span
                    className={cn(
                      "flex size-4 shrink-0 items-center justify-center rounded-full border",
                      item.done ? "border-accent bg-accent" : "border-line",
                    )}
                  />
                  <span className={item.done ? "text-subtle line-through" : "text-fg"}>{item.title}</span>
                </button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Удалить подзадачу ${item.title}`}
                  onClick={() => deleteSubtask(task.id, item.id)}
                >
                  <X className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
          <form
            className="mt-1"
            onSubmit={(event) => {
              event.preventDefault();
              addSubtask(task.id, sub);
              setSub("");
            }}
          >
            <input
              value={sub}
              onChange={(event) => setSub(event.target.value)}
              placeholder="Новая подзадача"
              aria-label="Новая подзадача"
              className="h-11 w-full rounded-md border border-line bg-elevated px-3 text-base outline-none placeholder:text-subtle"
            />
          </form>
        </div>

        <div className="mt-8">
          {confirm ? (
            <div className="flex gap-2">
              <Button variant="soft" onClick={() => setConfirm(false)}>
                Отмена
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  deleteTask(task.id);
                  onClose();
                }}
              >
                Удалить
              </Button>
            </div>
          ) : (
            <Button variant="ghost" className="text-danger" onClick={() => setConfirm(true)}>
              Удалить задачу
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
