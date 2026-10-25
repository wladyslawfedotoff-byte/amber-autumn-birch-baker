import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, FolderKanban, Flag, Sunrise, Trash2, PanelBottomOpen } from "lucide-react";
import { cn } from "@/lib/cn";
import { dueLabel, shiftIso, todayIso } from "@/lib/dates";
import { haptic } from "@/lib/haptics";
import { usePlanner } from "@/lib/planner-store";
import type { Priority, Task } from "@/lib/planner-types";

const PRIORITIES: { value: Priority; label: string; ring: string }[] = [
  { value: 0, label: "Нет", ring: "border-subtle" },
  { value: 1, label: "Низкий", ring: "border-accent" },
  { value: 2, label: "Средний", ring: "border-warn" },
  { value: 3, label: "Высокий", ring: "border-danger" },
];

/**
 * Long-press menu on a task row (iOS context menu, 1.18): the row is shown
 * lifted above a dimmed list, with the quick actions next to it. Every action
 * reuses an existing store action; nothing new is stored.
 */
export function TaskContextMenu({ task, rect, onClose, onOpen }: { task: Task; rect: DOMRect; onClose: () => void; onOpen: (id: string) => void }) {
  const updateTask = usePlanner((s) => s.updateTask);
  const deleteTask = usePlanner((s) => s.deleteTask);
  const sendTaskToProject = usePlanner((s) => s.sendTaskToProject);
  const projects = usePlanner((s) => s.projects) ?? [];
  const [page, setPage] = useState<"main" | "projects">("main");
  const [confirm, setConfirm] = useState(false);
  const today = todayIso();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const run = (fn: () => void) => () => {
    haptic("select");
    fn();
    onClose();
  };
  // Preview where the row was (clamped to the screen); menu below it, or above when there is no room.
  const vh = typeof window === "undefined" ? 800 : window.innerHeight;
  const menuH = page === "projects" ? Math.min(320, 52 + projects.length * 44) : 290;
  const previewTop = Math.max(12, Math.min(rect.top, vh - menuH - rect.height - 24));
  const below = previewTop + rect.height + 8 + menuH < vh;
  const item = "flex h-11 w-full items-center gap-3 px-4 text-left text-[15px] text-fg active:bg-fg/10";

  return createPortal(
    <div
      className="fixed inset-0 z-[85]"
      role="presentation"
      // React events bubble out of portals: keep taps here away from the row's swipe / open handlers.
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <button type="button" aria-label="Закрыть меню задачи" className="absolute inset-0 bg-black/25 backdrop-blur-[2px]" onClick={onClose} />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute flex items-start gap-3 rounded-xl bg-elevated px-3 py-2.5 shadow-[0_12px_32px_rgb(0_0_0/0.25)]"
        style={{ top: previewTop, left: rect.left, width: rect.width, animation: "ctx-in 160ms var(--ease)" }}
      >
        <span className={cn("mt-0.5 size-[1.125rem] shrink-0 rounded-full border-2", PRIORITIES[task.priority]?.ring)} />
        <span className="min-w-0">
          <span className="block text-[15px] leading-snug text-fg">{task.title}</span>
          {task.due ? <span className="text-xs text-muted">{dueLabel(task.due, today)}</span> : null}
        </span>
      </div>
      <div
        role="menu"
        aria-label={`Действия: ${task.title}`}
        className="ctx-menu absolute w-64 overflow-hidden rounded-[14px] shadow-[0_12px_40px_rgb(0_0_0/0.25)]"
        style={below ? { top: previewTop + rect.height + 8, left: Math.max(12, rect.left) } : { top: Math.max(12, previewTop - menuH - 8), left: Math.max(12, rect.left) }}
      >
        {page === "main" ? (
          <>
            {!task.done ? (
              <button type="button" role="menuitem" className={item} onClick={run(() => updateTask(task.id, { due: shiftIso(today, 1) }))}>
                <span className="flex-1">Завтра</span>
                <Sunrise className="size-5 text-muted" />
              </button>
            ) : null}
            <div className="border-t border-line/70 px-4 pt-2 pb-2.5">
              <p className="flex items-center justify-between pb-1.5 text-xs text-muted">
                Приоритет <Flag className="size-4" />
              </p>
              <div className="flex gap-1.5" role="group" aria-label="Приоритет">
                {PRIORITIES.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    role="menuitemradio"
                    aria-checked={task.priority === p.value}
                    aria-label={`Приоритет: ${p.label}`}
                    title={p.label}
                    onClick={run(() => updateTask(task.id, { priority: p.value }))}
                    className={cn(
                      "flex h-11 flex-1 items-center justify-center rounded-lg",
                      task.priority === p.value ? "bg-fg/10" : "active:bg-fg/10",
                    )}
                  >
                    <span className={cn("size-[1.125rem] rounded-full border-2", p.ring)} />
                  </button>
                ))}
              </div>
            </div>
            {projects.length > 0 ? (
              <button type="button" role="menuitem" className={cn(item, "border-t border-line/70")} onClick={() => setPage("projects")}>
                <span className="flex-1">В проект</span>
                <FolderKanban className="size-5 text-muted" />
                <ChevronRight className="-mr-1 size-4 text-subtle" />
              </button>
            ) : null}
            <button type="button" role="menuitem" className={cn(item, "border-t border-line/70")} onClick={run(() => onOpen(task.id))}>
              <span className="flex-1">Открыть</span>
              <PanelBottomOpen className="size-5 text-muted" />
            </button>
            <button
              type="button"
              role="menuitem"
              className={cn(item, "border-t-[6px] border-fg/5 text-danger")}
              onClick={() => {
                if (!confirm) {
                  haptic("warn");
                  setConfirm(true);
                  return;
                }
                run(() => deleteTask(task.id))();
              }}
            >
              <span className="flex-1">{confirm ? "Точно удалить?" : "Удалить"}</span>
              <Trash2 className="size-5" />
            </button>
          </>
        ) : (
          <>
            <button type="button" className={cn(item, "text-accent")} onClick={() => setPage("main")}>
              <ChevronLeft className="-ml-1 size-5" />
              <span className="flex-1">В проект</span>
            </button>
            <div className="max-h-64 overflow-y-auto">
              {projects.map((project) => (
                <button key={project.id} type="button" role="menuitem" className={cn(item, "border-t border-line/70")} onClick={run(() => sendTaskToProject(task.id, project.id))}>
                  <span className="min-w-0 flex-1 truncate">{project.title}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
