import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { CalendarRange, ChevronLeft, ChevronRight, MoreHorizontal, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InlineHint } from "@/components/ui/hint";
import { Sheet } from "@/components/ui/sheet";
import { Empty } from "@/components/planner/empty-state";
import { Fab } from "@/components/planner/quick-composer";
import { cn } from "@/lib/cn";
import { formatRange, formatShortDay } from "@/lib/dates";
import { usePlanner } from "@/lib/planner-store";
import type { Project, ProjectCard } from "@/lib/planner-types";
import { projectProgress } from "@/lib/projects";

function spanLabel(project: Project): string {
  if (project.start && project.end) return formatRange(project.start, project.end);
  if (project.start) return `с ${formatShortDay(project.start)}`;
  if (project.end) return `до ${formatShortDay(project.end)}`;
  return "Без дат";
}

export function ProjectsView({ initialId = null }: { initialId?: string | null }) {
  const projects = usePlanner((s) => s.projects) ?? [];
  const [openId, setOpenId] = useState<string | null>(initialId);
  const [creating, setCreating] = useState(false);
  const project = projects.find((item) => item.id === openId) ?? null;

  if (project) return <ProjectBoard project={project} onBack={() => setOpenId(null)} />;

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="mb-2 hidden justify-end md:flex">
        <Button variant="soft" size="sm" onClick={() => setCreating(true)}>
          <Plus className="size-4" /> Новый проект
        </Button>
      </div>
      {projects.length === 0 ? (
        <Empty title="Пока нет проектов" hint="Проект — дело длиннее одного дня, с этапами. Нажмите «+», чтобы создать." />
      ) : (
        <ul className="overflow-hidden rounded-xl bg-elevated">
          {projects.map((item) => {
            const { done, total } = projectProgress(item);
            return (
              <li key={item.id} className="border-line not-first:border-t">
                <button type="button" onClick={() => setOpenId(item.id)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.9375rem] font-medium">{item.title || "Без названия"}</span>
                    <span className="mt-0.5 flex items-center gap-2 text-[0.75rem] text-muted">
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
          className="h-11 w-full rounded-xl bg-elevated px-3 text-base outline-none placeholder:text-subtle"
        />
        <DateRows start={start} end={end} onStart={setStart} onEnd={setEnd} />
        <p className="mt-2 px-1 text-xs text-muted">Этапы «План → В работе → Готово» появятся сами, их можно переименовать.</p>
      </form>
    </Sheet>
  );
}

function DateRows({ start, end, onStart, onEnd }: { start: string; end: string; onStart: (v: string) => void; onEnd: (v: string) => void }) {
  return (
    <div className="mt-3 divide-y divide-line overflow-hidden rounded-xl bg-elevated text-[0.9375rem]">
      <label className="flex min-h-11 items-center gap-3 px-3">
        <span className="flex-1">Начало</span>
        <input type="date" aria-label="Начало" value={start} onChange={(event) => onStart(event.target.value)} style={{ minWidth: "8.5rem" }} className="h-9 rounded-lg bg-surface px-2 text-right outline-none" />
      </label>
      <label className="flex min-h-11 items-center gap-3 px-3">
        <span className="flex-1">Конец</span>
        <input type="date" aria-label="Конец" value={end} onChange={(event) => onEnd(event.target.value)} style={{ minWidth: "8.5rem" }} className="h-9 rounded-lg bg-surface px-2 text-right outline-none" />
      </label>
    </div>
  );
}

function ProjectBoard({ project, onBack }: { project: Project; onBack: () => void }) {
  const updateProject = usePlanner((s) => s.updateProject);
  const deleteProject = usePlanner((s) => s.deleteProject);
  const addStage = usePlanner((s) => s.addStage);
  const renameStage = usePlanner((s) => s.renameStage);
  const deleteStage = usePlanner((s) => s.deleteStage);
  const addCard = usePlanner((s) => s.addCard);
  const moveCard = usePlanner((s) => s.moveCard);
  const deleteCard = usePlanner((s) => s.deleteCard);
  const [stageName, setStageName] = useState("");
  const [settings, setSettings] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [over, setOver] = useState<string | null>(null);
  const [ghost, setGhost] = useState<{ title: string; x: number; y: number } | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const { done, total } = projectProgress(project);

  function beginCard(event: ReactPointerEvent<HTMLElement>, card: ProjectCard, fromStage: string) {
    if (event.button !== 0) return;
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

  return (
    <div className="flex flex-col">
      <div className="-mx-2 flex items-center gap-0.5">
        <button type="button" aria-label="К списку проектов" onClick={onBack} className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted">
          <ChevronLeft className="size-5" />
        </button>
        <input
          aria-label="Название проекта"
          value={project.title}
          onChange={(event) => updateProject(project.id, { title: event.target.value })}
          onBlur={() => {
            if (!project.title.trim()) updateProject(project.id, { title: "Без названия" });
          }}
          className="h-9 min-w-0 flex-1 bg-transparent text-lg font-semibold outline-none"
        />
        <button
          type="button"
          aria-label="Настройки проекта"
          onClick={() => setSettings(true)}
          className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted"
        >
          <MoreHorizontal className="size-5" />
        </button>
      </div>
      <div className="flex items-center gap-2 text-[0.75rem] text-muted">
        <button type="button" onClick={() => setSettings(true)} className="flex h-8 items-center gap-1.5 rounded-full bg-elevated px-2.5">
          <CalendarRange className="size-3.5" aria-hidden="true" />
          {spanLabel(project)}
        </button>
        <span className="h-1 flex-1 overflow-hidden rounded-full bg-elevated" aria-hidden="true">
          <span className="block h-full rounded-full bg-accent" style={{ width: `${total ? Math.round((done / total) * 100) : 0}%` }} />
        </span>
        <span className="tabular-nums">
          {done}/{total}
        </span>
      </div>
      <InlineHint label="Как пользоваться" className="mt-1">
        Потяните карточку в другой этап. Название этапа можно изменить, нажав на него. Карточки на последнем этапе считаются готовыми.
      </InlineHint>

      <div ref={scrollerRef} className="no-scrollbar -mx-4 mt-1 flex snap-x snap-mandatory scroll-px-4 items-start gap-2 overflow-x-auto px-4 pb-2 md:mx-0 md:px-0">
        {project.stages.map((stage) => (
          <section
            key={stage.id}
            data-stage={stage.id}
            className={cn("flex w-[80vw] max-w-72 shrink-0 snap-start flex-col rounded-xl bg-bg p-2 ring-1", over === stage.id ? "ring-accent" : "ring-transparent")}
          >
            <div className="flex items-center gap-1">
              <input
                aria-label={`Этап ${stage.title}`}
                value={stage.title}
                onChange={(event) => renameStage(project.id, stage.id, event.target.value)}
                className="h-8 min-w-0 flex-1 bg-transparent px-1 text-base font-semibold outline-none"
              />
              <span className="text-xs tabular-nums text-subtle">{stage.cards.length}</span>
              {project.stages.length > 1 ? (
                <button
                  type="button"
                  aria-label={`Убрать этап ${stage.title}`}
                  title="Убрать этап"
                  onClick={() => deleteStage(project.id, stage.id)}
                  className="flex size-8 items-center justify-center rounded-full text-subtle"
                >
                  <X className="size-3.5" />
                </button>
              ) : null}
            </div>
            <ul className="flex min-h-10 flex-col gap-1">
              {stage.cards.map((card) => (
                <li key={card.id}>
                  <div className="drag-handle flex items-start rounded-lg bg-elevated pl-2.5" onPointerDown={(event) => beginCard(event, card, stage.id)}>
                    <p className="min-w-0 flex-1 py-2 text-[0.9375rem] leading-snug">{card.title}</p>
                    <button
                      type="button"
                      data-nodrag=""
                      aria-label={`Удалить ${card.title}`}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={() => deleteCard(project.id, card.id)}
                      className="flex size-9 shrink-0 items-center justify-center text-subtle"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            <form
              className="mt-1 flex items-center gap-1.5 px-1"
              onSubmit={(event) => {
                event.preventDefault();
                const data = new FormData(event.currentTarget);
                addCard(project.id, stage.id, String(data.get("title") ?? ""));
                event.currentTarget.reset();
              }}
            >
              <Plus className="size-4 shrink-0 text-subtle" aria-hidden="true" />
              <input
                name="title"
                placeholder="Карточка"
                aria-label={`Карточка в ${stage.title}`}
                enterKeyHint="done"
                className="h-9 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-subtle"
              />
            </form>
          </section>
        ))}
        <form
          className="flex w-40 shrink-0 snap-start items-center gap-1.5 rounded-xl border border-dashed border-line px-2"
          onSubmit={(event) => {
            event.preventDefault();
            addStage(project.id, stageName);
            setStageName("");
          }}
        >
          <Plus className="size-4 shrink-0 text-subtle" aria-hidden="true" />
          <input
            value={stageName}
            onChange={(event) => setStageName(event.target.value)}
            placeholder="Новый этап"
            aria-label="Новый этап"
            enterKeyHint="done"
            className="h-10 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-subtle"
          />
        </form>
      </div>

      <Sheet
        open={settings}
        title="Проект"
        onClose={() => {
          setSettings(false);
          setConfirm(false);
        }}
      >
        <DateRows
          start={project.start ?? ""}
          end={project.end ?? ""}
          onStart={(value) => updateProject(project.id, { start: value || null })}
          onEnd={(value) => updateProject(project.id, { end: value || null })}
        />
        <p className="mt-2 px-1 text-xs text-muted">Даты видны в «Расписании» и «Календаре». Без дат проект просто лежит в списке.</p>
        <div className="mt-4">
          {confirm ? (
            <div className="flex gap-2">
              <Button variant="soft" className="flex-1" onClick={() => setConfirm(false)}>
                Отмена
              </Button>
              <Button
                variant="destructive"
                className="flex-1"
                onClick={() => {
                  deleteProject(project.id);
                  setSettings(false);
                  onBack();
                }}
              >
                Удалить проект
              </Button>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirm(true)} className="h-11 w-full rounded-xl bg-elevated text-[0.9375rem] text-danger">
              Удалить проект
            </button>
          )}
        </div>
      </Sheet>
      {ghost ? (
        <div
          className="pointer-events-none fixed z-50 max-w-48 truncate rounded-lg bg-elevated px-3 py-2 text-sm text-fg shadow-lg"
          style={{ left: ghost.x + 12, top: ghost.y + 12 }}
        >
          {ghost.title}
        </div>
      ) : null}
    </div>
  );
}
