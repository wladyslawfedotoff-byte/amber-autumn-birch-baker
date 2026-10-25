import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Columns3, List, Menu, Search, X } from "lucide-react";
import { AssistantNoticeList } from "@/components/planner/assist-notices";
import { useAssistantNotices } from "@/lib/assistant/use-notices";
import { ChecklistView } from "@/components/planner/checklist-view";
import { TaskDetail } from "@/components/planner/detail";
import { FocusView, formatFocusClock } from "@/components/planner/focus-view";
import { ReminderBanner, ReminderBell, ReminderPanel, useReminderChime, useReminderHits } from "@/components/planner/reminder-ui";
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
import { bindAttachments } from "@/lib/attachments/runtime";
import { hasSavedPlanner, initScope, markLoaded } from "@/lib/offline/device-store";
import { registerServiceWorker } from "@/lib/offline/sw-client";
import { refreshPushSubscription } from "@/lib/offline/push-client";
import { flushOfflineQuestions } from "@/lib/offline/assist-queue";
import { SyncIndicator, SyncPill } from "@/components/planner/sync-status";
import { useServerSyncStatus } from "@/lib/use-server-sync";
import { DoneToastBar } from "@/components/planner/done-toast";
import { PainPromptBar } from "@/components/planner/maintenance/prompt-bar";
import { Fab, QuickComposer } from "@/components/planner/quick-composer";
import { TAB_ICONS } from "@/components/planner/tab-icons";
import { TAB_OPTIONS, canBoard } from "@/lib/ui-prefs";
import { useViewportFrame } from "@/lib/use-viewport-frame";
import { useSheetDrag } from "@/lib/sheet-drag";
import { useShareScope } from "@/lib/use-share-scope";
import { markReady, useBoot } from "@/lib/boot";
import { PlannerSkeleton } from "@/components/planner/skeleton";
import { closeAllPopovers, useDismiss, usePopover } from "@/lib/popover";
import { closeMileage, kmAssetOf, openMileage, useMileagePrompt } from "@/lib/mileage-prompt";

const MileageSheet = lazy(() => import("@/components/planner/maintenance/sheets").then((m) => ({ default: m.MileageSheet })));

// 1.15: sections load on first open (and quietly in the background after start).
const loaders = {
  assist: () => import("@/components/planner/assist-view").then((m) => ({ default: m.AssistView })),
  calendar: () => import("@/components/planner/calendar-view").then((m) => ({ default: m.CalendarView })),
  dates: () => import("@/components/planner/dates-view").then((m) => ({ default: m.DatesView })),
  habits: () => import("@/components/planner/habits-view").then((m) => ({ default: m.HabitsView })),
  matrix: () => import("@/components/planner/matrix-view").then((m) => ({ default: m.MatrixView })),
  projects: () => import("@/components/planner/projects-view").then((m) => ({ default: m.ProjectsView })),
  maintenance: () => import("@/components/planner/maintenance/view").then((m) => ({ default: m.MaintenanceView })),
  schedule: () => import("@/components/planner/schedule-screen").then((m) => ({ default: m.ScheduleScreen })),
  settings: () => import("@/components/planner/settings-view").then((m) => ({ default: m.SettingsView })),
};
const AssistView = lazy(loaders.assist);
const CalendarView = lazy(loaders.calendar);
const DatesView = lazy(loaders.dates);
const HabitsView = lazy(loaders.habits);
const MatrixView = lazy(loaders.matrix);
const ProjectsView = lazy(loaders.projects);
const MaintenanceView = lazy(loaders.maintenance);
const ScheduleScreen = lazy(loaders.schedule);
const SettingsView = lazy(loaders.settings);

