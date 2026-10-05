import { useState } from "react";
import { Button } from "@/components/ui/button";
import { countdownLabel, daysBetween, formatLong, nextOccurrence, todayIso } from "@/lib/dates";
import { usePlanner } from "@/lib/planner-store";
import type { MilestoneKind } from "@/lib/planner-types";

const KINDS: { id: MilestoneKind; label: string }[] = [
  { id: "birthday", label: "День рождения" },
  { id: "anniversary", label: "Годовщина" },
  { id: "holiday", label: "Праздник" },
  { id: "other", label: "Другое" },
];

export function DatesView() {
  const milestones = usePlanner((s) => s.milestones) ?? [];
  const addMilestone = usePlanner((s) => s.addMilestone);
  const updateMilestone = usePlanner((s) => s.updateMilestone);
  const deleteMilestone = usePlanner((s) => s.deleteMilestone);
  const today = todayIso();
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(today);
  const [yearly, setYearly] = useState(true);
  const [kind, setKind] = useState<MilestoneKind>("birthday");
  const [time, setTime] = useState("09:00");

  const rows = milestones
    .map((item) => {
      const when = nextOccurrence(item.date, item.yearly, today);
      return { item, when, days: daysBetween(today, when) };
    })
    .sort((a, b) => a.days - b.days);

  return (
    <div>
      <ul className="divide-y divide-line">
        {rows.length === 0 ? <li className="py-8 text-sm text-muted">Пока нет важных дат.</li> : null}
        {rows.map((row) => (
          <li key={row.item.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <div className="w-16 shrink-0 text-center">
                <p className="font-display text-2xl tabular-nums leading-none">{Math.max(0, row.days)}</p>
                <p className="text-xs text-subtle">дн.</p>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{row.item.title}</p>
                <p className="text-xs text-muted">
                  {formatLong(row.when)} · {countdownLabel(row.days)}
                  {row.item.yearly ? " · каждый год" : ""}
                  {row.item.remindAt ? ` · в ${row.item.remindAt}` : ""}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="time"
                value={row.item.remindAt ?? ""}
                aria-label={`Напомнить, ${row.item.title}`}
                onChange={(event) => updateMilestone(row.item.id, { remindAt: event.target.value || null })}
                className="h-11 w-36 shrink-0 rounded-md border border-line bg-elevated px-3 text-sm"
              />
              <Button variant="ghost" className="text-danger" onClick={() => deleteMilestone(row.item.id)}>
                Удалить
              </Button>
            </div>
          </li>
        ))}
      </ul>

      <form
        className="mt-6 grid gap-3 rounded-lg border border-line bg-elevated p-3"
        onSubmit={(event) => {
          event.preventDefault();
          addMilestone({ title, date, yearly, kind, remindAt: time || null });
          setTitle("");
        }}
      >
        <p className="text-xs font-medium text-subtle">Новая дата</p>
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Название"
          aria-label="Название даты"
          className="h-11 rounded-md border border-line bg-surface px-3 text-sm outline-none placeholder:text-subtle"
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <input
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            aria-label="Дата"
            className="h-11 rounded-md border border-line bg-surface px-3 text-sm"
          />
          <select
            value={kind}
            onChange={(event) => setKind(event.target.value as MilestoneKind)}
            aria-label="Тип даты"
            className="h-11 rounded-md border border-line bg-surface px-3 text-sm"
          >
            {KINDS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
        <input
          type="time"
          value={time}
          onChange={(event) => setTime(event.target.value)}
          aria-label="Время напоминания"
          className="h-11 rounded-md border border-line bg-surface px-3 text-sm"
        />
        <label className="flex h-11 items-center gap-2 text-sm">
          <input type="checkbox" checked={yearly} onChange={(event) => setYearly(event.target.checked)} />
          Повторять каждый год
        </label>
        <Button type="submit" variant="primary" disabled={!title.trim() || !date}>
          Добавить дату
        </Button>
      </form>
    </div>
  );
}
