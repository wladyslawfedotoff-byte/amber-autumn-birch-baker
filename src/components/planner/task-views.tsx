import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Archive, ChevronDown, ChevronRight, GripVertical, Lock, RotateCcw, Trash2 } from "lucide-react";
import { TodayStrip, TodaySummary, WeekDays } from "@/components/planner/today-strip";
import { AddTaskForm, TaskRow } from "@/components/planner/task-row";
import { RowWindow } from "@/components/planner/row-window";
import { Button } from "@/components/ui/button";
import { InlineHint } from "@/components/ui/hint";
import { AllDone, Empty } from "@/components/planner/empty-state";
import { canBoard } from "@/lib/ui-prefs";
import { cn } from "@/lib/cn";
import { dueLabel, formatShortDay, shiftIso, todayIso, occursOn } from "@/lib/dates";
import { hideBlockedIn, isBlocked } from "@/lib/task-deps";
import { setShowBlocked, useShowBlocked } from "@/lib/use-show-blocked";
import { usePlanner } from "@/lib/planner-store";
import type { Priority, Task, View } from "@/lib/planner-types";
import { byNewest, doneInScope, matchesQuery, scopeTasks } from "@/lib/queries";
import { archiveOptionLabel, archivedTasks, recentDone, repeatTickedOn } from "@/lib/task-done";
import { syncNow } from "@/lib/sync/clock";
import { ListShareBar } from "@/components/planner/sharing";
import { useShareScope } from "@/lib/use-share-scope";

function defaultsFor(view: View, today: string): { listId: string | null; due: string | null } {
  if (view.startsWith("list:")) return { listId: view.slice(5), due: null };
  if (view === "tomorrow") return { listId: null, due: shiftIso(today, 1) };
  if (view.startsWith("day:")) return { listId: null, due: view.slice(4) };
  if (view === "today" || view === "week") return { listId: null, due: today };
  return { listId: null, due: null };
}


