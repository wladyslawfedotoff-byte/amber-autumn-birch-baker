import { useState, type ReactNode } from "react";
import { Check, ChevronRight, Pencil, Plus, RefreshCw, XCircle } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { Hint } from "@/components/ui/hint";
import { PickerInput } from "@/components/planner/picker-input";
import { cn } from "@/lib/cn";
import { todayIso } from "@/lib/dates";
import { SECTIONS, WEEKDAY_SHORT } from "@/lib/habit-plan";
import { draftPatch, habitDraft, toggleWeekday, type HabitDraft } from "@/lib/habit-view";
import { usePlanner } from "@/lib/planner-store";
import type { Habit, HabitFreq } from "@/lib/planner-types";
import { DAYS, pluralN } from "@/lib/plural";
import { TASK_COLORS } from "@/lib/task-colors";
import { HabitIcon } from "@/components/planner/habits/habit-ui";
import { ICONS, TEMPLATES, habitHex, randomQuote } from "@/components/planner/habits/habit-meta";

type Picker = "icon" | "goal" | "start" | "days" | { time: string | null } | null;

/** 21.09.2025 */
function dotDate(iso: string): string {
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
}

function Card({ title, extra, children, className }: { title?: ReactNode; extra?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("mt-3 rounded-card bg-card p-3 first:mt-0", className)}>
      {title ? (
        <div className="mb-2 flex min-h-6 items-center justify-between gap-2">
          <h3 className="text-body">{title}</h3>
          {extra}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** Rounded pill; filled when on. */
function Pill({ on, onClick, children, label, role = "radio" }: { on: boolean; onClick: () => void; children: ReactNode; label?: string; role?: "radio" | "checkbox" }) {
  return (
    <button
      type="button"
      role={role}
      aria-checked={on}
      aria-label={label}
      onClick={onClick}
      className={cn("h-9 min-w-0 truncate rounded-full px-2 text-[0.8125rem] tabular-nums transition-colors", on ? "bg-accent text-accent-fg" : "bg-surface text-muted")}
    >
      {children}
    </button>
  );
}

function ValueRow({ label, value, onClick, hint }: { label: string; value: string; onClick: () => void; hint?: ReactNode }) {
  return (
    <div className="flex min-h-12 items-center">
      <span className="text-body">{label}</span>
      {hint}
      <button type="button" onClick={onClick} aria-label={`${label}: ${value}`} className="flex h-12 min-w-0 flex-1 items-center justify-end gap-1 pl-3 text-body text-muted">
        <span className="truncate">{value}</span>
        <ChevronRight className="size-4 shrink-0 text-subtle" />
      </button>
    </div>
  );
}

function NumberField({ label, value, onValue, min, max, placeholder }: { label: string; value: number | null; onValue: (n: number | null) => void; min: number; max: number; placeholder?: string }) {
  return (
    <label className="flex min-w-0 flex-col text-xs text-subtle">
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
        className="mt-1 h-11 w-full rounded-card bg-card px-3 text-base text-fg outline-none placeholder:text-subtle"
      />
    </label>
  );
}

/**
 * «Изменить привычку» / «Новая привычка»: cards, pills, value rows
 * with small pickers on top. Nothing is saved until the round ✓.
 */
export function HabitEditor({
  habit,
  open,
  onClose,
  onSaved,
  onRemoved,
}: {
  /** null = a new habit. */
  habit: Habit | null;
  open: boolean;
  onClose: () => void;
  onSaved?: (id: string) => void;
  /** After «В архив» or «Удалить» (the habit page goes back to the list). */
  onRemoved?: () => void;
}) {
  if (!open) return null;
  return <EditorSheet key={habit?.id ?? "new"} habit={habit} onClose={onClose} onSaved={onSaved} onRemoved={onRemoved} />;
}

function EditorSheet({ habit, onClose, onSaved, onRemoved }: { habit: Habit | null; onClose: () => void; onSaved?: (id: string) => void; onRemoved?: () => void }) {
  const addHabit = usePlanner((s) => s.addHabit);
  const updateHabit = usePlanner((s) => s.updateHabit);
  const deleteHabit = usePlanner((s) => s.deleteHabit);
  const [draft, setDraft] = useState<HabitDraft>(() => habitDraft(habit));
  const [picker, setPicker] = useState<Picker>(null);
  const [confirm, setConfirm] = useState(false);
  const set = (patch: Partial<HabitDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const freq = draft.freq;
  const daily = freq.kind === "daily" || freq.kind === "weekdays";
  const preview = { name: draft.name || "✨", icon: draft.icon ?? (draft.name ? null : "✨"), color: draft.color };
  const today = todayIso();

  function save() {
    const patch = draftPatch(draft);
    if (!patch.name) return;
    if (habit) {
      updateHabit(habit.id, patch);
      onClose();
      onSaved?.(habit.id);
    } else {
      const id = addHabit(patch.name, patch);
      onClose();
      if (id) onSaved?.(id);
    }
  }

  const setFreq = (next: HabitFreq) => set({ freq: next });

  return (
    <Sheet open title={habit ? "Изменить привычку" : "Новая привычка"} onClose={onClose} action={{ label: "Сохранить привычку", onClick: save, disabled: !draft.name.trim(), icon: <Check className="size-5" strokeWidth={2.5} /> }}>
      <div className="pb-2">
        {!habit ? (
          <div className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4 pb-1" role="group" aria-label="Готовые привычки">
            {TEMPLATES.map((t) => (
              <button
                key={t.name}
                type="button"
                onClick={() => setDraft({ ...habitDraft({ ...t.extra, name: t.name }) })}
                className={cn("flex h-9 shrink-0 items-center gap-2 rounded-full bg-elevated px-3 text-[0.8125rem]", draft.name === t.name && "ring-2 ring-accent")}
              >
                <span aria-hidden="true">{t.extra.icon}</span>
                {t.name}
              </button>
            ))}
          </div>
        ) : null}

        <Card title="Название и значок">
          <form
            className="flex items-center gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
          >
            <button type="button" aria-label="Значок и цвет" onClick={() => setPicker("icon")} className="relative shrink-0">
              <HabitIcon habit={preview} size="md" className="size-14 text-2xl" />
              <span className="absolute right-0 bottom-0 flex size-5 items-center justify-center rounded-full bg-surface text-muted shadow-sm">
                <Pencil className="size-3" />
              </span>
            </button>
            <span className="relative min-w-0 flex-1">
              <input
                value={draft.name}
                maxLength={200}
                aria-label="Название привычки"
                placeholder="Например: пить воду"
                enterKeyHint="done"
                autoFocus={!habit}
                onChange={(event) => set({ name: event.target.value })}
                className="h-11 w-full rounded-xl bg-surface pr-10 pl-3 text-base outline-none placeholder:text-subtle"
              />
              {draft.name ? (
                <button type="button" aria-label="Очистить название" onClick={() => set({ name: "" })} className="absolute top-0 right-0 flex size-11 items-center justify-center text-subtle">
                  <XCircle className="size-4" />
                </button>
              ) : null}
            </span>
          </form>
        </Card>

        <Card title="Частота">
          <div role="radiogroup" aria-label="Частота" className="grid grid-cols-3 gap-2">
            <Pill on={daily} onClick={() => !daily && setFreq({ kind: "daily" })}>
              По дням
            </Pill>
            <Pill on={freq.kind === "weekly"} onClick={() => freq.kind !== "weekly" && setFreq({ kind: "weekly", times: 3 })}>
              В неделю
            </Pill>
            <Pill on={freq.kind === "interval"} onClick={() => freq.kind !== "interval" && setFreq({ kind: "interval", every: 2 })}>
              Интервал
            </Pill>
          </div>
          {daily ? (
            <>
              <p className="mt-3 mb-2 text-body">По каким дням</p>
              <div role="group" aria-label="Дни недели" className="grid grid-cols-4 gap-2">
                {WEEKDAY_SHORT.map((label, index) => (
                  <Pill key={label} role="checkbox" on={freq.kind === "daily" || freq.days.includes(index + 1)} onClick={() => setFreq(toggleWeekday(freq, index + 1))}>
                    {label.charAt(0).toUpperCase() + label.slice(1)}
                  </Pill>
                ))}
              </div>
            </>
          ) : null}
          {freq.kind === "weekly" ? (
            <>
              <p className="mt-3 mb-2 text-body">Сколько раз в неделю</p>
              <div role="radiogroup" aria-label="Раз в неделю" className="grid grid-cols-6 gap-2">
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  <Pill key={n} on={freq.times === n} onClick={() => setFreq({ kind: "weekly", times: n })}>
                    {n}
                  </Pill>
                ))}
              </div>
            </>
          ) : null}
          {freq.kind === "interval" ? (
            <>
              <p className="mt-3 mb-2 text-body">Раз в сколько дней</p>
              <div role="radiogroup" aria-label="Раз в N дней" className="grid grid-cols-4 gap-2">
                {[2, 3, 4, 5, 7, 10, 14, 30].map((n) => (
                  <Pill key={n} on={freq.every === n} onClick={() => setFreq({ kind: "interval", every: n })}>
                    {n}
                  </Pill>
                ))}
              </div>
            </>
          ) : null}
        </Card>

        <Card className="py-0">
          <div className="divide-y divide-line/70">
            <ValueRow label="Цель" value={draft.goal > 1 ? `${draft.goal}${draft.unit ? ` ${draft.unit}` : ""} / дн` : "Отметка / дн"} onClick={() => setPicker("goal")} />
            <ValueRow label="Дата начала" value={draft.startDate ? dotDate(draft.startDate) : "Не задана"} onClick={() => setPicker("start")} />
            <ValueRow
              label="Срок"
              value={draft.goalDays ? pluralN(draft.goalDays, DAYS) : "Без срока"}
              onClick={() => setPicker("days")}
              hint={<Hint label="Что такое срок">Сколько выполненных дней нужно набрать (например, 21 или 66). «Без срока» — просто привычка.</Hint>}
            />
          </div>
        </Card>

        <Card title="Раздел">
          <div role="radiogroup" aria-label="Раздел" className="grid grid-cols-4 gap-2">
            {SECTIONS.map((s) => (
              <Pill key={s.id} on={draft.section === s.id} onClick={() => set({ section: s.id })}>
                {s.label}
              </Pill>
            ))}
          </div>
        </Card>

        <Card title="Напоминания" extra={<Hint label="Про напоминания">Не придёт, если день уже отмечен или не по плану. Нажмите на время, чтобы изменить или убрать.</Hint>}>
          {draft.reminders.length ? (
            <div className="grid grid-cols-4 gap-2">
              {draft.reminders.map((t) => (
                <button key={t} type="button" aria-label={`Напоминание ${t}`} onClick={() => setPicker({ time: t })} className="h-9 rounded-full bg-accent text-[0.8125rem] tabular-nums text-accent-fg">
                  {t}
                </button>
              ))}
            </div>
          ) : null}
          <button type="button" onClick={() => setPicker({ time: null })} className="mt-1 flex h-9 items-center gap-1 text-[0.875rem] text-accent">
            <Plus className="size-4" /> Добавить
          </button>
        </Card>

        <Card className="py-1">
          <label className="flex min-h-11 cursor-pointer items-center gap-2">
            <span className="min-w-0 flex-1 text-body">Показывать дневник при отметке</span>
            <Hint label="Про дневник">Когда день выполнен, сразу откроется отметка: настроение и заметка.</Hint>
            <input type="checkbox" role="switch" checked={draft.journal} onChange={(event) => set({ journal: event.target.checked })} className="ios-switch shrink-0" />
          </label>
        </Card>

        <Card
          title="Мотивация"
          extra={
            <button type="button" aria-label="Другая фраза" onClick={() => set({ why: randomQuote(draft.why) })} className="-mr-2 flex size-9 items-center justify-center text-accent">
              <RefreshCw className="size-4" />
            </button>
          }
        >
          <span className="relative block">
            <input
              value={draft.why}
              maxLength={300}
              aria-label="Мотивация"
              placeholder="Зачем это вам? Например: чтобы больше успевать"
              onChange={(event) => set({ why: event.target.value })}
              className="h-11 w-full rounded-xl bg-surface pr-10 pl-3 text-base outline-none placeholder:text-subtle"
            />
            {draft.why ? (
              <button type="button" aria-label="Очистить мотивацию" onClick={() => set({ why: "" })} className="absolute top-0 right-0 flex size-11 items-center justify-center text-subtle">
                <XCircle className="size-4" />
              </button>
            ) : null}
          </span>
        </Card>

        {habit ? (
          <div className="mt-4 flex flex-col items-center">
            <button
              type="button"
              onClick={() => {
                updateHabit(habit.id, { archived: !habit.archived });
                onClose();
                onRemoved?.();
              }}
              className="h-11 px-4 text-body text-fg"
            >
              {habit.archived ? "Вернуть из архива" : "Убрать в архив"}
            </button>
            {confirm ? (
              <div className="flex items-center gap-2 py-1">
                <span className="text-xs text-muted">Удалить вместе с отметками?</span>
                <button type="button" onClick={() => setConfirm(false)} className="h-9 px-2 text-sm text-muted">
                  Отменить
                </button>
                <button
                  type="button"
                  onClick={() => {
                    deleteHabit(habit.id);
                    onClose();
                    onRemoved?.();
                  }}
                  className="h-9 rounded-full bg-danger px-3 text-sm font-medium text-on-danger"
                >
                  Удалить
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => setConfirm(true)} className="h-11 px-4 text-body text-danger">
                Удалить привычку
              </button>
            )}
          </div>
        ) : null}
      </div>

      {picker === "icon" ? <IconPicker draft={draft} set={set} onClose={() => setPicker(null)} /> : null}
      {picker === "goal" ? <GoalPicker draft={draft} set={set} onClose={() => setPicker(null)} /> : null}
      {picker === "start" ? (
        <SmallSheet title="Дата начала" onClose={() => setPicker(null)}>
          <PickerInput
            type="date"
            value={draft.startDate ?? ""}
            onValue={(value) => set({ startDate: value || null })}
            aria-label="Дата начала"
            clearLabel="Убрать дату начала"
            className="h-11 w-full rounded-card bg-card px-3 text-base"
          />
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Pill on={draft.startDate === today} onClick={() => set({ startDate: today })}>
              Сегодня
            </Pill>
            <Pill on={!draft.startDate} onClick={() => set({ startDate: null })}>
              Не задана
            </Pill>
          </div>
          <p className="mt-2 text-xs text-subtle">Дни до начала не считаются пропущенными.</p>
        </SmallSheet>
      ) : null}
      {picker === "days" ? (
        <SmallSheet title="Срок" onClose={() => setPicker(null)}>
          <div role="radiogroup" aria-label="Срок" className="grid grid-cols-4 gap-2">
            {[null, 7, 21, 30, 66, 100, 365].map((n) => (
              <Pill key={n ?? 0} on={draft.goalDays === n} onClick={() => set({ goalDays: n })}>
                {n ?? "Без срока"}
              </Pill>
            ))}
          </div>
          <div className="mt-3">
            <NumberField label="Своё число дней" value={draft.goalDays} min={1} max={3650} placeholder="например, 50" onValue={(n) => set({ goalDays: n })} />
          </div>
        </SmallSheet>
      ) : null}
      {picker && typeof picker === "object" ? (
        <ReminderPicker
          time={picker.time}
          onClose={() => setPicker(null)}
          onSave={(next) => set({ reminders: [...new Set([...draft.reminders.filter((t) => t !== picker.time), next])].sort() })}
          onRemove={() => set({ reminders: draft.reminders.filter((t) => t !== picker.time) })}
        />
      ) : null}
    </Sheet>
  );
}

