import { useState } from "react";
import {
  Archive,
  CalendarCheck,
  CalendarDays,
  CalendarRange,
  CheckCheck,
  Clock,
  Columns3,
  Hourglass,
  Inbox,
  LayoutGrid,
  LogOut,
  Users,
  ListChecks,
  MessageSquare,
  Plus,
  Repeat,
  Settings,
  Sunrise,
  Timer,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { todayIso } from "@/lib/dates";
import { usePlanner } from "@/lib/planner-store";
import { habitsForDay } from "@/lib/habit-plan";
import type { View } from "@/lib/planner-types";
import { countInbox, countList, countOpen, countToday, countTomorrow, countWeek, ownerOf, scopeTasks } from "@/lib/queries";
import { logout } from "@/lib/server-sync";
import { FAVICON_SVG } from "@/lib/app-icons";
import { APP_NAME, APP_TAGLINE } from "@/lib/site";
import { useCapabilities } from "@/lib/use-capabilities";
import { drawerItems } from "@/lib/ui-prefs";
import { projectProgress } from "@/lib/projects";
import { useShareScope } from "@/lib/use-share-scope";
import { archivedTasks, recentDone } from "@/lib/task-done";
import { syncNow } from "@/lib/sync/clock";

const SMART: { id: View; label: string; icon: typeof Inbox }[] = [
  { id: "inbox", label: "Входящие", icon: Inbox },
  { id: "today", label: "Сегодня", icon: CalendarCheck },
  { id: "tomorrow", label: "Завтра", icon: Sunrise },
  { id: "week", label: "7 дней", icon: CalendarRange },
  { id: "checklist", label: "Все", icon: ListChecks },
  { id: "calendar", label: "Календарь", icon: CalendarDays },
];

const TOOLS: { id: View; label: string; icon: typeof Inbox }[] = [
  { id: "schedule", label: "Расписание", icon: Clock },
  { id: "projects", label: "Проекты", icon: Columns3 },
  { id: "matrix", label: "Матрица", icon: LayoutGrid },
  { id: "focus", label: "Фокус", icon: Timer },
  { id: "habits", label: "Привычки", icon: Repeat },
  { id: "dates", label: "Даты", icon: Hourglass },
  { id: "assist", label: "Помощник", icon: MessageSquare },
];

export function Sidebar({
  view,
  onView,
  onClose,
  onProject,
}: {
  view: View;
  onView: (view: View) => void;
  /** Set for the phone drawer: items already in the tab bar are left out. */
  onClose?: () => void;
  onProject?: (id: string) => void;
}) {
  const tabBar = usePlanner((s) => s.tabBar);
  const projects = usePlanner((s) => s.projects) ?? [];
  const phone = Boolean(onClose);
  const lists = usePlanner((s) => s.lists);
  const tasks = usePlanner((s) => s.tasks);
  const habits = usePlanner((s) => s.habits);
  const addList = usePlanner((s) => s.addList);
  const today = todayIso();
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const archiveDays = usePlanner((s) => s.archiveDays);
  const now = syncNow();
  const doneCount = recentDone(tasks, now, archiveDays).length;
  const archiveCount = archivedTasks(tasks, now, archiveDays).length;
  const habitLeft = habitsForDay(habits, today).filter((h) => !h.checks.includes(today)).length;
  // «Помощник» needs AI_* settings on the server; hide it otherwise.
  const profile = useCapabilities();
  const { assistant } = profile;
  const tools = drawerItems(assistant ? TOOLS : TOOLS.filter((item) => item.id !== "assist"), tabBar, phone);
  const share = useShareScope();
  const smart = drawerItems(share ? [...SMART, { id: "shared" as View, label: "Общие", icon: Users }] : SMART, tabBar, phone);

  function count(id: View): number | null {
    if (id === "today") return countToday(tasks, today);
    if (id === "tomorrow") return countTomorrow(tasks, today);
    if (id === "week") return countWeek(tasks, today);
    if (id === "checklist") return countOpen(tasks);
    if (id === "inbox") return countInbox(tasks);
    if (id === "habits") return habitLeft;
    if (id === "shared") return share ? scopeTasks(tasks, "shared", today, share).length : null;
    return null;
  }

  function itemActive(id: View): boolean {
    return view === id;
  }

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col bg-bg text-fg">
      <div className="flex items-center gap-2 px-3 py-2">
        <img src={FAVICON_SVG} alt="" width={28} height={28} className="size-7 shrink-0 rounded-md" />
        <div className="min-w-0 flex-1">
          <p className="text-[0.9375rem] font-semibold leading-none">{APP_NAME}</p>
          {APP_TAGLINE ? <p className="mt-0.5 truncate text-xs leading-none text-subtle">{APP_TAGLINE}</p> : null}
        </div>
        {onClose ? (
          <Button size="icon" variant="ghost" aria-label="Закрыть меню" onClick={onClose}>
            <X className="size-5" />
          </Button>
        ) : null}
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-2" aria-label="Разделы">
        <ul className="flex flex-col">
          {smart.map((item) => (
            <NavRow
              key={item.id}
              item={item}
              active={itemActive(item.id)}
              count={count(item.id)}
              alert={item.id === "today" && tasks.some((t) => !t.done && t.due != null && t.due < today)}
              onView={onView}
            />
          ))}
        </ul>

        {tools.length > 0 ? (
          <>
            <SectionLabel>Инструменты</SectionLabel>
            <ul className="flex flex-col">
              {tools.map((item) => (
                <NavRow
                  key={item.id}
                  item={item}
                  active={itemActive(item.id)}
                  count={count(item.id)}
                  alert={false}
                  onView={onView}
                />
              ))}
            </ul>
          </>
        ) : null}

        <div className="mt-2 flex h-8 items-center justify-between pr-1 pl-2">
          <p className="text-[0.6875rem] font-semibold uppercase tracking-wide text-subtle">Списки</p>
          <button
            type="button"
            aria-label="Новый список"
            onClick={() => setAdding(true)}
            className="flex size-8 items-center justify-center rounded-md text-muted hover:bg-elevated hover:text-fg"
          >
            <Plus className="size-4" />
          </button>
        </div>
        <ul className="flex flex-col">
          {lists.map((list) => {
            const id = `list:${list.id}` as const;
            const active = view === id;
            const n = countList(tasks, list.id);
            return (
              <li key={list.id}>
                <button
                  type="button"
                  aria-current={active ? "page" : undefined}
                  onClick={() => onView(id)}
                  className={cn(
                    "flex h-9 w-full items-center gap-2.5 rounded-lg px-2 text-left text-sm transition-colors duration-150",
                    active ? "bg-elevated font-medium text-fg" : "text-muted hover:bg-elevated hover:text-fg",
                  )}
                >
                  <span className="flex size-4 shrink-0 items-center justify-center" aria-hidden="true">
                    <span className="size-1.5 rounded-full bg-accent" />
                  </span>
                  <span className="min-w-0 flex-1 truncate">{list.name}</span>
                  {share && ((list.members ?? []).length > 0 || ownerOf(list, share.dataOwner) !== share.me) ? (
                    <Users className="size-3.5 shrink-0 text-subtle" aria-label="общий список" />
                  ) : null}
                  {n > 0 ? <span className="tabular-nums text-xs text-subtle">{n}</span> : null}
                </button>
              </li>
            );
          })}
        </ul>
        {(() => {
          const tags = [...new Set(tasks.flatMap((task) => task.tags ?? []))].sort((a, b) => a.localeCompare(b, "ru"));
          if (tags.length === 0) return null;
          return (
            <div className="mt-2">
              <SectionLabel>Теги</SectionLabel>
              <div className="flex flex-wrap gap-1 px-1">
                {tags.map((tag) => {
                  const id = `tag:${tag}` as const;
                  const n = tasks.filter((task) => !task.done && (task.tags ?? []).includes(tag)).length;
                  return (
                    <button
                      key={tag}
                      type="button"
                      aria-current={view === id ? "page" : undefined}
                      onClick={() => onView(id)}
                      className={cn(
                        "flex h-8 items-center gap-1 rounded-full px-2.5 text-xs",
                        view === id ? "bg-accent text-accent-fg" : "bg-elevated text-muted",
                      )}
                    >
                      #{tag}
                      {n > 0 ? <span className="tabular-nums text-xs text-subtle">{n}</span> : null}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })()}
        {adding ? (
          <form
            className="mt-1 px-2"
            onSubmit={(event) => {
              event.preventDefault();
              const name = draft.trim();
              if (!name) {
                setAdding(false);
                return;
              }
              const id = addList(name);
              setDraft("");
              setAdding(false);
              onView(`list:${id}`);
            }}
          >
            <input
              autoFocus
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={() => {
                if (!draft.trim()) setAdding(false);
              }}
              placeholder="Название списка"
              aria-label="Название списка"
              className="h-10 w-full rounded-lg bg-elevated px-3 text-sm text-fg outline-none placeholder:text-subtle"
            />
          </form>
        ) : null}
        {onProject && projects.length > 0 ? (
          <>
            <SectionLabel>Проекты</SectionLabel>
            <ul className="flex flex-col">
              {projects.map((project) => {
                const { done, total } = projectProgress(project);
                return (
                  <li key={project.id}>
                    <button
                      type="button"
                      onClick={() => onProject(project.id)}
                      className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2 text-left text-sm text-muted hover:bg-elevated hover:text-fg"
                    >
                      <Columns3 className="size-4 shrink-0" strokeWidth={1.75} />
                      <span className="min-w-0 flex-1 truncate">{project.title || "Без названия"}</span>
                      {total > 0 ? (
                        <span className="tabular-nums text-xs text-subtle">
                          {done}/{total}
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        ) : null}
        <ul className="mt-2 flex flex-col border-t border-line pt-2">
          <NavRow item={{ id: "done", label: "Готово", icon: CheckCheck }} active={view === "done"} count={doneCount} alert={false} onView={onView} />
          <NavRow item={{ id: "archive", label: "Архив", icon: Archive }} active={view === "archive"} count={archiveCount} alert={false} onView={onView} />
        </ul>
      </nav>

      <div className="flex shrink-0 items-center gap-1 border-t border-line px-2 py-1.5">
        {profile.login ? (
          <>
            <span
              className="flex size-7 shrink-0 items-center justify-center rounded-full bg-elevated text-xs font-medium text-fg"
              aria-hidden="true"
            >
              {(profile.name || profile.login).slice(0, 1).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1 truncate px-1 text-sm text-muted" title={profile.login}>
              {profile.name || profile.login}
            </span>
          </>
        ) : (
          <span className="flex-1" />
        )}
        <button
          type="button"
          aria-current={view === "settings" ? "page" : undefined}
          onClick={() => onView("settings")}
          className="flex h-9 items-center gap-1.5 rounded-lg px-2 text-sm text-muted hover:bg-elevated hover:text-fg"
        >
          <Settings className="size-4 shrink-0" strokeWidth={1.75} />
          Настройки
        </button>
        {profile.login ? (
          <button
            type="button"
            onClick={() => void logout()}
            title="Выйти"
            className="flex size-9 items-center justify-center rounded-lg text-muted hover:bg-elevated hover:text-fg"
            aria-label={`Выйти из профиля ${profile.name || profile.login}`}
          >
            <LogOut className="size-4" strokeWidth={1.75} />
          </button>
        ) : null}
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: string }) {
  return <p className="mt-2 flex h-8 items-center px-2 text-[0.6875rem] font-semibold uppercase tracking-wide text-subtle">{children}</p>;
}

function NavRow({
  item,
  active,
  count,
  alert,
  onView,
}: {
  item: { id: View; label: string; icon: typeof Inbox };
  active: boolean;
  count: number | null;
  alert: boolean;
  onView: (view: View) => void;
}) {
  const Icon = item.icon;
  return (
    <li>
      <button
        type="button"
        aria-current={active ? "page" : undefined}
        onClick={() => onView(item.id)}
        className={cn(
          "flex h-9 w-full items-center gap-2.5 rounded-lg px-2 text-left text-sm transition-colors duration-150",
          active ? "bg-elevated font-medium text-fg" : "text-muted hover:bg-elevated hover:text-fg",
        )}
      >
        <Icon className="size-4 shrink-0" strokeWidth={1.75} />
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
        {count != null && count > 0 ? (
          <span className={cn("tabular-nums text-xs", alert ? "text-danger" : "text-subtle")}>{count}</span>
        ) : null}
      </button>
    </li>
  );
}
