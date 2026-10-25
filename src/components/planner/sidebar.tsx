import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Pin, PinOff, Plus, Search, Settings, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NAV_ICONS } from "@/components/planner/tab-icons";
import { cn } from "@/lib/cn";
import { todayIso } from "@/lib/dates";
import { usePlanner } from "@/lib/planner-store";
import { habitsForDay } from "@/lib/habit-plan";
import type { View } from "@/lib/planner-types";
import { countInbox, countList, countOpen, countTomorrow, countWeek, ownerOf, scopeTasks } from "@/lib/queries";
import { FAVICON_SVG } from "@/lib/app-icons";
import { APP_NAME, APP_TAGLINE } from "@/lib/site";
import { useCapabilities } from "@/lib/use-capabilities";
import {
  DRAWER_SEARCH_FROM,
  DRAWER_TABS,
  NAV_ITEMS,
  inDrawer,
  livePins,
  matchName,
  pickDrawerTab,
  type DrawerTab,
  type NavId,
  type NavPrefs,
  type PinKey,
} from "@/lib/ui-prefs";
import { projectProgress } from "@/lib/projects";
import { summarize } from "@/lib/maintenance/ops";
import { useShareScope } from "@/lib/use-share-scope";
import { isTaskOverdue } from "@/lib/maintenance/honest-due";

/** Smart lists as tiles (in this order). */
/** Navigation items that are screens of their own (not drawer groups). */
type ViewNav = Extract<NavId, View>;

const TILES: ViewNav[] = ["inbox", "tomorrow", "week", "checklist", "shared"];
/** Sections as a slim row of icon chips. */
const TOOLS: ViewNav[] = ["today", "calendar", "schedule", "habits", "assist", "focus", "matrix", "dates", "maintenance"];

const label = (id: NavId) => NAV_ITEMS.find((item) => item.id === id)?.label ?? id;

/** One row of a drawer group (a list, a project or a tag). */
type GroupItem = { key: string; name: string; count: string | null; pin: PinKey | null; shared?: boolean; open: () => void };

/** Long press (or right click) → the item menu; a short tap → open. */
function usePress(onLong: () => void) {
  const timer = useRef<number | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  const cancel = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
  };
  return {
    onPointerDown: (event: ReactPointerEvent) => {
      if (event.button !== 0) return;
      fired.current = false;
      start.current = { x: event.clientX, y: event.clientY };
      cancel();
      timer.current = window.setTimeout(() => {
        fired.current = true;
        onLong();
      }, 450);
    },
    onPointerMove: (event: ReactPointerEvent) => {
      const from = start.current;
      if (from && Math.hypot(event.clientX - from.x, event.clientY - from.y) > 8) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onContextMenu: (event: React.MouseEvent) => {
      event.preventDefault();
      cancel();
      fired.current = true;
      onLong();
    },
    /** True once if the last press was a long one (its click must not open the item). */
    consumeLong: () => {
      const was = fired.current;
      fired.current = false;
      return was;
    },
  };
}

