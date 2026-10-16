import { useState } from "react";
import { X } from "lucide-react";
import { Row, RowGroup } from "@/components/ui/rows";
import { Hint } from "@/components/ui/hint";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { REMIND_LEADS, leadShort, normalizeLead } from "@/lib/reminders";
import { DateMultiPicker } from "@/components/planner/date-multi-picker";
import { TaskShareControls } from "@/components/planner/sharing";
import { ColorPicker } from "@/components/planner/color-picker";
import { PickerInput } from "@/components/planner/picker-input";
import { DuplicateControls, NotesField, SubtasksBlock } from "@/components/planner/task-extras";
import { TaskObjects } from "@/components/planner/objects/task-objects";
import { DependsBlock } from "@/components/planner/objects/deps";
import { cleanDates, dueLabel, repeatLabel, shiftIso, todayIso } from "@/lib/dates";
import { colorHex, colorLabel } from "@/lib/task-colors";
import { usePlanner } from "@/lib/planner-store";
import { ownerOf } from "@/lib/queries";
import { displayName, useProfile } from "@/lib/use-capabilities";
import { isImportant, isUrgent } from "@/lib/planner-types";
import type { Priority, Repeat } from "@/lib/planner-types";

const LEVELS: { value: Priority; label: string }[] = [
  { value: 0, label: "Нет" },
  { value: 1, label: "Низкий" },
  { value: 2, label: "Средний" },
  { value: 3, label: "Высокий" },
];

