import { APP_NAME, APP_VERSION } from "@/lib/site";
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import {
  Archive,
  ArrowDown,
  ArrowUp,
  Bell,
  CheckCheck,
  CalendarClock,
  ChevronRight,
  GripVertical,
  Cloud,
  HardDriveDownload,
  Info,
  MinusCircle,
  Palette,
  PanelBottom,
  Plus,
  Sparkles,
} from "lucide-react";
import { AssistantSection } from "@/components/planner/assist-settings";
import { NAV_ICONS, TAB_ICONS } from "@/components/planner/tab-icons";
import { Sheet } from "@/components/ui/sheet";
import { SwitchRow } from "@/components/ui/rows";
import {
  CALENDAR_MODES,
  DEFAULT_TABS,
  MAX_TABS,
  MIN_TABS,
  NAV_ITEMS,
  TAB_OPTIONS,
  isNavId,
  moveTab,
  placeTab,
  placementOf,
  setPlacement,
  toggleTab,
  type NavId,
  type NavPrefs,
  type Placement,
  type TabId,
} from "@/lib/ui-prefs";
import { ACCENTS } from "@/lib/accents";
import { addFromBackup, saveBackup } from "@/lib/backup";
import { cn } from "@/lib/cn";
import { usePlanner } from "@/lib/planner-store";
import { changePassword, dismissLegacyNote, logout, logoutEverywhere, syncServerNow } from "@/lib/server-sync";
import { reloadProfile, useProfile } from "@/lib/use-capabilities";
import { phaseLabel, useServerSyncStatus } from "@/lib/use-server-sync";
import { ARCHIVE_OPTIONS, archivedTasks, recentDone } from "@/lib/task-done";
import { syncNow } from "@/lib/sync/clock";
import { useShareScope } from "@/lib/use-share-scope";
import type { View } from "@/lib/planner-types";