export function TaskViews({
  view,
  query,
  selectedId,
  onOpen,
  onPickDay,
  board: boardMode = false,
}: {
  /** «Доска» chosen with the icon in the header (lists that can be a board). */
  board?: boolean;
  view: View;
  query: string;
  selectedId: string | null;
  onOpen: (id: string) => void;
  onPickDay: (day: string) => void;
}) {
  const tasks = usePlanner((s) => s.tasks);
  const lists = usePlanner((s) => s.lists);
  const addTask = usePlanner((s) => s.addTask);
  const updateTask = usePlanner((s) => s.updateTask);
  const today = todayIso();
  const archiveDays = usePlanner((s) => s.archiveDays);
  const doneFolded = usePlanner((s) => s.doneFolded);
  const setDoneFolded = usePlanner((s) => s.setDoneFolded);
  const now = syncNow();
  const searching = query.trim().length > 0;
  const board = canBoard(view) && boardMode && !searching;

  const found = searching
    ? tasks.filter((task) => matchesQuery(task, query, lists)).sort(byNewest)
    : [];
  const share = useShareScope();
  const showBlocked = useShowBlocked();
  const open = scopeTasks(tasks, view, today, share, { showBlocked }).sort(byNewest);
  const hiddenBlocked = showBlocked || !hideBlockedIn(view) ? 0 : scopeTasks(tasks, view, today, share, { showBlocked: true }).length - open.length;
  const done = doneInScope(tasks, view, today, share, { now, archiveDays });
  const currentList = view.startsWith("list:") ? lists.find((list) => list.id === view.slice(5)) : undefined;
  const doneBlock =
    !searching && done.length > 0 && view !== "done" && view !== "archive" ? (
      <section className="mt-4" aria-label="Готово">
        <button
          type="button"
          aria-expanded={!doneFolded}
          onClick={() => setDoneFolded(!doneFolded)}
          className="flex h-10 items-center gap-1 rounded-md px-1 text-xs font-semibold uppercase text-subtle hover:text-fg"
        >
          {doneFolded ? <ChevronRight className="size-4" aria-hidden="true" /> : <ChevronDown className="size-4" aria-hidden="true" />}
          Готово · <span className="tabular-nums">{done.length}</span>
        </button>
        {doneFolded ? null : (
          <>
            <RowWindow items={done}>{(task) => (
              <TaskRow
                key={task.id}
                task={task}
                today={today}
                selected={selectedId === task.id}
                showDue={view !== "today"}
                showList={view === "today" || view === "inbox" || view === "week"}
                onOpen={onOpen}
                ticked={!task.done && repeatTickedOn(task, today)}
              />
            )}</RowWindow>
            <InlineHint label="Куда уходят выполненные" className="mt-1">
              {archiveDays > 0
                ? `Выполненные задачи уходят в «Архив» ${archiveOptionLabel(archiveDays)} — срок меняется в «Настройках».`
                : "Автоархив выключен — выполненные задачи остаются здесь. Включить можно в «Настройках»."}
            </InlineHint>
          </>
        )}
      </section>
    ) : null;
  const canAdd = !searching && view !== "done" && view !== "archive" && view !== "calendar" && view !== "focus" && view !== "habits";

  const blockedToggle =
    !searching && (hiddenBlocked > 0 || (showBlocked && hideBlockedIn(view) && open.some((task) => isBlocked(task, tasks)))) ? (
      <button
        type="button"
        onClick={() => setShowBlocked(!showBlocked)}
        aria-pressed={showBlocked}
        className="mb-1 flex h-9 items-center gap-2 rounded-full px-2 text-xs text-muted hover:text-fg"
        data-testid="blocked-toggle"
      >
        <Lock className="size-3.5" aria-hidden="true" />
        {showBlocked ? "Скрыть ждущие" : `Ждут другого дела: ${hiddenBlocked} · показать`}
      </button>
    ) : null;

  return (
    <div>
      {currentList && !searching ? <ListShareBar list={currentList} /> : null}
      {blockedToggle}
      {view === "shared" && !searching ? (
        <InlineHint label="Что сюда попадает" className="mb-1">
          Задачи, которые видите не только вы: совместные, назначенные и из общих списков. Поделиться — откройте задачу → «Совместная» или
          «Назначить»; целый список — в его заголовке.
        </InlineHint>
      ) : null}
      {canAdd && view !== "today" && view !== "shared" ? (
        <AddTaskForm
            className="hidden md:block"
          placeholder="Созвон завтра в 10"
          onAdd={(title, quick) =>
            addTask({
              title,
              ...quick,
              ...defaultsFor(view, today),
              tags: view.startsWith("tag:") ? [view.slice(4)] : undefined,
            })
          }
        />
      ) : null}

      {searching ? (
        <div className="mt-2">
          {found.length === 0 ? (
            <Empty title="Ничего не нашлось" hint="Попробуйте другое слово, тег или название списка." />
          ) : (
            <RowWindow items={found}>{(task) => (
              <TaskRow
                key={task.id}
                task={task}
                today={today}
                selected={selectedId === task.id}
                showDue
                showList
                onOpen={onOpen}
              />
            )}</RowWindow>
          )}
        </div>
      ) : view === "week" && !board ? (
        <WeekGroups tasks={open} today={today} selectedId={selectedId} onOpen={onOpen} />
      ) : view === "today" ? (
        <>
          <TodaySummary />
          <AddTaskForm
            className="hidden md:block"
            placeholder="Созвон завтра в 10"
            onAdd={(title, quick) => addTask({ title, ...quick, ...defaultsFor(view, today) })}
          />
          <TodayGroups tasks={open} today={today} selectedId={selectedId} onOpen={onOpen} />
          {doneBlock}
          <TodayStrip onPick={onPickDay} />
        </>
      ) : view.startsWith("day:") ? (
        <>
          <WeekDays selected={view.slice(4)} onPick={onPickDay} />
          <div className="mt-2">
            <AddTaskForm
            className="hidden md:block"
              placeholder="Задача на этот день"
              onAdd={(title, quick) => addTask({ title, ...quick, due: view.slice(4), listId: null })}
            />
          </div>
          {open.length === 0 ? (
            <Empty title="На этот день пусто" hint="Добавьте задачу или перенесите сюда с другого дня." />
          ) : (
            <div className="mt-2">
              <RowWindow items={open}>{(task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  today={today}
                  selected={selectedId === task.id}
                  showDue={false}
                  showList
                  onOpen={onOpen}
                />
              )}</RowWindow>
            </div>
          )}
        </>
      ) : board ? (
        <PriorityBoard tasks={open} today={today} selectedId={selectedId} onOpen={onOpen} onPriority={(id, priority) => updateTask(id, { priority, important: priority >= 2 })} />
      ) : open.length === 0 && view === "shared" ? (
        <Empty
          title="Общих задач пока нет"
          hint="Откройте любую задачу и отметьте человека в «Совместная» — она появится здесь у обоих. Или «Назначить», чтобы поручить."
        />
      ) : view === "archive" ? (
        <ArchiveList tasks={archivedTasks(tasks, now, archiveDays)} archiveDays={archiveDays} today={today} selectedId={selectedId} onOpen={onOpen} />
      ) : open.length === 0 && view !== "done" ? (
        <Empty
          title={
            view === "inbox" ? "Входящие пусты" : view === "tomorrow" ? "На завтра пусто" : view.startsWith("tag:") ? "С этим тегом пусто" : "Список пуст"
          }
          hint={share ? "Добавьте задачу — она видна только вам, пока вы ею не поделитесь." : "Добавьте задачу — она сохранится на вашем сервере и появится на всех устройствах."}
        />
      ) : view === "done" ? (
        doneAll(recentDone(tasks, now, archiveDays), selectedId, today, onOpen, archiveDays)
      ) : (
        <div className="mt-2">
          <RowWindow items={open}>{(task) => (
            <TaskRow
              key={task.id}
              task={task}
              today={today}
              selected={selectedId === task.id}
              showDue
              showList={view.startsWith("tag:") || view === "shared"}
              onOpen={onOpen}
            />
          )}</RowWindow>
        </div>
      )}

      {view === "today" ? null : doneBlock}
    </div>
  );
}