/** A picker on top of the edit sheet (closes with ✕ or «Готово»). */
function SmallSheet({ title, onClose, children, action }: { title: string; onClose: () => void; children: ReactNode; action?: { label: string; onClick: () => void; disabled?: boolean } }) {
  return (
    <Sheet open title={title} onClose={onClose} action={action ?? { label: "Готово", onClick: onClose }}>
      <div className="pb-2">{children}</div>
    </Sheet>
  );
}

function IconPicker({ draft, set, onClose }: { draft: HabitDraft; set: (patch: Partial<HabitDraft>) => void; onClose: () => void }) {
  const hex = habitHex({ color: draft.color });
  return (
    <SmallSheet title="Значок и цвет" onClose={onClose}>
      <div className="grid grid-cols-6 gap-2">
        {ICONS.map((icon) => (
          <button
            key={icon}
            type="button"
            aria-pressed={draft.icon === icon}
            aria-label={`Значок ${icon}`}
            onClick={() => set({ icon: draft.icon === icon ? null : icon })}
            className={cn("flex aspect-square items-center justify-center rounded-full text-xl", draft.icon === icon ? "ring-2 ring-offset-2 ring-offset-surface" : "bg-elevated")}
            style={draft.icon === icon ? { background: `color-mix(in srgb, ${hex} 22%, var(--elevated))`, ["--tw-ring-color" as string]: hex } : undefined}
          >
            {icon}
          </button>
        ))}
      </div>
      <p className="mt-4 mb-2 text-body">Цвет</p>
      <div className="grid grid-cols-6 justify-items-center gap-3">
        {TASK_COLORS.map((c) => (
          <button
            key={c.id}
            type="button"
            aria-pressed={draft.color === c.id}
            aria-label={c.label}
            title={c.label}
            onClick={() => set({ color: draft.color === c.id ? null : c.id })}
            className={cn("size-9 rounded-full", draft.color === c.id && "ring-2 ring-fg ring-offset-2 ring-offset-surface")}
            style={{ background: c.hex }}
          />
        ))}
      </div>
    </SmallSheet>
  );
}