export function TaskDetail({ taskId, onClose, onOpen }: { taskId: string; onClose: () => void; onOpen?: (id: string) => void }) {
  const task = usePlanner((s) => s.tasks.find((item) => item.id === taskId));
  const lists = usePlanner((s) => s.lists);
  const projects = usePlanner((s) => s.projects ?? []);
  const updateTask = usePlanner((s) => s.updateTask);
  const clearTaskTime = usePlanner((s) => s.clearTaskTime);
  const clearTaskDate = usePlanner((s) => s.clearTaskDate);
  const addProject = usePlanner((s) => s.addProject);
  const sendTaskToProject = usePlanner((s) => s.sendTaskToProject);
  const deleteTask = usePlanner((s) => s.deleteTask);
  const setRepeatDates = usePlanner((s) => s.setRepeatDates);
  const profile = useProfile();
  const [tag, setTag] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [projectDraft, setProjectDraft] = useState("");
  const [makingProject, setMakingProject] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const toggle = (id: string) => setOpen((cur) => (cur === id ? null : id));

  if (!task) return null;
  const me = profile.login;
  const owner = profile.multiUser && me ? ownerOf(task, profile.dataOwner || me) : me;
  const foreign = Boolean(profile.multiUser && me && owner !== me);

  const today = todayIso();
  const project = projects.find((p) => p.stages.some((stage) => stage.cards.some((card) => card.taskId === task.id)));
  const timeValue = task.startAt ? `${task.startAt}${task.endAt ? `–${task.endAt}` : ""}` : task.due ? "весь день" : "—";
  const level = LEVELS.find((l) => l.value === task.priority)?.label ?? "Нет";
  const matrix = [isImportant(task) ? "важно" : "", isUrgent(task) ? "срочно" : ""].filter(Boolean).join(" · ") || "—";
  const listName = lists.find((l) => l.id === task.listId)?.name ?? "Входящие";
  const field = "h-11 w-full rounded-md border border-line bg-surface px-3 text-base font-normal text-fg";
  const quick = (label: string, due: string | null) => (
    <button
      key={label}
      type="button"
      onClick={() => (due ? updateTask(task.id, { due }) : clearTaskDate(task.id))}
      className={cn("h-9 rounded-full border px-3 text-sm", (due ?? null) === (task.due ?? null) ? "border-accent bg-accent text-accent-fg" : "border-line text-fg")}
    >
      {label}
    </button>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 px-2 py-1">
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
          className="w-full bg-transparent text-xl font-semibold tracking-tight text-fg outline-none md:text-2xl"
        />

        <NotesField task={task} />

        <SubtasksBlock task={task} />

        <RowGroup>
          <Row label="Дата" value={task.repeat === "dates" ? (task.due ? `ближайшая: ${dueLabel(task.due, today)}` : "по выбранным датам") : task.due ? dueLabel(task.due, today) : "Нет"} open={open === "date"} onClick={() => toggle("date")}>
            {task.repeat === "dates" ? (
              <p className="text-xs text-muted">Даты выбираются в «Повтор».</p>
            ) : (
              <>
                <div className="flex flex-wrap gap-1.5">
                  {quick("Сегодня", today)}
                  {quick("Завтра", shiftIso(today, 1))}
                  {quick("Через неделю", shiftIso(today, 7))}
                  {quick("Без даты", null)}
                </div>
                <PickerInput
                  type="date"
                  value={task.due ?? ""}
                  aria-label="Дата"
                  clearLabel="Убрать дату"
                  onValue={(due) => (due ? updateTask(task.id, { due }) : clearTaskDate(task.id))}
                  className={cn(field, "mt-2")}
                />
                <p className="mt-1 text-xs text-muted">«Без даты» — задача уходит из «Сегодня» и календаря, остаётся в списке.</p>
              </>
            )}
          </Row>
          <Row label="Время" value={timeValue} open={open === "time"} onClick={() => toggle("time")}>
            <div className="grid grid-cols-2 gap-2">
              <label className="block min-w-0 text-xs text-subtle">
                Начало
                <PickerInput
                  type="time"
                  value={task.startAt ?? ""}
                  clearLabel="Убрать начало"
                  onValue={(raw) => {
                    const startAt = raw || null;
                    updateTask(task.id, { startAt, due: startAt && !task.due ? today : task.due });
                  }}
                  className={cn(field, "mt-1")}
                />
              </label>
              <label className="block min-w-0 text-xs text-subtle">
                Конец
                <PickerInput
                  type="time"
                  value={task.endAt ?? ""}
                  clearLabel="Убрать конец"
                  onValue={(raw) => {
                    const endAt = raw || null;
                    updateTask(task.id, { endAt, due: endAt && !task.due ? today : task.due });
                  }}
                  className={cn(field, "mt-1")}
                />
              </label>
            </div>
            <Button
              variant="soft"
              size="sm"
              className="mt-2 h-9"
              disabled={!task.remindAt && !task.startAt && !task.endAt}
              onClick={() => clearTaskTime(task.id)}
              title="Дата остаётся, время, начало, конец и напоминание убираются"
            >
              Без времени (весь день)
            </Button>
          </Row>
          <Row
            label="Напомнить"
            value={task.remindAt ? `${task.remindAt}${normalizeLead(task.remindLead) ? ` · ${leadShort(normalizeLead(task.remindLead))}` : ""}` : "Нет"}
            open={open === "remind"}
            onClick={() => toggle("remind")}
          >
            <PickerInput
              type="time"
              value={task.remindAt ?? ""}
              aria-label="Напомнить"
              clearLabel="Убрать напоминание"
              onValue={(raw) => {
                const remindAt = raw || null;
                updateTask(task.id, { remindAt, due: remindAt && !task.due ? today : task.due });
              }}
              className={field}
            />
            <div className="mt-2 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Когда напомнить" data-testid="remind-lead">
              {REMIND_LEADS.map((lead) => {
                const on = normalizeLead(task.remindLead) === lead;
                return (
                  <button
                    key={lead}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    disabled={!task.remindAt}
                    onClick={() => updateTask(task.id, { remindLead: lead })}
                    className={cn("h-8 rounded-full px-3 text-[0.8125rem] disabled:opacity-40", on ? "bg-accent text-accent-fg" : "bg-surface text-fg")}
                  >
                    {leadShort(lead)}
                  </button>
                );
              })}
            </div>
          </Row>
          <Row label="Повтор" value={task.repeat ? repeatLabel(task.repeat, task.repeatDates) : "Нет"} open={open === "repeat"} onClick={() => toggle("repeat")}>
            <select
              aria-label="Повтор"
              value={task.repeat ?? ""}
              onChange={(event) => {
                const repeat = (event.target.value || null) as Repeat | null;
                if (repeat === "dates") {
                  const start = cleanDates(task.repeatDates);
                  setRepeatDates(task.id, start.length ? start : task.due ? [task.due] : []);
                  return;
                }
                updateTask(task.id, { repeat, due: repeat && !task.due ? today : task.due });
              }}
              className={field}
            >
              <option value="">Не повторять</option>
              <option value="day">{repeatLabel("day")}</option>
              <option value="weekdays">{repeatLabel("weekdays")}</option>
              <option value="week">{repeatLabel("week")}</option>
              <option value="month">{repeatLabel("month")}</option>
              <option value="dates">Выбранные даты…</option>
            </select>
            {task.repeat === "dates" ? (
              <div className="mt-2">
                <DateMultiPicker value={task.repeatDates ?? []} onChange={(dates) => setRepeatDates(task.id, dates)} />
              </div>
            ) : task.repeat ? (
              <p className="mt-1 text-xs text-muted">Галочка ставит следующую дату, а не в архив.</p>
            ) : null}
          </Row>
        </RowGroup>

        <RowGroup>
          <Row label="Приоритет" value={level} open={open === "priority"} onClick={() => toggle("priority")}>
            <div className="grid grid-cols-4 gap-1">
              {LEVELS.map((item) => {
                const active = task.priority === item.value;
                return (
                  <button
                    key={item.value}
                    type="button"
                    aria-pressed={active}
                    onClick={() => updateTask(task.id, { priority: item.value })}
                    className={cn(
                      "h-10 rounded-md border text-xs font-medium",
                      active ? "border-current" : "border-line text-muted",
                      active && item.value === 3 && "text-danger",
                      active && item.value === 2 && "text-warn",
                      active && item.value === 1 && "text-accent",
                      active && item.value === 0 && "text-fg",
                    )}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
          </Row>
          <Row label="Список" value={listName} open={open === "list"} onClick={() => toggle("list")}>
            <select
              aria-label="Список"
              value={task.listId ?? ""}
              onChange={(event) => updateTask(task.id, { listId: event.target.value || null })}
              className={field}
            >
              <option value="">Входящие</option>
              {lists.map((list) => (
                <option key={list.id} value={list.id}>
                  {list.name}
                </option>
              ))}
            </select>
          </Row>
        </RowGroup>

        <Row
          label="Подробнее"
          value={
            [
              task.color && colorLabel(task.color) !== "Нет" ? "цвет" : null,
              project ? "проект" : null,
              task.tags.length ? "теги" : null,
              isImportant(task) || isUrgent(task) ? "матрица" : null,
              (task.members ?? []).length || task.assignee ? "совместная" : null,
            ]
              .filter(Boolean)
              .join(" · ") || ""
          }
          open={open === "more"}
          onClick={() => toggle("more")}
        >
          <div className="space-y-4">
            <RowGroup>
              <Row label="Матрица" value={matrix} open={open === "matrix"} onClick={() => toggle("matrix")}>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    aria-pressed={isImportant(task)}
                    onClick={() => updateTask(task.id, { important: !isImportant(task) })}
                    className={cn("h-10 rounded-md border text-sm", isImportant(task) ? "border-accent font-medium text-fg" : "border-line text-muted")}
                  >
                    Важно
                  </button>
                  <button
                    type="button"
                    aria-pressed={isUrgent(task)}
                    onClick={() => updateTask(task.id, { urgent: !isUrgent(task) })}
                    className={cn("h-10 rounded-md border text-sm", isUrgent(task) ? "border-danger font-medium text-danger" : "border-line text-muted")}
                  >
                    Срочно
                  </button>
                </div>
              </Row>
              <Row
                label="Цвет"
                value={
                  <span className="inline-flex items-center gap-1.5">
                    {colorHex(task.color) ? <span className="size-3 rounded-full" style={{ background: colorHex(task.color)! }} /> : null}
                    {colorLabel(task.color)}
                  </span>
                }
                open={open === "color"}
                onClick={() => toggle("color")}
              >
                <ColorPicker bare value={task.color} onChange={(color) => updateTask(task.id, { color })} />
              </Row>
              <Row label="Проект" value={project?.title ?? "—"} open={open === "project"} onClick={() => toggle("project")}>
                <select
                  aria-label="Проект"
                  value={makingProject ? "new" : (project?.id ?? "")}
                  onChange={(event) => {
                    const value = event.target.value;
                    if (value === "new") {
                      setMakingProject(true);
                      return;
                    }
                    setMakingProject(false);
                    if (value) sendTaskToProject(task.id, value);
                  }}
                  className={field}
                >
                  <option value="">Не в проекте</option>
                  {projects.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title}
                    </option>
                  ))}
                  <option value="new">Новый проект…</option>
                </select>
                {makingProject ? (
                  <form
                    className="mt-2 flex gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const title = projectDraft.trim();
                      if (!title) return;
                      const existing = projects.find((item) => item.title.trim().toLowerCase() === title.toLowerCase());
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
                      className={cn(field, "flex-1")}
                    />
                    <button type="submit" className="h-11 shrink-0 rounded-md bg-accent px-3 text-sm text-accent-fg">
                      Передать
                    </button>
                  </form>
                ) : null}
              </Row>
              <Row label="Теги" value={task.tags.length ? task.tags.map((t) => `#${t}`).join(" ") : "—"} open={open === "tags"} onClick={() => toggle("tags")}>
                {task.tags.length ? (
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {task.tags.map((item) => (
                      <button
                        key={item}
                        type="button"
                        onClick={() => updateTask(task.id, { tags: task.tags.filter((tagName) => tagName !== item) })}
                        className="h-8 rounded-full border border-line bg-surface px-3 text-xs text-fg"
                      >
                        #{item} ×<span className="sr-only"> убрать</span>
                      </button>
                    ))}
                  </div>
                ) : null}
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    const next = tag.trim().toLowerCase().replace(/^#/, "");
                    if (!next || task.tags.includes(next)) {
                      setTag("");
                      return;
                    }
                    updateTask(task.id, { tags: [...task.tags, next] });
                    setTag("");
                  }}
                >
                  <input value={tag} onChange={(event) => setTag(event.target.value)} placeholder="Добавить тег, например «жду»" aria-label="Добавить тег" className={field} />
                </form>
              </Row>
            </RowGroup>

            <RowGroup>
              {profile.multiUser && me ? (
                <Row
                  label="Совместная"
                  value={task.assignee ? `назначена: ${displayName(task.assignee, profile)}` : (task.members ?? []).length ? `участников: ${(task.members ?? []).length}` : "только вы"}
                  open={open === "share"}
                  onClick={() => toggle("share")}
                >
                  <TaskShareControls task={task} />
                </Row>
              ) : null}
              <Row label="Дублировать" open={open === "copy"} onClick={() => toggle("copy")}>
                <DuplicateControls task={task} onOpen={onOpen} />
              </Row>
            </RowGroup>

            <TaskObjects task={task} projectContacts={project?.contacts ?? []} />
            <DependsBlock task={task} />
          </div>
        </Row>

        <div className="mt-6">
          {foreign ? (
            <p className="mb-2 text-xs text-muted">
              Задача {displayName(owner, profile)}. <Hint label="Что значит «Убрать у себя»">Она исчезнет только у вас и останется у владельца.</Hint>
            </p>
          ) : null}
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
                {foreign ? "Убрать" : "Удалить"}
              </Button>
            </div>
          ) : (
            <Button variant="ghost" className="text-danger" onClick={() => setConfirm(true)}>
              {foreign ? "Убрать у себя" : "Удалить задачу"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
