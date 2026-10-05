import { useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { beep } from "@/lib/beep";
import { cn } from "@/lib/cn";
import { usePlanner } from "@/lib/planner-store";
import { collectReminders, kindLabel, notifyReminder, type ReminderHit } from "@/lib/reminders";

export function useReminderHits(): ReminderHit[] {
  const tasks = usePlanner((s) => s.tasks);
  const milestones = usePlanner((s) => s.milestones);
  const remindAck = usePlanner((s) => s.remindAck);
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
  }, [tasks, milestones, remindAck]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => window.clearInterval(id);
  }, []);

  if (now == null) return [];
  return collectReminders({
    tasks,
    milestones: milestones ?? [],
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
}: {
  hits: ReminderHit[];
  onOpen: (hit: ReminderHit) => void;
  onAck: (hit: ReminderHit) => void;
}) {
  const [perm, setPerm] = useState<NotificationPermission | "off">("off");

  useEffect(() => {
    if (typeof Notification === "undefined") return;
    setPerm(Notification.permission);
  }, []);

  const due = hits.filter((hit) => hit.status === "due");
  const later = hits.filter((hit) => hit.status === "later");

  return (
    <div className="absolute top-full right-0 z-30 mt-2 w-full max-w-sm rounded-lg border border-line bg-surface p-3">
      <p className="text-xs font-medium text-subtle">Напоминания</p>
      {hits.length === 0 ? (
        <p className="py-4 text-sm text-muted">Пока тихо. Время ставится в задаче, привычке или дате.</p>
      ) : (
        <ul className="mt-2 max-h-80 overflow-y-auto">
          {due.map((hit) => (
            <ReminderRow key={hit.key} hit={hit} onOpen={onOpen} onAck={onAck} />
          ))}
          {later.map((hit) => (
            <ReminderRow key={hit.key} hit={hit} onOpen={onOpen} onAck={onAck} />
          ))}
        </ul>
      )}
      <p className="mt-2 text-xs text-subtle">
        Звук только пока «Пора» открыта. Утром всё на сегодня — на экране «Сегодня».
      </p>
      {perm === "default" ? (
        <Button
          variant="soft"
          className="mt-2 w-full"
          onClick={() => {
            void Notification.requestPermission().then((next) => setPerm(next));
          }}
        >
          Включить уведомления
        </Button>
      ) : null}
      {perm === "granted" ? <p className="mt-2 text-xs text-muted">Уведомления браузера включены.</p> : null}
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
        <span className="mt-0.5 block pl-14 text-xs text-subtle">
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
}: {
  due: ReminderHit[];
  onOpen: (hit: ReminderHit) => void;
  onAck: (hit: ReminderHit) => void;
  onMore: () => void;
}) {
  const hit = due[0];
  if (!hit) return null;
  const extra = due.length - 1;

  return (
    <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line bg-elevated px-4">
      <button type="button" onClick={() => onOpen(hit)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
        <span className="w-12 shrink-0 text-xs tabular-nums text-danger">{hit.time}</span>
        <span className="truncate text-sm text-fg">{hit.title}</span>
      </button>
      {extra > 0 ? (
        <button type="button" onClick={onMore} className="h-11 shrink-0 px-1 text-xs text-muted">
          ещё {extra}
        </button>
      ) : null}
      <button type="button" onClick={() => onAck(hit)} className="h-11 shrink-0 px-1 text-xs text-muted">
        Понятно
      </button>
    </div>
  );
}
