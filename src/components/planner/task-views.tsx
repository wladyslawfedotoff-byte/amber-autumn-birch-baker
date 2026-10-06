import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { GripVertical } from "lucide-react";
import { TodayStrip, TodaySummary, WeekDays } from "@/components/planner/today-strip";
import { AddTaskForm, TaskRow } from "@/components/planner/task-row";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { dueLabel, formatLong, shiftIso, todayIso, occursOn } from "@/lib/dates";
import { usePlanner } from "@/lib/planner-store";
import type { Priority, Task, View } from "@/lib/planner-types";
import { byNewest, doneInScope, matchesQuery, scopeTasks } from "@/lib/queries";
import { ListShareBar } from "@/components/planner/sharing";
import { useShareScope } from "@/lib/use-share-scope";

function defaultsFor(view: View, today: string): { listId: string | null; due: string | null } {
  if (view.startsWith("list:")) return { listId: view.slice(5), due: null };
  if (view === "tomorrow") return { listId: null, due: shiftIso(today, 1) };
  if (view.startsWith("day:")) return { listId: null, due: view.slice(4) };
  if (view === "today" || view === "week") return { listId: null, due: today };
  return { listId: null, due: null };
}

function canBoard(view: View): boolean {
  return view === "inbox" || view === "tomorrow" || view === "week" || view.startsWith("list:") || view.startsWith("tag:");
}

function Empty({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="px-2 py-16 text-center">
      <p className="font-display text-2xl tracking-tight">{title}</p>
      <p className="mt-2 text-sm text-muted">{hint}</p>
    </div>
  );
}

export function TaskViews({
  view,
  query,
  selectedId,
  onOpen,
  onPickDay,
}: {
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
  const [showDone, setShowDone] = useState(false);
  const [mode, setMode] = useState<"list" | "board">("list");
  const searching = query.trim().length > 0;
  const board = canBoard(view) && mode === "board" && !searching;

  const found = searching
    ? tasks.filter((task) => matchesQuery(task, query, lists)).sort(byNewest)
    : [];
  const share = useShareScope();
  const open = scopeTasks(tasks, view, today, share).sort(byNewest);
  const done = doneInScope(tasks, view, today, share);
  const currentList = view.startsWith("list:") ? lists.find((list) => list.id === view.slice(5)) : undefined;
  const canAdd = !searching && view !== "done" && view !== "calendar" && view !== "focus" && view !== "habits";

  return (
    <div>
      {currentList && !searching ? <ListShareBar list={currentList} /> : null}
      {view === "shared" && !searching ? (
        <p className="mb-3 text-sm text-muted">
          Задачи, которые видите не только вы: совместные, назначенные и из общих списков. Поделиться — откройте задачу → «Совместная» или
          «Назначить»; целый список — в его заголовке.
        </p>
      ) : null}
      {canAdd && view !== "today" && view !== "shared" ? (
        <AddTaskForm
          placeholder="Созвон завтра в 10"
          onAdd={(title) =>
            addTask({
              title,
              ...defaultsFor(view, today),
              tags: view.startsWith("tag:") ? [view.slice(4)] : undefined,
            })
          }
        />
      ) : null}

      {canBoard(view) && !searching ? (
        <div className="mt-3 grid grid-cols-2 gap-1 rounded-md border border-line p-1">
          <button
            type="button"
            aria-pressed={mode === "list"}
            onClick={() => setMode("list")}
            className={cn("h-11 rounded-md text-sm", mode === "list" ? "bg-elevated font-medium text-fg" : "text-muted")}
          >
            Список
          </button>
          <button
            type="button"
            aria-pressed={mode === "board"}
            onClick={() => setMode("board")}
            className={cn("h-11 rounded-md text-sm", mode === "board" ? "bg-elevated font-medium text-fg" : "text-muted")}
          >
            Доска
          </button>
        </div>
      ) : null}

      {searching ? (
        <div className="mt-4">
          {found.length === 0 ? (
            <Empty title="Ничего не нашлось" hint="Попробуйте другое слово, тег или название списка." />
          ) : (
            found.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                today={today}
                selected={selectedId === task.id}
                showDue
                showList
                onOpen={onOpen}
              />
            ))
          )}
        </div>
      ) : view === "week" && !board ? (
        <WeekGroups tasks={open} today={today} selectedId={selectedId} onOpen={onOpen} />
      ) : view === "today" ? (
        <>
          <TodaySummary />
          <AddTaskForm
            placeholder="Созвон завтра в 10"
            onAdd={(title) => addTask({ title, ...defaultsFor(view, today) })}
          />
          <TodayGroups tasks={open} today={today} selectedId={selectedId} onOpen={onOpen} />
          <TodayStrip onPick={onPickDay} />
        </>
      ) : view.startsWith("day:") ? (
        <>
          <WeekDays selected={view.slice(4)} onPick={onPickDay} />
          <div className="mt-3">
            <AddTaskForm
              placeholder="Задача на этот день"
              onAdd={(title) => addTask({ title, due: view.slice(4), listId: null })}
            />
          </div>
          {open.length === 0 ? (
            <Empty title="На этот день пусто" hint="Добавьте задачу или перенесите сюда с другого дня." />
          ) : (
            <div className="mt-3">
              {open.map((task) => (
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
      ) : open.length === 0 && view !== "done" ? (
        <Empty
          title={
            view === "inbox" ? "Входящие пусты" : view === "tomorrow" ? "На завтра пусто" : view.startsWith("tag:") ? "С этим тегом пусто" : "Список пуст"
          }
          hint={share ? "Добавьте задачу — она видна только вам, пока вы ею не поделитесь." : "Добавьте задачу — она останется на этом устройстве."}
        />
      ) : view === "done" ? (
        doneAll(tasks, selectedId, today, onOpen)
      ) : (
        <div className="mt-3">
          {open.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              today={today}
              selected={selectedId === task.id}
              showDue
              showList={view.startsWith("tag:") || view === "shared"}
              onOpen={onOpen}
            />
          ))}
        </div>
      )}

      {!searching && done.length > 0 && view !== "done" ? (
        <div className="mt-6">
          <Button variant="ghost" className="text-muted" onClick={() => setShowDone((value) => !value)}>
            Выполнено · <span className="tabular-nums">{done.length}</span>
          </Button>
          {showDone
            ? done.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  today={today}
                  selected={selectedId === task.id}
                  showDue={view !== "today"}
                  showList={view === "today" || view === "inbox"}
                  onOpen={onOpen}
                />
              ))
            : null}
        </div>
      ) : null}
    </div>
  );
}

