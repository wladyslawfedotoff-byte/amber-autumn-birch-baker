import { InlineHint } from "@/components/ui/hint";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Bell, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { beep } from "@/lib/beep";
import { cn } from "@/lib/cn";
import { usePlanner } from "@/lib/planner-store";
import { collectReminders, kindLabel, notifyReminder, type ReminderHit } from "@/lib/reminders";

export function useReminderHits(): ReminderHit[] {
  const tasks = usePlanner((s) => s.tasks);
  const milestones = usePlanner((s) => s.milestones);
  const habits = usePlanner((s) => s.habits);
  const remindAck = usePlanner((s) => s.remindAck);
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
  }, [tasks, milestones, habits, remindAck]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => window.clearInterval(id);
  }, []);

  if (now == null) return [];
  return collectReminders({
    tasks,
    milestones: milestones ?? [],
    habits: habits ?? [],
    remindAck: remindAck ?? {},
    now,
  });
}

export function useReminderChime(due: ReminderHit[]) {
  const startedAt = useRef(0);
  const seen = useRef(new Set<string>());
  const dueRef = useRef(due);
  dueRef.current = due;
  const signature = due.map((hit) => `${hit.key}:${hit.stamp}`).join("|");

  useEffect(() => {
    if (startedAt.current === 0) startedAt.current = Date.now();
    for (const hit of dueRef.current) {
      const id = `${hit.key}:${hit.stamp}`;
      if (seen.current.has(id)) continue;
      seen.current.add(id);
      if (hit.at < startedAt.current - 2_000) continue;
      beep();
      notifyReminder(hit);
    }
  }, [signature]);
}

export function ReminderBell({
  dueCount,
  open,
  onToggle,
}: {
  dueCount: number;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <Button
      size="icon"
      variant="ghost"
      aria-expanded={open}
      aria-label={dueCount > 0 ? `Напоминания, сейчас ${dueCount}` : "Напоминания"}
      onClick={onToggle}
    >
      <span className="relative">
        <Bell className="size-5" strokeWidth={1.75} />
        {dueCount > 0 ? (
          <span className="absolute -top-1 -right-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-xs text-on-danger tabular-nums">
            {dueCount > 9 ? "9" : dueCount}
          </span>
        ) : null}
      </span>
    </Button>
  );
}

export function ReminderPanel({
  hits,
  onOpen,
  onAck,
  top,
}: {
  hits: ReminderHit[];
  onOpen: (hit: ReminderHit) => void;
  onAck: (hit: ReminderHit) => void;
  /** Extra notices above the reminders (the assistant's answers). */
  top?: ReactNode;
}) {
  const [perm, setPerm] = useState<NotificationPermission | "off">("off");

  useEffect(() => {
    if (typeof Notification === "undefined") return;
    setPerm(Notification.permission);
  }, []);

  const due = hits.filter((hit) => hit.status === "due");
  const later = hits.filter((hit) => hit.status === "later");

  return (
    <div className="absolute top-full right-2 left-2 z-30 mt-1 rounded-2xl bg-surface p-2 shadow-xl ring-1 ring-line md:left-auto md:w-96">
      {top}
      <p className="px-1 text-[0.6875rem] font-semibold uppercase tracking-wide text-subtle">Напоминания</p>
      {hits.length === 0 ? (
        <p className="px-1 py-3 text-sm text-muted">Пока тихо. Время ставится в задаче, привычке или дате.</p>
      ) : (
        <ul className="mt-1 max-h-80 overflow-y-auto rounded-card bg-card px-2">
          {due.map((hit) => (
            <ReminderRow key={hit.key} hit={hit} onOpen={onOpen} onAck={onAck} />
          ))}
          {later.map((hit) => (
            <ReminderRow key={hit.key} hit={hit} onOpen={onOpen} onAck={onAck} />
          ))}
        </ul>
      )}
      <InlineHint label="Когда звучит сигнал" className="mt-1">
        Звук только пока «Пора» открыта. Утром всё на сегодня — на экране «Сегодня».
      </InlineHint>
      {perm === "default" ? (
        <Button
          variant="soft"
          size="sm"
          className="mt-1 w-full"
          onClick={() => {
            void Notification.requestPermission().then((next) => setPerm(next));
          }}
        >
          Включить уведомления
        </Button>
      ) : null}
      {perm === "granted" ? <p className="px-1 pb-1 text-xs text-muted">Уведомления браузера включены.</p> : null}
    </div>
  );
}

