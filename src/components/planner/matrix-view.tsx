import { shortMaintTitle } from "@/lib/maintenance/short-title";
import { useEffect, useRef, useState, type FormEvent, type RefObject, type PointerEvent as ReactPointerEvent } from "react";
import { Check, Maximize2, Minimize2, MoveRight, Plus } from "lucide-react";
import { cn } from "@/lib/cn";
import { dueLabel, todayIso } from "@/lib/dates";
import { usePlanner } from "@/lib/planner-store";
import { setPopover, useDismiss, usePopoverStore } from "@/lib/popover";
import { isImportant, isUrgent, type Asset, type Task } from "@/lib/planner-types";
import { colorHex } from "@/lib/task-colors";
import { useDoneToast } from "@/lib/done-toast";

/**
 * Eisenhower matrix: four quadrants on one screen (also on a
 * 360 px phone), compact one-line rows, each quadrant scrolls by itself,
 * tap the header to open it full screen, quick add per quadrant. Moving: drag
 * with the mouse, or long-press (right click) → «Переместить в…».
 */
type Quad = { id: number; title: string; short: string; hint: string; example: string; important: boolean; urgent: boolean; color: string };

const QUADS: Quad[] = [
  { id: 0, title: "Срочно и важно", short: "Сделать сейчас", hint: "Горит и важно — делайте первым.", example: "Например: оплатить счёт до вечера", important: true, urgent: true, color: "#d50000" },
  { id: 1, title: "Важно, не срочно", short: "Запланировать", hint: "Важно для целей — дайте этому время.", example: "Например: план тренировок", important: true, urgent: false, color: "#f6a609" },
  { id: 2, title: "Срочно, не важно", short: "Быстро / поручить", hint: "Отвлекает, но горит — сделать быстро или поручить.", example: "Например: ответить на письмо", important: false, urgent: true, color: "#039be5" },
  { id: 3, title: "Не срочно, не важно", short: "Потом", hint: "Можно отложить или отказаться.", example: "Например: разобрать фото", important: false, urgent: false, color: "#33b679" },
];

function quadOf(task: Task): number {
  return QUADS.findIndex((quad) => isImportant(task) === quad.important && isUrgent(task) === quad.urgent);
}

type Menu = { taskId: string; title: string; x: number; y: number };

export function MatrixView({ selectedId, onOpen }: { selectedId: string | null; onOpen: (id: string) => void }) {
  const tasks = usePlanner((s) => s.tasks);
  const updateTask = usePlanner((s) => s.updateTask);
  const today = todayIso();
  const open = tasks.filter((task) => !task.done);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [menu, setMenuState] = useState<Menu | null>(null);
  const menuActive = usePopoverStore((s) => s.id === "matrix-menu");
  const setMenu = (next: Menu | null) => {
    setPopover("matrix-menu", next !== null);
    setMenuState(next);
  };
  // Another popover opened or the screen changed: this menu closes too.
  useEffect(() => {
    if (menu && !menuActive) setMenuState(null);
  }, [menu, menuActive]);
  const menuBoxRef = useRef<HTMLDivElement>(null);
  useDismiss(menu !== null, () => setMenu(null), [menuBoxRef]);
  const [drag, setDrag] = useState<{ id: string; title: string; x: number; y: number; over: number | null } | null>(null);

  function move(taskId: string, quad: number) {
    const target = QUADS[quad];
    if (!target) return;
    updateTask(taskId, { important: target.important, urgent: target.urgent });
  }

  const shown = expanded == null ? QUADS : QUADS.filter((quad) => quad.id === expanded);

  return (
    <div className="relative flex h-full min-h-[26rem] flex-col">
      <p className="mb-2 hidden text-xs text-muted sm:block">
        Нажмите на заголовок, чтобы развернуть квадрант. Перетащите задачу мышью в другой квадрант или удерживайте её — «Переместить в…».
      </p>
      <div className={cn("grid min-h-0 flex-1 gap-2 sm:gap-3", expanded == null ? "grid-cols-2 grid-rows-2" : "grid-cols-1 grid-rows-1")}>
        {shown.map((quad) => (
          <Quadrant
            key={quad.id}
            quad={quad}
            items={open.filter((task) => quadOf(task) === quad.id)}
            today={today}
            selectedId={selectedId}
            expanded={expanded === quad.id}
            dropOver={drag?.over === quad.id}
            onToggle={() => setExpanded(expanded === quad.id ? null : quad.id)}
            onOpen={onOpen}
            onMenu={setMenu}
            onDrag={setDrag}
            onDrop={move}
          />
        ))}
      </div>
      {menu ? <MoveMenu boxRef={menuBoxRef} menu={menu} tasks={open} onMove={move} onOpen={onOpen} onClose={() => setMenu(null)} /> : null}
      {drag && drag.over != null ? (
        <div
          className="pointer-events-none fixed z-50 max-w-48 truncate rounded-md border border-line bg-elevated px-3 py-2 text-sm text-fg shadow"
          style={{ left: drag.x + 12, top: drag.y + 12 }}
        >
          {drag.title}
        </div>
      ) : null}
    </div>
  );
}

