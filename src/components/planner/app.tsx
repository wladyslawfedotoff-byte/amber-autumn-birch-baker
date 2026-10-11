import { useCallback, useEffect, useRef, useState } from "react";
import { Columns3, List, Menu, Search, Trash2, X } from "lucide-react";
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
import { ScheduleScreen } from "@/components/planner/schedule-screen";
import { SettingsView } from "@/components/planner/settings-view";
import { Sidebar } from "@/components/planner/sidebar";
import { TaskViews } from "@/components/planner/task-views";
import { Button } from "@/components/ui/button";
import { beep } from "@/lib/beep";
import { cn } from "@/lib/cn";
import { formatLong, formatRange, formatShortDay, shiftIso, todayIso } from "@/lib/dates";
import { usePlanner } from "@/lib/planner-store";
import type { View } from "@/lib/planner-types";
import { scopeTasks } from "@/lib/queries";
import { useProfile } from "@/lib/use-capabilities";
import { bindServerSync } from "@/lib/server-sync";
import { SyncIndicator } from "@/components/planner/sync-status";
import { DoneToastBar } from "@/components/planner/done-toast";
import { Fab, QuickComposer } from "@/components/planner/quick-composer";
import { TAB_ICONS } from "@/components/planner/tab-icons";
import { TAB_OPTIONS, canBoard } from "@/lib/ui-prefs";
import { useViewportFrame } from "@/lib/use-viewport-frame";

function viewTitle(view: View, lists: { id: string; name: string }[]): string {
  if (view === "today") return "Сегодня";
  if (view === "tomorrow") return "Завтра";
  if (view === "week") return "7 дней";
  if (view === "inbox") return "Входящие";
  if (view === "checklist") return "Все";
  if (view === "matrix") return "Матрица";
  if (view === "done") return "Готово";
  if (view === "archive") return "Архив";
  if (view === "calendar") return "Календарь";
  if (view === "focus") return "Фокус";
  if (view === "habits") return "Привычки";
  if (view === "dates") return "Даты";
  if (view === "assist") return "Помощник";
  if (view === "schedule") return "Расписание";
  if (view === "projects") return "Проекты";
  if (view === "settings") return "Настройки";
  if (view === "shared") return "Общие";
  if (view.startsWith("tag:")) return `#${view.slice(4)}`;
  if (view.startsWith("day:")) return formatLong(view.slice(4));
  return lists.find((list) => list.id === view.slice(5))?.name ?? "Список";
}

