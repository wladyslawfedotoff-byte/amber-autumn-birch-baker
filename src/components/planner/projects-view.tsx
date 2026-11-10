import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ArrowDown, ArrowUp, CalendarRange, ChevronLeft, ChevronRight, ListChecks, Lock, MoreHorizontal, Plus, X } from "lucide-react";
import { CheckCircle, FIELD, GroupedCard, ListRow, SectionHeader, TextField } from "@/components/ui/kit";
import { InlineHint } from "@/components/ui/hint";
import { Sheet } from "@/components/ui/sheet";
import { Empty } from "@/components/planner/empty-state";
import { Fab } from "@/components/planner/quick-composer";
import { TaskContextMenu } from "@/components/planner/task-menu";
import { AttachmentsBlock } from "@/components/planner/objects/attachments";
import { ContactsBlock } from "@/components/planner/objects/contacts";
import { cn } from "@/lib/cn";
import { dueLabel, formatRange, formatShortDay, todayIso } from "@/lib/dates";
import { showUndo } from "@/lib/done-toast";
import { haptic } from "@/lib/haptics";
import { usePlanner } from "@/lib/planner-store";
import type { Project, ProjectStage, Task } from "@/lib/planner-types";
import { pluralN } from "@/lib/plural";
import { boardOf, projectProgress } from "@/lib/projects";
import { isBlocked } from "@/lib/task-deps";
import { progressLabel, subtaskProgress } from "@/lib/task-tools";

/** Hold (ms) before a touch picks a card up (iOS-like); moving earlier scrolls the board. */
const HOLD_MS = 350;
/** Finger travel (px) that turns a press into a scroll (before the hold) or a drag (after). */
const SLOP = 8;

function spanLabel(project: Project): string {
  if (project.start && project.end) return formatRange(project.start, project.end);
  if (project.start) return `с ${formatShortDay(project.start)}`;
  if (project.end) return `до ${formatShortDay(project.end)}`;
  return "Без дат";
}

