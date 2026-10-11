import { Check } from "lucide-react";
import { cn } from "@/lib/cn";
import { TASK_COLORS, colorLabel, type TaskColor } from "@/lib/task-colors";

/** Google-Calendar-like palette: tap a colour, tap again (or «Без цвета») to clear. */
export function ColorPicker({ value, onChange }: { value: TaskColor | null | undefined; onChange: (color: TaskColor | null) => void }) {
  return (
    <fieldset className="mt-5">
      <legend className="text-xs font-medium text-subtle">
        Цвет <span className="font-normal">· {colorLabel(value)}</span>
      </legend>
      <p className="mt-1 text-xs text-muted">Например: работа — «Черника», дом — «Базилик», срочное — «Томат». Цвет виден в списках, календаре и расписании.</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <button
          type="button"
          aria-pressed={!value}
          title="Без цвета"
          aria-label="Без цвета"
          onClick={() => onChange(null)}
          className={cn(
            "flex size-9 items-center justify-center rounded-full border border-dashed border-line text-xs text-muted",
            !value && "ring-2 ring-fg ring-offset-2 ring-offset-bg",
          )}
        >
          —
        </button>
        {TASK_COLORS.map((item) => {
          const on = value === item.id;
          return (
            <button
              key={item.id}
              type="button"
              aria-pressed={on}
              aria-label={item.label}
              title={item.label}
              onClick={() => onChange(on ? null : item.id)}
              className={cn("flex size-9 items-center justify-center rounded-full", on && "ring-2 ring-fg ring-offset-2 ring-offset-bg")}
              style={{ background: item.hex }}
            >
              {on ? <Check className="size-4 text-white" strokeWidth={3} aria-hidden="true" /> : null}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