function ArchiveSection({ onView }: { onView?: (view: View) => void }) {
  const archiveDays = usePlanner((s) => s.archiveDays);
  const setArchiveDays = usePlanner((s) => s.setArchiveDays);
  const { done, archived } = useDoneCounts();
  const [help, setHelp] = useState(false);
  return (
    <section aria-label="Готово и архив" className="text-sm">
      <div className="divide-y divide-line overflow-hidden rounded-xl bg-elevated">
        <button type="button" disabled={!onView} onClick={() => onView?.("done")} className="flex min-h-11 w-full items-center gap-3 px-3 text-left">
          <CheckCheck className="size-[1.125rem] shrink-0 text-accent" strokeWidth={1.75} aria-hidden="true" />
          <span className="min-w-0 flex-1 text-[0.9375rem]">Выполненные</span>
          <span className="text-muted tabular-nums">{done}</span>
          <ChevronRight className="size-4 shrink-0 text-subtle" aria-hidden="true" />
        </button>
        <button type="button" disabled={!onView} onClick={() => onView?.("archive")} className="flex min-h-11 w-full items-center gap-3 px-3 text-left">
          <Archive className="size-[1.125rem] shrink-0 text-accent" strokeWidth={1.75} aria-hidden="true" />
          <span className="min-w-0 flex-1 text-[0.9375rem]">Архив</span>
          <span className="text-muted tabular-nums">{archived}</span>
          <ChevronRight className="size-4 shrink-0 text-subtle" aria-hidden="true" />
        </button>
      </div>
      <div className="mt-4 mb-1 flex items-center gap-1 px-1">
        <p className="min-w-0 flex-1 text-[0.6875rem] font-semibold tracking-wide text-subtle uppercase">Убирать в архив</p>
        <button
          type="button"
          aria-expanded={help}
          aria-label="Подсказка"
          onClick={() => setHelp((value) => !value)}
          className="flex size-7 shrink-0 items-center justify-center rounded-full bg-elevated text-xs font-semibold text-muted"
        >
          ?
        </button>
      </div>
      {help ? (
        <p className="mb-2 rounded-lg bg-elevated px-3 py-2 text-xs text-muted">
          Выполненные задачи сначала видны внизу списка в группе «Готово», а через выбранный срок уходят в «Архив». Из архива задачу можно вернуть
          или удалить. Срок общий для всех ваших устройств.
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Убирать в архив">
        {ARCHIVE_OPTIONS.map((days) => {
          const on = archiveDays === days;
          return (
            <button
              key={days}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setArchiveDays(days)}
              className={cn("h-10 rounded-xl px-3 text-sm", on ? "bg-accent text-accent-fg" : "card-lift bg-elevated text-fg")}
            >
              {days === 0 ? "Никогда" : `${days} ${days === 1 ? "день" : days < 5 ? "дня" : "дней"}`}
            </button>
          );
        })}
      </div>
    </section>
  );
}

/** «Выполненные» (still in lists) and «Архив» counts, as in the menu of 1.6. */
function useDoneCounts(): { done: number; archived: number } {
  const tasks = usePlanner((s) => s.tasks);
  const archiveDays = usePlanner((s) => s.archiveDays);
  const now = syncNow();
  return { done: recentDone(tasks, now, archiveDays).length, archived: archivedTasks(tasks, now, archiveDays).length };
}

function formatSyncTime(stamp: number | null): string {
  if (!stamp) return "ещё не было";
  const date = new Date(stamp);
  const time = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(date);
  const sameDay = new Date().toDateString() === date.toDateString();
  if (sameDay) return `сегодня в ${time}`;
  const day = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" }).format(date);
  return `${day} в ${time}`;
}

const MIN_PASSWORD = 12;

function ProfileSection() {
  const profile = useProfile();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  if (!profile.login) return <p className="text-sm text-muted">Вход не настроен: данные хранятся только на этом устройстве и на сервере без профилей.</p>;
  const length = [...next].length;
  const mismatch = repeat.length > 0 && repeat !== next;
  const canSave = current.length > 0 && length >= MIN_PASSWORD && repeat === next && !busy;
  const field = "mt-1 h-11 w-full rounded-md border border-line bg-surface px-3 text-base text-fg outline-none";
  return (
    <section aria-label="Профиль">
      <p className="text-sm text-muted">
        Вы вошли как <span className="font-medium text-fg">{profile.name || profile.login}</span>
        {profile.name && profile.name !== profile.login ? <span className="text-subtle"> ({profile.login})</span> : null}.
        {profile.multiUser
          ? " У каждого профиля свои задачи, списки и привычки; общими становятся только те, которыми поделились."
          : " Один профиль на сервере — второй человек добавляется в .env (APP_USERS), см. docs/SYNOLOGY.md."}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => {
            setOpen((value) => !value);
            setDone(false);
            setError("");
          }}
          className="h-11 rounded-xl bg-elevated px-4 text-sm text-fg"
        >
          Сменить пароль
        </button>
        <button type="button" onClick={() => void logout()} className="h-11 rounded-xl px-4 text-sm text-muted">
          Выйти из профиля
        </button>
      </div>
      {done ? <p className="mt-2 text-sm text-ok" role="status">Пароль изменён. Остальные ваши устройства вышли — там войдите с новым паролем.</p> : null}
      {open ? (
        <form
          className="card-lift mt-3 rounded-xl bg-elevated p-4 text-sm"
          onSubmit={(event) => {
            event.preventDefault();
            if (!canSave) return;
            setBusy(true);
            setError("");
            changePassword(current, next, repeat)
              .then(() => {
                setDone(true);
                setOpen(false);
                setCurrent("");
                setNext("");
                setRepeat("");
                reloadProfile();
              })
              .catch((err: unknown) => setError(err instanceof Error ? err.message : "Не получилось."))
              .finally(() => setBusy(false));
          }}
        >
          <input type="text" name="username" value={profile.login} autoComplete="username" readOnly hidden aria-hidden="true" tabIndex={-1} />
          <label className="block text-xs font-medium text-subtle">
            Текущий пароль
            <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} className={field} />
          </label>
          <label className="mt-3 block text-xs font-medium text-subtle">
            Новый пароль
            <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} className={field} aria-describedby="pw-hint" />
          </label>
          <p id="pw-hint" className={cn("mt-1 text-xs", next && length < MIN_PASSWORD ? "text-warn" : "text-muted")}>
            Не короче {MIN_PASSWORD} символов{next ? ` (сейчас ${length})` : ""}. Удобнее всего фраза из 3–4 случайных слов через пробел — её легко
            запомнить и трудно подобрать.
          </p>
          <label className="mt-3 block text-xs font-medium text-subtle">
            Новый пароль ещё раз
            <input type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} className={field} />
          </label>
          {mismatch ? <p className="mt-1 text-xs text-warn">Пароли пока не совпадают.</p> : null}
          {error ? (
            <p className="mt-2 text-xs text-danger" role="alert">
              {error}
            </p>
          ) : null}
          <p className="mt-3 text-xs text-muted">
            Новый пароль хранится на сервере (data/users.json) и заменяет пароль из .env. Остальные ваши устройства выйдут, это — останется. Забыли
            пароль? Его сбрасывают на сервере: <code>docker exec pora-app node scripts/reset-password.mjs {profile.login}</code>.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="submit" disabled={!canSave} className="h-11 rounded-xl bg-accent px-4 text-sm text-accent-fg disabled:opacity-50">
              {busy ? "Сохраняем…" : "Сохранить пароль"}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="h-11 rounded-xl px-4 text-sm text-muted">
              Отмена
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}