export function ProjectsView({
  initialId = null,
  onOpenChange,
  onOpenTask,
}: {
  initialId?: string | null;
  /** The project on screen (null — the list); «Помощник» uses it for «Разбей проект на шаги». */
  onOpenChange?: (id: string | null) => void;
  /** Tap on a card: the same task sheet as everywhere. */
  onOpenTask?: (id: string) => void;
}) {
  const projects = usePlanner((s) => s.projects) ?? NO_PROJECTS;
  const tasks = usePlanner((s) => s.tasks);
  const [openId, setOpenId] = useState<string | null>(initialId);
  useEffect(() => {
    onOpenChange?.(openId);
  }, [openId, onOpenChange]);
  // The board closes with the project (deleted here or on another device).
  useEffect(() => {
    return () => onOpenChange?.(null);
  }, [onOpenChange]);
  const [creating, setCreating] = useState(false);
  const project = projects.find((item) => item.id === openId) ?? null;

  if (project) return <ProjectBoard project={project} onBack={() => setOpenId(null)} onOpenTask={onOpenTask} />;

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="mb-2 hidden justify-end md:flex">
        <button type="button" onClick={() => setCreating(true)} className="hit flex h-8 items-center gap-1 rounded-full bg-accent/10 px-3 text-caption font-medium text-accent-ink">
          <Plus className="size-4" aria-hidden="true" /> Новый проект
        </button>
      </div>
      {projects.length === 0 ? (
        <Empty title="Пока нет проектов" hint="Проект — дело длиннее одного дня, с этапами. Нажмите «+», чтобы создать." />
      ) : (
        <ul className="menu-card overflow-hidden rounded-card">
          {projects.map((item) => {
            const { done, total } = projectProgress(item, tasks);
            return (
              <li key={item.id} className="border-line not-first:border-t">
                <button type="button" onClick={() => setOpenId(item.id)} className="flex min-h-11 w-full items-center gap-3 px-3 py-2 text-left">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body font-medium">{item.title || "Без названия"}</span>
                    <span className="mt-1 flex items-center gap-2 text-caption text-muted">
                      <span className="shrink-0">{spanLabel(item)}</span>
                      <span className="h-1 min-w-8 flex-1 overflow-hidden rounded-full bg-bg" aria-hidden="true">
                        <span className="block h-full rounded-full bg-accent" style={{ width: `${total ? Math.round((done / total) * 100) : 0}%` }} />
                      </span>
                      <span className="shrink-0 tabular-nums" aria-label={`Готово ${done} из ${total}`}>
                        {done}/{total}
                      </span>
                    </span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-subtle" aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <Fab label="Новый проект" onClick={() => setCreating(true)} />
      <NewProjectSheet open={creating} onClose={() => setCreating(false)} onCreated={setOpenId} />
    </div>
  );
}

const NO_PROJECTS: Project[] = [];
const NO_META: Meta = { due: "", steps: "" };

function NewProjectSheet({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const addProject = usePlanner((s) => s.addProject);
  const updateProject = usePlanner((s) => s.updateProject);
  const [title, setTitle] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const ok = title.trim().length > 0;
  const save = () => {
    if (!ok) return;
    const id = addProject(title.trim());
    if (start || end) updateProject(id, { start: start || null, end: end || null });
    setTitle("");
    setStart("");
    setEnd("");
    onClose();
    onCreated(id);
  };
  return (
    <Sheet open={open} title="Новый проект" onClose={onClose} action={{ label: "Создать", onClick: save, disabled: !ok }}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <input
          autoFocus
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Например: ремонт кухни"
          aria-label="Название проекта"
          enterKeyHint="done"
          className={cn(FIELD, "border-separator")}
        />
        <DateRows start={start} end={end} onStart={setStart} onEnd={setEnd} />
        <p className="mt-2 px-1 text-caption text-secondary-label">Этапы «Сделать → В работе → Готово» появятся сами, их можно переименовать.</p>
      </form>
    </Sheet>
  );
}

function DateRows({ start, end, onStart, onEnd }: { start: string; end: string; onStart: (v: string) => void; onEnd: (v: string) => void }) {
  return (
    <div className="mt-3 menu-card overflow-hidden rounded-card text-body">
      <label className="flex min-h-11 items-center gap-3 px-3">
        <span className="flex-1">Начало</span>
        <input type="date" aria-label="Начало" value={start} onChange={(event) => onStart(event.target.value)} style={{ minWidth: "8.5rem" }} className="h-9 rounded-lg bg-surface px-2 text-right outline-none" />
      </label>
      <label className="flex min-h-11 items-center gap-3 border-t border-separator px-3">
        <span className="flex-1">Конец</span>
        <input type="date" aria-label="Конец" value={end} onChange={(event) => onEnd(event.target.value)} style={{ minWidth: "8.5rem" }} className="h-9 rounded-lg bg-surface px-2 text-right outline-none" />
      </label>
    </div>
  );
}

/**
 * A name field that may be emptied while typing: an empty name on leaving the
 * field goes back to the previous one (stage and project names).
 */
function NameInput({ value, onCommit, className, label }: { value: string; onCommit: (next: string) => void; className?: string; label: string }) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);
  const commit = () => {
    const clean = draft.trim();
    if (!clean) setDraft(value);
    else if (clean !== value) onCommit(clean);
  };
  return (
    <input
      aria-label={label}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onFocus={() => {
        focused.current = true;
      }}
      onBlur={() => {
        focused.current = false;
        commit();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") (event.target as HTMLInputElement).blur();
        if (event.key === "Escape") {
          setDraft(value);
          focused.current = false;
        }
      }}
      enterKeyHint="done"
      autoComplete="off"
      className={className}
    />
  );
}

/** «+ Новое дело» / «+ Новый этап»: Enter adds and keeps the field; leaving the field (iPhone «Готово») adds too. */
function AddField({ placeholder, label, onAdd, className }: { placeholder: string; label: string; onAdd: (title: string) => void; className?: string }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const clean = draft.trim();
    if (!clean) return;
    onAdd(clean);
    setDraft("");
  };
  return (
    <form
      className={cn("flex items-center gap-2", className)}
      onSubmit={(event) => {
        event.preventDefault();
        add();
      }}
    >
      <Plus className="size-4 shrink-0 text-tertiary-label" aria-hidden="true" />
      <input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={add}
        placeholder={placeholder}
        aria-label={label}
        enterKeyHint="done"
        autoComplete="off"
        className="h-11 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-tertiary-label"
      />
    </form>
  );
}

type Drag = { taskId: string; title: string; x: number; y: number; over: string | null };

function ProjectBoard({ project, onBack, onOpenTask }: { project: Project; onBack: () => void; onOpenTask?: (id: string) => void }) {
  const tasks = usePlanner((s) => s.tasks);
  const renameStage = usePlanner((s) => s.renameStage);
  const addCard = usePlanner((s) => s.addCard);
  const moveCard = usePlanner((s) => s.moveCard);
  const cardTask = usePlanner((s) => s.cardTask);
  const toggleTask = usePlanner((s) => s.toggleTask);
  const [settings, setSettings] = useState(false);
  const [menu, setMenu] = useState<{ taskId: string; rect: DOMRect } | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [lifted, setLifted] = useState<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  /** The click that ends a long press or a drag must not open the card. */
  const swallow = useRef(false);
  const columns = useMemo(() => boardOf(project, tasks), [project, tasks]);
  const { done, total } = projectProgress(project, tasks);
  const today = todayIso();
  const menuTask = menu ? tasks.find((task) => task.id === menu.taskId) : undefined;

  /** The task behind a board item (an old plain card becomes a task here). */
  const resolve = (id: string, legacy: boolean): string | null => (legacy ? cardTask(project.id, id) : id);

  function openCard(id: string, legacy: boolean) {
    const taskId = resolve(id, legacy);
    if (taskId) onOpenTask?.(taskId);
  }

  function dropAt(taskId: string, x: number, y: number) {
    const column = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-stage]");
    const stageId = column?.dataset.stage;
    if (!column || !stageId) return;
    let beforeId: string | null = null;
    for (const node of column.querySelectorAll<HTMLElement>("[data-card]")) {
      if (node.dataset.card === taskId) continue;
      const rect = node.getBoundingClientRect();
      if (y < rect.top + rect.height / 2) {
        beforeId = node.dataset.card ?? null;
        break;
      }
    }
    moveCard(project.id, taskId, stageId, beforeId);
    haptic("select");
  }

  function press(event: ReactPointerEvent<HTMLElement>, id: string, title: string, legacy: boolean) {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest("[data-nodrag]")) return;
    const el = event.currentTarget;
    const pointer = event.pointerId;
    const touch = event.pointerType !== "mouse";
    const sx = event.clientX;
    const sy = event.clientY;
    // Mouse: drag at once (as before). Touch: only after the hold, so a swipe scrolls the board.
    let armed = !touch;
    let dragging = false;
    let taskId: string | null = legacy ? null : id;
    let x = sx;
    let y = sy;
    const hold = touch
      ? window.setTimeout(() => {
          armed = true;
          haptic("select");
          setLifted(id);
        }, HOLD_MS)
      : 0;
    // Once a card is held, the finger moves the card, not the page.
    const stopScroll = (ev: TouchEvent) => {
      if (armed && ev.cancelable) ev.preventDefault();
    };
    el.addEventListener("touchmove", stopScroll, { passive: false });
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pointer) return;
      x = ev.clientX;
      y = ev.clientY;
      const dist = Math.hypot(x - sx, y - sy);
      if (!armed) {
        if (dist > SLOP) cleanup();
        return;
      }
      if (!dragging) {
        if (dist <= SLOP) return;
        taskId = taskId ?? resolve(id, legacy);
        if (!taskId) return cleanup();
        dragging = true;
      }
      const over = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-stage]")?.dataset.stage ?? null;
      setDrag({ taskId: taskId!, title, x, y, over });
      const scroller = scrollerRef.current;
      if (scroller) {
        const rect = scroller.getBoundingClientRect();
        if (x < rect.left + 36) scroller.scrollLeft -= 18;
        else if (x > rect.right - 36) scroller.scrollLeft += 18;
      }
    };
    const finish = (ev: PointerEvent) => {
      if (ev.pointerId !== pointer) return;
      const wasArmed = armed;
      const wasDragging = dragging;
      cleanup();
      if (ev.type === "pointercancel") return;
      if (wasDragging && taskId) {
        swallowClick();
        dropAt(taskId, x, y);
      } else if (touch && wasArmed) {
        // Held and released in place: the card's menu.
        swallowClick();
        const resolved = taskId ?? resolve(id, legacy);
        if (resolved) setMenu({ taskId: resolved, rect: el.getBoundingClientRect() });
      }
    };
    function cleanup() {
      window.clearTimeout(hold);
      el.removeEventListener("touchmove", stopScroll);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      armed = false;
      dragging = false;
      setLifted(null);
      setDrag(null);
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  }

  /** The click the browser sends after a hold or a drop lands on whatever is under the finger now
   *  (the menu's backdrop, another card) — eat it before anyone sees it. */
  function swallowClick() {
    swallow.current = true;
    const eat = (ev: MouseEvent) => {
      ev.preventDefault();
      ev.stopPropagation();
      window.removeEventListener("click", eat, true);
    };
    window.addEventListener("click", eat, true);
    window.setTimeout(() => {
      swallow.current = false;
      window.removeEventListener("click", eat, true);
    }, 400);
  }

  function tick(id: string, legacy: boolean) {
    const taskId = resolve(id, legacy);
    if (!taskId) return;
    haptic("tick");
    toggleTask(taskId);
  }

  return (
    <div className="flex flex-col">
      <div className="-mx-2 flex items-center gap-1">
        <button type="button" onClick={onBack} className="flex h-11 shrink-0 items-center gap-0.5 rounded-full pr-2 text-body text-accent-ink">
          <ChevronLeft className="size-5" aria-hidden="true" />
          Проекты
        </button>
        <span className="flex-1" />
        <button
          type="button"
          aria-label="Проект: название, этапы, даты"
          title="Проект"
          onClick={() => setSettings(true)}
          className="flex size-11 shrink-0 items-center justify-center rounded-full text-accent-ink"
        >
          <MoreHorizontal className="size-5" />
        </button>
      </div>
      <div className="flex items-center gap-2 text-caption text-secondary-label">
        <button type="button" onClick={() => setSettings(true)} className="hit flex h-8 items-center gap-2 rounded-full bg-elevated px-3">
          <CalendarRange className="size-3.5" aria-hidden="true" />
          {spanLabel(project)}
        </button>
        <span className="h-1 flex-1 overflow-hidden rounded-full bg-elevated" aria-hidden="true">
          <span className="block h-full rounded-full bg-accent" style={{ width: `${total ? Math.round((done / total) * 100) : 0}%` }} />
        </span>
        <span className="tabular-nums" aria-label={`Готово ${done} из ${total}`}>
          {done}/{total}
        </span>
      </div>
      <InlineHint label="Как пользоваться" className="mt-1">
        Нажмите на карточку — откроется задача. Кружок — выполнить: дело уйдёт в последний этап. Удерживайте карточку и ведите — перенесёте в другой этап; удержали и отпустили — меню. Этапы, контакты и файлы — в «•••».
      </InlineHint>

      <div ref={scrollerRef} className="no-scrollbar -mx-4 mt-1 flex snap-x snap-mandatory scroll-px-4 items-start gap-2 overflow-x-auto px-4 pb-2 md:mx-0 md:px-0">
        {columns.map(({ stage, tasks: items, cards }) => (
          <section
            key={stage.id}
            data-stage={stage.id}
            aria-label={`Этап ${stage.title}`}
            className={cn("flex w-[80vw] max-w-72 shrink-0 snap-start flex-col rounded-xl bg-bg p-2 ring-1", drag?.over === stage.id ? "ring-accent" : "ring-transparent")}
          >
            <div className="flex items-center gap-1">
              <NameInput
                label={`Название этапа ${stage.title}`}
                value={stage.title}
                onCommit={(name) => renameStage(project.id, stage.id, name)}
                className="h-11 min-w-0 flex-1 bg-transparent px-1 text-base font-semibold outline-none"
              />
              <span className="px-1 text-caption tabular-nums text-tertiary-label">{items.length + cards.length}</span>
            </div>
            <ul className="flex min-h-11 flex-col gap-1">
              {items.map((task) => (
                <BoardCard
                  key={task.id}
                  id={task.id}
                  title={task.title}
                  done={task.done}
                  meta={metaOf(task, today)}
                  blocked={!task.done && Boolean(task.dependsOn) && isBlocked(task, tasks)}
                  lifted={lifted === task.id}
                  ghost={drag?.taskId === task.id}
                  onPress={(event) => press(event, task.id, task.title, false)}
                  onOpen={() => {
                    if (!swallow.current) openCard(task.id, false);
                  }}
                  onTick={() => tick(task.id, false)}
                  onMenu={(rect) => setMenu({ taskId: task.id, rect })}
                />
              ))}
              {cards.map((card) => (
                <BoardCard
                  key={card.id}
                  id={card.id}
                  title={card.title}
                  done={false}
                  meta={NO_META}
                  blocked={false}
                  lifted={lifted === card.id}
                  ghost={false}
                  onPress={(event) => press(event, card.id, card.title, true)}
                  onOpen={() => {
                    if (!swallow.current) openCard(card.id, true);
                  }}
                  onTick={() => tick(card.id, true)}
                  onMenu={(rect) => {
                    const taskId = resolve(card.id, true);
                    if (taskId) setMenu({ taskId, rect });
                  }}
                />
              ))}
            </ul>
            <AddField className="mt-1 px-1" placeholder="Новое дело" label={`Новое дело в «${stage.title}»`} onAdd={(title) => addCard(project.id, stage.id, title)} />
          </section>
        ))}
      </div>

      <ProjectSheet project={project} open={settings} onClose={() => setSettings(false)} onDeleted={onBack} />
      {menu && menuTask ? <TaskContextMenu task={menuTask} rect={menu.rect} onClose={() => setMenu(null)} onOpen={(id) => onOpenTask?.(id)} /> : null}
      {drag ? (
        <div className="pointer-events-none fixed z-50 max-w-56 truncate rounded-lg bg-elevated px-3 py-2 text-body text-label shadow-lg" style={{ left: drag.x + 12, top: drag.y + 12 }}>
          {drag.title}
        </div>
      ) : null}
    </div>
  );
}

