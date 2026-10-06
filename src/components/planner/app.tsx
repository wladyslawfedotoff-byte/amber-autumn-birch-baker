import { useEffect, useState } from "react";
import { CalendarCheck, CalendarDays, Clock, Menu, Repeat, Search, Timer, X } from "lucide-react";
import { AssistView } from "@/components/planner/assist-view";
import { CalendarView } from "@/components/planner/calendar-view";
import { ChecklistView } from "@/components/planner/checklist-view";
import { DatesView } from "@/components/planner/dates-view";
import { TaskDetail } from "@/components/planner/detail";
import { FocusView, formatFocusClock } from "@/components/planner/focus-view";
import { HabitsView } from "@/components/planner/habits-view";
import { MatrixView } from "@/components/planner/matrix-view";
import { ProjectsView } from "@/components/planner/projects-view";
import { ReminderBanner, ReminderBell, ReminderPanel, useReminderChime, useReminderHits } from "@/components/planner/reminder-ui";
import { ScheduleView } from "@/components/planner/schedule-view";
import { SettingsView } from "@/components/planner/settings-view";
import { Sidebar } from "@/components/planner/sidebar";
import { TaskViews } from "@/components/planner/task-views";
import { Button } from "@/components/ui/button";
import { beep } from "@/lib/beep";
import { cn } from "@/lib/cn";
import { formatLong, shiftIso, todayIso } from "@/lib/dates";
import { usePlanner } from "@/lib/planner-store";
import type { View } from "@/lib/planner-types";
import { scopeTasks } from "@/lib/queries";
import { bindServerSync } from "@/lib/server-sync";
import { SyncIndicator } from "@/components/planner/sync-status";

const MOBILE: { id: View; label: string; icon: typeof CalendarCheck }[] = [
  { id: "today", label: "Сегодня", icon: CalendarCheck },
  { id: "calendar", label: "Календарь", icon: CalendarDays },
  { id: "schedule", label: "Расписание", icon: Clock },
  { id: "habits", label: "Привычки", icon: Repeat },
  { id: "focus", label: "Фокус", icon: Timer },
];

function viewTitle(view: View, lists: { id: string; name: string }[]): string {
  if (view === "today") return "Сегодня";
  if (view === "tomorrow") return "Завтра";
  if (view === "week") return "7 дней";
  if (view === "inbox") return "Входящие";
  if (view === "checklist") return "Все";
  if (view === "matrix") return "Матрица";
  if (view === "done") return "Готово";
  if (view === "calendar") return "Календарь";
  if (view === "focus") return "Фокус";
  if (view === "habits") return "Привычки";
  if (view === "dates") return "Даты";
  if (view === "assist") return "Помощник";
  if (view === "schedule") return "Расписание";
  if (view === "projects") return "Проекты";
  if (view === "settings") return "Настройки";
  if (view.startsWith("tag:")) return `#${view.slice(4)}`;
  if (view.startsWith("day:")) return formatLong(view.slice(4));
  return lists.find((list) => list.id === view.slice(5))?.name ?? "Список";
}

