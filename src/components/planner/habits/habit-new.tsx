import { useState } from "react";
import { Sheet } from "@/components/ui/sheet";
import { usePlanner } from "@/lib/planner-store";
import type { Habit } from "@/lib/planner-types";
import { HabitIcon } from "@/components/planner/habits/habit-ui";
import { TEMPLATES } from "@/components/planner/habits/habit-meta";

/**
 * «Новая привычка»: own name (then the editor opens to set it up) or one tap
 * on a ready template from the gallery.
 */
export function NewHabitSheet({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string, custom: boolean) => void }) {
  const addHabit = usePlanner((s) => s.addHabit);
  const habits = usePlanner((s) => s.habits);
  const [name, setName] = useState("");
  const create = (title: string, extra?: Partial<Habit>) => {
    const id = addHabit(title, extra);
    if (!id) return;
    setName("");
    onClose();
    onCreated(id, !extra);
  };
  const taken = new Set(habits.filter((h) => !h.archived).map((h) => h.name));
  return (
    <Sheet open={open} title="Новая привычка" onClose={onClose} action={{ label: "Создать", onClick: () => create(name), disabled: !name.trim() }}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          create(name);
        }}
      >
        <input
          autoFocus
          value={name}
          maxLength={200}
          onChange={(event) => setName(event.target.value)}
          aria-label="Название привычки"
          placeholder="Например: 10 минут чтения"
          enterKeyHint="done"
          className="h-11 w-full rounded-xl bg-elevated px-3 text-base outline-none placeholder:text-subtle"
        />
      </form>
      <p className="mt-4 mb-1.5 px-1 text-xs font-medium text-subtle uppercase">Или готовая</p>
      <div className="grid grid-cols-2 gap-2">
        {TEMPLATES.map((t) => (
          <button
            key={t.name}
            type="button"
            disabled={taken.has(t.name)}
            onClick={() => create(t.name, t.extra)}
            className="flex items-center gap-2.5 rounded-xl bg-elevated p-2.5 text-left disabled:opacity-40"
          >
            <HabitIcon habit={{ name: t.name, icon: t.extra.icon, color: t.extra.color }} />
            <span className="min-w-0">
              <span className="block truncate text-[0.9375rem] font-medium">{t.name}</span>
              <span className="block truncate text-[0.75rem] text-muted">{t.hint}</span>
            </span>
          </button>
        ))}
      </div>
      <p className="mt-3 px-1 text-xs text-subtle">Начните с маленькой — такой, что не найдётся причины не сделать.</p>
    </Sheet>
  );
}