function ConnectionSection() {
  const status = useServerSyncStatus();
  const [busy, setBusy] = useState(false);
  const [confirmAll, setConfirmAll] = useState(false);
  const [allBusy, setAllBusy] = useState(false);
  const [allError, setAllError] = useState("");
  const label = phaseLabel(status);
  return (
    <section aria-label="Подключение">
      <p className="text-sm text-muted">
        Задачи хранятся на вашем сервере и на этом устройстве. {APP_NAME} · версия {APP_VERSION}
      </p>
      <div className="card-lift mt-3 rounded-xl bg-elevated p-4 text-sm">
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className={cn(
              "size-2.5 rounded-full",
              label.tone === "ok" ? "bg-ok" : label.tone === "danger" ? "bg-danger" : "bg-subtle",
            )}
          />
          <span className="font-medium">{label.text}</span>
        </div>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-muted">
          <dt>Последняя синхронизация</dt>
          <dd className="text-right text-fg tabular-nums">{formatSyncTime(status.lastSyncAt)}</dd>
          <dt>Версия на сервере</dt>
          <dd className="text-right text-fg tabular-nums">{status.revision ?? "—"}</dd>
          <dt>Неотправленные изменения</dt>
          <dd className={cn("text-right", status.dirty ? "text-warn" : "text-fg")}>{status.dirty ? "есть" : "нет"}</dd>
        </dl>
        {status.lastError ? <p className="mt-3 text-xs text-danger">{status.lastError}</p> : null}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void syncServerNow().finally(() => setBusy(false));
          }}
          className="h-11 rounded-xl bg-accent px-4 text-sm text-accent-fg disabled:opacity-60"
        >
          {busy ? "Синхронизация…" : "Синхронизировать сейчас"}
        </button>
        <button type="button" onClick={() => void logout()} className="h-11 rounded-xl px-4 text-sm text-muted">
          Выйти
        </button>
        <button
          type="button"
          onClick={() => {
            setAllError("");
            setConfirmAll(true);
          }}
          aria-expanded={confirmAll}
          className="h-11 rounded-xl px-4 text-sm text-danger"
        >
          Выйти на всех устройствах
        </button>
      </div>
      {confirmAll ? (
        <div role="alertdialog" aria-labelledby="logout-all-title" className="card-lift mt-3 rounded-xl bg-elevated p-4 text-sm">
          <p id="logout-all-title" className="font-medium">
            Выйти на всех устройствах?
          </p>
          <p className="mt-1 text-muted">
            Все сеансы вашего профиля будут завершены, включая этот: на каждом вашем телефоне и компьютере нужно будет снова ввести пароль.
            Пригодится, если устройство потеряно или пароль мог узнать кто-то ещё — тогда смените и пароль («Профиль» → «Сменить пароль»).
            Другие профили не затронуты. Данные не удаляются.
          </p>
          {allError ? <p className="mt-2 text-xs text-danger">{allError}</p> : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={allBusy}
              onClick={() => {
                setAllBusy(true);
                logoutEverywhere()
                  .catch((error: unknown) => setAllError(error instanceof Error ? error.message : "Не получилось."))
                  .finally(() => setAllBusy(false));
              }}
              className="h-11 rounded-xl bg-danger px-4 text-sm text-on-danger disabled:opacity-60"
            >
              {allBusy ? "Завершаем сеансы…" : "Да, выйти везде"}
            </button>
            <button type="button" disabled={allBusy} onClick={() => setConfirmAll(false)} className="h-11 rounded-xl px-4 text-sm text-muted">
              Отмена
            </button>
          </div>
        </div>
      ) : null}
      {status.legacyNote ? (
        <p className="mt-3 text-xs text-muted">
          {status.legacyNote}{" "}
          <button type="button" onClick={dismissLegacyNote} className="text-fg underline underline-offset-2">
            Понятно
          </button>
        </p>
      ) : null}
    </section>
  );
}