function Quadrant({
  quad,
  items,
  today,
  selectedId,
  expanded,
  dropOver,
  onToggle,
  onOpen,
  onMenu,
  onDrag,
  onDrop,
}: {
  quad: Quad;
  items: Task[];
  today: string;
  selectedId: string | null;
  expanded: boolean;
  dropOver: boolean;
  onToggle: () => void;
  onOpen: (id: string) => void;
  onMenu: (menu: Menu) => void;
  onDrag: (drag: { id: string; title: string; x: number; y: number; over: number | null } | null) => void;
  onDrop: (taskId: string, quad: number) => void;
}) {
  const addTask = usePlanner((s) => s.addTask);
  const [draft, setDraft] = useState("");
  const sorted = [...items].sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999") || b.createdAt - a.createdAt);

  function add(event: FormEvent) {
    event.preventDefault();
    if (!draft.trim()) return;
    addTask({ title: draft, listId: null, due: null, important: quad.important, urgent: quad.urgent });
    setDraft("");
  }

  return (
    <section
      data-quad={quad.id}
      aria-label={quad.title}
      className={cn(
        "flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border bg-elevated",
        dropOver ? "border-accent ring-2 ring-accent" : "border-transparent",
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        title={expanded ? "Свернуть — показать все четыре" : "Развернуть на весь экран"}
        className="flex h-9 shrink-0 items-center gap-2 px-2 text-left sm:h-11 sm:px-3"
        style={{ background: `color-mix(in oklab, ${quad.color} 14%, var(--elevated))` }}
      >
        <span className="size-2 shrink-0 rounded-full" style={{ background: quad.color }} aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-xs font-semibold leading-tight text-fg sm:text-sm">{quad.title}</span>
        <span className="shrink-0 text-[0.6875rem] tabular-nums text-muted">{items.length}</span>
        {expanded ? <Minimize2 className="size-3.5 shrink-0 text-subtle" aria-hidden="true" /> : <Maximize2 className="hidden size-3.5 shrink-0 text-subtle sm:block" aria-hidden="true" />}
      </button>
      {expanded ? <p className="px-3 pt-1 text-xs text-muted">{quad.hint}</p> : null}
      <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 py-1">
        {sorted.length === 0 ? (
          <li className="px-2 py-2 text-[0.6875rem] leading-snug text-subtle sm:text-xs">
            {quad.short}. {quad.example}.
          </li>
        ) : null}
        {sorted.map((task) => (
          <MatrixRow
            key={task.id}
            task={task}
            quad={quad.id}
            today={today}
            selected={selectedId === task.id}
            roomy={expanded}
            onOpen={onOpen}
            onMenu={onMenu}
            onDrag={onDrag}
            onDrop={onDrop}
          />
        ))}
      </ul>
      <form onSubmit={add} className="flex shrink-0 items-center gap-1 border-t border-line px-2">
        <Plus className="size-3.5 shrink-0 text-subtle" aria-hidden="true" />
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={expanded ? quad.example : "Добавить"}
          aria-label={`Добавить в «${quad.title}»`}
          enterKeyHint="done"
          className="h-9 min-w-0 flex-1 bg-transparent text-[0.8125rem] text-fg outline-none placeholder:text-subtle"
        />
      </form>
    </section>
  );
}

const NO_ASSETS: Asset[] = [];

function MatrixRow({
  task,
  quad,
  today,
  selected,
  roomy,
  onOpen,
  onMenu,
  onDrag,
  onDrop,
}: {
  task: Task;
  quad: number;
  today: string;
  selected: boolean;
  roomy: boolean;
  onOpen: (id: string) => void;
  onMenu: (menu: Menu) => void;
  onDrag: (drag: { id: string; title: string; x: number; y: number; over: number | null } | null) => void;
  onDrop: (taskId: string, quad: number) => void;
}) {
  const assets = usePlanner((s) => s.assets) ?? NO_ASSETS;
  const toggleTask = usePlanner((s) => s.toggleTask);
  const showToast = useDoneToast((s) => s.show);
  const overdue = task.due != null && task.due < today;
  const dot = colorHex(task.color);
  const timer = useRef<number | null>(null);
  const longPressed = useRef(false);
  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);

  function down(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    longPressed.current = false;
    const { clientX: x0, clientY: y0, pointerType } = event;
    const handle = event.currentTarget;
    timer.current = window.setTimeout(() => {
      longPressed.current = true;
      onMenu({ taskId: task.id, title: task.title, x: x0, y: y0 });
    }, 500);
    if (pointerType !== "mouse") {
      // Touch: scrolling cancels the long press; moving is done via the menu.
      const cancel = (ev: PointerEvent) => {
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > 8 && timer.current) window.clearTimeout(timer.current);
      };
      const end = () => {
        if (timer.current) window.clearTimeout(timer.current);
        handle.removeEventListener("pointermove", cancel);
        handle.removeEventListener("pointerup", end);
        handle.removeEventListener("pointercancel", end);
      };
      handle.addEventListener("pointermove", cancel);
      handle.addEventListener("pointerup", end);
      handle.addEventListener("pointercancel", end);
      return;
    }
    // Mouse: drag into another quadrant.
    handle.setPointerCapture(event.pointerId);
    let moved = false;
    let over: number | null = null;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) > 6) {
        moved = true;
        if (timer.current) window.clearTimeout(timer.current);
      }
      if (!moved) return;
      const node = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>("[data-quad]");
      const next = node ? Number(node.dataset.quad) : null;
      over = next != null && Number.isFinite(next) ? next : null;
      onDrag({ id: task.id, title: task.title, x: ev.clientX, y: ev.clientY, over });
    };
    const finish = () => {
      if (timer.current) window.clearTimeout(timer.current);
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", finish);
      handle.removeEventListener("pointercancel", finish);
      onDrag(null);
      if (moved) {
        longPressed.current = true; // swallow the click
        if (over != null && over !== quad) onDrop(task.id, over);
      }
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
  }

  return (
    <li className={cn("flex items-center rounded-md", selected && "bg-surface")}>
      <button
        type="button"
        aria-label={`Выполнить: ${task.title}`}
        onClick={() => {
          toggleTask(task.id);
          const after = usePlanner.getState().tasks.find((t) => t.id === task.id);
          showToast({ id: task.id, title: task.title, repeat: Boolean(after && !after.done), next: after && !after.done ? after.due : null, at: Date.now() });
        }}
        className="flex size-8 shrink-0 items-center justify-center"
      >
        <span className="flex size-4 items-center justify-center rounded-full border-[1.5px] border-subtle">
          <Check className="size-2.5 opacity-0" aria-hidden="true" />
        </span>
      </button>
      <button
        type="button"
        onPointerDown={down}
        onClick={() => {
          if (longPressed.current) {
            longPressed.current = false;
            return;
          }
          onOpen(task.id);
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          onMenu({ taskId: task.id, title: task.title, x: event.clientX, y: event.clientY });
        }}
        className="drag-handle flex h-8 min-w-0 flex-1 select-none items-center gap-1 pr-1 text-left"
        style={{ WebkitTouchCallout: "none" }}
      >
        <span className={cn("min-w-0 flex-1 line-clamp-2 break-words text-fg", roomy ? "text-sm" : "text-[0.8125rem] leading-tight")}>{task.maint ? shortMaintTitle(task, assets) : task.title}</span>
        {dot ? <span className="size-1.5 shrink-0 rounded-full" style={{ background: dot }} aria-hidden="true" /> : null}
        {task.due && (roomy || task.due !== today) ? (
          <span className={cn("shrink-0 text-[0.625rem] tabular-nums", overdue ? "text-danger" : "text-subtle")}>{dueLabel(task.due, today)}</span>
        ) : null}
      </button>
    </li>
  );
}