function doneAll(
  tasks: Task[],
  selectedId: string | null,
  today: string,
  onOpen: (id: string) => void,
) {
  const items = tasks.filter((task) => task.done).sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));
  if (items.length === 0) {
    return <Empty title="Пока пусто" hint="Выполненные задачи появятся здесь." />;
  }
  return (
    <div>
      {items.map((task) => (
        <TaskRow
          key={task.id}
          task={task}
          today={today}
          selected={selectedId === task.id}
          showDue
          showList
          onOpen={onOpen}
        />
      ))}
    </div>
  );
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
  if (overdue.length === 0 && current.length === 0) {
    return <Empty title="День свободен" hint="Добавьте задачу на сегодня — или оставьте паузу." />;
  }
  return (
    <div>
      {overdue.length > 0 ? (
        <section className="mt-5">
          <h2 className="px-1 font-display text-lg tracking-tight text-danger">Просрочено</h2>
          {overdue.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              today={today}
              selected={selectedId === task.id}
              showDue
              showList
              onOpen={onOpen}
            />
          ))}
        </section>
      ) : null}
      {current.length > 0 ? (
        <section className="mt-5">
          <h2 className="px-1 font-display text-lg tracking-tight text-fg">На сегодня</h2>
          {[...current]
            .sort((a, b) => (a.startAt ?? a.remindAt ?? "99:99").localeCompare(b.startAt ?? b.remindAt ?? "99:99"))
            .map((task) => (
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
        <section key={group.day} className="mt-5">
          <h2 className="px-3 text-sm font-medium text-muted">{formatLong(group.day)}</h2>
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
    <div className="mt-3">
      <p className="text-xs text-muted">Потяните карточку в другой приоритет.</p>
      <div ref={scrollerRef} className="mt-2 flex gap-2 overflow-x-auto pb-2">
        {COLUMNS.map((column) => {
          const items = tasks.filter((task) => task.priority === column.priority);
          return (
            <section
              key={column.priority}
              data-priority={column.priority}
              className={cn(
                "flex w-64 shrink-0 flex-col rounded-lg border bg-bg p-3",
                over === column.priority ? "border-accent" : "border-line",
              )}
            >
              <p className="flex h-11 items-center justify-between text-sm font-medium">
                {column.title}
                <span className="tabular-nums text-xs text-subtle">{items.length}</span>
              </p>
              <ul className="flex min-h-16 flex-col gap-2">
                {items.map((task) => (
                  <li key={task.id}>
                    <div
                      className={cn(
                        "drag-handle rounded-md border border-line bg-elevated px-3 py-3",
                        selectedId === task.id && "border-accent",
                      )}
                      onPointerDown={(event) => begin(event, task)}
                    >
                      <span className="flex items-start gap-2">
                        <GripVertical className="mt-0.5 size-4 shrink-0 text-subtle" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm text-fg">{task.title}</span>
                          <span className="mt-1 block text-xs text-muted">
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