type Meta = { due: string; steps: string };

function metaOf(task: Task, today: string): Meta {
  return { due: task.due ? dueLabel(task.due, today) : "", steps: progressLabel(subtaskProgress(task)) };
}

/** One card on the board: a task with its circle (the same task sheet opens on tap). */
function BoardCard({
  id,
  title,
  done,
  meta,
  blocked,
  lifted,
  ghost,
  onPress,
  onOpen,
  onTick,
  onMenu,
}: {
  id: string;
  title: string;
  done: boolean;
  meta: Meta;
  blocked: boolean;
  lifted: boolean;
  ghost: boolean;
  onPress: (event: ReactPointerEvent<HTMLElement>) => void;
  onOpen: () => void;
  onTick: () => void;
  onMenu: (rect: DOMRect) => void;
}) {
  const ref = useRef<HTMLLIElement>(null);
  return (
    <li
      ref={ref}
      data-card={id}
      onPointerDown={onPress}
      onContextMenu={(event) => {
        // Right click (and Android long-press): the card's menu instead of the browser one.
        event.preventDefault();
        if (ref.current) onMenu(ref.current.getBoundingClientRect());
      }}
      className={cn(
        "group flex touch-manipulation items-start rounded-lg bg-elevated transition-[transform,box-shadow,opacity] duration-150 select-none [-webkit-touch-callout:none]",
        lifted && "scale-[1.02] shadow-lg",
        ghost && "opacity-40",
      )}
    >
      <button
        type="button"
        data-nodrag=""
        aria-label={done ? `Вернуть в работу: ${title}` : `Выполнить: ${title}`}
        aria-pressed={done}
        onClick={onTick}
        className="flex size-11 shrink-0 items-center justify-center"
      >
        <CheckCircle checked={done} />
      </button>
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 py-2.5 pr-3 text-left">
        <span className={cn("block text-body leading-snug break-words", done ? "text-tertiary-label line-through" : "text-label")}>
          {blocked ? <Lock className="mr-1 inline size-3.5 text-warn" aria-label="Ждёт другого дела" /> : null}
          {title || "Без названия"}
        </span>
        {meta.due || meta.steps ? (
          <span className="mt-0.5 flex items-center gap-2 text-caption text-secondary-label">
            {meta.due ? <span>{meta.due}</span> : null}
            {meta.steps ? (
              <span className="inline-flex items-center gap-1">
                <ListChecks className="size-3" aria-hidden="true" />
                {meta.steps}
              </span>
            ) : null}
          </span>
        ) : null}
      </button>
    </li>
  );
}

