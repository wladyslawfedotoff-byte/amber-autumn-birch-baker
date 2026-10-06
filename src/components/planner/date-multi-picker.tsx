import { useState } from "react";
import { format, parseISO } from "date-fns";
import { ru } from "date-fns/locale";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { cleanDates, formatMonth, formatShort, todayIso } from "@/lib/dates";

const WEEK = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];

function monthGrid(year: number, month: number): (string | null)[] {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  const out: (string | null)[] = Array.from({ length: offset }, () => null);
  for (let day = 1; day <= days; day++) out.push(todayIso(new Date(year, month, day)));
  while (out.length % 7) out.push(null);
  return out;
}

/**
 * «Выбранные даты»: tap days in a month calendar (any months, back and forth).
 * Big 44px cells for phones; the chosen dates are listed below as chips.
 */
export function DateMultiPicker({ value, onChange }: { value: string[]; onChange: (dates: string[]) => void }) {
  const today = todayIso();
  const selected = new Set(cleanDates(value));
  const start = parseISO(cleanDates(value).find((d) => d >= today) ?? today);
  const [cursor, setCursor] = useState({ y: start.getFullYear(), m: start.getMonth() });
  const cells = monthGrid(cursor.y, cursor.m);
  const shift = (delta: number) => {
    const d = new Date(cursor.y, cursor.m + delta, 1);
    setCursor({ y: d.getFullYear(), m: d.getMonth() });
  };
  const toggle = (iso: string) => {
    const next = new Set(selected);
    if (next.has(iso)) next.delete(iso);
    else next.add(iso);
    onChange([...next].sort());
  };
  const sorted = [...selected].sort();
  const past = sorted.filter((d) => d < today);
  return (
    <div className="mt-2 rounded-xl border border-line p-2" data-testid="date-multi-picker">
      <div className="flex items-center">
        <button type="button" aria-label="Предыдущий месяц" onClick={() => shift(-1)} className="flex size-11 items-center justify-center rounded-md text-muted hover:text-fg">
          <ChevronLeft className="size-4" />
        </button>
        <p className="flex-1 text-center text-sm font-medium text-fg" aria-live="polite">
          {formatMonth(new Date(cursor.y, cursor.m, 1))}
        </p>
        <button type="button" aria-label="Следующий месяц" onClick={() => shift(1)} className="flex size-11 items-center justify-center rounded-md text-muted hover:text-fg">
          <ChevronRight className="size-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 text-center text-[11px] text-subtle" aria-hidden="true">
        {WEEK.map((d) => (
          <span key={d} className="py-1">
            {d}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-0.5" role="group" aria-label="Дни месяца">
        {cells.map((iso, index) =>
          iso ? (
            <button
              key={iso}
              type="button"
              aria-pressed={selected.has(iso)}
              aria-label={format(parseISO(iso), "d MMMM yyyy", { locale: ru })}
              onClick={() => toggle(iso)}
              className={cn(
                "flex h-11 items-center justify-center rounded-md text-sm tabular-nums",
                selected.has(iso) ? "bg-accent font-medium text-accent-fg" : iso < today ? "text-subtle" : "text-fg hover:bg-elevated",
                iso === today && !selected.has(iso) ? "ring-1 ring-accent" : "",
              )}
            >
              {Number(iso.slice(8))}
            </button>
          ) : (
            <span key={`empty-${index}`} />
          ),
        )}
      </div>
      {sorted.length ? (
        <div className="mt-2">
          <p className="px-1 text-xs text-muted">
            Выбрано: {sorted.length}. Нажмите на дату ещё раз, чтобы убрать.
          </p>
          <div className="mt-1 flex flex-wrap gap-1">
            {sorted.map((iso) => (
              <button
                key={iso}
                type="button"
                onClick={() => toggle(iso)}
                aria-label={`Убрать ${format(parseISO(iso), "d MMMM yyyy", { locale: ru })}`}
                className={cn("flex h-8 items-center gap-1 rounded-full border border-line px-2 text-xs", iso < today ? "text-subtle" : "text-fg")}
              >
                {formatShort(iso)}
                {iso.slice(0, 4) !== today.slice(0, 4) ? ` ${iso.slice(0, 4)}` : ""}
                <X className="size-3" aria-hidden="true" />
              </button>
            ))}
          </div>
          {past.length ? (
            <button type="button" onClick={() => onChange(sorted.filter((d) => d >= today))} className="mt-1 h-9 px-1 text-xs text-muted underline">
              Убрать прошедшие ({past.length})
            </button>
          ) : null}
        </div>
      ) : (
        <p className="mt-2 px-1 text-xs text-muted">Например: дни сдачи показаний, приёмы у врача, дежурства — любые дни в разных месяцах.</p>
      )}
    </div>
  );
}
