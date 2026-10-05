import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ChevronLeft, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { formatShort } from "@/lib/dates";
import { usePlanner } from "@/lib/planner-store";
import type { Project, ProjectCard } from "@/lib/planner-types";

function spanLabel(project: Project): string {
  if (project.start && project.end) return `${formatShort(project.start)} — ${formatShort(project.end)}`;
  if (project.start) return `с ${formatShort(project.start)}`;
  if (project.end) return `до ${formatShort(project.end)}`;
  return "Без дат";
}

function progress(project: Project): string {
  const cards = project.stages.flatMap((stage) => stage.cards);
  if (cards.length === 0) return "Пока пусто";
  const last = project.stages[project.stages.length - 1];
  const done = last ? last.cards.length : 0;
  return `${done} из ${cards.length} на последнем этапе`;
}

export function ProjectsView({ initialId = null }: { initialId?: string | null }) {
  const projects = usePlanner((s) => s.projects) ?? [];
  const addProject = usePlanner((s) => s.addProject);
  const updateProject = usePlanner((s) => s.updateProject);
  const deleteProject = usePlanner((s) => s.deleteProject);
  const addStage = usePlanner((s) => s.addStage);
  const renameStage = usePlanner((s) => s.renameStage);
  const deleteStage = usePlanner((s) => s.deleteStage);
  const addCard = usePlanner((s) => s.addCard);
  const moveCard = usePlanner((s) => s.moveCard);
  const deleteCard = usePlanner((s) => s.deleteCard);
  const [openId, setOpenId] = useState<string | null>(initialId);
  const [name, setName] = useState("");
  const [stageName, setStageName] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [over, setOver] = useState<string | null>(null);
  const [ghost, setGhost] = useState<{ title: string; x: number; y: number } | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const project = projects.find((item) => item.id === openId) ?? null;

  function beginCard(event: ReactPointerEvent<HTMLElement>, card: ProjectCard, fromStage: string) {
    if (!project || event.button !== 0) return;
    if ((event.target as HTMLElement).closest("[data-nodrag]")) return;
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startY = event.clientY;
    let active = false;
    let target = fromStage;
    const move = (ev: PointerEvent) => {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > 8) active = true;
      const node = document.elementFromPoint(ev.clientX, ev.clientY)?.closest("[data-stage]");
      target = node?.getAttribute("data-stage") ?? fromStage;
      setOver(active ? target : null);
      setGhost(active ? { title: card.title, x: ev.clientX, y: ev.clientY } : null);
      const scroller = scrollerRef.current;
      if (scroller && active) {
        const rect = scroller.getBoundingClientRect();
        if (ev.clientX < rect.left + 36) scroller.scrollLeft -= 18;
        else if (ev.clientX > rect.right - 36) scroller.scrollLeft += 18;
      }
    };
    const finish = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", finish);
      handle.removeEventListener("pointercancel", finish);
      if (active && target !== fromStage) moveCard(project.id, card.id, target);
      setOver(null);
      setGhost(null);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
  }

  if (!project) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const id = addProject(name);
            setName("");
            if (name.trim()) setOpenId(id);
          }}
        >
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Новый проект"
            aria-label="Новый проект"
            className="h-11 min-w-0 flex-1 rounded-md border border-line bg-elevated px-3 text-base outline-none placeholder:text-subtle"
          />
          <Button type="submit" variant="primary" disabled={!name.trim()}>
            Создать
          </Button>
        </form>
        {projects.length === 0 ? (
          <div className="px-2 py-16 text-center">
            <p className="font-display text-2xl tracking-tight">Пока нет проектов</p>
            <p className="mt-2 text-sm text-muted">Проект длиннее одного дня. Карточку перетащите в другой этап.</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {projects.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => {
                    setConfirm(false);
                    setOpenId(item.id);
                  }}
                  className="flex w-full flex-col items-start rounded-lg border border-line bg-elevated px-4 py-3 text-left"
                >
                  <span className="text-sm font-medium">{item.title}</span>
                  <span className="mt-1 text-xs text-muted">{spanLabel(item)}</span>
                  <span className="text-xs text-subtle">{progress(item)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Button
          size="icon"
          variant="ghost"
          aria-label="К списку проектов"
          onClick={() => {
            setOpenId(null);
            setConfirm(false);
          }}
        >
          <ChevronLeft className="size-5" />
        </Button>
        <input
          aria-label="Название проекта"
          value={project.title}
          onChange={(event) => updateProject(project.id, { title: event.target.value })}
          onBlur={() => {
            if (!project.title.trim()) updateProject(project.id, { title: "Без названия" });
          }}
          className="min-w-0 flex-1 bg-transparent font-display text-3xl tracking-tight outline-none"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs font-medium text-subtle">
          Начало
          <input
            type="date"
            value={project.start ?? ""}
            onChange={(event) => updateProject(project.id, { start: event.target.value || null })}
            className="mt-2 h-11 w-full rounded-md border border-line bg-elevated px-3 text-base text-fg"
          />
        </label>
        <label className="block text-xs font-medium text-subtle">
          Конец
          <input
            type="date"
            value={project.end ?? ""}
            onChange={(event) => updateProject(project.id, { end: event.target.value || null })}
            className="mt-2 h-11 w-full rounded-md border border-line bg-elevated px-3 text-base text-fg"
          />
        </label>
      </div>

      <p className="text-xs text-muted">Потяните карточку в другой этап.</p>
      <div ref={scrollerRef} className="flex gap-2 overflow-x-auto pb-2">
        {project.stages.map((stage) => (
          <section
            key={stage.id}
            data-stage={stage.id}
            className={cn(
              "flex w-64 shrink-0 snap-start flex-col rounded-lg border bg-bg p-3",
              over === stage.id ? "border-accent" : "border-line",
            )}
          >
            <input
              aria-label={`Этап ${stage.title}`}
              value={stage.title}
              onChange={(event) => renameStage(project.id, stage.id, event.target.value)}
              className="h-11 w-full bg-transparent text-sm font-medium outline-none"
            />
            <ul className="mt-2 flex min-h-16 flex-col gap-2">
              {stage.cards.map((card) => (
                <li key={card.id}>
                  <div
                    className="drag-handle flex items-start gap-2 rounded-md border border-line bg-elevated p-3"
                    onPointerDown={(event) => beginCard(event, card, stage.id)}
                  >
                    <p className="min-w-0 flex-1 py-2 text-sm">{card.title}</p>
                    <button
                      type="button"
                      data-nodrag=""
                      aria-label={`Удалить ${card.title}`}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={() => deleteCard(project.id, card.id)}
                      className="flex size-11 shrink-0 items-center justify-center text-subtle"
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            <form
              className="mt-2"
              onSubmit={(event) => {
                event.preventDefault();
                const data = new FormData(event.currentTarget);
                addCard(project.id, stage.id, String(data.get("title") ?? ""));
                event.currentTarget.reset();
              }}
            >
              <input
                name="title"
                placeholder="Карточка"
                aria-label={`Карточка в ${stage.title}`}
                className="h-11 w-full rounded-md border border-line bg-elevated px-3 text-base outline-none placeholder:text-subtle"
              />
            </form>
            {project.stages.length > 1 ? (
              <button
                type="button"
                onClick={() => deleteStage(project.id, stage.id)}
                className="mt-2 h-11 text-left text-xs text-muted"
              >
                Убрать этап
              </button>
            ) : null}
          </section>
        ))}
      </div>

      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          addStage(project.id, stageName);
          setStageName("");
        }}
      >
        <input
          value={stageName}
          onChange={(event) => setStageName(event.target.value)}
          placeholder="Новый этап"
          aria-label="Новый этап"
          className="h-11 min-w-0 flex-1 rounded-md border border-line bg-elevated px-3 text-base outline-none placeholder:text-subtle"
        />
        <Button type="submit" variant="soft" disabled={!stageName.trim()}>
          Этап
        </Button>
      </form>

      {confirm ? (
        <div className="flex gap-2">
          <Button variant="soft" onClick={() => setConfirm(false)}>
            Отмена
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              deleteProject(project.id);
              setOpenId(null);
              setConfirm(false);
            }}
          >
            Удалить проект
          </Button>
        </div>
      ) : (
        <Button variant="ghost" className="self-start text-danger" onClick={() => setConfirm(true)}>
          Удалить проект
        </Button>
      )}
      {ghost ? (
        <div
          className="pointer-events-none fixed z-50 max-w-48 truncate rounded-md border border-line bg-elevated px-3 py-2 text-sm text-fg"
          style={{ left: ghost.x + 12, top: ghost.y + 12 }}
        >
          {ghost.title}
        </div>
      ) : null}
    </div>
  );
}
