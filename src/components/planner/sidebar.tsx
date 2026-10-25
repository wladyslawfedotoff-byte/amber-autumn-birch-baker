import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { AlertCircle, CalendarCheck, Folder, Sunrise, ChevronDown, ChevronRight, Hash, Inbox, List, ListChecks, Pin, PinOff, Plus, Search, Settings, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NAV_ICONS } from "@/components/planner/tab-icons";
import { cn } from "@/lib/cn";
import { todayIso } from "@/lib/dates";
import { usePlanner } from "@/lib/planner-store";
import { habitsForDay } from "@/lib/habit-plan";
import type { View } from "@/lib/planner-types";
import { countInbox, countList, countOpen, countToday, countTomorrow, countWeek, ownerOf, scopeTasks } from "@/lib/queries";
import { FAVICON_SVG } from "@/lib/app-icons";
import { APP_NAME } from "@/lib/site";
import { useCapabilities } from "@/lib/use-capabilities";
import {
  DRAWER_TABS,
  NAV_ITEMS,
  inDrawer,
  livePins,
  matchName,
  type DrawerTab,
  type NavId,
  type NavPrefs,
  type PinKey,
} from "@/lib/ui-prefs";
import { projectProgress } from "@/lib/projects";
import { summarize } from "@/lib/maintenance/ops";
import { useShareScope } from "@/lib/use-share-scope";
import { isTaskOverdue } from "@/lib/maintenance/honest-due";

/** Navigation items that are screens of their own (not drawer groups). */
type ViewNav = Extract<NavId, View>;

/** Smart-list tiles (2×2). «Просрочено» is not a screen: it opens «Сегодня», where overdue tasks sit on top. */
type Tile = "today" | "inbox" | "tomorrow" | "checklist" | "overdue";
const TILES: Tile[] = ["today", "inbox", "tomorrow", "checklist", "overdue"];
const TILE_META: Record<Tile, { label: string; color: string; icon: typeof Inbox }> = {
  today: { label: "Сегодня", color: "#0a84ff", icon: CalendarCheck },
  inbox: { label: "Входящие", color: "#5856d6", icon: Inbox },
  tomorrow: { label: "Завтра", color: "#ff9500", icon: Sunrise },
  checklist: { label: "Все", color: "#8e8e93", icon: ListChecks },
  overdue: { label: "Просрочено", color: "#ff3b30", icon: AlertCircle },
};
/** Everything else that is a screen: one row each in «Разделы». */
const ROWS: ViewNav[] = ["week", "shared", "calendar", "schedule", "habits", "assist", "focus", "matrix", "dates", "maintenance"];
/** One colour per section (iOS system colours). */
const ROW_COLORS: Partial<Record<ViewNav, string>> = {
  week: "#30b0c7",
  shared: "#5856d6",
  calendar: "#ff3b30",
  schedule: "#0a84ff",
  habits: "#34c759",
  assist: "#af52de",
  focus: "#ff2d55",
  matrix: "#5856d6",
  dates: "#ff9500",
  maintenance: "#8e8e93",
};
/** Lists, projects and tags have no colour of their own: they cycle this palette by position. */
const PALETTE = ["#0a84ff", "#ff9500", "#34c759", "#af52de", "#ff2d55", "#30b0c7", "#5856d6", "#ff3b30"];
const GLYPH: Record<DrawerTab, typeof Inbox> = { lists: List, projects: Folder, tags: Hash };

const label = (id: NavId) => NAV_ITEMS.find((item) => item.id === id)?.label ?? id;