function GoalPicker({ draft, set, onClose }: { draft: HabitDraft; set: (patch: Partial<HabitDraft>) => void; onClose: () => void }) {
  const amount = draft.goal > 1;
  return (
    <SmallSheet title="Цель на день" onClose={onClose}>
      <div role="radiogroup" aria-label="Цель на день" className="grid grid-cols-2 gap-2">
        <Pill on={!amount} onClick={() => set({ goal: 1 })}>
          Просто отметить
        </Pill>
        <Pill on={amount} onClick={() => !amount && set({ goal: 8, unit: draft.unit || "раз" })}>
          Количество
        </Pill>
      </div>
      {amount ? (
        <div className="mt-3 grid grid-cols-3 gap-2">
          <NumberField label="Сколько" value={draft.goal} min={2} max={100000} onValue={(n) => set({ goal: n ?? 2 })} />
          <label className="flex min-w-0 flex-col text-xs text-subtle">
            Единица
            <input
              value={draft.unit}
              maxLength={20}
              placeholder="стаканов"
              onChange={(event) => set({ unit: event.target.value })}
              className="mt-1 h-11 w-full rounded-card bg-card px-3 text-base text-fg outline-none placeholder:text-subtle"
            />
          </label>
          <NumberField label="За нажатие" value={draft.step} min={1} max={10000} onValue={(n) => set({ step: n ?? 1 })} />
        </div>
      ) : null}
      <p className="mt-2 text-xs text-subtle">
        {amount ? "Каждое нажатие добавляет «за нажатие»; день засчитан, когда цель набрана." : "Одно нажатие — день выполнен."}
      </p>
    </SmallSheet>
  );
}

function ReminderPicker({ time, onClose, onSave, onRemove }: { time: string | null; onClose: () => void; onSave: (time: string) => void; onRemove: () => void }) {
  const [value, setValue] = useState(time ?? "09:00");
  return (
    <SmallSheet
      title={time ? "Изменить напоминание" : "Новое напоминание"}
      onClose={onClose}
      action={{
        label: "Готово",
        disabled: !value,
        onClick: () => {
          if (value) onSave(value);
          onClose();
        },
      }}
    >
      <PickerInput type="time" step={60} value={value} onValue={setValue} aria-label="Время напоминания" className="h-11 w-full rounded-card bg-card px-3 text-base" />
      {time ? (
        <button
          type="button"
          onClick={() => {
            onRemove();
            onClose();
          }}
          className="mt-3 h-11 w-full rounded-card bg-card text-body text-danger"
        >
          Убрать напоминание
        </button>
      ) : null}
    </SmallSheet>
  );
}