function MoveMenu({
  boxRef,
  menu,
  tasks,
  onMove,
  onOpen,
  onClose,
}: {
  boxRef: RefObject<HTMLDivElement | null>;
  menu: Menu;
  tasks: Task[];
  onMove: (taskId: string, quad: number) => void;
  onOpen: (id: string) => void;
  onClose: () => void;
}) {
  const task = tasks.find((item) => item.id === menu.taskId);
  const current = task ? quadOf(task) : -1;
  return (
    <>
      <button type="button" aria-label="Закрыть меню" className="fixed inset-0 z-40 cursor-default bg-black/20" onClick={onClose} />
      <div
        ref={boxRef}
        role="menu"
        aria-label={`Переместить «${menu.title}»`}
        className="fixed inset-x-3 bottom-20 z-50 rounded-2xl bg-elevated p-2 shadow-lg sm:inset-x-auto sm:bottom-auto sm:w-64"
        style={typeof window !== "undefined" && window.innerWidth >= 640 ? { left: Math.min(menu.x, window.innerWidth - 270), top: Math.min(menu.y, window.innerHeight - 260) } : undefined}
      >
        <p className="truncate px-2 py-1 text-xs text-muted">«{menu.title}»</p>
        <p className="px-2 pt-1 text-xs font-medium text-subtle">Переместить в…</p>
        {QUADS.filter((quad) => quad.id !== current).map((quad) => (
          <button
            key={quad.id}
            type="button"
            role="menuitem"
            onClick={() => {
              onMove(menu.taskId, quad.id);
              onClose();
            }}
            className="flex h-11 w-full items-center gap-2 rounded-lg px-2 text-left text-sm hover:bg-surface"
          >
            <span className="size-2.5 rounded-full" style={{ background: quad.color }} aria-hidden="true" />
            <span className="flex-1">{quad.title}</span>
            <MoveRight className="size-4 text-subtle" aria-hidden="true" />
          </button>
        ))}
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            onOpen(menu.taskId);
            onClose();
          }}
          className="mt-1 flex h-11 w-full items-center rounded-lg border-t border-line px-2 text-left text-sm text-muted hover:bg-surface"
        >
          Открыть задачу
        </button>
      </div>
    </>
  );
}