/** After the first screen is up: fetch the other sections while the phone is idle, so a tab opens at once. */
function preloadSections(): void {
  const run = () => {
    for (const load of Object.values(loaders)) void load().catch(() => undefined);
  };
  const idle = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  if (idle) idle(run, { timeout: 4000 });
  else window.setTimeout(run, 2500);
}

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
  if (view === "maintenance") return "Обслуживание";
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
  const assistantNotices = useAssistantNotices(Boolean(profile.assistant));
  const [assistOpen, setAssistOpen] = useState<string | null>(null);
  /** «Помощник» opened from an open project: offers «Разбей проект на шаги». */
  const [assistProject, setAssistProject] = useState<string | null>(null);
  /** «Помощник» puts its «История» / «Новая беседа» buttons into the app header. */
  const [assistSlot, setAssistSlot] = useState<HTMLDivElement | null>(null);
  /** Project open on the «Проекты» screen right now. */
  const shownProject = useRef<string | null>(null);
  const onProjectShown = useCallback((id: string | null) => {
    shownProject.current = id;
  }, []);
  const [view, setView] = useState<View>("today");
  const ready = useBoot((s) => s.ready);
  const mileageAsset = useMileagePrompt((s) => s.assetId);
  useEffect(() => {
    if (ready) preloadSections();
  }, [ready]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Large title (1.18): big at the top of the list, compact in the bar once scrolled.
  const [collapsed, setCollapsed] = useState(false);
  const closeDetail = useCallback(() => setSelectedId(null), []);
  const detailDrag = useSheetDrag(closeDetail);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const drawerSwipe = useRef<{ x: number; y: number } | null>(null);
  const [bell, setBell] = usePopover("bell");
  const bellRef = useRef<HTMLSpanElement>(null);
  const bellPanelRef = useRef<HTMLDivElement>(null);
  useDismiss(bell, () => setBell(false), [bellRef, bellPanelRef]);
  // Another screen, another task or the drawer: nothing stays hanging open.
  useEffect(() => closeAllPopovers(), [view, selectedId, drawer]);
  const [confirmList, setConfirmList] = useState(false);
  const tabBar = usePlanner((s) => s.tabBar);
  const share = useShareScope();
  // «Общие» has nothing to show without shared lists on this server.
  const tabs = share ? tabBar : tabBar.filter((id) => id !== "shared");
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
    let stopAttach = () => {};
    let cancelled = false;
    // This user's local copy (IndexedDB), chosen before anything is read.
    const switched = initScope();
    void (async () => {
      const pristine = !(await hasSavedPlanner("srok-planner"));
      await usePlanner.persist.rehydrate();
      markLoaded();
      // A saved copy is shown at once; a fresh device waits for the server copy (skeleton until then).
      if (!pristine) markReady();
      else window.setTimeout(markReady, 15_000);
      if (!cancelled) {
        stop = bindServerSync({ pristine, switched });
        stopAttach = bindAttachments();
      }
      void registerServiceWorker().then(() => refreshPushSubscription());
    })();
    return () => {
      cancelled = true;
      stop();
      stopAttach();
    };
  }, []);

  // A tapped reminder: «/?task=<id>» on launch, or a message from the service worker.
  const pendingTask = useRef<string | null>(null);
  useEffect(() => {
    const url = new URL(window.location.href);
    const fromUrl = url.searchParams.get("task");
    if (fromUrl) {
      pendingTask.current = fromUrl;
      url.searchParams.delete("task");
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    }
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; taskId?: unknown } | null;
      if (data?.type !== "open-task" || typeof data.taskId !== "string") return;
      if (usePlanner.getState().tasks.some((item) => item.id === data.taskId)) {
        setBell(false);
        setSelectedId(data.taskId);
      } else pendingTask.current = data.taskId;
    };
    navigator.serviceWorker?.addEventListener("message", onMessage);
    return () => navigator.serviceWorker?.removeEventListener("message", onMessage);
  }, []);
  useEffect(() => {
    const id = pendingTask.current;
    if (!id || !tasks.some((item) => item.id === id)) return;
    pendingTask.current = null;
    setBell(false);
    setSelectedId(id);
  }, [tasks]);

  // «Обслуживание»: rules that became «скоро» turn into ordinary tasks (idempotent; also hourly and on return to the app).
  const assetsAll = usePlanner((s) => s.assets);
  const syncMaintenance = usePlanner((s) => s.syncMaintenance);
  useEffect(() => {
    syncMaintenance();
    const timer = window.setInterval(syncMaintenance, 60 * 60 * 1000);
    const visible = () => document.visibilityState === "visible" && syncMaintenance();
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [assetsAll, syncMaintenance]);

  // Questions to the assistant asked without network go to the server queue
  // once the server is reachable again (on start, «online», after a sync recovers).
  const reachable = !useServerSyncStatus().offline;
  const refreshNotices = assistantNotices.refresh;
  useEffect(() => {
    if (!profile.assistant || !reachable) return;
    const flush = () => void flushOfflineQuestions().then((sent) => sent && refreshNotices());
    flush();
    window.addEventListener("online", flush);
    return () => window.removeEventListener("online", flush);
  }, [profile.assistant, reachable, refreshNotices]);

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
    if (surface) document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => meta.setAttribute("content", surface));
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
    // Smooth cross-fade between sections (View Transitions, no bounce); plain switch elsewhere.
    const doc = typeof document === "undefined" ? null : (document as Document & { startViewTransition?: (cb: () => void) => unknown });
    const calm = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (doc?.startViewTransition && !calm && next !== view) {
      doc.startViewTransition(() => flushSync(() => switchView(next)));
      return;
    }
    switchView(next);
  }
  function switchView(next: View) {
    setCollapsed(false);
    if (next === "assist") setAssistProject(view === "projects" ? shownProject.current : null);
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
    if (view === "maintenance") return "";
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
  // Chat and wide boards keep a single compact bar.
  const bigTitleOff = view === "assist" && !query.trim();
  const bannerKey = dueHits.map((hit) => `${hit.key}:${hit.stamp}`).join("|");

  return (
    <div className="app-frame vv-frame flex overflow-hidden bg-surface text-fg">
      <aside className="hidden h-full w-72 shrink-0 border-r border-line md:flex">
        <Sidebar view={view} onView={openView} onProject={openProject} />
      </aside>

      {drawer ? (
        // Full height (under the status bar too); the panel pads itself by the safe areas.
        <div className="absolute inset-0 z-40 md:hidden">
          <button type="button" className="scrim absolute inset-0" aria-label="Закрыть меню" onClick={() => setDrawer(false)} />
          <div
            className="drawer-panel sheet-safe absolute inset-y-0 left-0 flex w-[19rem] max-w-[86vw] flex-col bg-bg pt-[env(safe-area-inset-top)] shadow-xl"
            // Swipe left closes the menu (a mostly horizontal move of 60 px or more).
            onTouchStart={(event) => {
              const t = event.touches[0];
              drawerSwipe.current = t ? { x: t.clientX, y: t.clientY } : null;
            }}
            onTouchEnd={(event) => {
              const from = drawerSwipe.current;
              const t = event.changedTouches[0];
              drawerSwipe.current = null;
              if (from && t && from.x - t.clientX > 60 && Math.abs(t.clientY - from.y) < from.x - t.clientX) setDrawer(false);
            }}
          >
            <Sidebar view={view} onView={openView} onClose={() => setDrawer(false)} onProject={openProject} />
          </div>
        </div>
      ) : null}

      <div className="relative flex min-w-0 flex-1 flex-col">
        <header className={cn("relative z-35 shrink-0 px-2 py-2 transition-shadow duration-200 md:px-8 md:py-3", collapsed && "max-md:shadow-[0_0.5px_0_var(--line)]")}>
          <div className="flex items-center gap-2">
            <Button size="icon" variant="ghost" className="md:hidden" aria-label="Открыть меню" onClick={() => setDrawer(true)}>
              <Menu className="size-5" />
            </Button>
            <div className="min-w-0 flex-1">
              {listId ? (
                <>
                <p className={cn("truncate text-center text-[1.0625rem] font-semibold transition-opacity duration-200 md:hidden", !collapsed && "opacity-0")} aria-hidden="true">
                  {lists.find((list) => list.id === listId)?.name ?? ""}
                </p>
                <input
                  aria-label="Название списка"
                  value={lists.find((list) => list.id === listId)?.name ?? ""}
                  onChange={(event) => renameList(listId, event.target.value)}
                  onBlur={() => {
                    const current = lists.find((list) => list.id === listId)?.name ?? "";
                    if (!current.trim()) renameList(listId, "Без названия");
                  }}
                  className="hidden w-full bg-transparent text-xl font-semibold tracking-tight outline-none md:block md:text-4xl md:font-bold"
                />
                </>
              ) : (
                <h1
                  className={cn(
                    "truncate text-center text-[1.0625rem] font-semibold transition-opacity duration-200 md:text-left md:text-4xl md:font-bold md:tracking-tight",
                    !collapsed && !bigTitleOff && "max-md:opacity-0",
                  )}
                >
                  {query.trim() ? "Поиск" : viewTitle(view, lists)}
                </h1>
              )}
              {subtitle ? <p className="hidden truncate text-xs text-muted md:block">{subtitle}</p> : null}
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
            {view === "assist" && !query.trim() ? <div ref={setAssistSlot} className="flex items-center" /> : null}
            {showSearch || view === "assist" ? null : (
              <Button size="icon" variant="ghost" aria-label="Поиск" onClick={() => setSearchOpen(true)}>
                <Search className="size-5" />
              </Button>
            )}
            <SyncIndicator onOpen={() => openView("settings")} />
            <span ref={bellRef} className="contents">
              <ReminderBell dueCount={dueHits.length + assistantNotices.notices.length} open={bell} onToggle={() => setBell(!bell)} />
            </span>
          </div>
          <SyncPill />
          {showSearch ? (
            <label className="relative mt-2 block">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Поиск"
                aria-label="Поиск задач"
                autoFocus
                className="h-10 w-full rounded-card bg-card pr-11 pl-10 text-base outline-none placeholder:text-subtle"
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
              <div ref={bellPanelRef}>
              <ReminderPanel
                hits={hits}
                onOpen={openHit}
                onAck={(hit) => ackReminder(hit.key, hit.stamp)}
                top={
                  <AssistantNoticeList
                    notices={assistantNotices.notices}
                    onOpen={(notice) => {
                      assistantNotices.dismiss({ conversationId: notice.conversationId });
                      openView("assist");
                      setAssistOpen(`${notice.conversationId}#${Date.now()}`);
                    }}
                  />
                }
              />
              </div>
            </>
          ) : null}
        </header>

        {ready && view === "today" && !query.trim() && dueHits.length > 0 && bannerHidden !== bannerKey ? (
          <ReminderBanner
            due={dueHits}
            onOpen={openHit}
            onAck={(hit) => ackReminder(hit.key, hit.stamp)}
            kmFor={(hit) => (hit.kind === "task" ? kmAssetOf(usePlanner.getState().tasks.find((t) => t.id === hit.refId)) : undefined)}
            onMileage={(assetId) => openMileage(assetId)}
            onMore={() => setBell(true)}
            onHide={() => setBannerHidden(bannerKey)}
          />
        ) : null}

        {mileageAsset ? (
          <Suspense fallback={null}>
            <MileageSheet assetId={mileageAsset} onClose={closeMileage} />
          </Suspense>
        ) : null}

        <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          data-main-scroll
          onScroll={(event) => setCollapsed(event.currentTarget.scrollTop > 40)}
          className={cn(
            "min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-4 pt-0 md:px-8 md:py-6",
            view === "assist" && !query.trim() ? "pb-[calc(3.25rem+var(--safe-b))] md:pb-0" : "pb-[calc(6rem+3.25rem+var(--safe-b))] md:pb-24",
          )}
        >
          {!bigTitleOff ? (
            <div className="pb-2 md:hidden">
              {listId ? (
                <input
                  aria-label="Название списка"
                  value={lists.find((list) => list.id === listId)?.name ?? ""}
                  onChange={(event) => renameList(listId, event.target.value)}
                  onBlur={() => {
                    const current = lists.find((list) => list.id === listId)?.name ?? "";
                    if (!current.trim()) renameList(listId, "Без названия");
                  }}
                  className="large-title w-full bg-transparent outline-none"
                />
              ) : (
                <p className="large-title truncate" aria-hidden="true">
                  {query.trim() ? "Поиск" : viewTitle(view, lists)}
                </p>
              )}
              {subtitle ? <p className="truncate text-xs text-muted">{subtitle}</p> : null}
            </div>
          ) : null}
          {!ready ? <PlannerSkeleton /> : null}
          <Suspense fallback={<PlannerSkeleton />}>
          {ready && showLists ? (
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
            <div className="mt-16 flex justify-center">
              {confirmList ? (
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setConfirmList(false)}>
                    Отменить
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
                <button type="button" className="h-11 px-4 text-xs text-subtle underline-offset-2 active:underline" onClick={() => setConfirmList(true)}>
                  Удалить список…
                </button>
              )}
            </div>
          ) : null}
          {ready && !query.trim() && view === "calendar" ? <CalendarView selectedId={selectedId} onOpen={setSelectedId} onDayChange={setCalendarDay} /> : null}
          {ready && !query.trim() && view === "checklist" ? <ChecklistView selectedId={selectedId} onOpen={setSelectedId} /> : null}
          {ready && !query.trim() && view === "matrix" ? <MatrixView selectedId={selectedId} onOpen={setSelectedId} /> : null}
          {ready && !query.trim() && view === "focus" ? <FocusView /> : null}
          {ready && !query.trim() && view === "habits" ? <HabitsView onOpenFocus={() => openView("focus")} /> : null}
          {ready && !query.trim() && view === "dates" ? <DatesView /> : null}
          {ready && !query.trim() && view === "assist" ? <AssistView onOpen={setSelectedId} openConversationId={assistOpen} headerSlot={assistSlot} projectId={assistProject} /> : null}
          {ready && !query.trim() && view === "schedule" ? (
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
          {ready && !query.trim() && view === "projects" ? <ProjectsView key={projectId ?? "all"} initialId={projectId} onOpenChange={onProjectShown} /> : null}
          {ready && !query.trim() && view === "maintenance" ? <MaintenanceView onOpenTask={setSelectedId} /> : null}
          {ready && !query.trim() && view === "settings" ? <SettingsView onView={openView} /> : null}
          </Suspense>
        </div>
        {quick ? (
          <Fab
            label="Добавить задачу"
            onClick={openComposer}
          />
        ) : null}
        </div>

        {/* Phones: bars float above the translucent tab bar; content scrolls under both. */}
        <div className="z-36 max-md:absolute max-md:inset-x-0 max-md:bottom-[calc(3.25rem+var(--safe-b))] max-md:bg-surface">
        <DoneToastBar />
        <PainPromptBar onOpen={() => openView("maintenance")} />

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
        </div>

        <nav
          className="frost z-36 grid shrink-0 pb-safe max-md:absolute max-md:inset-x-0 max-md:bottom-0 md:hidden"
          style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
          aria-label="Основные разделы"
        >
          {tabs.map((id) => {
            const Icon = TAB_ICONS[id];
            const label = TAB_OPTIONS.find((tab) => tab.id === id)?.label ?? id;
            const active = !query.trim() && (view === id || (id === "today" && view.startsWith("day:")));
            return (
              <button
                key={id}
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => openView(id)}
                className={cn("flex h-[3.25rem] min-w-0 flex-col items-center justify-center gap-1 text-[0.6875rem]", active ? "text-accent" : "text-subtle")}
              >
                <Icon className="size-[1.375rem]" strokeWidth={active ? 2 : 1.75} />
                <span className="max-w-full truncate px-1">{label}</span>
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
        <>
        <button type="button" aria-hidden="true" tabIndex={-1} className="scrim absolute inset-0 z-50 lg:hidden" onClick={closeDetail} />
        <aside
          ref={detailDrag.panelRef}
          className="sheet task-sheet sheet-safe absolute inset-x-0 bottom-0 z-50 flex w-full flex-col bg-surface lg:static lg:inset-auto lg:z-auto lg:w-96 lg:shrink-0 lg:border-l lg:border-line"
        >
          <TaskDetail key={task.id} taskId={task.id} onClose={closeDetail} onOpen={setSelectedId} onHeaderPointerDown={detailDrag.onPointerDown} />
        </aside>
        </>
      ) : null}
    </div>
  );
}
