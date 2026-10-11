import { useState, type ReactNode } from "react";
import { Archive, ArchiveRestore, Bell, Plus, Trash2, X } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { Hint } from "@/components/ui/hint";
import { Row, RowGroup } from "@/components/ui/rows";
import { PickerInput } from "@/components/planner/picker-input";
import { cn } from "@/lib/cn";
import { formatShortDay } from "@/lib/dates";
import { SECTIONS, WEEKDAY_SHORT, freqLabel, goalOf, normalizeFreq, reminderTimes, sectionOf, stepOf } from "@/lib/habit-plan";
import { reminderSummary } from "@/lib/habit-view";
import { usePlanner } from "@/lib/planner-store";
import type { Habit, HabitFreq } from "@/lib/planner-types";
import { DAYS, pluralN } from "@/lib/plural";
import { TASK_COLORS } from "@/lib/task-colors";
import { ICONS, habitHex } from "@/components/planner/habits/habit-meta";

type Panel = "icon" | "freq" | "goal" | "challenge" | "section" | "reminders" | null;

/** Small segmented control used inside the sub-pickers. */
function Segments<T extends string | number>({ value, options, onChange, label }: { value: T; options: { id: T; label: string }[]; onChange: (id: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="grid gap-0.5 rounded-lg bg-surface p-0.5" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((option) => (
        <button
          key={String(option.id)}
          type="button"
          role="radio"
          aria-checked={value === option.id}
          onClick={() => onChange(option.id)}
          className={cn("h-8 truncate rounded-md px-1 text-[0.8125rem]", value === option.id ? "bg-elevated font-semibold text-fg shadow-sm" : "text-muted")}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function Pills({ children }: { children: ReactNode }) {
  return <div className="mt-2 flex flex-wrap gap-1">{children}</div>;
}

function Pill({ on, onClick, children, label }: { on: boolean; onClick: () => void; children: ReactNode; label?: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={label}
      onClick={onClick}
      className={cn("h-8 min-w-8 rounded-full px-2.5 text-[0.8125rem] tabular-nums", on ? "bg-accent text-accent-fg" : "bg-surface text-fg")}
    >
      {children}
    </button>
  );
}

function NumberInput({ label, value, onValue, min, max, placeholder }: { label: string; value: number | null | undefined; onValue: (n: number | null) => void; min: number; max: number; placeholder?: string }) {
  return (
    <label className="flex min-w-0 flex-col text-[0.6875rem] text-subtle">
      {label}
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        placeholder={placeholder}
        value={value ?? ""}
        onChange={(event) => {
          const raw = event.target.value;
          if (!raw) return onValue(null);
          const n = Math.round(Number(raw));
          if (Number.isFinite(n)) onValue(Math.min(max, Math.max(min, n)));
        }}
        className="mt-0.5 h-9 w-full rounded-lg bg-surface px-2 text-base text-fg outline-none placeholder:text-subtle"
      />
    </label>
  );
}

/**
 * «Изменить привычку» as iOS rows: each row shows its value and unfolds a
 * compact picker right under itself. Every change saves (and syncs) at once.
 */
export function HabitEditor({ habit, open, onClose, onDeleted }: { habit: Habit; open: boolean; onClose: () => void; onDeleted?: () => void }) {
  return (
    <Sheet open={open} title={habit.name} onClose={onClose} action={{ label: "Готово", onClick: onClose }}>
      {open ? <EditorBody key={habit.id} habit={habit} onDeleted={onDeleted} /> : null}
    </Sheet>
  );
}

function EditorBody({ habit, onDeleted }: { habit: Habit; onDeleted?: () => void }) {
  const updateHabit = usePlanner((s) => s.updateHabit);
  const deleteHabit = usePlanner((s) => s.deleteHabit);
  const [panel, setPanel] = useState<Panel>(null);
  const [confirm, setConfirm] = useState(false);
  const [name, setName] = useState(habit.name);
  const [time, setTime] = useState("");
  const freq = normalizeFreq(habit.freq);
  const goal = goalOf(habit);
  const times = reminderTimes(habit);
  const set = (patch: Partial<Habit>) => updateHabit(habit.id, patch);
  const setFreq = (next: HabitFreq) => set({ freq: next });
  const toggle = (next: Panel) => setPanel(panel === next ? null : next);
  const hex = habitHex(habit);
  const color = TASK_COLORS.find((c) => c.id === habit.color);

  return (
    <div className="pb-2">
      <div className="divide-y divide-line overflow-hidden rounded-xl bg-elevated">
        <label className="flex min-h-11 items-center gap-3 px-3">
          <span className="w-20 shrink-0 text-[0.9375rem]">Название</span>
          <input
            value={name}
            maxLength={200}
            aria-label="Название"
            onChange={(event) => setName(event.target.value)}
            onBlur={() => name.trim() && name !== habit.name && set({ name })}
            className="h-11 min-w-0 flex-1 bg-transparent text-right text-base outline-none"
          />
        </label>
        <label className="flex min-h-11 items-center gap-3 px-3">
          <span className="w-20 shrink-0 text-[0.9375rem]">Зачем</span>
          <input
            defaultValue={habit.why ?? ""}
            maxLength={300}
            aria-label="Зачем (мотивация)"
            placeholder="чтобы просыпаться бодрым"
            onBlur={(event) => event.target.value !== (habit.why ?? "") && set({ why: event.target.value })}
            className="h-11 min-w-0 flex-1 bg-transparent text-right text-base text-muted outline-none placeholder:text-subtle"
          />
        </label>
      </div>

      <RowGroup>
        <Row
          label="Значок и цвет"
          value={
            <span className="inline-flex items-center gap-1.5">
              <span className="text-base">{habit.icon || "—"}</span>
              <span className="inline-block size-3 rounded-full" style={{ background: hex }} />
              <span className="sr-only">{color?.label ?? "цвет по умолчанию"}</span>
            </span>
          }
          open={panel === "icon"}
          onClick={() => toggle("icon")}
        >
          <div className="grid grid-cols-9 gap-1">
            {ICONS.map((icon) => (
              <button
                key={icon}
                type="button"
                aria-pressed={habit.icon === icon}
                aria-label={`Значок ${icon}`}
                onClick={() => set({ icon: habit.icon === icon ? null : icon })}
                className={cn("flex aspect-square items-center justify-center rounded-full text-base", habit.icon === icon ? "ring-2 ring-offset-1 ring-offset-elevated" : "bg-surface")}
                style={habit.icon === icon ? { background: `color-mix(in srgb, ${hex} 22%, var(--elevated))`, ["--tw-ring-color" as string]: hex } : undefined}
              >
                {icon}
              </button>
            ))}
          </div>
          <div className="mt-3 flex justify-between">
            {TASK_COLORS.map((c) => (
              <button
                key={c.id}
                type="button"
                aria-pressed={habit.color === c.id}
                aria-label={c.label}
                title={c.label}
                onClick={() => set({ color: habit.color === c.id ? null : c.id })}
                className={cn("size-7 rounded-full", habit.color === c.id && "ring-2 ring-fg ring-offset-2 ring-offset-elevated")}
                style={{ background: c.hex }}
              />
            ))}
          </div>
        </Row>
        <Row label="Частота" value={freqLabel(freq)} open={panel === "freq"} onClick={() => toggle("freq")}>
          <Segments
            label="Частота"
            value={freq.kind}
            onChange={(kind) =>
              setFreq(
                kind === "weekdays" ? { kind, days: [1, 2, 3, 4, 5] } : kind === "weekly" ? { kind, times: 3 } : kind === "interval" ? { kind, every: 2 } : { kind: "daily" },
              )
            }
            options={[
              { id: "daily", label: "Каждый день" },
              { id: "weekdays", label: "Дни недели" },
              { id: "weekly", label: "N в неделю" },
              { id: "interval", label: "Раз в N дн." },
            ]}
          />
          {freq.kind === "weekdays" ? (
            <Pills>
              {WEEKDAY_SHORT.map((label, index) => {
                const n = index + 1;
                const on = freq.days.includes(n);
                return (
                  <Pill
                    key={label}
                    on={on}
                    onClick={() => {
                      const days = on ? freq.days.filter((d) => d !== n) : [...freq.days, n];
                      setFreq(days.length ? { kind: "weekdays", days } : { kind: "daily" });
                    }}
                  >
                    {label}
                  </Pill>
                );
              })}
            </Pills>
          ) : null}
          {freq.kind === "weekly" ? (
            <Pills>
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <Pill key={n} on={freq.times === n} onClick={() => setFreq({ kind: "weekly", times: n })}>
                  {n}
                </Pill>
              ))}
            </Pills>
          ) : null}
          {freq.kind === "interval" ? (
            <Pills>
              {[2, 3, 4, 5, 7, 10, 14, 30].map((n) => (
                <Pill key={n} on={freq.every === n} onClick={() => setFreq({ kind: "interval", every: n })}>
                  {n}
                </Pill>
              ))}
            </Pills>
          ) : null}
          <p className="mt-1.5 text-xs text-subtle">
            Дни вне плана не прерывают серию
            <Hint>Например, выходные у привычки «по будням» или дни между отметками у «раз в 3 дня».</Hint>
          </p>
        </Row>
        <Row
          label="Цель на день"
          value={goal > 1 ? `${goal} ${habit.unit ?? ""}`.trim() : "Просто отметить"}
          open={panel === "goal"}
          onClick={() => toggle("goal")}
        >
          <Segments
            label="Цель на день"
            value={goal > 1 ? "amount" : "check"}
            onChange={(id) => (id === "check" ? set({ goal: null }) : goal <= 1 && set({ goal: 8, unit: habit.unit || "раз" }))}
            options={[
              { id: "check", label: "Просто отметить" },
              { id: "amount", label: "Количество" },
            ]}
          />
          {goal > 1 ? (
            <div className="mt-2 grid grid-cols-3 gap-2">
              <NumberInput label="Сколько" value={goal} min={2} max={100000} onValue={(n) => set({ goal: n ?? null })} />
              <label className="flex min-w-0 flex-col text-[0.6875rem] text-subtle">
                Единица
                <input
                  defaultValue={habit.unit ?? ""}
                  maxLength={20}
                  placeholder="стаканов"
                  onBlur={(event) => set({ unit: event.target.value.trim() || null })}
                  className="mt-0.5 h-9 w-full rounded-lg bg-surface px-2 text-base text-fg outline-none placeholder:text-subtle"
                />
              </label>
              <NumberInput label="За нажатие" value={stepOf(habit)} min={1} max={10000} onValue={(n) => set({ step: n })} />
            </div>
          ) : null}
          <p className="mt-1.5 text-xs text-subtle">
            Например: 8 стаканов воды
            <Hint>Каждое нажатие добавляет «за нажатие»; день засчитан, когда цель набрана.</Hint>
          </p>
        </Row>
        <Row
          label="Начало и цель"
          value={[habit.startDate ? `с ${formatShortDay(habit.startDate)}` : "", habit.goalDays ? pluralN(habit.goalDays, DAYS) : ""].filter(Boolean).join(" · ") || "Нет"}
          open={panel === "challenge"}
          onClick={() => toggle("challenge")}
        >
          <div className="grid grid-cols-2 gap-2">
            <label className="flex min-w-0 flex-col text-[0.6875rem] text-subtle">
              Начало
              <PickerInput
                type="date"
                value={habit.startDate ?? ""}
                onValue={(value) => set({ startDate: value || null })}
                clearLabel="Убрать дату начала"
                className="mt-0.5 h-9 w-full rounded-lg bg-surface px-2 text-base text-fg"
              />
            </label>
            <NumberInput label="Цель в днях" value={habit.goalDays} min={1} max={3650} placeholder="21, 66, 100" onValue={(n) => set({ goalDays: n })} />
          </div>
          <Pills>
            {[7, 21, 30, 66, 100, 365].map((n) => (
              <Pill key={n} on={habit.goalDays === n} onClick={() => set({ goalDays: habit.goalDays === n ? null : n })}>
                {n}
              </Pill>
            ))}
          </Pills>
        </Row>
        <Row label="Раздел" value={SECTIONS.find((s) => s.id === sectionOf(habit))?.label} open={panel === "section"} onClick={() => toggle("section")}>
          <Segments label="Раздел" value={sectionOf(habit)} onChange={(section) => set({ section })} options={SECTIONS.map((s) => ({ id: s.id, label: s.label }))} />
        </Row>
        <Row label="Напоминания" value={reminderSummary(habit)} open={panel === "reminders"} onClick={() => toggle("reminders")}>
          {times.length ? (
            <ul className="divide-y divide-line overflow-hidden rounded-lg bg-surface">
              {times.map((t) => (
                <li key={t} className="flex h-10 items-center gap-2 pl-3">
                  <Bell className="size-3.5 text-subtle" aria-hidden="true" />
                  <span className="flex-1 text-[0.9375rem] tabular-nums">{t}</span>
                  <button
                    type="button"
                    aria-label={`Убрать напоминание ${t}`}
                    className="flex size-10 items-center justify-center text-subtle"
                    onClick={() => set({ reminders: times.filter((x) => x !== t), remindAt: null })}
                  >
                    <X className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <form
            className="mt-2 flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (!time) return;
              set({ reminders: [...new Set([...times, time])].sort(), remindAt: null });
              setTime("");
            }}
          >
            <PickerInput type="time" value={time} onValue={setTime} aria-label="Время напоминания" className="h-9 w-28 rounded-lg bg-surface px-2 text-base" />
            <button type="submit" disabled={!time} className="flex h-9 items-center gap-1 rounded-full bg-surface px-3 text-[0.8125rem] text-accent disabled:opacity-40">
              <Plus className="size-4" /> Добавить
            </button>
          </form>
          <p className="mt-1.5 text-xs text-subtle">
            Можно несколько: 9:00, 13:00, 18:00
            <Hint>Напоминание не придёт, если день уже отмечен или не по плану.</Hint>
          </p>
        </Row>
      </RowGroup>

      <RowGroup>
        <Row
          label={habit.archived ? "Вернуть из архива" : "В архив"}
          icon={habit.archived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />}
          onClick={() => set({ archived: !habit.archived })}
        />
        {confirm ? (
          <div className="flex items-center gap-2 px-3 py-2">
            <span className="min-w-0 flex-1 text-xs text-muted">Удалятся и все отметки. Архив их сохранит.</span>
            <button type="button" onClick={() => setConfirm(false)} className="h-9 px-2 text-sm text-muted">
              Отмена
            </button>
            <button
              type="button"
              onClick={() => {
                deleteHabit(habit.id);
                onDeleted?.();
              }}
              className="h-9 rounded-full bg-danger px-3 text-sm font-medium text-on-danger"
            >
              Удалить
            </button>
          </div>
        ) : (
          <Row label="Удалить привычку" icon={<Trash2 className="size-4" />} danger onClick={() => setConfirm(true)} />
        )}
      </RowGroup>
      <p className="mt-2 px-1 text-xs text-subtle">Порядок в списке — потяните привычку за значок.</p>
    </div>
  );
}