function ReminderRow({
  hit,
  onOpen,
  onAck,
}: {
  hit: ReminderHit;
  onOpen: (hit: ReminderHit) => void;
  onAck: (hit: ReminderHit) => void;
}) {
  return (
    <li className="flex items-center gap-2 border-b border-line py-1 last:border-b-0">
      <button type="button" onClick={() => onOpen(hit)} className="min-w-0 flex-1 py-1 text-left">
        <span className="flex items-baseline gap-2">
          <span className={cn("w-12 shrink-0 text-xs tabular-nums", hit.status === "due" ? "text-danger" : "text-muted")}>
            {hit.time}
          </span>
          <span className="truncate text-sm text-fg">{hit.title}</span>
        </span>
        <span className="mt-1 block pl-14 text-xs text-subtle">
          {kindLabel(hit.kind)} · {hit.whenLabel}
        </span>
      </button>
      {hit.status === "due" ? (
        <Button variant="ghost" className="shrink-0 text-muted" onClick={() => onAck(hit)}>
          Понятно
        </Button>
      ) : null}
    </li>
  );
}

export function ReminderBanner({
  due,
  onOpen,
  onAck,
  onMore,
  onHide,
  kmFor,
  onMileage,
}: {
  due: ReminderHit[];
  /** Card id when the hit is a «Обновите пробег» task: the strip offers «Пробег» right away. */
  kmFor?: (hit: ReminderHit) => string | undefined;
  onMileage?: (assetId: string) => void;
  onOpen: (hit: ReminderHit) => void;
  onAck: (hit: ReminderHit) => void;
  onMore: () => void;
  /** «×»: hide the strip until the next reminder; the bell keeps the list. */
  onHide: () => void;
}) {
  const hit = due[0];
  if (!hit) return null;
  const extra = due.length - 1;
  const kmAsset = kmFor?.(hit);

  return (
    <div className="relative z-10 shrink-0 bg-surface px-3 pb-2 md:px-8" role="status">
      <div className="card-lift flex h-9 items-center gap-1 rounded-full bg-elevated pr-1 pl-3 text-sm">
        <Bell className="size-3.5 shrink-0 text-danger" aria-hidden="true" />
        <button type="button" onClick={() => onOpen(hit)} className="hit flex h-9 min-w-0 flex-1 items-center gap-2 text-left">
          <span className="shrink-0 text-xs tabular-nums text-danger">{hit.time}</span>
          <span className="truncate text-fg">{hit.title}</span>
        </button>
        {extra > 0 ? (
          <button type="button" onClick={onMore} className="hit h-9 shrink-0 px-2 text-xs text-muted" aria-label={`Ещё напоминаний: ${extra}`}>
            +{extra}
          </button>
        ) : null}
        {kmAsset && onMileage ? (
          <button type="button" onClick={() => onMileage(kmAsset)} className="hit h-9 shrink-0 px-2 text-xs font-medium text-accent-ink">
            Обновить пробег
          </button>
        ) : (
          <button type="button" onClick={() => onAck(hit)} className="hit h-9 shrink-0 px-2 text-xs font-medium text-accent-ink">
            Понятно
          </button>
        )}
        <button
          type="button"
          onClick={onHide}
          aria-label="Скрыть полоску напоминаний"
          title="Скрыть — список останется под колокольчиком"
          className="hit flex size-9 shrink-0 items-center justify-center rounded-full text-subtle"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}