export function PlannerApp() {
  const profile = useProfile();
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
  const tabBar = usePlanner((s) => s.tabBar);
  const addTask = usePlanner((s) => s.addTask);
  const [composer, setComposer] = useState(false);
  const composerRef = useRef<HTMLInputElement>(null);
  /** Day shown by «Календарь» / «Расписание»: the «+» adds to it. */
  const [calendarDay, setCalendarDay] = useState<string | null>(null);
  const [board, setBoard] = useState(false);
  /** «×» on the reminder strip hides it until a new reminder comes (no «Понятно» needed). */
  const [bannerHidden, setBannerHidden] = useState("");
  const closeComposer = useCallback(() => {
    setComposer(false);
    composerRef.current?.blur();
  }, []);
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
    // Safari tints its bars from theme-color: match the app surface (no grey band under the tab bar).
    const surface = getComputedStyle(document.documentElement).getPropertyValue("--surface").trim();
    if (surface) document.querySelector('meta[name="theme-color"]')?.setAttribute("content", surface);
  }, [theme, accent]);

  useViewportFrame();

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

  function openComposer() {
    setComposer(true);
    // Focus inside the tap: iOS opens the keyboard only for that.
    const input = composerRef.current;
    input?.focus({ preventScroll: true });
    // Desktop: the composer is display:none until opened — focus after paint.
    if (input && document.activeElement !== input) requestAnimationFrame(() => composerRef.current?.focus({ preventScroll: true }));
  }

  function openView(next: View) {
    setView(next);
    setBoard(false);
    setCalendarDay(null);
    setComposer(false);
    if (next !== "projects") setProjectId(null);
    setDrawer(false);
    setBell(false);
    setQuery("");
    setSearchOpen(false);
    setConfirmList(false);
  }

  function openProject(id: string) {
    openView("projects");
    setProjectId(id);
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
    if (view === "week") return formatRange(today, shiftIso(today, 6));
    if (view === "tomorrow") return formatShortDay(shiftIso(today, 1), true);
    if (view === "inbox") return "Без списка";
    if (view === "done") return "Недавно выполненные";
    if (view === "archive") return "Старые выполненные задачи";
    if (view === "calendar") return "";
    if (view === "focus") return "";
    if (view === "habits") return "";
    if (view === "checklist") return "Все открытые";
    if (view === "matrix") return "";
    if (view === "dates") return "";
    if (view === "assist") return "";
    if (view === "schedule") return "";
    if (view === "projects") return "";
    if (view === "settings") return "";
    if (view === "shared") return "Видны не только вам";
    if (view.startsWith("tag:")) {
      const n = scopeTasks(tasks, view, today).length;
      return n === 0 ? "Нет открытых задач с этим тегом" : `${n} открытых`;
    }
    if (view.startsWith("day:")) {
      const n = scopeTasks(tasks, view, today).length;
      return n === 0 ? "На этот день задач нет" : `${n} открытых`;
    }
    if (view.startsWith("list:")) {
      const list = lists.find((item) => item.id === view.slice(5));
      const n = scopeTasks(tasks, view, today).length;
      const shared = profile.multiUser && list && ((list.members ?? []).length > 0 || (list.owner && list.owner !== profile.login));
      const base = n === 0 ? "Пока нет открытых задач" : `${n} открытых`;
      return shared ? `${base} · общий` : base;
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
    view === "archive" ||
    view === "shared" ||
    view.startsWith("list:") ||
    view.startsWith("tag:") ||
    view.startsWith("day:") ||
    query.trim().length > 0;

  const showSearch = searchOpen || query.trim().length > 0;
  const quick = (() => {
    if (query.trim()) return null;
    if (view === "calendar" || view === "schedule") {
      const day = calendarDay ?? today;
      return { title: day === today ? "На сегодня" : `На ${formatLong(day).toLowerCase()}`, placeholder: "Встреча в 15", defaults: { due: day, listId: null } };
    }
    if (view === "checklist") return { title: "Во «Входящие»", placeholder: "Созвон завтра в 10", defaults: { due: null, listId: null } };
    if (!showLists || view === "done" || view === "archive" || view === "shared") return null;
    if (view === "today") return { title: "На сегодня", placeholder: "Созвон завтра в 10", defaults: { due: today, listId: null } };
    if (view === "tomorrow") return { title: "На завтра", placeholder: "Созвон завтра в 10", defaults: { due: shiftIso(today, 1), listId: null } };
    if (view === "week") return { title: "На сегодня", placeholder: "Созвон завтра в 10", defaults: { due: today, listId: null } };
    if (view.startsWith("day:")) {
      const day = view.slice(4);
      return { title: `На ${formatLong(day).toLowerCase()}`, placeholder: "Задача на этот день", defaults: { due: day, listId: null } };
    }
    if (view.startsWith("list:")) {
      const name = lists.find((list) => list.id === view.slice(5))?.name ?? "список";
      return { title: `В список «${name}»`, placeholder: "Созвон завтра в 10", defaults: { due: null, listId: view.slice(5) } };
    }
    if (view.startsWith("tag:")) {
      return { title: `С тегом #${view.slice(4)}`, placeholder: "Созвон завтра в 10", defaults: { due: null, listId: null, tags: [view.slice(4)] } };
    }
    return { title: "Во «Входящие»", placeholder: "Созвон завтра в 10", defaults: { due: null, listId: null } };
  })();
  const bannerKey = dueHits.map((hit) => `${hit.key}:${hit.stamp}`).join("|");

  return (
    <div className="app-frame vv-frame flex overflow-hidden bg-surface text-fg">
      <aside className="hidden h-full w-64 shrink-0 border-r border-line md:flex">
        <Sidebar view={view} onView={openView} onProject={openProject} />
      </aside>

      {drawer ? (
        <div className="sheet absolute inset-x-0 bottom-0 z-40 md:hidden">
          <button type="button" className="scrim absolute inset-0" aria-label="Закрыть меню" onClick={() => setDrawer(false)} />
          <div className="sheet-safe absolute inset-y-0 left-0 flex w-72 flex-col bg-bg">
            <Sidebar view={view} onView={openView} onClose={() => setDrawer(false)} onProject={openProject} />
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="relative z-20 shrink-0 px-2 py-1.5 md:px-8 md:py-3">
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
                  className="w-full bg-transparent text-xl font-semibold tracking-tight outline-none md:font-display md:text-4xl md:font-normal"
                />
              ) : (
                <h1 className="truncate text-xl font-semibold tracking-tight md:font-display md:text-4xl md:font-normal">{viewTitle(view, lists)}</h1>
              )}
              {subtitle ? <p className="truncate text-xs text-muted">{subtitle}</p> : null}
            </div>
            {canBoard(view) && !query.trim() ? (
              <Button
                size="icon"
                variant="ghost"
                aria-pressed={board}
                aria-label={board ? "Показать списком" : "Показать доской"}
                title={board ? "Списком" : "Доской"}
                onClick={() => setBoard(!board)}
                className={board ? "text-accent" : undefined}
              >
                {board ? <List className="size-5" /> : <Columns3 className="size-5" />}
              </Button>
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
            <label className="relative mt-1.5 block">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Поиск"
                aria-label="Поиск задач"
                autoFocus
                className="h-10 w-full rounded-xl bg-elevated pr-11 pl-10 text-base outline-none placeholder:text-subtle"
                suppressHydrationWarning
              />
              <button
                type="button"
                aria-label="Закрыть поиск"
                onClick={() => {
                  setQuery("");
                  setSearchOpen(false);
                }}
                className="absolute top-0 right-0 flex size-10 items-center justify-center text-subtle"
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

        {dueHits.length > 0 && bannerHidden !== bannerKey ? (
          <ReminderBanner
            due={dueHits}
            onOpen={openHit}
            onAck={(hit) => ackReminder(hit.key, hit.stamp)}
            onMore={() => setBell(true)}
            onHide={() => setBannerHidden(bannerKey)}
          />
        ) : null}

        <div className="relative flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-4 pt-2 pb-24 md:px-8 md:py-6">
          {showLists ? (
            <TaskViews
              key={view}
              view={view}
              query={query}
              selectedId={selectedId}
              onOpen={setSelectedId}
              onPickDay={(day) => openView(day === today ? "today" : `day:${day}`)}
              board={board}
            />
          ) : null}
          {listId && !query.trim() ? (
            <div className="mt-6 flex justify-center">
              {confirmList ? (
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setConfirmList(false)}>
                    Отмена
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => {
                      deleteList(listId);
                      setView("inbox");
                      setConfirmList(false);
                    }}
                  >
                    Удалить · задачи во «Входящие»
                  </Button>
                </div>
              ) : (
                <Button variant="ghost" size="sm" className="text-subtle" onClick={() => setConfirmList(true)}>
                  <Trash2 className="size-4" /> Удалить список
                </Button>
              )}
            </div>
          ) : null}
          {!query.trim() && view === "calendar" ? <CalendarView selectedId={selectedId} onOpen={setSelectedId} onDayChange={setCalendarDay} /> : null}
          {!query.trim() && view === "checklist" ? <ChecklistView selectedId={selectedId} onOpen={setSelectedId} /> : null}
          {!query.trim() && view === "matrix" ? <MatrixView selectedId={selectedId} onOpen={setSelectedId} /> : null}
          {!query.trim() && view === "focus" ? <FocusView /> : null}
          {!query.trim() && view === "habits" ? <HabitsView onOpenFocus={() => openView("focus")} /> : null}
          {!query.trim() && view === "dates" ? <DatesView /> : null}
          {!query.trim() && view === "assist" ? <AssistView onOpen={setSelectedId} /> : null}
          {!query.trim() && view === "schedule" ? (
            <ScheduleScreen
              onOpen={setSelectedId}
              onOpenProjects={openProject}
              onDayChange={setCalendarDay}
              onQuickAdd={(day) => {
                setCalendarDay(day);
                openComposer();
              }}
            />
          ) : null}
          {!query.trim() && view === "projects" ? <ProjectsView key={projectId ?? "all"} initialId={projectId} /> : null}
          {!query.trim() && view === "settings" ? <SettingsView /> : null}
        </div>
        {quick ? (
          <Fab
            label="Добавить задачу"
            onClick={openComposer}
          />
        ) : null}
        </div>

        <DoneToastBar />

        {focus.running || focus.note ? (
          <div className="flex h-12 shrink-0 items-center gap-3 border-t border-line px-4">
            <span className="text-base font-semibold tabular-nums">{formatFocusClock(focus.seconds)}</span>
            <span className="min-w-0 flex-1 truncate text-sm text-muted">
              {focus.note ?? (focus.mode === "work" ? "Фокус" : "Перерыв")}
            </span>
            <Button variant="soft" size="sm" className="h-9 rounded-full" onClick={() => (focus.running ? pauseFocus() : startFocus())}>
              {focus.running ? "Пауза" : "Дальше"}
            </Button>
            {view !== "focus" ? (
              <Button variant="ghost" size="sm" className="h-9" onClick={() => openView("focus")}>
                Открыть
              </Button>
            ) : null}
          </div>
        ) : null}

        <nav
          className="grid shrink-0 border-t border-line bg-surface pb-safe md:hidden"
          style={{ gridTemplateColumns: `repeat(${tabBar.length}, minmax(0, 1fr))` }}
          aria-label="Основные разделы"
        >
          {tabBar.map((id) => {
            const Icon = TAB_ICONS[id];
            const label = TAB_OPTIONS.find((tab) => tab.id === id)?.label ?? id;
            const active = !query.trim() && (view === id || (id === "today" && view.startsWith("day:")));
            return (
              <button
                key={id}
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => openView(id)}
                className={cn("flex h-[3.25rem] min-w-0 flex-col items-center justify-center gap-0.5 text-[0.6875rem]", active ? "text-accent" : "text-subtle")}
              >
                <Icon className="size-[1.375rem]" strokeWidth={active ? 2 : 1.75} />
                <span className="max-w-full truncate px-0.5">{label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {quick ? (
        <QuickComposer
          open={composer}
          onClose={closeComposer}
          inputRef={composerRef}
          title={quick.title}
          placeholder={quick.placeholder}
          onAdd={(title, options) => addTask({ title, ...options, ...quick.defaults })}
        />
      ) : null}

      {task ? (
        <aside className="sheet sheet-safe absolute inset-x-0 bottom-0 z-50 flex w-full flex-col bg-surface lg:static lg:inset-auto lg:z-auto lg:w-96 lg:shrink-0 lg:border-l lg:border-line">
          <TaskDetail key={task.id} taskId={task.id} onClose={() => setSelectedId(null)} onOpen={setSelectedId} />
        </aside>
      ) : null}
    </div>
  );
}
