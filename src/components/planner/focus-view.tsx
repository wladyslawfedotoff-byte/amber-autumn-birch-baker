import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { todayIso } from "@/lib/dates";
import { breakFor, usePlanner } from "@/lib/planner-store";

const PRESETS = [
  { label: "25 мин", work: 25 * 60 },
  { label: "50 мин", work: 50 * 60 },
  { label: "15 мин", work: 15 * 60 },
] as const;

function formatClock(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function FocusView() {
  const tasks = usePlanner((s) => s.tasks);
  const toggleTask = usePlanner((s) => s.toggleTask);
  const pomoDate = usePlanner((s) => s.pomoDate);
  const pomoCount = usePlanner((s) => s.pomoCount);
  const focus = usePlanner((s) => s.focus);
  const startFocus = usePlanner((s) => s.startFocus);
  const pauseFocus = usePlanner((s) => s.pauseFocus);
  const resetFocus = usePlanner((s) => s.resetFocus);
  const setWorkLen = usePlanner((s) => s.setWorkLen);
  const setFocusTask = usePlanner((s) => s.setFocusTask);
  const today = todayIso();
  const sessions = pomoDate === today ? pomoCount : 0;
  const total = focus.mode === "work" ? focus.workLen : breakFor(focus.workLen);
  const openTasks = tasks.filter((task) => !task.done);
  const radius = 88;
  const circ = 2 * Math.PI * radius;
  const offset = circ * (1 - (total === 0 ? 0 : focus.seconds / total));
  const label = focus.running ? "Пауза" : focus.seconds < total ? "Дальше" : "Старт";
  const linked = tasks.find((task) => task.id === focus.taskId);

  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center py-4">
      <div className="flex flex-wrap justify-center gap-2">
        {PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            aria-pressed={focus.workLen === preset.work && focus.mode === "work"}
            onClick={() => setWorkLen(preset.work)}
            className={cn(
              "h-11 rounded-full border px-4 text-sm",
              focus.workLen === preset.work
                ? "border-accent bg-accent text-accent-fg"
                : "border-line text-muted",
            )}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <div className="relative mt-8 size-64">
        <svg viewBox="0 0 200 200" className="size-full" aria-hidden="true">
          <circle cx="100" cy="100" r={radius} fill="none" className="stroke-line" strokeWidth="8" />
          <circle
            cx="100"
            cy="100"
            r={radius}
            fill="none"
            className="stroke-accent"
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={circ}
            strokeDashoffset={offset}
            transform="rotate(-90 100 100)"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <p className="text-xs text-subtle">{focus.mode === "work" ? "Фокус" : "Перерыв"}</p>
          <p className="font-display text-5xl tabular-nums tracking-tight">{formatClock(focus.seconds)}</p>
        </div>
      </div>

      <div className="mt-6 flex items-center gap-2">
        <Button variant="primary" onClick={() => (focus.running ? pauseFocus() : startFocus())}>
          {label}
        </Button>
        <Button variant="soft" onClick={resetFocus}>
          Сброс
        </Button>
      </div>

      <p className="mt-4 text-sm text-muted">
        Сессии сегодня: <span className="tabular-nums text-fg">{sessions}</span>
      </p>
      {focus.note ? <p className="mt-2 text-center text-sm text-fg">{focus.note}</p> : null}

      <label className="mt-8 block w-full text-xs font-medium text-subtle">
        Задача сессии
        <select
          value={focus.taskId ?? ""}
          onChange={(event) => setFocusTask(event.target.value || null)}
          className="mt-2 h-11 w-full rounded-md border border-line bg-elevated px-3 text-sm font-normal text-fg"
        >
          <option value="">Без задачи</option>
          {openTasks.map((task) => (
            <option key={task.id} value={task.id}>
              {task.title}
            </option>
          ))}
        </select>
      </label>
      {linked && !linked.done ? (
        <Button className="mt-3" variant="soft" onClick={() => toggleTask(linked.id)}>
          Отметить выполненной
        </Button>
      ) : null}
    </div>
  );
}

export function formatFocusClock(total: number): string {
  return formatClock(total);
}
