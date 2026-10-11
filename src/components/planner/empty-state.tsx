import type { ReactNode } from "react";

/** Compact empty state (TickTick-like): short title, one muted line, no big serif. */
export function Empty({ title, hint, icon }: { title: string; hint: string; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 pt-12 pb-6 text-center">
      {icon ? <span className="mb-2 text-subtle">{icon}</span> : null}
      <p className="text-[0.9375rem] font-semibold">{title}</p>
      <p className="mt-1 max-w-xs text-[0.8125rem] text-muted">{hint}</p>
    </div>
  );
}
