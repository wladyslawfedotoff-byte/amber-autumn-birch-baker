/** Placeholder rows while the planner loads: same height as real rows, no layout jump. */
export function PlannerSkeleton() {
  return (
    <div aria-busy="true" aria-label="Загрузка задач" className="animate-pulse">
      <div className="mb-3 h-4 w-40 rounded bg-elevated" />
      {[72, 56, 64, 48, 60, 52].map((w, i) => (
        <div key={i} className="task-row mb-1 flex h-11 items-center gap-3 rounded-card bg-card px-3">
          <span className="size-[1.125rem] shrink-0 rounded-full border-2 border-line" />
          <span className="h-3 rounded bg-line" style={{ width: `${w}%` }} />
        </div>
      ))}
    </div>
  );
}