function doneAll(
  items: Task[],
  selectedId: string | null,
  today: string,
  onOpen: (id: string) => void,
  archiveDays: number,
) {
  if (items.length === 0) {
    return (
      <Empty
        title="Пока пусто"
        hint="Нажмите на кружок слева от задачи — она зачеркнётся и появится здесь. Старые выполненные лежат в «Архиве»."
      />
    );
  }
  return (
    <div>
      <InlineHint label="Как вернуть задачу" className="mb-1">
        {archiveDays > 0
          ? `Выполненные за последние дни. Через ${archiveOptionLabel(archiveDays).replace("через ", "")} после выполнения задача уходит в «Архив».`
          : "Все выполненные задачи. Автоархив выключен в «Настройках»."}{" "}
        Кружок слева — вернуть задачу в работу.
      </InlineHint>
      <RowWindow items={items}>{(task) => (
        <TaskRow
          key={task.id}
          task={task}
          today={today}
          selected={selectedId === task.id}
          showDue
          showList
          onOpen={onOpen}
        />
      )}</RowWindow>
    </div>
  );
}

/** Local calendar day of a timestamp («2026-10-25»). */
function localIso(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function TodayGroups({
  tasks,
  today,
  selectedId,
  onOpen,
}: {
  tasks: Task[];
  today: string;
  selectedId: string | null;
  onOpen: (id: string) => void;
}) {
  const overdue = tasks.filter((task) => task.due != null && task.due < today);
  const current = tasks.filter((task) => task.due === today);
  const doneToday = usePlanner((s) => s.tasks.reduce((n, t) => (t.done && t.completedAt && localIso(t.completedAt) === today ? n + 1 : n), 0));
  if (overdue.length === 0 && current.length === 0) {
    return doneToday > 0 ? <AllDone title="Всё сделано" hint="На сегодня дел больше нет. Можно выдохнуть." /> : <AllDone title="День свободен" hint="Ничего не запланировано — хорошая пауза." />;
  }
  return (
    <div>
      {overdue.length > 0 ? (
        <section className="mt-3">
          <h2 className="px-1 pb-1 text-xs font-semibold uppercase tracking-wide text-muted">Просрочено</h2>
          <RowWindow items={overdue}>{(task) => (
            <TaskRow
              key={task.id}
              task={task}
              today={today}
              selected={selectedId === task.id}
              showDue
              showList
              foldSubtasks
              onOpen={onOpen}
            />
          )}</RowWindow>
        </section>
      ) : null}
      {current.length > 0 ? (
        <section className="mt-3">
          <h2 className="px-1 pb-1 text-xs font-semibold uppercase tracking-wide text-subtle">На сегодня</h2>
          <RowWindow items={[...current].sort((a, b) => (a.startAt ?? a.remindAt ?? "99:99").localeCompare(b.startAt ?? b.remindAt ?? "99:99"))}>
            {(task) => (
            <TaskRow
              key={task.id}
              task={task}
              today={today}
              selected={selectedId === task.id}
              showDue={false}
              showList
              foldSubtasks
              onOpen={onOpen}
            />
          )}
          </RowWindow>
        </section>
      ) : null}
    </div>
  );
}

function WeekGroups({
  tasks,
  today,
  selectedId,
  onOpen,
}: {
  tasks: Task[];
  today: string;
  selectedId: string | null;
  onOpen: (id: string) => void;
}) {
  const days = Array.from({ length: 7 }, (_, index) => shiftIso(today, index));
  const groups = days
    .map((day) => ({ day, items: tasks.filter((task) => occursOn(task, day)) }))
    .filter((group) => group.items.length > 0);
  if (groups.length === 0) {
    return <Empty title="Неделя свободна" hint="Задачи с датой на ближайшие 7 дней появятся здесь." />;
  }
  return (
    <div>
      {groups.map((group) => (
        <section key={group.day} className="mt-3">
          <h2 className={cn("px-1 pb-1 text-xs font-semibold uppercase tracking-wide", group.day === today ? "text-accent" : "text-subtle")}>
            {group.day === today ? "Сегодня · " : group.day === shiftIso(today, 1) ? "Завтра · " : ""}
            {formatShortDay(group.day, true)}
          </h2>
          {group.items.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              today={today}
              selected={selectedId === task.id}
              showDue={false}
              showList
              onOpen={onOpen}
            />
          ))}
        </section>
      ))}
    </div>
  );
}

