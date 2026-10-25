import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Archive, CalendarRange, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { cn } from "@/lib/cn";
import { dayNumber, shiftIso, todayIso, weekdayLetter, weekDays } from "@/lib/dates";
import { SECTIONS, dayState, freqLabel, goalOf, isDue, sectionOf, sortHabits } from "@/lib/habit-plan";
import { dayProgress, habitSubline, reorderSection, tapCompletes } from "@/lib/habit-view";
import { usePlanner } from "@/lib/planner-store";
import type { Habit } from "@/lib/planner-types";
import { InlineHint } from "@/components/ui/hint";
import { Empty } from "@/components/planner/empty-state";
import { Fab } from "@/components/planner/quick-composer";
import { HabitDetail } from "@/components/planner/habits/habit-detail";
import { HabitEditor } from "@/components/planner/habits/habit-editor";
import { CheckinSheet } from "@/components/planner/habits/habit-checkin";
import { HabitIcon, RingCheck } from "@/components/planner/habits/habit-ui";
import { STATE_LABEL, habitHex } from "@/components/planner/habits/habit-meta";

/** Habits: compact rows by section, a ring check on the right, the habit page on tap. */
export function HabitsView({ onOpenFocus }: { onOpenFocus?: () => void }) {
  const habits = usePlanner((s) => s.habits);
  const addHabit = usePlanner((s) => s.addHabit);
  const today = todayIso();
  const [openId, setOpenId] = useState<string | null>(null);
  const [checkinId, setCheckinId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [week, setWeek] = useState(false);
  const [offset, setOffset] = useState(0);
  const [showArchive, setShowArchive] = useState(false);
  const active = sortHabits(habits.filter((h) => !h.archived));
  const archived = sortHabits(habits.filter((h) => h.archived));
  const planned = active.filter((h) => isDue(h, today) || h.checks.includes(today));
  const doneToday = planned.filter((h) => h.checks.includes(today)).length;
  const shown = showArchive ? archived : active;
  const groups = SECTIONS.map((section) => ({ section, items: shown.filter((h) => sectionOf(h) === section.id) })).filter((g) => g.items.length);
  const days = weekDays(shiftIso(today, offset * 7));
  const opened = habits.find((h) => h.id === openId);
  const checkin = habits.find((h) => h.id === checkinId);

  if (opened) return <HabitDetail key={opened.id} habit={opened} onBack={() => setOpenId(null)} onOpenFocus={onOpenFocus} />;

  return (
    <div className="mx-auto max-w-xl">
      <div className="flex h-10 items-center gap-1">
        {showArchive ? (
          <button type="button" onClick={() => setShowArchive(false)} className="flex h-10 items-center gap-1 text-sm text-muted">
            <ChevronLeft className="size-4" /> Архив привычек
          </button>
        ) : (
          <p className="min-w-0 flex-1 text-sm text-muted">
            Сегодня{" "}
            <span className={cn("font-medium tabular-nums", planned.length ? "text-fg" : "text-subtle opacity-60")}>
              {doneToday} из {planned.length}
            </span>
          </p>
        )}
        <span className="flex-1" />
        {!showArchive && active.length ? (
          <button
            type="button"
            aria-label={week ? "Скрыть неделю" : "Показать неделю"}
            aria-pressed={week}
            onClick={() => {
              setWeek(!week);
              setOffset(0);
            }}
            className={cn("flex size-10 items-center justify-center rounded-full", week ? "bg-elevated text-accent" : "text-muted")}
          >
            <CalendarRange className="size-5" />
          </button>
        ) : null}
        <button type="button" aria-label="Новая привычка" onClick={() => setCreating(true)} className="hidden size-10 items-center justify-center rounded-full text-muted hover:bg-elevated md:flex">
          <Plus className="size-5" />
        </button>
      </div>

      {week && !showArchive && active.length ? (
        <div className="flex items-center">
          <button type="button" aria-label="Прошлая неделя" onClick={() => setOffset(offset - 1)} className="flex size-9 items-center justify-center text-muted">
            <ChevronLeft className="size-4" />
          </button>
          <div className="grid flex-1 grid-cols-7 text-center text-[0.6875rem] text-subtle">
            {days.map((day) => (
              <span key={day} className={cn(day === today && "font-semibold text-accent")}>
                {weekdayLetter(day)} {dayNumber(day)}
              </span>
            ))}
          </div>
          {offset < 0 ? (
            <button type="button" aria-label="Эта неделя" onClick={() => setOffset(0)} className="flex h-9 items-center px-1 text-xs text-accent">
              Сейчас
            </button>
          ) : null}
          <button type="button" aria-label="Следующая неделя" disabled={offset >= 0} onClick={() => setOffset(offset + 1)} className="flex size-9 items-center justify-center text-muted disabled:opacity-30">
            <ChevronRight className="size-4" />
          </button>
        </div>
      ) : null}

      {!showArchive && active.length === 0 ? (
        <Empty
          title="Привычек пока нет"
          hint="Начните с одной маленькой. Нажмите пример или «+»."
          examples={[
            { icon: "💧", label: "Стакан воды утром", onAdd: () => addHabit("Стакан воды утром") },
            { icon: "📖", label: "2 страницы книги", onAdd: () => addHabit("2 страницы книги") },
          ]}
        />
      ) : null}

      {groups.map(({ section, items }) => (
        <section key={section.id} className="mt-2" data-section={section.id}>
          <h3 className="px-1 pb-1 text-[0.6875rem] font-semibold tracking-wide text-subtle uppercase">{section.label}</h3>
          <ul className="overflow-hidden rounded-xl bg-elevated">
            {items.map((habit, index) => (
              <HabitRow
                key={habit.id}
                habit={habit}
                index={index}
                count={items.length}
                today={today}
                days={week && !showArchive ? days : null}
                onOpen={() => setOpenId(habit.id)}
                onCompleted={() => setCheckinId(habit.id)}
              />
            ))}
          </ul>
        </section>
      ))}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        {active.length ? (
          <InlineHint label="Как отмечать">
            Круг справа — отметка за сегодня (для количества: +шаг за нажатие, полный круг — цель). Нажмите на привычку — календарь, статистика, дневник и
            отметки за прошлые дни. Порядок — потяните за значок.
          </InlineHint>
        ) : (
          <span />
        )}
        {archived.length > 0 && !showArchive ? (
          <button type="button" onClick={() => setShowArchive(true)} className="flex h-9 items-center gap-2 px-1 text-xs text-muted">
            <Archive className="size-3.5" /> Архив ({archived.length})
          </button>
        ) : null}
      </div>

      {!showArchive ? <Fab label="Новая привычка" onClick={() => setCreating(true)} /> : null}
      <HabitEditor habit={null} open={creating} onClose={() => setCreating(false)} />
      {checkin ? <CheckinSheet key={checkin.id} habit={checkin} day={today} onClose={() => setCheckinId(null)} /> : null}
    </div>
  );
}

const ROW_H = 60;

function HabitRow({
  habit,
  index,
  count,
  today,
  days,
  onOpen,
  onCompleted,
}: {
  habit: Habit;
  index: number;
  count: number;
  today: string;
  days: string[] | null;
  onOpen: () => void;
  /** «Показывать дневник при отметке»: the tap finished today. */
  onCompleted: () => void;
}) {
  const toggleHabit = usePlanner((s) => s.toggleHabit);
  const setHabitOrder = usePlanner((s) => s.setHabitOrder);
  const moveHabit = usePlanner((s) => s.moveHabit);
  const habits = usePlanner((s) => s.habits);
  const hex = habitHex(habit);
  const state = dayState(habit, today, today);
  const due = isDue(habit, today);
  const [dy, setDy] = useState<number | null>(null);
  const dragged = useRef(false);
  const goal = goalOf(habit);
  const sub = [habitSubline(habit, today, freqLabel(habit.freq)), due || habit.checks.includes(today) ? "" : "не по плану"].filter(Boolean).join(" · ");

  function down(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || habit.archived) return;
    const start = event.clientY;
    const node = event.currentTarget;
    node.setPointerCapture(event.pointerId);
    dragged.current = false;
    const move = (ev: PointerEvent) => {
      const d = ev.clientY - start;
      if (Math.abs(d) > 6) dragged.current = true;
      if (dragged.current) setDy(Math.max(-index * ROW_H, Math.min((count - 1 - index) * ROW_H, d)));
    };
    const up = (ev: PointerEvent) => {
      node.removeEventListener("pointermove", move);
      node.removeEventListener("pointerup", up);
      node.removeEventListener("pointercancel", up);
      if (dragged.current) {
        const to = index + Math.round((ev.clientY - start) / ROW_H);
        if (to !== index) setHabitOrder(reorderSection(habits, habit.id, to));
      }
      setDy(null);
    };
    node.addEventListener("pointermove", move);
    node.addEventListener("pointerup", up);
    node.addEventListener("pointercancel", up);
  }

  return (
    <li
      data-habit-row={habit.id}
      className={cn("relative border-b border-line/70 last:border-b-0", dy !== null && "z-10 bg-surface shadow-lg")}
      style={dy !== null ? { transform: `translateY(${dy}px)` } : undefined}
    >
      <div className="flex min-h-[3.75rem] items-center gap-3 pr-2 pl-3">
        <button
          type="button"
          aria-label={`${habit.name}: открыть или потянуть, чтобы переставить`}
          onPointerDown={down}
          onClick={() => {
            if (dragged.current) {
              dragged.current = false;
              return;
            }
            onOpen();
          }}
          className="drag-handle shrink-0"
        >
          <HabitIcon habit={habit} />
        </button>
        <button type="button" onClick={onOpen} className={cn("min-w-0 flex-1 py-2 text-left", !due && state !== "done" && "opacity-60")}>
          <span className={cn("block truncate text-[0.9375rem] leading-5", state === "done" && "text-muted")}>{habit.name}</span>
          {sub ? <span className="block truncate text-[0.75rem] leading-4 text-muted">{sub}</span> : null}
        </button>
        <span className="sr-only">
          <button type="button" onClick={() => moveHabit(habit.id, -1)} disabled={index === 0}>
            {habit.name}: выше
          </button>
          <button type="button" onClick={() => moveHabit(habit.id, 1)} disabled={index === count - 1}>
            {habit.name}: ниже
          </button>
        </span>
        {habit.archived ? null : (
          <RingCheck
            progress={dayProgress(habit, today)}
            color={hex}
            state={state}
            pressed={state === "done"}
            label={`${habit.name}, ${today}: ${STATE_LABEL[state]}${goal > 1 ? ` (нажмите: +шаг)` : ""}`}
            onClick={() => {
              const completes = habit.journal && tapCompletes(habit, today);
              toggleHabit(habit.id, today);
              if (completes) onCompleted();
            }}
          />
        )}
      </div>
      {days ? (
        <div className="grid grid-cols-7 justify-items-center pr-9 pb-2 pl-9">
          {days.map((day) => {
            const s = dayState(habit, day, today);
            return (
              <RingCheck
                key={day}
                size={26}
                progress={dayProgress(habit, day)}
                color={hex}
                state={s}
                text={String(dayNumber(day))}
                pressed={s === "done"}
                disabled={s === "future" || s === "before"}
                label={`${habit.name}, ${day}: ${STATE_LABEL[s]}`}
                onClick={() => toggleHabit(habit.id, day)}
              />
            );
          })}
        </div>
      ) : null}
    </li>
  );
}
