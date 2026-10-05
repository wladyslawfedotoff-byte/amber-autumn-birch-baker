import { useState } from "react";
import {
  CalendarCheck,
  CalendarDays,
  CalendarRange,
  CheckCheck,
  Clock,
  Columns3,
  Hourglass,
  Inbox,
  LayoutGrid,
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
import type { View } from "@/lib/planner-types";
import { countInbox, countList, countOpen, countToday, countTomorrow, countWeek } from "@/lib/queries";

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
}: {
  view: View;
  onView: (view: View) => void;
  onClose?: () => void;
}) {
  const lists = usePlanner((s) => s.lists);
  const tasks = usePlanner((s) => s.tasks);
  const habits = usePlanner((s) => s.habits);
  const addList = usePlanner((s) => s.addList);
  const today = todayIso();
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const habitLeft = habits.filter((h) => !h.checks.includes(today)).length;

  function count(id: View): number | null {
    if (id === "today") return countToday(tasks, today);
    if (id === "tomorrow") return countTomorrow(tasks, today);
    if (id === "week") return countWeek(tasks, today);
    if (id === "checklist") return countOpen(tasks);
    if (id === "inbox") return countInbox(tasks);
    if (id === "habits") return habitLeft;
    return null;
  }

  function itemActive(id: View): boolean {
    return view === id;
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg text-fg">
      <div className="flex items-center gap-2 px-3 py-3">
        <span className="flex size-8 items-center justify-center rounded-md bg-accent text-accent-fg">
          <svg viewBox="0 0 32 32" className="size-4" aria-hidden="true">
            <path
              d="M7 16.5 13 22.5 25 9.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <p className="min-w-0 flex-1 font-display text-xl leading-none tracking-tight">Пора</p>
        {onClose ? (
          <Button size="icon" variant="ghost" aria-label="Закрыть меню" onClick={onClose}>
            <X className="size-5" />
          </Button>
        ) : null}
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-2" aria-label="Разделы">
        <p className="px-2 pb-1 text-xs font-medium text-subtle">Смарт-списки</p>
        <ul className="flex flex-col">
          {SMART.map((item) => (
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

        <p className="mt-3 px-2 pb-1 text-xs font-medium text-subtle">Инструменты</p>
        <ul className="grid grid-cols-2 gap-1">
          {TOOLS.map((item) => (
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

        <div className="mt-3 flex items-center justify-between px-2">
          <p className="text-xs font-medium text-subtle">Списки</p>
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
                    "flex h-10 w-full items-center gap-2 rounded-md px-2 text-left text-sm transition-colors duration-150",
                    active ? "bg-elevated font-medium text-fg" : "text-muted hover:bg-elevated hover:text-fg",
                  )}
                >
                  <span className="size-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">{list.name}</span>
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
            <div className="mt-3">
              <p className="px-2 pb-1 text-xs font-medium text-subtle">Теги</p>
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
                        "flex h-10 items-center gap-1 rounded-full border px-3 text-sm",
                        view === id ? "border-accent bg-elevated font-medium text-fg" : "border-line text-muted",
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
              className="h-11 w-full rounded-md border border-line bg-elevated px-3 text-sm text-fg outline-none placeholder:text-subtle"
            />
          </form>
        ) : null}
        <button
          type="button"
          aria-current={view === "done" ? "page" : undefined}
          onClick={() => onView("done")}
          className={cn(
            "mt-1 flex h-10 w-full items-center gap-2 rounded-md px-2 text-left text-sm transition-colors duration-150",
            view === "done" ? "bg-elevated font-medium text-fg" : "text-muted hover:bg-elevated hover:text-fg",
          )}
        >
          <CheckCheck className="size-4 shrink-0" strokeWidth={1.75} />
          <span className="min-w-0 flex-1 truncate">Готово</span>
        </button>
      </nav>

      <div className="shrink-0 border-t border-line px-2 py-2">
        <button
          type="button"
          aria-current={view === "settings" ? "page" : undefined}
          onClick={() => onView("settings")}
          className={cn(
            "flex h-10 w-full items-center gap-2 rounded-md px-2 text-left text-sm",
            view === "settings" ? "bg-elevated font-medium text-fg" : "text-muted hover:bg-elevated hover:text-fg",
          )}
        >
          <Settings className="size-4 shrink-0" strokeWidth={1.75} />
          <span className="min-w-0 flex-1 truncate">Настройки</span>
        </button>
      </div>
    </div>
  );
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
          "flex h-10 w-full items-center gap-2 rounded-md px-2 text-left text-sm transition-colors duration-150",
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
