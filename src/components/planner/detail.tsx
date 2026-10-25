import { useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { X } from "lucide-react";
import {
  Chip,
  FIELD,
  GroupedCard,
  ListRow,
  SegmentedControl,
  SheetHeader,
} from "@/components/ui/kit";
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

/** Раскрывающаяся строка карточки: ListRow, под ним редактор (аккордеон). */
function Disclose({
  label,
  value,
  open,
  onClick,
  children,
}: {
  label: string;
  value?: ReactNode;
  open: boolean;
  onClick: () => void;
  children?: ReactNode;
}) {
  return (
    <ListRow title={label} value={value || " "} expanded={open} onClick={onClick}>
      {open && children ? <div className="px-3 pb-3">{children}</div> : null}
    </ListRow>
  );
}

const LEVELS: { value: Priority; label: string }[] = [
  { value: 0, label: "Нет" },
  { value: 1, label: "Низкий" },
  { value: 2, label: "Средний" },
  { value: 3, label: "Высокий" },
];

export function TaskDetail({
  taskId,
  onClose,
  onOpen,
  onHeaderPointerDown,
}: {
  taskId: string;
  onClose: () => void;
  onOpen?: (id: string) => void;
  /** Bottom-sheet drag (phones): pull the header down to close. */
  onHeaderPointerDown?: (event: ReactPointerEvent<HTMLElement>) => void;
}) {
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
  // «Подробнее» has its own state: opening a row inside it must not fold it up.
  const [more, setMore] = useState(false);

  if (!task) return null;
  const me = profile.login;
  const owner = profile.multiUser && me ? ownerOf(task, profile.dataOwner || me) : me;
  const foreign = Boolean(profile.multiUser && me && owner !== me);

  const today = todayIso();
  const project = projects.find((p) =>
    p.stages.some((stage) => stage.cards.some((card) => card.taskId === task.id)),
  );
  const timeValue = task.startAt
    ? `${task.startAt}${task.endAt ? `–${task.endAt}` : ""}`
    : task.due
      ? "весь день"
      : "—";
  const level = LEVELS.find((l) => l.value === task.priority)?.label ?? "Нет";
  const matrix =
    [isImportant(task) ? "важно" : "", isUrgent(task) ? "срочно" : ""]
      .filter(Boolean)
      .join(" · ") || "—";
  const listName = lists.find((l) => l.id === task.listId)?.name ?? "Входящие";
  const field = cn(FIELD, "border-separator");
  const quick = (label: string, due: string | null) => (
    <Chip
      key={label}
      tone={(due ?? null) === (task.due ?? null) ? "on" : "outline"}
      aria-pressed={(due ?? null) === (task.due ?? null)}
      onClick={() => (due ? updateTask(task.id, { due }) : clearTaskDate(task.id))}
      className="h-8 px-3 text-[0.8125rem]"
    >
      {label}
    </Chip>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 touch-none lg:touch-auto" onPointerDown={onHeaderPointerDown}>
        <span aria-hidden="true" className="sheet-grabber lg:hidden" />
        <div className="lg:hidden">
          <SheetHeader title="Задача" onDone={onClose} />
        </div>
        <div className="hidden items-center px-2 py-1 lg:flex">
          <p className="px-2 text-body font-semibold text-label">Задача</p>
          <Button
            className="ml-auto"
            size="icon"
            variant="ghost"
            aria-label="Закрыть"
            onClick={onClose}
          >
            <X className="size-5" />
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-8">
        <input
          value={task.title}
          aria-label="Название"
          onChange={(event) => updateTask(task.id, { title: event.target.value })}
          onBlur={() => {
            if (!task.title.trim()) updateTask(task.id, { title: "Без названия" });
          }}
          className="w-full bg-transparent text-title font-semibold tracking-tight text-label outline-none md:text-2xl"
        />

        <NotesField task={task} />

        <SubtasksBlock task={task} />

        <GroupedCard className="mt-3">
          <Disclose
            label="Дата"
            value={
              task.repeat === "dates"
                ? task.due
                  ? `ближайшая: ${dueLabel(task.due, today)}`
                  : "по выбранным датам"
                : task.due
                  ? dueLabel(task.due, today)
                  : "Нет"
            }
            open={open === "date"}
            onClick={() => toggle("date")}
          >
            {task.repeat === "dates" ? (
              <p className="text-caption text-secondary-label">Даты выбираются в «Повтор».</p>
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
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
                <p className="mt-1 text-caption text-secondary-label">
                  «Без даты» — задача уходит из «Сегодня» и календаря, остаётся в списке.
                </p>
              </>
            )}
          </Disclose>
          <Disclose
            label="Время"
            value={timeValue}
            open={open === "time"}
            onClick={() => toggle("time")}
          >
            <div className="grid grid-cols-2 gap-2">
              <label className="block min-w-0 text-caption text-secondary-label">
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
              <label className="block min-w-0 text-caption text-secondary-label">
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
              variant="secondary"
              size="sm"
              className="mt-2"
              disabled={!task.remindAt && !task.startAt && !task.endAt}
              onClick={() => clearTaskTime(task.id)}
              title="Дата остаётся, время, начало, конец и напоминание убираются"
            >
              Без времени (весь день)
            </Button>
          </Disclose>
          <Disclose
            label="Напомнить"
            value={
              task.remindAt
                ? `${task.remindAt}${normalizeLead(task.remindLead) ? ` · ${leadShort(normalizeLead(task.remindLead))}` : ""}`
                : "Нет"
            }
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
            <div
              className="mt-2 flex flex-wrap gap-2"
              role="radiogroup"
              aria-label="Когда напомнить"
              data-testid="remind-lead"
            >
              {REMIND_LEADS.map((lead) => {
                const on = normalizeLead(task.remindLead) === lead;
                return (
                  <Chip
                    key={lead}
                    role="radio"
                    aria-checked={on}
                    disabled={!task.remindAt}
                    tone={on ? "on" : "outline"}
                    onClick={() => updateTask(task.id, { remindLead: lead })}
                    className="h-8 px-3 text-[0.8125rem]"
                  >
                    {leadShort(lead)}
                  </Chip>
                );
              })}
            </div>
          </Disclose>
          <Disclose
            label="Повтор"
            value={task.repeat ? repeatLabel(task.repeat, task.repeatDates) : "Нет"}
            open={open === "repeat"}
            onClick={() => toggle("repeat")}
          >
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
                <DateMultiPicker
                  value={task.repeatDates ?? []}
                  onChange={(dates) => setRepeatDates(task.id, dates)}
                />
              </div>
            ) : task.repeat ? (
              <p className="mt-1 text-caption text-secondary-label">
                Галочка ставит следующую дату, а не в архив.
              </p>
            ) : null}
          </Disclose>
        </GroupedCard>

        <GroupedCard className="mt-3">
          <Disclose
            label="Приоритет"
            value={level}
            open={open === "priority"}
            onClick={() => toggle("priority")}
          >
            <SegmentedControl
              label="Приоритет"
              options={LEVELS.map((item) => ({ id: String(item.value), label: item.label, tone: item.value === 3 ? ("danger" as const) : undefined }))}
              value={String(task.priority)}
              onChange={(id) => updateTask(task.id, { priority: Number(id) as Priority })}
            />
          </Disclose>
          <Disclose
            label="Список"
            value={listName}
            open={open === "list"}
            onClick={() => toggle("list")}
          >
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
          </Disclose>
        </GroupedCard>

        <GroupedCard className="mt-3">
          <ListRow
            title="Подробнее"
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
            expanded={more}
            onClick={() => setMore((value) => !value)}
          />
        </GroupedCard>
        {more ? (
          <div className="space-y-4">
            <GroupedCard className="mt-1">
              <Disclose
                label="Матрица"
                value={matrix}
                open={open === "matrix"}
                onClick={() => toggle("matrix")}
              >
                <div className="flex gap-2">
                  <Chip
                    tone={isImportant(task) ? "on" : "outline"}
                    aria-pressed={isImportant(task)}
                    onClick={() => updateTask(task.id, { important: !isImportant(task) })}
                    className="h-8 flex-1 justify-center text-body"
                  >
                    Важно
                  </Chip>
                  <Chip
                    tone={isUrgent(task) ? "on" : "outline"}
                    aria-pressed={isUrgent(task)}
                    onClick={() => updateTask(task.id, { urgent: !isUrgent(task) })}
                    className="h-8 flex-1 justify-center text-body"
                  >
                    Срочно
                  </Chip>
                </div>
              </Disclose>
              <Disclose
                label="Цвет"
                value={
                  <span className="inline-flex items-center gap-2">
                    {colorHex(task.color) ? (
                      <span
                        className="size-3 rounded-full"
                        style={{ background: colorHex(task.color)! }}
                      />
                    ) : null}
                    {colorLabel(task.color)}
                  </span>
                }
                open={open === "color"}
                onClick={() => toggle("color")}
              >
                <ColorPicker
                  bare
                  value={task.color}
                  onChange={(color) => updateTask(task.id, { color })}
                />
              </Disclose>
              <Disclose
                label="Проект"
                value={project?.title ?? "—"}
                open={open === "project"}
                onClick={() => toggle("project")}
              >
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
                      const existing = projects.find(
                        (item) => item.title.trim().toLowerCase() === title.toLowerCase(),
                      );
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
                    <Button type="submit" variant="primary" className="shrink-0">
                      Передать
                    </Button>
                  </form>
                ) : null}
              </Disclose>
              <Disclose
                label="Теги"
                value={task.tags.length ? task.tags.map((t) => `#${t}`).join(" ") : "—"}
                open={open === "tags"}
                onClick={() => toggle("tags")}
              >
                {task.tags.length ? (
                  <div className="mb-2 flex flex-wrap gap-2">
                    {task.tags.map((item) => (
                      <Chip
                        key={item}
                        tone="outline"
                        onClick={() =>
                          updateTask(task.id, {
                            tags: task.tags.filter((tagName) => tagName !== item),
                          })
                        }
                        className="h-8 px-3"
                      >
                        #{item} ×<span className="sr-only"> убрать</span>
                      </Chip>
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
                  <input
                    value={tag}
                    onChange={(event) => setTag(event.target.value)}
                    placeholder="Добавить тег, например «жду»"
                    aria-label="Добавить тег"
                    className={field}
                  />
                </form>
              </Disclose>
            </GroupedCard>

            <GroupedCard className="mt-3">
              {profile.multiUser && me ? (
                <Disclose
                  label="Совместная"
                  value={
                    task.assignee
                      ? `назначена: ${displayName(task.assignee, profile)}`
                      : (task.members ?? []).length
                        ? `участников: ${(task.members ?? []).length}`
                        : "только вы"
                  }
                  open={open === "share"}
                  onClick={() => toggle("share")}
                >
                  <TaskShareControls task={task} />
                </Disclose>
              ) : null}
              <Disclose label="Дублировать" open={open === "copy"} onClick={() => toggle("copy")}>
                <DuplicateControls task={task} onOpen={onOpen} />
              </Disclose>
            </GroupedCard>

            <TaskObjects task={task} projectContacts={project?.contacts ?? []} />
            <DependsBlock task={task} />
          </div>
        ) : null}

        <div className="mt-6">
          {foreign ? (
            <p className="mb-2 text-caption text-secondary-label">
              Задача {displayName(owner, profile)}.{" "}
              <Hint label="Что значит «Убрать у себя»">
                Она исчезнет только у вас и останется у владельца.
              </Hint>
            </p>
          ) : null}
          {confirm ? (
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setConfirm(false)}>
                Отменить
              </Button>
              <Button
                variant="destructive"
                className="flex-1"
                onClick={() => {
                  deleteTask(task.id);
                  onClose();
                }}
              >
                {foreign ? "Убрать" : "Удалить"}
              </Button>
            </div>
          ) : (
            <GroupedCard className="mt-0">
              <ListRow
                destructive
                chevron={false}
                title={foreign ? "Убрать у себя" : "Удалить задачу"}
                onClick={() => setConfirm(true)}
              />
            </GroupedCard>
          )}
        </div>
      </div>
    </div>
  );
}