function BackupSection() {
  const [note, setNote] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <section aria-label="Резервная копия">
      <p className="text-sm text-muted">
        Файл со всеми задачами, списками, привычками и проектами. Из копии добавляется только то, чего сейчас нет, — текущие задачи не
        перезаписываются.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            void saveBackup().then((result) => setNote(result === "saved" ? "Копия сохранена." : "Сохранение отменено."));
          }}
          className="h-11 rounded-xl bg-accent px-4 text-sm text-accent-fg"
        >
          Сохранить копию
        </button>
        <button type="button" onClick={() => fileRef.current?.click()} className="h-11 rounded-xl px-4 text-sm text-fg">
          Добавить из копии
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json,text/plain"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          void addFromBackup(file).then(
            (added) => {
              if (added === null) setNote("Это не файл копии «Пора».");
              else if (added === 0) setNote("Всё из копии уже есть.");
              else setNote(`Добавлено записей: ${added}.`);
            },
            () => setNote("Файл не подошёл."),
          );
        }}
      />
      {note ? <p className="mt-2 text-xs text-muted">{note}</p> : null}
    </section>
  );
}

type SheetId = "profile" | "look" | "tabs" | "notify" | "datetime" | "connection" | "archive" | "backup" | "assistant" | "about";

const SHEET_TITLES: Record<SheetId, string> = {
  profile: "Профиль",
  look: "Вид",
  tabs: "Навигация",
  notify: "Уведомления",
  datetime: "Дата и время",
  connection: "Подключение",
  archive: "Архив",
  backup: "Резервная копия",
  assistant: "Помощник",
  about: "О приложении",
};

/** Settings row: coloured icon, label, value, «›». */
function NavRow({
  id,
  icon: Icon,
  color,
  label,
  value,
  onOpen,
}: {
  id: SheetId;
  icon: typeof Info;
  color: string;
  label: string;
  value?: string;
  onOpen: (id: SheetId) => void;
}) {
  return (
    <button type="button" data-row={id} onClick={() => onOpen(id)} className="flex min-h-12 w-full items-center gap-3 px-3 text-left">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-lg text-white" style={{ background: color }} aria-hidden="true">
        <Icon className="size-4" strokeWidth={2} />
      </span>
      <span className="min-w-0 flex-1 truncate text-[0.9375rem] text-fg">{label}</span>
      {value ? <span className="max-w-[62%] shrink-0 truncate text-sm text-muted">{value}</span> : null}
      <ChevronRight className="size-4 shrink-0 text-subtle" aria-hidden="true" />
    </button>
  );
}

function Group({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <div className="mt-4">
      {title ? <p className="mb-1 px-3 text-xs font-medium text-subtle uppercase">{title}</p> : null}
      <div className="card-lift divide-y divide-line overflow-hidden rounded-2xl bg-elevated">{children}</div>
    </div>
  );
}