/** One row of a drawer group (a list, a project or a tag). */
type GroupItem = { key: string; name: string; count: string | null; pin: PinKey | null; color?: string; shared?: boolean; open: () => void };

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
  /** Which group gets the «+ Новый …» field. */
  const [adding, setAdding] = useState<DrawerTab | null>(null);
  const [draft, setDraft] = useState("");
  /** Folded groups (projects and tags start folded). */
  const [folded, setFolded] = useState<Record<DrawerTab, boolean>>({ lists: false, projects: true, tags: true });
  /** Key of the item whose menu («Закрепить» / «Открепить») is open. */
  const [menuFor, setMenuFor] = useState<string | null>(null);

  const prefs: NavPrefs = { tabBar, drawerHidden };
  const shows = (id: NavId) => inDrawer(id, prefs, phone);
  const assetsAll = usePlanner((s) => s.assets) ?? [];
  const overdueCount = tasks.filter((t) => isTaskOverdue(t, assetsAll, today)).length;

  const tiles = TILES.filter((id) => id === "overdue" || shows(id));
  const rows = ROWS.filter((id) => (id !== "shared" || share) && (id !== "assist" || profile.assistant) && shows(id));
  const groups = DRAWER_TABS.filter((tab) => (tab.id !== "projects" || onProject) && shows(tab.id));
  const pinned = shows("pinned") ? livePins(pins, lists, projects) : [];

  const maintAttention = assetsAll.filter((a) => summarize(a, today).status !== "ok").length;
  const habitLeft = habitsForDay(habits, today).filter((h) => !h.checks.includes(today)).length;

  function tileCount(id: Tile): number {
    if (id === "today") return countToday(tasks, today);
    if (id === "inbox") return countInbox(tasks);
    if (id === "tomorrow") return countTomorrow(tasks, today);
    if (id === "checklist") return countOpen(tasks);
    return overdueCount;
  }

  function rowCount(id: ViewNav): number {
    if (id === "week") return countWeek(tasks, today);
    if (id === "shared" && share) return scopeTasks(tasks, "shared", today, share).length;
    if (id === "habits") return habitLeft;
    if (id === "maintenance") return maintAttention;
    return 0;
  }

  function openProject(id: string) {
    onProject?.(id);
  }

  const listItems: GroupItem[] = lists.map((list, index) => {
    const n = countList(tasks, list.id);
    return {
      key: `list:${list.id}`,
      name: list.name,
      count: n > 0 ? String(n) : null,
      pin: `list:${list.id}`,
      color: PALETTE[index % PALETTE.length],
      shared: Boolean(share && ((list.members ?? []).length > 0 || ownerOf(list, share.dataOwner) !== share.me)),
      open: () => onView(`list:${list.id}`),
    };
  });
  const projectItems: GroupItem[] = projects.map((project, index) => {
    const { done, total } = projectProgress(project);
    return {
      key: `project:${project.id}`,
      name: project.title || "Без названия",
      // «0/2» says something (nothing done yet); an empty project shows nothing.
      count: total > 0 ? `${done}/${total}` : null,
      pin: `project:${project.id}`,
      color: PALETTE[(index + 3) % PALETTE.length],
      open: () => openProject(project.id),
    };
  });
  const tagItems: GroupItem[] = [...new Set(tasks.flatMap((task) => task.tags ?? []))]
    .sort((a, b) => a.localeCompare(b, "ru"))
    .map((tag, index) => {
      const n = tasks.filter((task) => !task.done && (task.tags ?? []).includes(tag)).length;
      return { key: `tag:${tag}`, name: tag, count: n > 0 ? String(n) : null, pin: null, color: PALETTE[(index + 5) % PALETTE.length], open: () => onView(`tag:${tag}`) };
    });
  const groupItems: Record<DrawerTab, GroupItem[]> = { lists: listItems, projects: projectItems, tags: tagItems };
  const searching = query.trim().length > 0;
  const searchable = groups.some((group) => groupItems[group.id].length > 0);

  const pinItems = pinned
    .map((pin) => [...listItems, ...projectItems].find((item) => item.pin === pin))
    .filter((item): item is GroupItem => Boolean(item));

  function submitNew(kind: DrawerTab) {
    const name = draft.trim();
    setDraft("");
    setAdding(null);
    if (!name) return;
    if (kind === "projects") openProject(addProject(name));
    else onView(`list:${addList(name)}`);
  }

  const activeKey = view.startsWith("list:") || view.startsWith("tag:") ? view : null;

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col bg-bg text-fg">
      <div className="flex shrink-0 items-center gap-2 px-4 pt-2 pb-1">
        <img src={FAVICON_SVG} alt="" width={28} height={28} className="size-7 shrink-0 rounded-[0.45rem]" />
        <p className="min-w-0 flex-1 truncate text-[1.25rem] leading-tight font-bold tracking-tight">{APP_NAME}</p>
        <Button
          size="icon"
          variant="ghost"
          aria-label="Настройки"
          aria-current={view === "settings" ? "page" : undefined}
          title="Настройки"
          onClick={() => onView("settings")}
          className={cn("size-9 text-muted", view === "settings" && "text-accent")}
        >
          <Settings className="size-5" strokeWidth={1.75} />
        </Button>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-1 pb-[max(env(safe-area-inset-bottom),1rem)]" aria-label="Разделы">
        {searchable ? (
          <label className="relative block">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-subtle" aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Поиск списков"
              aria-label="Поиск списков"
              className="h-9 w-full rounded-[0.625rem] bg-fg/[0.07] pr-3 pl-8 text-[0.9375rem] outline-none placeholder:text-subtle"
            />
          </label>
        ) : null}

        {!searching && tiles.length > 0 ? (
          <ul className={cn("mt-3 grid gap-2", tiles.length === 1 ? "grid-cols-1" : "grid-cols-2")}>
            {tiles.map((id) => {
              const meta = TILE_META[id];
              const Icon = meta.icon;
              const target: View = id === "overdue" ? "today" : id;
              const active = id !== "overdue" && view === id;
              const n = tileCount(id);
              return (
                                <li key={id}>
                  <button
                    type="button"
                    aria-current={active ? "page" : undefined}
                    onClick={() => onView(target)}
                    className={cn(
                      "press flex h-[4.5rem] w-full flex-col justify-between menu-card rounded-xl p-2 text-left shadow-[0_0.5px_0_var(--line)]",
                      active && "ring-2 ring-accent/60",
                    )}
                  >
                    <span className="flex w-full items-start justify-between">
                      <Badge color={meta.color} icon={Icon} big />
                      <span className={cn("text-[1.375rem] leading-none font-bold tabular-nums", n === 0 && "opacity-35")}>{n}</span>
                    </span>
                    <span className="truncate text-[0.875rem] leading-tight font-semibold text-muted">{meta.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}

        {!searching && pinItems.length > 0 ? (
          <Card title="Закреплённые">
            {pinItems.map((item) => (
              <GroupRow
                key={item.key}
                item={item}
                icon={item.key.startsWith("project:") ? Folder : List}
                active={activeKey === item.key}
                pinned
                hidePinMark
                menuOpen={menuFor === `pin:${item.key}`}
                onMenu={(open) => setMenuFor(open ? `pin:${item.key}` : null)}
                onTogglePin={() => {
                  if (item.pin) togglePin(item.pin);
                  setMenuFor(null);
                }}
              />
            ))}
          </Card>
        ) : null}

        {!searching && rows.length > 0 ? (
          <Card title="Разделы">
            {rows.map((id) => {
              const Icon = NAV_ICONS[id];
              const active = view === id || (id === "today" && view.startsWith("day:"));
              const n = rowCount(id);
              return (
                <li key={id}>
                  <button
                    type="button"
                    aria-current={active ? "page" : undefined}
                    onClick={() => onView(id)}
                    className={cn(ROW, active && "bg-fg/[0.06]")}
                  >
                    <Badge color={ROW_COLORS[id] ?? "#8e8e93"} icon={Icon} />
                    <span className="min-w-0 flex-1 truncate">{label(id)}</span>
                    {n > 0 ? <span className="shrink-0 text-[0.9375rem] text-subtle tabular-nums">{n}</span> : null}
                    <ChevronRight className="size-4 shrink-0 text-subtle/60" aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </Card>
        ) : null}

        {groups.map((group) => {
          const all = groupItems[group.id];
          const items = searching ? all.filter((item) => matchName(item.name, query)) : all;
          if (searching && items.length === 0) return null;
          if (group.id === "tags" && all.length === 0) return null;
          const title = group.id === "lists" ? "Мои списки" : group.label;
          const isFolded = !searching && folded[group.id];
          return (
            <Card
              key={group.id}
              title={title}
              folded={isFolded}
              onFold={() => setFolded((f) => ({ ...f, [group.id]: !f[group.id] }))}
              count={isFolded && all.length > 0 ? all.length : undefined}
            >
              {isFolded
                ? null
                : items.map((item) => (
                    <GroupRow
                      key={item.key}
                      item={item}
                      icon={GLYPH[group.id]}
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
              {!isFolded && all.length === 0 ? (
                <li className="py-2 pr-3 pl-[3.25rem] text-[0.8125rem] text-subtle">{group.id === "projects" ? "Проектов пока нет." : "Списков пока нет."}</li>
              ) : null}
              {!isFolded && !searching && group.add ? (
                adding === group.id ? (
                  <AddField kind={group.id} draft={draft} setDraft={setDraft} onSubmit={() => submitNew(group.id)} onCancel={() => setAdding(null)} />
                ) : (
                  <li>
                    <button type="button" onClick={() => setAdding(group.id)} className={cn(ROW, "text-accent")}>
                      <Badge color="#8e8e93" icon={Plus} />
                      {group.add}
                    </button>
                  </li>
                )
              ) : null}
            </Card>
          );
        })}

        {searching && !groups.some((g) => groupItems[g.id].some((item) => matchName(item.name, query))) ? (
          <p className="px-1 pt-3 text-[0.8125rem] text-subtle">Ничего не нашлось.</p>
        ) : null}

      </nav>
    </div>
  );
}

/** One row inside a grouped card: 44 px, a 28 px badge; hairlines between rows start after the badge (.menu-card). */
const ROW =
  "flex h-11 w-full touch-manipulation items-center gap-3 px-3 text-left text-[0.9375rem] transition-colors duration-150 select-none [-webkit-touch-callout:none] active:bg-fg/[0.06]";

/** A grouped inset card with a small caption; the caption folds the card when onFold is set. */
function Card({ title, children, folded, onFold, count }: { title: string; children: ReactNode; folded?: boolean; onFold?: () => void; count?: number }) {
  return (
    <section aria-label={title} className="mt-4">
      {onFold ? (
        <button type="button" aria-expanded={!folded} onClick={onFold} className="mb-1 flex w-full items-center gap-1 px-1 text-left">
          <SectionLabel>{title}</SectionLabel>
          {count ? <span className="text-[0.75rem] text-subtle tabular-nums">{count}</span> : null}
          <ChevronDown className={cn("ml-auto size-4 text-subtle transition-transform duration-150", folded && "-rotate-90")} aria-hidden="true" />
        </button>
      ) : (
        <div className="mb-1 px-1">
          <SectionLabel>{title}</SectionLabel>
        </div>
      )}
      {folded ? null : <ul className="menu-card overflow-hidden rounded-xl">{children}</ul>}
    </section>
  );
}

function AddField({ kind, draft, setDraft, onSubmit, onCancel }: { kind: DrawerTab; draft: string; setDraft: (v: string) => void; onSubmit: () => void; onCancel: () => void }) {
  const name = kind === "projects" ? "Название проекта" : "Название списка";
  return (
    <li>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <input
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => {
            if (!draft.trim()) onCancel();
          }}
          placeholder={name}
          aria-label={name}
          className="h-11 w-full bg-transparent pr-3 pl-[3.25rem] text-[0.9375rem] text-fg outline-none placeholder:text-subtle"
        />
      </form>
    </li>
  );
}

/** The one icon style of the menu: a solid squircle (radius 25%) with a white glyph. */
function Badge({ color, icon: Icon, big }: { color: string; icon: typeof Inbox; big?: boolean }) {
  return (
    <span
      className={cn("flex shrink-0 items-center justify-center text-white", big ? "size-8 rounded-[0.5rem]" : "size-7 rounded-[0.4375rem]")}
      style={{ background: color }}
      aria-hidden="true"
    >
      <Icon className={big ? "size-[1.125rem]" : "size-4"} strokeWidth={2.25} />
    </span>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <p className="text-[0.6875rem] font-semibold tracking-wide text-subtle uppercase">{children}</p>;
}

function GroupRow({
  item,
  icon,
  active,
  pinned,
  hidePinMark,
  menuOpen,
  onMenu,
  onTogglePin,
}: {
  item: GroupItem;
  icon: typeof Inbox;
  active: boolean;
  pinned: boolean;
  hidePinMark?: boolean;
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
        className={cn(ROW, active && "bg-fg/[0.06] font-medium")}
      >
        <Badge color={item.color ?? "#8e8e93"} icon={icon} />
        <span className="min-w-0 flex-1 truncate">{item.name}</span>
        {pinned && !hidePinMark ? <Pin className="size-3.5 shrink-0 text-subtle" aria-label="закреплён" /> : null}
        {item.shared ? <Users className="size-3.5 shrink-0 text-subtle" aria-label="общий список" /> : null}
        {item.count ? <span className="shrink-0 text-[0.9375rem] text-subtle tabular-nums">{item.count}</span> : null}
      </button>
      {menuOpen ? (
        <div role="menu" className="mx-2 mb-2 flex items-center gap-1 rounded-lg bg-elevated p-1 text-sm">
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
