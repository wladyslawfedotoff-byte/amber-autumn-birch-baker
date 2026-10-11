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
    <div className="mx-auto flex w-full max-w-md flex-col items-center py-2">
      <div className="grid w-full max-w-xs grid-cols-3 gap-0.5 rounded-lg bg-elevated p-0.5" role="radiogroup" aria-label="Длина сессии">
        {PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            role="radio"
            aria-checked={focus.workLen === preset.work}
            onClick={() => setWorkLen(preset.work)}
            className={cn("h-8 rounded-md text-sm", focus.workLen === preset.work ? "bg-surface font-semibold text-fg shadow-sm" : "text-muted")}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <div className="relative mt-6 size-56">
        <svg viewBox="0 0 200 200" className="size-full" aria-hidden="true">
          <circle cx="100" cy="100" r={radius} fill="none" className="stroke-line" strokeWidth="6" />
          <circle
            cx="100"
            cy="100"
            r={radius}
            fill="none"
            className="stroke-accent"
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={circ}
            strokeDashoffset={offset}
            transform="rotate(-90 100 100)"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <p className="text-xs text-subtle">{focus.mode === "work" ? "Фокус" : "Перерыв"}</p>
          <p className="text-[2.75rem] font-light tabular-nums leading-none tracking-tight">{formatClock(focus.seconds)}</p>
        </div>
      </div>

      <div className="mt-5 flex items-center gap-2">
        <Button variant="primary" className="min-w-28 rounded-full" onClick={() => (focus.running ? pauseFocus() : startFocus())}>
          {label}
        </Button>
        <Button variant="soft" className="rounded-full" onClick={resetFocus}>
          Сброс
        </Button>
      </div>

      <p className="mt-3 text-xs text-muted">
        Сессии сегодня: <span className="tabular-nums text-fg">{sessions}</span>
      </p>
      {focus.note ? <p className="mt-2 text-center text-sm text-fg">{focus.note}</p> : null}

      <label className="mt-6 flex min-h-11 w-full items-center gap-3 rounded-xl bg-elevated pl-3 text-[0.9375rem]">
        <span className="shrink-0">Задача</span>
        <select
          value={focus.taskId ?? ""}
          onChange={(event) => setFocusTask(event.target.value || null)}
          aria-label="Задача сессии"
          className="h-11 min-w-0 flex-1 appearance-none truncate border-0 bg-transparent pr-3 text-right text-base text-muted shadow-none outline-none"
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
        <Button className="mt-2" variant="ghost" size="sm" onClick={() => toggleTask(linked.id)}>
          Отметить выполненной
        </Button>
      ) : null}
    </div>
  );
}

export function formatFocusClock(total: number): string {
  return formatClock(total);
}
