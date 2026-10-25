import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Archive, ArchiveRestore, BarChart3, CalendarCheck, Check, ChevronLeft, ChevronRight, Flame, MoreHorizontal, Pencil, Percent, Timer, Trash2, Trophy } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatShortDay, todayIso } from "@/lib/dates";
import { WEEKDAY_SHORT, freqLabel, goalOf, goalProgress, isDue, stepOf } from "@/lib/habit-plan";
import { amountOn, calendarCell, monthBars, monthStats, tapCompletes } from "@/lib/habit-view";
import { monthGrid, shiftMonth } from "@/lib/habit-stats";
import { usePlanner } from "@/lib/planner-store";
import { useDismiss, usePopover } from "@/lib/popover";
import type { Habit } from "@/lib/planner-types";
import { DAYS, plural, pluralN } from "@/lib/plural";
import { CheckinSheet } from "@/components/planner/habits/habit-checkin";
import { HabitEditor } from "@/components/planner/habits/habit-editor";
import { HabitIcon, RingCheck } from "@/components/planner/habits/habit-ui";
import { MONTHS, MONTHS_IN, MOODS, STATE_LABEL, habitHex } from "@/components/planner/habits/habit-meta";

const WEEKS: readonly [string, string, string] = ["неделя", "недели", "недель"];