/** «•••»: everything about the project in one sheet. */
function ProjectSheet({ project, open, onClose, onDeleted }: { project: Project; open: boolean; onClose: () => void; onDeleted: () => void }) {
  const updateProject = usePlanner((s) => s.updateProject);
  const deleteProject = usePlanner((s) => s.deleteProject);
  const undoDeleteProject = usePlanner((s) => s.undoDeleteProject);
  const addStage = usePlanner((s) => s.addStage);
  const renameStage = usePlanner((s) => s.renameStage);
  const moveStage = usePlanner((s) => s.moveStage);
  const deleteStage = usePlanner((s) => s.deleteStage);
  const restoreStage = usePlanner((s) => s.restoreStage);
  const tasks = usePlanner((s) => s.tasks);
  const count = useMemo(() => {
    const out = new Map<string, number>();
    for (const column of boardOf(project, tasks)) out.set(column.stage.id, column.tasks.length + column.cards.length);
    return out;
  }, [project, tasks]);

  const removeStage = (stage: ProjectStage) => {
    const deleted = deleteStage(project.id, stage.id);
    if (!deleted) return;
    haptic("warn");
    const text = deleted.count ? `Этап «${stage.title}» удалён, ${pluralN(deleted.count, ["дело", "дела", "дел"])} — в «${deleted.into}»` : `Этап «${stage.title}» удалён`;
    showUndo(`stage:${stage.id}`, text, () => restoreStage(deleted));
  };
  const removeProject = () => {
    const deleted = deleteProject(project.id);
    if (!deleted) return;
    haptic("warn");
    onClose();
    onDeleted();
    const n = deleted.tasks.length;
    const name = project.title || "Без названия";
    showUndo(`project:${project.id}`, n ? `Проект «${name}» и ${pluralN(n, ["дело", "дела", "дел"])} удалены` : `Проект «${name}» удалён`, () => undoDeleteProject(deleted));
  };
  const button = "flex size-11 shrink-0 items-center justify-center rounded-full text-secondary-label disabled:opacity-30";

  return (
    <Sheet open={open} title="Проект" closeLabel="Закрыть" onClose={onClose}>
      <ProjectName project={project} onCommit={(title) => updateProject(project.id, { title })} />
      <DateRows
        start={project.start ?? ""}
        end={project.end ?? ""}
        onStart={(value) => updateProject(project.id, { start: value || null })}
        onEnd={(value) => updateProject(project.id, { end: value || null })}
      />
      <p className="mt-2 px-1 text-caption text-secondary-label">Даты видны в «Расписании» и «Календаре». Без дат проект просто лежит в списке.</p>

      <GroupedCard title="Этапы">
        {project.stages.map((stage, index) => (
          <li key={stage.id} className="flex items-center gap-1 pl-3">
            <NameInput
              label={`Название этапа ${stage.title}`}
              value={stage.title}
              onCommit={(name) => renameStage(project.id, stage.id, name)}
              className="h-11 min-w-0 flex-1 bg-transparent text-body outline-none"
            />
            <span className="px-1 text-caption tabular-nums text-tertiary-label">{count.get(stage.id) ?? 0}</span>
            <button type="button" aria-label={`Выше: ${stage.title}`} disabled={index === 0} onClick={() => moveStage(project.id, stage.id, -1)} className={button}>
              <ArrowUp className="size-4" />
            </button>
            <button type="button" aria-label={`Ниже: ${stage.title}`} disabled={index === project.stages.length - 1} onClick={() => moveStage(project.id, stage.id, 1)} className={button}>
              <ArrowDown className="size-4" />
            </button>
            <button type="button" aria-label={`Удалить этап ${stage.title}`} disabled={project.stages.length < 2} onClick={() => removeStage(stage)} className={cn(button, "text-danger")}>
              <X className="size-4" />
            </button>
          </li>
        ))}
        <li className="px-3">
          <AddField placeholder="Новый этап" label="Новый этап" onAdd={(title) => addStage(project.id, title)} />
        </li>
      </GroupedCard>
      {project.stages.length > 1 ? (
        <p className="mt-1 px-1 text-caption text-secondary-label">
          «{project.stages[project.stages.length - 1]!.title}» — последний этап: дела там считаются выполненными. У удалённого этапа дела переходят в первый.
        </p>
      ) : null}

      <div className="mt-4">
        <SectionHeader title="Контакты и файлы" />
        <ContactsBlock projectId={project.id} contacts={project.contacts ?? []} />
        <AttachmentsBlock kind="project" parentId={project.id} items={project.attachments ?? []} />
      </div>

      <GroupedCard className="mt-4">
        <ListRow title="Удалить проект" destructive onClick={removeProject} chevron={false} />
      </GroupedCard>
      <p className="mt-1 px-1 text-caption text-secondary-label">Вместе с его делами. Пять секунд можно «Вернуть».</p>
    </Sheet>
  );
}

function ProjectName({ project, onCommit }: { project: Project; onCommit: (title: string) => void }) {
  const [draft, setDraft] = useState(project.title);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(project.title);
  }, [project.title]);
  return (
    <TextField
      label="Название"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onFocus={() => {
        focused.current = true;
      }}
      onBlur={() => {
        focused.current = false;
        const clean = draft.trim();
        if (!clean) setDraft(project.title);
        else if (clean !== project.title) onCommit(clean);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") (event.target as HTMLInputElement).blur();
      }}
      enterKeyHint="done"
      autoComplete="off"
    />
  );
}