export function PlannerApp() {
  const lists = usePlanner((s) => s.lists);
  const tasks = usePlanner((s) => s.tasks);
  const theme = usePlanner((s) => s.theme);
  const accent = usePlanner((s) => s.accent);
  const focus = usePlanner((s) => s.focus);
  const tickFocus = usePlanner((s) => s.tickFocus);
  const startFocus = usePlanner((s) => s.startFocus);
  const pauseFocus = usePlanner((s) => s.pauseFocus);
  const renameList = usePlanner((s) => s.renameList);
  const deleteList = usePlanner((s) => s.deleteList);
  const ackReminder = usePlanner((s) => s.ackReminder);
  const hits = useReminderHits();
  const dueHits = hits.filter((hit) => hit.status === "due");
  useReminderChime(dueHits);
  const [view, setView] = useState<View>("today");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [bell, setBell] = useState(false);
  const [confirmList, setConfirmList] = useState(false);
  const today = todayIso();
  const task = tasks.find((item) => item.id === selectedId) ?? null;
  const listId = view.startsWith("list:") ? view.slice(5) : null;

  useEffect(() => {
    let stop = () => {};
    let cancelled = false;
    let pristine = false;
    try {
      pristine = window.localStorage.getItem("srok-planner") === null;
    } catch {
      pristine = false;
    }
    void Promise.resolve(usePlanner.persist.rehydrate()).then(() => {
      if (!cancelled) stop = bindServerSync({ pristine });
    });
    return () => {
      cancelled = true;
      stop();
    };
  }, []);

  useEffect(() => {
    if (!focus.running || !tickFocus) return;
    const id = window.setInterval(() => {
      if (tickFocus()) beep();
    }, 250);
    return () => window.clearInterval(id);
  }, [focus.running, tickFocus]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.accent = accent;
  }, [theme, accent]);

  useEffect(() => {
    let last = 0;
    const apply = () => {
      const next = Math.round(window.visualViewport?.height ?? window.innerHeight);
      if (Math.abs(next - last) < 2) return;
      last = next;
      document.documentElement.style.setProperty("--app-h", `${next}px`);
    };
    apply();
    window.visualViewport?.addEventListener("resize", apply);
    window.addEventListener("orientationchange", apply);
    return () => {
      window.visualViewport?.removeEventListener("resize", apply);
      window.removeEventListener("orientationchange", apply);
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setSelectedId(null);
      setDrawer(false);
      setBell(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (listId && !lists.some((list) => list.id === listId)) setView("inbox");
  }, [listId, lists]);

  useEffect(() => {
    if (selectedId && !tasks.some((item) => item.id === selectedId)) setSelectedId(null);
  }, [selectedId, tasks]);

  function openView(next: View) {
    setView(next);
    if (next !== "projects") setProjectId(null);
    setDrawer(false);
    setBell(false);
    setQuery("");
    setSearchOpen(false);
    setConfirmList(false);
  }

  function openHit(hit: { kind: string; refId: string }) {
    setBell(false);
    if (hit.kind === "task") {
      setSelectedId(hit.refId);
      return;
    }
    setSelectedId(null);
    openView(hit.kind === "habit" ? "habits" : "dates");
  }

  const subtitle = (() => {
    if (query.trim()) return "Поиск по названию, заметке и тегам";
    if (view === "today") return "";
    if (view === "week") return `${formatLong(today)} — ${formatLong(shiftIso(today, 6))}`;
    if (view === "tomorrow") return formatLong(shiftIso(today, 1));
    if (view === "inbox") return "Без списка";
    if (view === "done") return "Всё, что уже закрыто";
    if (view === "calendar") return "Перетащите задачу или этап на другой день";
    if (view === "focus") return "Таймер остаётся на экране, пока идёт сессия";
    if (view === "habits") return "Отметки за неделю";
    if (view === "checklist") return "Все открытые задачи";
    if (view === "matrix") return "Важно и срочно — по разные стороны";
    if (view === "dates") return "Дни до дня рождения, годовщины и праздника";
    if (view === "assist") return "Разложить мысли на задачи";
    if (view === "schedule") return "Рабочие часы, свободные окна и накладки";
    if (view === "projects") return "Длинные дела по этапам";
    if (view === "settings") return "Подключение, оформление и копия";
    if (view.startsWith("tag:")) {
      const n = scopeTasks(tasks, view, today).length;
      return n === 0 ? "Нет открытых задач с этим тегом" : `${n} открытых`;
    }
    if (view.startsWith("day:")) {
      const n = scopeTasks(tasks, view, today).length;
      return n === 0 ? "На этот день задач нет" : `${n} открытых`;
    }
    const n = scopeTasks(tasks, view, today).length;
    return n === 0 ? "Пока нет открытых задач" : `${n} открытых`;
  })();

  const showLists =
    view === "today" ||
    view === "tomorrow" ||
    view === "week" ||
    view === "inbox" ||
    view === "done" ||
    view.startsWith("list:") ||
    view.startsWith("tag:") ||
    view.startsWith("day:") ||
    query.trim().length > 0;

  const showSearch = searchOpen || query.trim().length > 0;

  return (
    <div className="app-frame relative flex overflow-hidden bg-surface text-fg">
      <aside className="hidden h-full w-64 shrink-0 border-r border-line md:flex">
        <Sidebar view={view} onView={openView} />
      </aside>

      {drawer ? (
        <div className="sheet absolute inset-x-0 bottom-0 z-40 md:hidden">
          <button type="button" className="scrim absolute inset-0" aria-label="Закрыть меню" onClick={() => setDrawer(false)} />
          <div className="sheet-safe absolute inset-y-0 left-0 flex w-72 flex-col bg-bg">
            <Sidebar view={view} onView={openView} onClose={() => setDrawer(false)} />
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="relative z-20 shrink-0 px-4 py-3 md:px-8">
          <div className="flex items-center gap-2">
            <Button size="icon" variant="ghost" className="md:hidden" aria-label="Открыть меню" onClick={() => setDrawer(true)}>
              <Menu className="size-5" />
            </Button>
            <div className="min-w-0 flex-1">
              {listId ? (
                <input
                  aria-label="Название списка"
                  value={lists.find((list) => list.id === listId)?.name ?? ""}
                  onChange={(event) => renameList(listId, event.target.value)}
                  onBlur={() => {
                    const current = lists.find((list) => list.id === listId)?.name ?? "";
                    if (!current.trim()) renameList(listId, "Без названия");
                  }}
                  className="w-full bg-transparent font-display text-2xl tracking-tight outline-none md:text-4xl"
                />
              ) : (
                <h1 className="truncate font-display text-2xl tracking-tight md:text-4xl">{viewTitle(view, lists)}</h1>
              )}
              {subtitle ? <p className="truncate text-xs text-muted">{subtitle}</p> : null}
            </div>
            {listId ? (
              confirmList ? (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    deleteList(listId);
                    setView("inbox");
                    setConfirmList(false);
                  }}
                >
                  Удалить
                </Button>
              ) : (
                <Button variant="ghost" className="text-muted" onClick={() => setConfirmList(true)}>
                  Удалить
                </Button>
              )
            ) : null}
            {showSearch ? null : (
              <Button size="icon" variant="ghost" aria-label="Поиск" onClick={() => setSearchOpen(true)}>
                <Search className="size-5" />
              </Button>
            )}
            <SyncIndicator onOpen={() => openView("settings")} />
            <ReminderBell dueCount={dueHits.length} open={bell} onToggle={() => setBell((open) => !open)} />
          </div>
          {showSearch ? (
            <label className="relative mt-3 block">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Поиск"
                aria-label="Поиск задач"
                autoFocus
                className="card-lift h-11 w-full rounded-2xl bg-elevated pr-11 pl-10 text-base outline-none placeholder:text-subtle"
                suppressHydrationWarning
              />
              <button
                type="button"
                aria-label="Закрыть поиск"
                onClick={() => {
                  setQuery("");
                  setSearchOpen(false);
                }}
                className="absolute top-0 right-0 flex size-11 items-center justify-center text-subtle"
              >
                <X className="size-4" />
              </button>
            </label>
          ) : null}
          {bell ? (
            <>
              <button
                type="button"
                aria-label="Закрыть напоминания"
                className="fixed inset-0 z-20 cursor-default"
                onClick={() => setBell(false)}
              />
              <ReminderPanel hits={hits} onOpen={openHit} onAck={(hit) => ackReminder(hit.key, hit.stamp)} />
            </>
          ) : null}
        </header>

        {dueHits.length > 0 ? (
          <ReminderBanner
            due={dueHits}
            onOpen={openHit}
            onAck={(hit) => ackReminder(hit.key, hit.stamp)}
            onMore={() => setBell(true)}
          />
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-2 md:px-8 md:py-6">
          {showLists ? (
            <TaskViews
              key={view}
              view={view}
              query={query}
              selectedId={selectedId}
              onOpen={setSelectedId}
              onPickDay={(day) => openView(day === today ? "today" : `day:${day}`)}
            />
          ) : null}
          {!query.trim() && view === "calendar" ? <CalendarView selectedId={selectedId} onOpen={setSelectedId} /> : null}
          {!query.trim() && view === "checklist" ? <ChecklistView selectedId={selectedId} onOpen={setSelectedId} /> : null}
          {!query.trim() && view === "matrix" ? <MatrixView selectedId={selectedId} onOpen={setSelectedId} /> : null}
          {!query.trim() && view === "focus" ? <FocusView /> : null}
          {!query.trim() && view === "habits" ? <HabitsView /> : null}
          {!query.trim() && view === "dates" ? <DatesView /> : null}
          {!query.trim() && view === "assist" ? <AssistView onOpen={setSelectedId} /> : null}
          {!query.trim() && view === "schedule" ? (
            <ScheduleView
              onOpen={setSelectedId}
              onOpenProjects={(id) => {
                setProjectId(id);
                openView("projects");
              }}
            />
          ) : null}
          {!query.trim() && view === "projects" ? <ProjectsView key={projectId ?? "all"} initialId={projectId} /> : null}
          {!query.trim() && view === "settings" ? <SettingsView /> : null}
        </div>

        {focus.running || focus.note ? (
          <div className="flex h-14 shrink-0 items-center gap-3 border-t border-line px-4">
            <span className="font-display text-xl tabular-nums">{formatFocusClock(focus.seconds)}</span>
            <span className="min-w-0 flex-1 truncate text-sm text-muted">
              {focus.note ?? (focus.mode === "work" ? "Фокус" : "Перерыв")}
            </span>
            <Button variant="soft" onClick={() => (focus.running ? pauseFocus() : startFocus())}>
              {focus.running ? "Пауза" : "Дальше"}
            </Button>
            {view !== "focus" ? (
              <Button variant="ghost" onClick={() => openView("focus")}>
                Открыть
              </Button>
            ) : null}
          </div>
        ) : null}

        <nav className="grid shrink-0 grid-cols-5 bg-surface pb-safe md:hidden" aria-label="Основные разделы">
          {MOBILE.map((item) => {
            const Icon = item.icon;
            const active = !query.trim() && (view === item.id || (item.id === "today" && view.startsWith("day:")));
            return (
              <button key={item.id} type="button" onClick={() => openView(item.id)} className="flex h-14 items-center justify-center">
                <span
                  className={cn(
                    "flex min-w-14 flex-col items-center gap-0.5 rounded-xl px-2 py-1 text-xs",
                    active ? "bg-elevated text-fg" : "text-subtle",
                  )}
                >
                  <Icon className="size-5" strokeWidth={1.75} />
                  {item.label}
                </span>
              </button>
            );
          })}
        </nav>
      </div>

      {task ? (
        <aside className="sheet sheet-safe absolute inset-x-0 bottom-0 z-50 flex w-full flex-col bg-surface lg:static lg:inset-auto lg:z-auto lg:w-96 lg:shrink-0 lg:border-l lg:border-line">
          <TaskDetail taskId={task.id} onClose={() => setSelectedId(null)} />
        </aside>
      ) : null}
    </div>
  );
}