/** Habit page: hero with the big check, month rings, stat tiles, daily chart, journal. */
export function HabitDetail({ habit, onBack, onOpenFocus }: { habit: Habit; onBack: () => void; onOpenFocus?: () => void }) {
  const focusHabit = usePlanner((s) => s.focusHabit);
  const [journalDay, setJournalDay] = useState(false);
  const updateHabit = usePlanner((s) => s.updateHabit);
  const deleteHabit = usePlanner((s) => s.deleteHabit);
  const today = todayIso();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [day, setDay] = useState<string | null>(null);
  const [menu, setMenu] = usePopover("habit-menu");
  const menuBoxRef = useRef<HTMLDivElement>(null);
  useDismiss(menu, () => setMenu(false), [menuBoxRef]);
  const [confirm, setConfirm] = useState(false);
  const [editing, setEditing] = useState(false);
  const hex = habitHex(habit);
  const stats = monthStats(habit, month, today);
  const goal = goalOf(habit);
  const challenge = goalProgress(habit, today);
  const monthIndex = Number(month.slice(5, 7)) - 1;
  const notes = (habit.log ?? []).filter((e) => e.id.startsWith(month) && (e.note || e.mood)).sort((a, b) => (a.id < b.id ? 1 : -1));
  const unitWord = habit.unit ?? "";
  const streakUnit = stats.unit === "week" ? WEEKS : DAYS;

  return (
    <div className="mx-auto max-w-xl pb-4">
      <div className="sticky -top-2 z-20 -mx-4 -mt-2 flex items-center gap-1 bg-surface px-2 pt-2 pb-1 md:static md:mx-0 md:px-0">
        <button type="button" aria-label="К привычкам" onClick={onBack} className="flex size-10 items-center justify-center rounded-full text-muted">
          <ChevronLeft className="size-5" />
        </button>
        <p className="min-w-0 flex-1 truncate text-center text-[0.9375rem] font-semibold">{habit.name}</p>
        <div ref={menuBoxRef} className="relative">
          <button
            type="button"
            aria-label="Ещё"
            aria-expanded={menu}
            onClick={() => {
              setMenu(!menu);
              setConfirm(false);
            }}
            className="flex size-10 items-center justify-center rounded-full text-muted"
          >
            <MoreHorizontal className="size-5" />
          </button>
          {menu ? (
            <>
              <button type="button" aria-hidden="true" tabIndex={-1} className="fixed inset-0 z-30 cursor-default" onClick={() => setMenu(false)} />
              <div role="menu" className="absolute top-full right-0 z-40 mt-1 w-56 overflow-hidden rounded-2xl bg-surface/95 py-2 shadow-2xl ring-1 ring-line backdrop-blur">
                <MenuItem
                  icon={<Pencil className="size-4" />}
                  onClick={() => {
                    setMenu(false);
                    setEditing(true);
                  }}
                >
                  Редактировать
                </MenuItem>
                <MenuItem
                  icon={<Timer className="size-4" />}
                  onClick={() => {
                    setMenu(false);
                    focusHabit(habit.id);
                    onOpenFocus?.();
                  }}
                >
                  Фокус
                </MenuItem>
                <MenuItem
                  icon={habit.archived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />}
                  onClick={() => {
                    updateHabit(habit.id, { archived: !habit.archived });
                    setMenu(false);
                    onBack();
                  }}
                >
                  {habit.archived ? "Вернуть из архива" : "В архив"}
                </MenuItem>
                {confirm ? (
                  <MenuItem
                    danger
                    icon={<Trash2 className="size-4" />}
                    onClick={() => {
                      deleteHabit(habit.id);
                      onBack();
                    }}
                  >
                    Удалить с отметками?
                  </MenuItem>
                ) : (
                  <MenuItem danger icon={<Trash2 className="size-4" />} onClick={() => setConfirm(true)}>
                    Удалить
                  </MenuItem>
                )}
              </div>
            </>
          ) : null}
        </div>
      </div>

      <Hero habit={habit} today={today} hex={hex} onCompleted={() => setJournalDay(true)} />

      {challenge ? (
        <div className="mt-3 rounded-2xl bg-elevated p-3">
          <p className="flex items-center gap-2 text-[0.8125rem]">
            <Trophy className="size-4" style={{ color: hex }} aria-hidden="true" />
            <span className="flex-1">Цель: {pluralN(challenge.target, DAYS)}</span>
            <span className="tabular-nums text-muted">
              {challenge.done}/{challenge.target}
            </span>
          </p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface">
            <div className="h-full rounded-full" style={{ width: `${Math.round((challenge.done / challenge.target) * 100)}%`, background: hex }} />
          </div>
          {challenge.reached ? <p className="mt-1 text-xs text-muted">Цель достигнута! Продлить — в «Изменить → Начало и цель».</p> : null}
        </div>
      ) : null}

      <Card>
        <div className="flex items-center">
          <button type="button" aria-label="Прошлый месяц" onClick={() => setMonth(shiftMonth(month, -1))} className="flex size-9 items-center justify-center rounded-full text-muted">
            <ChevronLeft className="size-4" />
          </button>
          <p className="flex-1 text-center text-[0.9375rem] font-semibold">
            {MONTHS[monthIndex]} {month.slice(0, 4) !== today.slice(0, 4) ? month.slice(0, 4) : ""}
          </p>
          <button
            type="button"
            aria-label="Следующий месяц"
            disabled={month >= today.slice(0, 7)}
            onClick={() => setMonth(shiftMonth(month, 1))}
            className="flex size-9 items-center justify-center rounded-full text-muted disabled:opacity-30"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
        <div className="mt-1 grid grid-cols-7 justify-items-center gap-y-2 text-center">
          {WEEKDAY_SHORT.map((d) => (
            <span key={d} className="text-[0.6875rem] text-subtle">
              {d}
            </span>
          ))}
          {monthGrid(month, habit.checks, today)
            .flat()
            .map((cell, index) => {
              if (!cell) return <span key={`pad-${index}`} />;
              const { state, progress } = calendarCell(habit, cell.day, today);
              return (
                <div key={cell.day} className="relative">
                  <RingCheck
                    size={38}
                    progress={progress}
                    color={hex}
                    state={state}
                    text={String(Number(cell.day.slice(8)))}
                    label={`${cell.day}: ${STATE_LABEL[state]}`}
                    pressed={state === "done"}
                    disabled={cell.future}
                    onClick={() => setDay(cell.day)}
                  />
                  {cell.day === today ? <span className="absolute -bottom-1 left-1/2 size-1 -translate-x-1/2 rounded-full" style={{ background: hex }} /> : null}
                  {entryMark(habit, cell.day)}
                </div>
              );
            })}
        </div>
        <p className="mt-2 text-center text-[0.6875rem] text-subtle">Нажмите на день — отметка, пропуск, настроение, заметка.</p>
      </Card>

      <Card title="Статистика">
        <div className="grid grid-cols-2 gap-2">
          <Tile icon={<CalendarCheck className="size-3.5" />} color="#4fa57e" label="Отметок за месяц" value={stats.monthChecks} unit={plural(stats.monthChecks, DAYS)} />
          <Tile icon={<Check className="size-3.5" />} color="#3a8fc4" label="Всего отметок" value={stats.totalChecks} unit={plural(stats.totalChecks, DAYS)} />
          <Tile icon={<Percent className="size-3.5" />} color="#dcae3a" label="Выполнено за месяц" value={stats.percent} unit="%" />
          <Tile icon={<Flame className="size-3.5" />} color="#e07a3c" label="Текущая серия" value={stats.current} unit={plural(stats.current, streakUnit)} />
          <Tile icon={<Trophy className="size-3.5" />} color="#8a4fa3" label="Лучшая серия" value={stats.best} unit={plural(stats.best, streakUnit)} />
          {goal > 1 ? (
            <>
              <Tile icon={<BarChart3 className="size-3.5" />} color="#8a90c9" label="Объём за месяц" value={stats.monthVolume} unit={unitWord} />
              <Tile icon={<BarChart3 className="size-3.5" />} color="#4a5aa8" label="Общий объём" value={stats.totalVolume} unit={unitWord} />
            </>
          ) : null}
        </div>
      </Card>

      <Card title={goal > 1 ? `По дням${habit.unit ? ` (${habit.unit})` : ""}` : "По дням"}>
        <BarChart habit={habit} month={month} today={today} hex={hex} />
      </Card>

      <Card title={`Дневник в ${MONTHS_IN[monthIndex]}`}>
        {notes.length ? (
          <ul className="divide-y divide-line">
            {notes.map((entry) => (
              <li key={entry.id}>
                <button type="button" onClick={() => setDay(entry.id)} className="flex w-full items-start gap-2 py-2 text-left">
                  <span className="w-14 shrink-0 text-xs text-subtle">{formatShortDay(entry.id)}</span>
                  <span className="shrink-0 text-base leading-5">{MOODS.find((m) => m.value === entry.mood)?.icon ?? ""}</span>
                  <span className="min-w-0 flex-1 text-[0.875rem] whitespace-pre-line">{entry.note}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="py-3 text-center text-[0.8125rem] text-muted">В этом месяце заметок нет. Нажмите на день в календаре, чтобы записать мысли.</p>
        )}
      </Card>

      {day ? <CheckinSheet key={day} habit={habit} day={day} onClose={() => setDay(null)} /> : null}
      <HabitEditor habit={habit} open={editing} onClose={() => setEditing(false)} onRemoved={onBack} />
      {journalDay && !day ? <CheckinSheet key={`journal-${today}`} habit={habit} day={today} onClose={() => setJournalDay(false)} /> : null}
    </div>
  );
}

function entryMark(habit: Habit, day: string): ReactNode {
  const entry = (habit.log ?? []).find((e) => e.id === day);
  if (!entry?.note && !entry?.mood) return null;
  return <span aria-hidden="true" className="absolute top-0 right-0 size-1.5 rounded-full bg-muted" />;
}

function MenuItem({ icon, children, onClick, danger }: { icon: ReactNode; children: ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" role="menuitem" onClick={onClick} className={cn("flex h-11 w-full items-center gap-3 px-4 text-left text-[0.9375rem] hover:bg-elevated", danger ? "text-danger" : "text-fg")}>
      <span className={danger ? "text-danger" : "text-fg"}>{icon}</span>
      {children}
    </button>
  );
}

function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="mt-3 rounded-2xl bg-elevated p-3">
      {title ? <h3 className="mb-2 text-[0.9375rem] font-semibold">{title}</h3> : null}
      {children}
    </section>
  );
}

function Tile({ icon, color, label, value, unit }: { icon: ReactNode; color: string; label: string; value: number; unit: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-surface p-3">
      <p className="flex items-center gap-1 truncate text-[0.6875rem] text-muted">
        <span style={{ color }} aria-hidden="true">
          {icon}
        </span>
        {label}
      </p>
      <p className="mt-1 truncate">
        <span className="text-xl font-semibold tabular-nums">{value}</span>
        {unit ? <span className="ml-1 text-xs text-muted">{unit}</span> : null}
      </p>
    </div>
  );
}

/** Daily amounts vs the goal line (simple habits: done days as full bars). */
function BarChart({ habit, month, today, hex }: { habit: Habit; month: string; today: string; hex: string }) {
  const bars = monthBars(habit, month, today);
  const goal = goalOf(habit);
  const top = Math.max(goal, ...bars.map((b) => b.amount ?? 0), 1);
  const W = 320;
  const H = 120;
  const pad = { l: 22, b: 16, t: 6 };
  const slot = (W - pad.l) / bars.length;
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / top);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Выполнение по дням за ${MONTHS[Number(month.slice(5, 7)) - 1]?.toLowerCase()}`}>
      {[0, Math.round(top / 2), top].map((v) => (
        <g key={v}>
          <line x1={pad.l} x2={W} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeWidth={0.5} />
          <text x={pad.l - 4} y={y(v) + 3} textAnchor="end" fontSize={8} fill="var(--subtle)">
            {v}
          </text>
        </g>
      ))}
      {goal > 1 ? <line x1={pad.l} x2={W} y1={y(goal)} y2={y(goal)} stroke={hex} strokeWidth={1} strokeDasharray="3 2" /> : null}
      {bars.map((bar, i) => {
        const x = pad.l + i * slot + slot * 0.25;
        const v = bar.amount ?? 0;
        return (
          <g key={bar.day}>
            {v > 0 ? <rect x={x} y={y(v)} width={slot * 0.5} height={Math.max(1, y(0) - y(v))} rx={1} fill={hex} opacity={v >= goal ? 1 : 0.5} /> : null}
            {i % 5 === 0 || bar.day === today ? (
              <text x={x + slot * 0.25} y={H - 4} textAnchor="middle" fontSize={8} fill={bar.day === today ? hex : "var(--subtle)"}>
                {i + 1}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

/** Big hero: icon in the habit colour, name, motivation, today's progress and a swipe-or-tap check. */
function Hero({ habit, today, hex, onCompleted }: { habit: Habit; today: string; hex: string; onCompleted: () => void }) {
  const toggleHabit = usePlanner((s) => s.toggleHabit);
  const setHabitDay = usePlanner((s) => s.setHabitDay);
  const goal = goalOf(habit);
  const done = habit.checks.includes(today);
  const amount = amountOn(habit, today);
  const due = isDue(habit, today);
  return (
    <section className="mt-1 flex flex-col items-center rounded-3xl px-4 pt-6 pb-5 text-center" style={{ background: `color-mix(in srgb, ${hex} 14%, var(--surface))` }}>
      <HabitIcon habit={habit} size="xl" className="shadow-sm" />
      <h2 className="mt-3 text-xl font-semibold">{habit.name}</h2>
      {habit.why ? <p className="mt-1 text-[0.8125rem] text-muted">{habit.why}</p> : null}
      <p className="mt-2 text-xs text-muted tabular-nums">
        {goal > 1 ? `${Math.min(amount, goal)} / ${goal}${habit.unit ? ` ${habit.unit}` : ""}` : done ? "Сегодня выполнено" : due ? "Сегодня по плану" : `Сегодня не по плану · ${freqLabel(habit.freq)}`}
      </p>
      {goal > 1 ? (
        <div className="mt-1 h-1 w-24 overflow-hidden rounded-full bg-surface">
          <div className="h-full rounded-full" style={{ width: `${Math.min(100, (amount / goal) * 100)}%`, background: hex }} />
        </div>
      ) : null}
      <SwipeCheck
        hex={hex}
        done={done}
        label={done ? "Снять отметку за сегодня" : goal > 1 ? `Добавить ${stepOf(habit)}${habit.unit ? ` ${habit.unit}` : ""}` : "Отметить сегодня"}
        onTap={() => {
          const completes = habit.journal && tapCompletes(habit, today);
          toggleHabit(habit.id, today);
          if (completes) onCompleted();
        }}
        onSwipe={() => {
          if (done) return;
          setHabitDay(habit.id, today, { done: true });
          if (habit.journal) onCompleted();
        }}
      />
      <p className="mt-2 text-[0.6875rem] text-subtle">{done ? "Нажмите, чтобы снять" : goal > 1 ? `Нажатие: +${stepOf(habit)} · смахните вправо — вся цель` : "Нажмите или смахните вправо"}</p>
    </section>
  );
}

/** Swipe pill: drag the knob to the right end = done; a tap = one step. */
function SwipeCheck({ hex, done, label, onTap, onSwipe }: { hex: string; done: boolean; label: string; onTap: () => void; onSwipe: () => void }) {
  const track = useRef<HTMLButtonElement>(null);
  const [dx, setDx] = useState<number | null>(null);
  const moved = useRef(false);
  const KNOB = 48;
  const width = () => (track.current?.clientWidth ?? 220) - KNOB - 8;

  function down(event: ReactPointerEvent<HTMLButtonElement>) {
    if (done || event.button !== 0) return;
    const start = event.clientX;
    const node = event.currentTarget;
    node.setPointerCapture(event.pointerId);
    moved.current = false;
    const move = (ev: PointerEvent) => {
      const d = Math.max(0, Math.min(width(), ev.clientX - start));
      if (d > 6) moved.current = true;
      if (moved.current) setDx(d);
    };
    const up = (ev: PointerEvent) => {
      node.removeEventListener("pointermove", move);
      node.removeEventListener("pointerup", up);
      node.removeEventListener("pointercancel", up);
      const d = ev.clientX - start;
      if (moved.current && d >= width() * 0.7) onSwipe();
      setDx(null);
    };
    node.addEventListener("pointermove", move);
    node.addEventListener("pointerup", up);
    node.addEventListener("pointercancel", up);
  }

  const offset = done ? width() : (dx ?? 0);
  return (
    <button
      ref={track}
      type="button"
      aria-label={label}
      aria-pressed={done}
      onPointerDown={down}
      onClick={() => {
        if (moved.current) {
          moved.current = false;
          return;
        }
        onTap();
      }}
      className="drag-handle relative mt-4 h-14 w-56 rounded-full p-1"
      style={{ background: done ? hex : `color-mix(in srgb, ${hex} 30%, var(--surface))` }}
    >
      <span
        className={cn("absolute top-1 left-1 flex size-12 items-center justify-center rounded-full bg-white shadow", dx === null && "transition-transform duration-200")}
        style={{ transform: `translateX(${offset}px)`, color: hex }}
      >
        <Check className="size-6" strokeWidth={3} />
      </span>
      {done ? <span className="relative text-sm font-medium text-white">Выполнено</span> : null}
    </button>
  );
}