const COLUMNS: { priority: Priority; title: string }[] = [
  { priority: 3, title: "Высокий" },
  { priority: 2, title: "Средний" },
  { priority: 1, title: "Низкий" },
  { priority: 0, title: "Без приоритета" },
];

function PriorityBoard({
  tasks,
  today,
  selectedId,
  onOpen,
  onPriority,
}: {
  tasks: Task[];
  today: string;
  selectedId: string | null;
  onOpen: (id: string) => void;
  onPriority: (id: string, priority: Priority) => void;
}) {
  const [over, setOver] = useState<Priority | null>(null);
  const [ghost, setGhost] = useState<{ title: string; x: number; y: number } | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

  function begin(event: ReactPointerEvent<HTMLElement>, task: Task) {
    if (event.button !== 0) return;
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startY = event.clientY;
    let moved = false;
    let target = task.priority;
    const move = (ev: PointerEvent) => {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > 8) moved = true;
      if (!moved) return;
      const node = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>("[data-priority]");
      const next = Number(node?.dataset.priority);
      if (next === 0 || next === 1 || next === 2 || next === 3) target = next as Priority;
      setOver(target);
      setGhost({ title: task.title, x: ev.clientX, y: ev.clientY });
      const scroller = scrollerRef.current;
      if (!scroller) return;
      const rect = scroller.getBoundingClientRect();
      if (ev.clientX < rect.left + 36) scroller.scrollLeft -= 18;
      else if (ev.clientX > rect.right - 36) scroller.scrollLeft += 18;
    };
    const finish = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", finish);
      handle.removeEventListener("pointercancel", finish);
      if (moved && target !== task.priority) onPriority(task.id, target);
      else if (!moved) onOpen(task.id);
      setOver(null);
      setGhost(null);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
  }

  return (
    <div className="mt-1">
      <InlineHint label="Как переставлять">Потяните карточку за любое место в другую колонку — у задачи сменится приоритет. Нажатие открывает задачу.</InlineHint>
      <div ref={scrollerRef} className="no-scrollbar -mx-4 mt-1 flex snap-x snap-mandatory scroll-px-4 gap-2 overflow-x-auto px-4 pb-2 md:mx-0 md:px-0">
        {COLUMNS.map((column) => {
          const items = tasks.filter((task) => task.priority === column.priority);
          return (
            <section
              key={column.priority}
              data-priority={column.priority}
              className={cn(
                "flex w-[80vw] max-w-72 shrink-0 snap-start flex-col rounded-xl bg-bg p-2 ring-1",
                over === column.priority ? "ring-accent" : "ring-transparent",
              )}
            >
              <p className="flex h-8 items-center justify-between px-1 text-xs font-semibold uppercase text-subtle">
                {column.title}
                <span className="tabular-nums">{items.length}</span>
              </p>
              <ul className="flex min-h-16 flex-col gap-1">
                {items.map((task) => (
                  <li key={task.id}>
                    <div
                      className={cn(
                        "drag-handle rounded-lg bg-elevated px-3 py-2",
                        selectedId === task.id && "ring-1 ring-accent",
                      )}
                      onPointerDown={(event) => begin(event, task)}
                    >
                      <span className="flex items-start gap-2">
                        <GripVertical className="mt-1 size-3.5 shrink-0 text-subtle" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-[0.9375rem] leading-snug text-fg">{task.title}</span>
                          <span className="mt-1 block text-[0.75rem] text-muted">
                            {task.due ? dueLabel(task.due, today) : "без даты"}
                          </span>
                        </span>
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
      {ghost ? (
        <div
          className="pointer-events-none fixed z-50 max-w-48 truncate rounded-md border border-line bg-elevated px-3 py-2 text-sm"
          style={{ left: ghost.x + 12, top: ghost.y + 12 }}
        >
          {ghost.title}
        </div>
      ) : null}
    </div>
  );
}

function ArchiveList({
  tasks,
  archiveDays,
  today,
  selectedId,
  onOpen,
}: {
  tasks: Task[];
  archiveDays: number;
  today: string;
  selectedId: string | null;
  onOpen: (id: string) => void;
}) {
  const restoreTask = usePlanner((s) => s.restoreTask);
  const deleteTask = usePlanner((s) => s.deleteTask);
  const deleteTasks = usePlanner((s) => s.deleteTasks);
  const [confirm, setConfirm] = useState<string | null>(null);
  if (tasks.length === 0) {
    return (
      <Empty
        title="Архив пуст"
        hint={
          archiveDays > 0
            ? `Сюда попадают выполненные задачи ${archiveOptionLabel(archiveDays)} после выполнения. Их можно вернуть в работу или удалить насовсем.`
            : "Автоархив выключен. Включите его в «Настройках» — например, «через 7 дней», — и старые выполненные задачи перестанут мешать."
        }
      />
    );
  }
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <p className="min-w-0 flex-1 text-xs text-subtle">
          <Archive className="mr-1 inline size-3.5 align-text-bottom" aria-hidden="true" />
          {tasks.length} в архиве · «↺» — снова в работу
        </p>
        {confirm === "all" ? (
          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              deleteTasks(tasks.map((task) => task.id));
              setConfirm(null);
            }}
          >
            Удалить все {tasks.length}
          </Button>
        ) : (
          <Button variant="ghost" size="sm" className="text-muted" onClick={() => setConfirm("all")}>
            Очистить архив
          </Button>
        )}
      </div>
      {tasks.map((task) => (
        <div key={task.id} className="mb-1 flex items-start gap-1">
          <div className="min-w-0 flex-1">
            <TaskRow task={task} today={today} selected={selectedId === task.id} showDue showList onOpen={onOpen} />
          </div>
          <Button size="icon" variant="ghost" aria-label={`Вернуть «${task.title}» в работу`} title="Вернуть в работу" onClick={() => restoreTask(task.id)}>
            <RotateCcw className="size-4" />
          </Button>
          {confirm === task.id ? (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                deleteTask(task.id);
                setConfirm(null);
              }}
            >
              Удалить
            </Button>
          ) : (
            <Button size="icon" variant="ghost" aria-label={`Удалить «${task.title}»`} title="Удалить насовсем" onClick={() => setConfirm(task.id)}>
              <Trash2 className="size-4" />
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}
