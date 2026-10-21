import type { ReactNode } from "react";
import { Plus } from "lucide-react";

export type EmptyExample = { icon: string; label: string; onAdd: () => void };

/** Compact empty state: short title, one muted line, optional tappable examples. */
export function Empty({ title, hint, icon, examples }: { title: string; hint: string; icon?: ReactNode; examples?: EmptyExample[] }) {
  return (
    <div className="flex flex-col items-center px-6 pt-12 pb-6 text-center">
      {icon ? <span className="mb-2 text-subtle">{icon}</span> : null}
      <p className="text-[0.9375rem] font-semibold">{title}</p>
      <p className="mt-1 max-w-xs text-[0.8125rem] text-muted">{hint}</p>
      {examples?.length ? (
        <ul className="mt-3 w-full max-w-xs space-y-1.5">
          {examples.map((ex) => (
            <li key={ex.label}>
              <button
                type="button"
                onClick={ex.onAdd}
                className="flex h-10 w-full items-center gap-2 rounded-xl border border-dashed border-line px-3 text-left text-sm text-muted"
              >
                <span aria-hidden="true">{ex.icon}</span>
                <span className="min-w-0 flex-1 truncate">{ex.label}</span>
                <Plus className="size-4 shrink-0 text-accent" aria-label="Добавить" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