export function Sidebar({
  view,
  onView,
  onClose,
  onProject,
}: {
  view: View;
  onView: (view: View) => void;
  /** Set for the phone drawer: items that sit in the tab bar are left out. */
  onClose?: () => void;
  onProject?: (id: string) => void;
}) {
  const phone = Boolean(onClose);
  const tabBar = usePlanner((s) => s.tabBar);
  const drawerHidden = usePlanner((s) => s.drawerHidden) ?? [];
  const savedTab = usePlanner((s) => s.drawerTab) ?? "lists";
  const setDrawerTab = usePlanner((s) => s.setDrawerTab);
  const pins = usePlanner((s) => s.pins) ?? [];
  const togglePin = usePlanner((s) => s.togglePin);
  const projects = usePlanner((s) => s.projects) ?? [];
  const lists = usePlanner((s) => s.lists);
  const tasks = usePlanner((s) => s.tasks);
  const habits = usePlanner((s) => s.habits);
  const addList = usePlanner((s) => s.addList);
  const addProject = usePlanner((s) => s.addProject);
  const today = todayIso();
  const profile = useCapabilities();
  const share = useShareScope();
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  /** Key of the item whose menu («Закрепить» / «Открепить») is open. */
  const [menuFor, setMenuFor] = useState<string | null>(null);

  const prefs: NavPrefs = { tabBar, drawerHidden };
  const shows = (id: NavId) => inDrawer(id, prefs, phone);
  const assetsAll = usePlanner((s) => s.assets) ?? [];
  const overdue = tasks.some((t) => isTaskOverdue(t, assetsAll, today));

  const tiles = TILES.filter((id) => (id !== "shared" || share) && shows(id));
  const tools = TOOLS.filter((id) => (id !== "assist" || profile.assistant) && shows(id));
  const groups = DRAWER_TABS.filter((tab) => (tab.id !== "projects" || onProject) && shows(tab.id));
  const tab = pickDrawerTab(savedTab, groups.map((group) => group.id));
  const pinned = shows("pinned") ? livePins(pins, lists, projects) : [];

  function tileCount(id: ViewNav): number {
    if (id === "inbox") return countInbox(tasks);
    if (id === "tomorrow") return countTomorrow(tasks, today);
    if (id === "week") return countWeek(tasks, today);
    if (id === "checklist") return countOpen(tasks);
    if (id === "shared" && share) return scopeTasks(tasks, "shared", today, share).length;
    return 0;
  }

  const maintAttention = assetsAll.filter((a) => summarize(a, today).status !== "ok").length;
  const habitLeft = habitsForDay(habits, today).filter((h) => !h.checks.includes(today)).length;

  function openProject(id: string) {
    onProject?.(id);
  }

  const listItems: GroupItem[] = lists.map((list) => {
    const n = countList(tasks, list.id);
    return {
      key: `list:${list.id}`,
      name: list.name,
      count: n > 0 ? String(n) : null,
      pin: `list:${list.id}`,
      shared: Boolean(share && ((list.members ?? []).length > 0 || ownerOf(list, share.dataOwner) !== share.me)),
      open: () => onView(`list:${list.id}`),
    };
  });
  const projectItems: GroupItem[] = projects.map((project) => {
    const { done, total } = projectProgress(project);
    return {
      key: `project:${project.id}`,
      name: project.title || "Без названия",
      // «0/2» says something (nothing done yet); an empty project shows nothing.
      count: total > 0 ? `${done}/${total}` : null,
      pin: `project:${project.id}`,
      open: () => openProject(project.id),
    };
  });
  const tagItems: GroupItem[] = [...new Set(tasks.flatMap((task) => task.tags ?? []))]
    .sort((a, b) => a.localeCompare(b, "ru"))
    .map((tag) => {
      const n = tasks.filter((task) => !task.done && (task.tags ?? []).includes(tag)).length;
      return { key: `tag:${tag}`, name: `#${tag}`, count: n > 0 ? String(n) : null, pin: null, open: () => onView(`tag:${tag}`) };
    });
  const groupItems: Record<DrawerTab, GroupItem[]> = { lists: listItems, projects: projectItems, tags: tagItems };
  const current = tab ? groupItems[tab] : [];
  const searchable = current.length >= DRAWER_SEARCH_FROM;
  const shown = searchable ? current.filter((item) => matchName(item.name, query)) : current;
  const meta = DRAWER_TABS.find((item) => item.id === tab);

  const pinItems = pinned
    .map((pin) => [...listItems, ...projectItems].find((item) => item.pin === pin))
    .filter((item): item is GroupItem => Boolean(item));

  function switchTab(next: DrawerTab) {
    setDrawerTab(next);
    setQuery("");
    setAdding(false);
    setMenuFor(null);
  }

  function submitNew() {
    const name = draft.trim();
    setDraft("");
    setAdding(false);
    if (!name) return;
    if (tab === "projects") {
      const id = addProject(name);
      openProject(id);
    } else {
      onView(`list:${addList(name)}`);
    }
  }

  const activeKey = view.startsWith("list:") || view.startsWith("tag:") ? view : null;

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col bg-bg text-fg">
      <div className="flex shrink-0 items-center gap-3 px-3 pt-2 pb-1">
        <img src={FAVICON_SVG} alt="" width={36} height={36} className="size-9 shrink-0 rounded-[0.6rem]" />
        <div className="min-w-0 flex-1">
          <p className="text-base leading-tight font-semibold">{APP_NAME}</p>
          {APP_TAGLINE ? <p className="truncate text-xs leading-tight text-subtle">{APP_TAGLINE}</p> : null}
        </div>
        <Button
          size="icon"
          variant="ghost"
          aria-label="Настройки"
          aria-current={view === "settings" ? "page" : undefined}
          title="Настройки"
          onClick={() => onView("settings")}
          className={cn("size-10 text-muted", view === "settings" && "text-accent")}
        >
          <Settings className="size-5" strokeWidth={1.75} />
        </Button>
        {onClose ? (
          <Button size="icon" variant="ghost" aria-label="Закрыть меню" onClick={onClose} className="size-10 text-muted">
            <X className="size-5" />
          </Button>
        ) : null}
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pt-1 pb-3" aria-label="Разделы">
        {tiles.length > 0 ? (
          <ul className="grid gap-2" style={{ gridTemplateColumns: `repeat(${tiles.length}, minmax(0, 1fr))` }}>
            {tiles.map((id) => {
              const Icon = NAV_ICONS[id];
              const active = view === id;
              return (
                <li key={id}>
                  <button
                    type="button"
                    aria-current={active ? "page" : undefined}
                    onClick={() => onView(id)}
                    className={cn(
                      "press flex h-[4.25rem] w-full flex-col items-center justify-center rounded-xl px-1",
                      active ? "bg-accent text-accent-fg" : "bg-fg/[0.06] text-fg",
                    )}
                  >
                    <Icon className={cn("size-4", active ? "" : "text-accent")} strokeWidth={1.75} aria-hidden="true" />
                    <span className={cn("mt-1 text-[1.0625rem] leading-tight font-semibold tabular-nums", !active && !Number(tileCount(id)) && "opacity-35")}>{tileCount(id)}</span>
                    <span className={cn("max-w-full truncate leading-tight", tiles.length > 4 ? "text-[0.625rem]" : "text-[0.6875rem]", active ? "opacity-90" : "text-muted")}>
                      {label(id)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}

        {tools.length > 0 ? (
          <ul className="mt-2 flex flex-wrap gap-2">
            {tools.map((id) => {
              const Icon = NAV_ICONS[id];
              const active = view === id || (id === "today" && view.startsWith("day:"));
              const badge = id === "habits" && habitLeft > 0 ? String(habitLeft) : id === "maintenance" && maintAttention > 0 ? String(maintAttention) : null;
              return (
                // Three in a row when they fit; a long label takes its own width and wraps (never truncated).
                <li key={id} className="min-w-fit grow basis-[30%]">
                  <button
                    type="button"
                    aria-current={active ? "page" : undefined}
                    onClick={() => onView(id)}
                    className={cn(
                      "press flex h-9 w-full items-center justify-center gap-2 rounded-lg border px-2 text-[0.8125rem] whitespace-nowrap",
                      active ? "border-accent bg-accent/10 text-accent" : "border-line bg-surface/60 text-fg",
                    )}
                  >
                    <Icon className="size-4 shrink-0 text-accent" strokeWidth={1.75} aria-hidden="true" />
                    <span>{label(id)}</span>
                    {id === "today" && overdue ? <span className="size-1.5 shrink-0 rounded-full bg-danger" aria-label="есть просроченные" /> : null}
                    {badge ? <span className="shrink-0 text-xs text-subtle/70 tabular-nums">{badge}</span> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}

        {shows("pinned") && (pinItems.length > 0 || groups.some((g) => g.id !== "tags")) ? (
          <section aria-label="Закреплённые" className="mt-3">
            <SectionLabel>Закреплённые</SectionLabel>
            {pinItems.length > 0 ? (
              <ul className="flex flex-wrap gap-2">
                {pinItems.map((item) => (
                  <PinChip
                    key={item.key}
                    item={item}
                    active={activeKey === item.key}
                    menuOpen={menuFor === `pin:${item.key}`}
                    onMenu={(open) => setMenuFor(open ? `pin:${item.key}` : null)}
                    onUnpin={() => {
                      if (item.pin) togglePin(item.pin);
                      setMenuFor(null);
                    }}
                  />
                ))}
              </ul>
            ) : (
              <p className="px-1 text-xs text-subtle">Удерживайте список или проект, чтобы закрепить его здесь.</p>
            )}
          </section>
        ) : null}

        {tab && meta ? (
          <section className="mt-3" aria-label={meta.label}>
            {groups.length > 1 ? (
              <div role="tablist" aria-label="Группы меню" className="grid rounded-xl bg-fg/[0.06] p-1" style={{ gridTemplateColumns: `repeat(${groups.length}, minmax(0, 1fr))` }}>
                {groups.map((group) => (
                  <button
                    key={group.id}
                    type="button"
                    role="tab"
                    aria-selected={group.id === tab}
                    onClick={() => switchTab(group.id)}
                    className={cn(
                      "h-8 rounded-[0.6rem] text-sm transition-colors duration-150",
                      group.id === tab ? "bg-surface font-medium text-fg shadow-sm" : "text-muted",
                    )}
                  >
                    {group.label}
                  </button>
                ))}
              </div>
            ) : (
              <SectionLabel>{meta.label}</SectionLabel>
            )}

            {searchable ? (
              <label className="relative mt-2 block">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-subtle" aria-hidden="true" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={meta.search}
                  aria-label={meta.search}
                  className="h-9 w-full rounded-lg border border-line bg-surface/60 pr-3 pl-8 text-sm outline-none placeholder:text-subtle"
                />
              </label>
            ) : null}

            <ul className="mt-1 flex flex-col">
              {shown.map((item) => (
                <GroupRow
                  key={item.key}
                  item={item}
                  active={activeKey === item.key}
                  pinned={item.pin ? pins.includes(item.pin) : false}
                  menuOpen={menuFor === item.key}
                  onMenu={(open) => setMenuFor(open && item.pin ? item.key : null)}
                  onTogglePin={() => {
                    if (item.pin) togglePin(item.pin);
                    setMenuFor(null);
                  }}
                />
              ))}
            </ul>
            {current.length === 0 ? (
              <p className="px-2 py-2 text-xs text-subtle">
                {tab === "tags" ? "Теги появятся, когда вы добавите их к задачам (#тег в названии)." : tab === "projects" ? "Проектов пока нет." : "Списков пока нет."}
              </p>
            ) : shown.length === 0 ? (
              <p className="px-2 py-2 text-xs text-subtle">Ничего не нашлось.</p>
            ) : null}

            {meta.add ? (
              adding ? (
                <form
                  className="mt-1"
                  onSubmit={(event) => {
                    event.preventDefault();
                    submitNew();
                  }}
                >
                  <input
                    autoFocus
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onBlur={() => {
                      if (!draft.trim()) setAdding(false);
                    }}
                    placeholder={tab === "projects" ? "Название проекта" : "Название списка"}
                    aria-label={tab === "projects" ? "Название проекта" : "Название списка"}
                    className="h-10 w-full rounded-lg bg-elevated px-3 text-sm text-fg outline-none placeholder:text-subtle"
                  />
                </form>
              ) : (
                <button type="button" onClick={() => setAdding(true)} className="flex h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-sm text-accent">
                  <Plus className="size-4" aria-hidden="true" />
                  {meta.add}
                </button>
              )
            ) : null}
          </section>
        ) : null}
      </nav>
    </div>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <p className="mb-1 px-1 text-[0.6875rem] font-semibold tracking-wide text-subtle uppercase">{children}</p>;
}

function GroupRow({
  item,
  active,
  pinned,
  menuOpen,
  onMenu,
  onTogglePin,
}: {
  item: GroupItem;
  active: boolean;
  pinned: boolean;
  menuOpen: boolean;
  onMenu: (open: boolean) => void;
  onTogglePin: () => void;
}) {
  const press = usePress(() => onMenu(true));
  const { consumeLong, ...handlers } = press;
  return (
    <li>
      <button
        type="button"
        aria-current={active ? "page" : undefined}
        aria-haspopup={item.pin ? "menu" : undefined}
        {...(item.pin ? handlers : {})}
        onClick={() => {
          if (consumeLong()) return;
          onMenu(false);
          item.open();
        }}
        className={cn(
          "flex h-10 w-full touch-manipulation items-center gap-2 rounded-lg px-2 text-left text-[0.9375rem] transition-colors duration-150 select-none [-webkit-touch-callout:none]",
          active ? "bg-elevated font-medium text-fg" : "text-fg hover:bg-elevated",
        )}
      >
        {pinned ? <Pin className="size-3.5 shrink-0 text-accent" aria-label="закреплён" /> : null}
        <span className="min-w-0 flex-1 truncate">{item.name}</span>
        {item.shared ? <Users className="size-3.5 shrink-0 text-subtle" aria-label="общий список" /> : null}
        {item.count ? <span className="shrink-0 text-xs text-subtle/70 tabular-nums">{item.count}</span> : null}
      </button>
      {menuOpen ? (
        <div role="menu" className="mx-1 mb-1 flex items-center gap-1 rounded-lg bg-elevated p-1 text-sm">
          <button type="button" role="menuitem" autoFocus onClick={onTogglePin} className="flex h-9 flex-1 items-center justify-center gap-2 rounded-md bg-surface">
            {pinned ? <PinOff className="size-4" aria-hidden="true" /> : <Pin className="size-4" aria-hidden="true" />}
            {pinned ? "Открепить" : "Закрепить"}
          </button>
          <button type="button" role="menuitem" onClick={() => onMenu(false)} className="h-9 rounded-md px-3 text-muted">
            Отменить
          </button>
        </div>
      ) : null}
    </li>
  );
}

function PinChip({
  item,
  active,
  menuOpen,
  onMenu,
  onUnpin,
}: {
  item: GroupItem;
  active: boolean;
  menuOpen: boolean;
  onMenu: (open: boolean) => void;
  onUnpin: () => void;
}) {
  const { consumeLong, ...handlers } = usePress(() => onMenu(true));
  if (menuOpen) {
    return (
      <li className="flex h-8 items-center gap-1 rounded-full bg-elevated pr-1 pl-1 text-[0.8125rem]">
        <button type="button" autoFocus onClick={onUnpin} className="flex h-7 items-center gap-1 rounded-full bg-surface px-3">
          <PinOff className="size-3.5" aria-hidden="true" />
          Открепить «{item.name.length > 14 ? `${item.name.slice(0, 13)}…` : item.name}»
        </button>
        <button type="button" aria-label="Отменить" onClick={() => onMenu(false)} className="flex size-7 items-center justify-center rounded-full text-muted">
          <X className="size-3.5" />
        </button>
      </li>
    );
  }
  return (
    <li className="max-w-full min-w-0">
      <button
        type="button"
        aria-current={active ? "page" : undefined}
        {...handlers}
        onClick={() => {
          if (consumeLong()) return;
          item.open();
        }}
        className={cn(
          "press flex h-8 max-w-full touch-manipulation items-center gap-2 rounded-full border px-3 text-[0.8125rem] select-none [-webkit-touch-callout:none]",
          active ? "border-accent bg-accent/10 text-accent" : "border-line bg-surface/60 text-fg",
        )}
      >
        <Pin className="size-3 shrink-0 text-subtle" aria-hidden="true" />
        <span className="min-w-0 truncate">{item.name}</span>
        {item.count ? <span className="shrink-0 text-xs text-subtle/70 tabular-nums">{item.count}</span> : null}
      </button>
    </li>
  );
}