function LookSection() {
  const theme = usePlanner((s) => s.theme);
  const accent = usePlanner((s) => s.accent);
  const setTheme = usePlanner((s) => s.setTheme);
  const setAccent = usePlanner((s) => s.setAccent);
  return (
    <div>
      <p className="text-xs font-medium text-subtle">Тема</p>
      <div className="mt-2 grid grid-cols-2 gap-1 rounded-xl bg-elevated p-1" role="radiogroup" aria-label="Тема">
        {(["light", "dark"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={theme === mode}
            onClick={() => setTheme(mode)}
            className={cn("h-10 rounded-lg text-sm", theme === mode ? "bg-surface font-medium text-fg shadow-sm" : "text-muted")}
          >
            {mode === "light" ? "Светлая" : "Тёмная"}
          </button>
        ))}
      </div>
      <p className="mt-5 text-xs font-medium text-subtle">Цвет акцента</p>
      <p className="mt-0.5 text-xs text-muted">Кнопки, выбранный день и отметки.</p>
      <div className="mt-3 grid grid-cols-4 gap-3">
        {ACCENTS.map((item) => {
          const on = accent === item.id;
          return (
            <button key={item.id} type="button" aria-pressed={on} aria-label={item.name} onClick={() => setAccent(item.id)} className="flex flex-col items-center gap-1.5">
              <span className={cn("size-10 rounded-full", item.swatch, on ? "ring-2 ring-fg ring-offset-2 ring-offset-surface" : "")} />
              <span className={cn("text-xs", on ? "text-fg" : "text-muted")}>{item.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * «Навигация»: every section has one place — the bottom bar on a phone (2–5,
 * ordered by dragging ≡), the side menu, or hidden. Items in the bar never
 * repeat in the menu.
 */
function NavigationSection() {
  const tabs = usePlanner((s) => s.tabBar) ?? DEFAULT_TABS;
  const hidden = usePlanner((s) => s.drawerHidden) ?? [];
  const setNav = usePlanner((s) => s.setNav);
  const setTabs = usePlanner((s) => s.setTabBar);
  const profile = useProfile();
  const share = useShareScope();
  const [help, setHelp] = useState(false);
  const [drag, setDrag] = useState<{ id: TabId; order: TabId[] } | null>(null);
  const prefs: NavPrefs = { tabBar: tabs, drawerHidden: hidden };
  const shown = drag?.order ?? tabs;
  // Sections this profile does not have are not offered.
  const available = NAV_ITEMS.filter((item) => (item.id !== "assist" || profile.assistant) && (item.id !== "shared" || share));
  const addable = available.filter((item) => item.tab && placementOf(item.id, prefs) !== "bottom");
  const menu = available.filter((item) => placementOf(item.id, prefs) !== "bottom");
  const full = tabs.length >= MAX_TABS;
  const move = (id: NavId, to: Placement) => setNav(setPlacement(prefs, id, to));

  function beginDrag(event: ReactPointerEvent<HTMLElement>, id: TabId) {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    let order = tabs;
    setDrag({ id, order });
    const onMove = (ev: PointerEvent) => {
      const rows = [...document.querySelectorAll<HTMLElement>("[data-tab-row]")];
      const index = rows.findIndex((row) => {
        const rect = row.getBoundingClientRect();
        return ev.clientY < rect.top + rect.height / 2;
      });
      order = placeTab(order, id, index < 0 ? rows.length - 1 : index > order.indexOf(id) ? index - 1 : index);
      setDrag({ id, order });
    };
    const finish = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", finish);
      handle.removeEventListener("pointercancel", finish);
      setDrag(null);
      if (order.join() !== tabs.join()) setTabs(order);
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
  }

  const label = (id: string) => NAV_ITEMS.find((item) => item.id === id)?.label ?? TAB_OPTIONS.find((tab) => tab.id === id)?.label ?? id;
  const heading = "mt-4 mb-1 px-1 text-[0.6875rem] font-semibold tracking-wide text-subtle uppercase";

  return (
    <div className="text-sm">
      <div className="flex items-center gap-1 px-1">
        <p className="min-w-0 flex-1 text-xs text-muted">Что видно внизу и в боковом меню</p>
        <button
          type="button"
          aria-expanded={help}
          aria-label="Подсказка"
          onClick={() => setHelp((value) => !value)}
          className="flex size-7 shrink-0 items-center justify-center rounded-full bg-elevated text-xs font-semibold text-muted"
        >
          ?
        </button>
      </div>
      {help ? (
        <p className="mt-1 rounded-lg bg-elevated px-3 py-2 text-xs text-muted">
          Внизу — от {MIN_TABS} до {MAX_TABS} вкладок, порядок меняется перетаскиванием за ≡. Пункт стоит в одном месте: что внизу, того нет в меню.
          Выключенное в меню можно открыть, вернув переключатель. На компьютере нижней панели нет — там видно всё, кроме скрытого.
        </p>
      ) : null}

      <p className={heading}>
        Нижняя панель · {tabs.length} из {MAX_TABS}
      </p>
      <ul className="divide-y divide-line overflow-hidden rounded-xl bg-elevated">
        {shown.map((id, index) => {
          const Icon = TAB_ICONS[id];
          const name = label(id);
          // «Настройки» from 1.6 can only leave the bar (the gear is in the menu header now).
          const toMenu = isNavId(id) ? () => move(id, "menu") : () => setTabs(toggleTab(tabs, id));
          return (
            <li key={id} data-tab-row="" className={cn("flex min-h-11 items-center gap-2 pr-1", drag?.id === id && "bg-surface shadow-md")}>
              <button
                type="button"
                aria-label={`Убрать «${name}» с панели в меню`}
                disabled={tabs.length <= MIN_TABS}
                onClick={toMenu}
                className="flex size-11 shrink-0 items-center justify-center text-danger disabled:opacity-30"
              >
                <MinusCircle className="size-5" />
              </button>
              <Icon className="size-5 shrink-0 text-accent" strokeWidth={1.75} aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate text-[0.9375rem]">{name}</span>
              {/* Keyboard / screen-reader fallback for the drag handle. */}
              <button type="button" aria-label={`${name}: левее`} disabled={index === 0} onClick={() => setTabs(moveTab(tabs, id, -1))} className="sr-only focus:not-sr-only">
                <ArrowUp className="size-4" />
              </button>
              <button
                type="button"
                aria-label={`${name}: правее`}
                disabled={index === shown.length - 1}
                onClick={() => setTabs(moveTab(tabs, id, 1))}
                className="sr-only focus:not-sr-only"
              >
                <ArrowDown className="size-4" />
              </button>
              <span
                aria-hidden="true"
                title="Потяните, чтобы поменять порядок"
                onPointerDown={(event) => beginDrag(event, id)}
                className="drag-handle flex size-11 shrink-0 cursor-grab items-center justify-center text-subtle"
              >
                <GripVertical className="size-5" />
              </span>
            </li>
          );
        })}
      </ul>

      {addable.length > 0 ? (
        <>
          <p className={heading}>Можно добавить в панель</p>
          <ul className="grid grid-cols-3 gap-1.5">
            {addable.map((item) => (
              <li key={item.id} className="min-w-0">
                <button
                  type="button"
                  aria-label={`Добавить «${item.label}» на панель`}
                  disabled={full}
                  onClick={() => move(item.id, "bottom")}
                  className="card-lift flex h-10 w-full min-w-0 items-center gap-1.5 rounded-xl bg-elevated px-2.5 text-left text-[0.875rem] disabled:opacity-40"
                >
                  <Plus className="size-4 shrink-0 text-accent" aria-hidden="true" />
                  <span className="min-w-0 truncate">{item.label}</span>
                </button>
              </li>
            ))}
          </ul>
          {full ? <p className="mt-1 px-1 text-xs text-muted">Панель заполнена — уберите вкладку, чтобы добавить другую.</p> : null}
        </>
      ) : null}

      <p className={heading}>Боковое меню</p>
      <ul className="divide-y divide-line overflow-hidden rounded-xl bg-elevated">
        {menu.map((item) => {
          const Icon = NAV_ICONS[item.id];
          const on = placementOf(item.id, prefs) === "menu";
          return (
            <li key={item.id}>
              <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3">
                <Icon className="size-[1.125rem] shrink-0 text-subtle" strokeWidth={1.75} aria-hidden="true" />
                <span className={cn("min-w-0 flex-1 truncate text-[0.9375rem]", on ? "text-fg" : "text-muted")}>{item.label}</span>
                <input
                  type="checkbox"
                  role="switch"
                  checked={on}
                  aria-label={`«${item.label}» в меню`}
                  onChange={(event) => move(item.id, event.target.checked ? "menu" : "hidden")}
                  className="ios-switch shrink-0"
                />
              </label>
            </li>
          );
        })}
      </ul>
      <div className="mt-2 flex items-center justify-between gap-2 px-1">
        <p className="text-xs text-muted">Пункты из нижней панели в меню не повторяются.</p>
        <button type="button" onClick={() => setNav({ tabBar: [...DEFAULT_TABS], drawerHidden: [] })} className="h-9 shrink-0 text-sm text-accent">
          Сбросить
        </button>
      </div>
    </div>
  );
}

function NotifySection() {
  const [perm, setPerm] = useState<NotificationPermission | "off">("off");
  useEffect(() => {
    if (typeof Notification === "undefined") return;
    setPerm(Notification.permission);
  }, []);
  return (
    <div className="text-sm">
      <div className="divide-y divide-line overflow-hidden rounded-xl bg-elevated">
        <div className="flex min-h-11 items-center gap-3 px-3">
          <span className="min-w-0 flex-1">Уведомления браузера</span>
          <span className={cn("text-sm", perm === "granted" ? "text-ok" : perm === "denied" ? "text-danger" : "text-muted")}>
            {perm === "granted" ? "Включены" : perm === "denied" ? "Запрещены" : perm === "default" ? "Не включены" : "Недоступны"}
          </span>
        </div>
      </div>
      {perm === "default" ? (
        <button
          type="button"
          onClick={() => {
            void Notification.requestPermission().then((next) => setPerm(next));
          }}
          className="mt-3 h-11 w-full rounded-xl bg-accent text-sm text-accent-fg"
        >
          Включить уведомления
        </button>
      ) : null}
      {perm === "denied" ? <p className="mt-2 text-xs text-muted">Разрешите уведомления для этого сайта в настройках браузера (на iPhone — «Настройки» → «Уведомления»).</p> : null}
      <p className="mt-3 text-xs text-muted">
        Время напоминания ставится в задаче («Напомнить»), привычке или дате. Звук играет, пока «Пора» открыта; на iPhone уведомления приходят, если
        приложение добавлено на экран «Домой». Сработавшие напоминания — под колокольчиком вверху; полоску можно скрыть крестиком.
      </p>
    </div>
  );
}

function DateTimeSection() {
  const workStart = usePlanner((s) => s.workStart) ?? "09:00";
  const workEnd = usePlanner((s) => s.workEnd) ?? "18:00";
  const setWorkHours = usePlanner((s) => s.setWorkHours);
  const weekNumbers = usePlanner((s) => s.weekNumbers) ?? false;
  const setWeekNumbers = usePlanner((s) => s.setWeekNumbers);
  const mode = usePlanner((s) => s.calendarMode) ?? "month";
  const setMode = usePlanner((s) => s.setCalendarMode);
  const field = "h-9 w-24 rounded-lg bg-surface px-2 text-right tabular-nums outline-none";
  return (
    <div className="text-[0.9375rem]">
      <div className="divide-y divide-line overflow-hidden rounded-xl bg-elevated">
        <label className="flex min-h-11 items-center gap-3 px-3">
          <span className="min-w-0 flex-1">Рабочий день с</span>
          <input type="time" value={workStart} onChange={(event) => setWorkHours(event.target.value || "09:00", workEnd)} className={field} />
        </label>
        <label className="flex min-h-11 items-center gap-3 px-3">
          <span className="min-w-0 flex-1">до</span>
          <input type="time" value={workEnd} onChange={(event) => setWorkHours(workStart, event.target.value || "18:00")} className={field} />
        </label>
      </div>
      <p className="mt-1 px-1 text-xs text-muted">Подсвечивается в «Расписании». Общая настройка для всех ваших устройств.</p>
      <div className="mt-4 divide-y divide-line overflow-hidden rounded-xl bg-elevated">
        <SwitchRow label="Номера недель" hint="В календаре: «41» слева от строки месяца" checked={weekNumbers} onChange={setWeekNumbers} />
        <label className="flex min-h-11 items-center gap-3 px-3">
          <span className="min-w-0 flex-1">Календарь открывать как</span>
          <select aria-label="Вид календаря" value={mode} onChange={(event) => setMode(event.target.value as typeof mode)} className="h-9 rounded-lg bg-surface px-2 outline-none">
            {CALENDAR_MODES.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="mt-1 px-1 text-xs text-muted">Неделя начинается с понедельника. Эти две настройки — только для этого устройства.</p>
    </div>
  );
}

function AboutSection() {
  return (
    <div className="text-sm">
      <div className="flex flex-col items-center py-4 text-center">
        <span className="flex size-14 items-center justify-center rounded-2xl bg-accent text-2xl text-accent-fg" aria-hidden="true">
          ✓
        </span>
        <p className="mt-2 text-lg font-semibold">{APP_NAME}</p>
        <p className="text-muted">Версия {APP_VERSION}</p>
      </div>
      <p className="text-muted">
        Задачи, календарь, привычки, даты и фокус — на вашем сервере. Работает и без сети: изменения отправятся, когда связь вернётся. Чтобы
        поставить как приложение на iPhone: «Поделиться» → «На экран «Домой»».
      </p>
    </div>
  );
}

export function SettingsView({ onView }: { onView?: (view: View) => void }) {
  const profile = useProfile();
  const theme = usePlanner((s) => s.theme);
  const accent = usePlanner((s) => s.accent);
  const tabs = usePlanner((s) => s.tabBar) ?? DEFAULT_TABS;
  const doneCounts = useDoneCounts();
  const status = useServerSyncStatus();
  const [open, setOpen] = useState<SheetId | null>(null);
  const accentName = ACCENTS.find((item) => item.id === accent)?.name ?? "";
  const close = useCallback(() => setOpen(null), []);

  return (
    <div className="mx-auto max-w-md pb-8">
      <button
        type="button"
        data-row="profile"
        onClick={() => setOpen("profile")}
        className="card-lift flex w-full items-center gap-3 rounded-2xl bg-elevated px-3 py-3 text-left"
      >
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent text-lg font-semibold text-accent-fg" aria-hidden="true">
          {(profile.name || profile.login || "?").slice(0, 1).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-base font-semibold">{profile.name || profile.login || "Профиль"}</span>
          <span className="block truncate text-xs text-muted">{profile.login ? "Профиль, пароль, выход" : "Без входа"}</span>
        </span>
        <ChevronRight className="size-4 shrink-0 text-subtle" aria-hidden="true" />
      </button>

      <Group>
        <NavRow id="look" icon={Palette} color="#8b5cf6" label="Вид" value={`${theme === "dark" ? "Тёмная" : "Светлая"} · ${accentName}`} onOpen={setOpen} />
        <NavRow id="tabs" icon={PanelBottom} color="#3b82f6" label="Навигация" value={`${tabs.length} ${tabs.length < 5 ? "вкладки" : "вкладок"}`} onOpen={setOpen} />
        <NavRow id="notify" icon={Bell} color="#ef4444" label="Уведомления" onOpen={setOpen} />
        <NavRow id="datetime" icon={CalendarClock} color="#f59e0b" label="Дата и время" onOpen={setOpen} />
      </Group>

      <Group>
        <NavRow id="connection" icon={Cloud} color="#10b981" label="Подключение" value={phaseLabel(status).text} onOpen={setOpen} />
        <NavRow
          id="archive"
          icon={Archive}
          color="#a16207"
          label="Архив"
          value={`Выполненные ${doneCounts.done} · Архив ${doneCounts.archived}`}
          onOpen={setOpen}
        />
        <NavRow id="backup" icon={HardDriveDownload} color="#14b8a6" label="Резервная копия" onOpen={setOpen} />
        {profile.assistant ? <NavRow id="assistant" icon={Sparkles} color="#0ea5e9" label="Помощник" onOpen={setOpen} /> : null}
      </Group>

      <Group>
        <NavRow id="about" icon={Info} color="#6b7280" label="О приложении" value={APP_VERSION} onOpen={setOpen} />
      </Group>

      <Sheet open={open !== null} title={open ? SHEET_TITLES[open] : ""} onClose={close}>
        <div className="pb-2">
          {open === "profile" ? <ProfileSection /> : null}
          {open === "look" ? <LookSection /> : null}
          {open === "tabs" ? <NavigationSection /> : null}
          {open === "notify" ? <NotifySection /> : null}
          {open === "datetime" ? <DateTimeSection /> : null}
          {open === "connection" ? <ConnectionSection /> : null}
          {open === "archive" ? <ArchiveSection onView={onView} /> : null}
          {open === "backup" ? <BackupSection /> : null}
          {open === "assistant" ? <AssistantSection /> : null}
          {open === "about" ? <AboutSection /> : null}
        </div>
      </Sheet>
    </div>
  );
}
