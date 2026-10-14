import { Lock } from "lucide-react";
import { FieldLabel } from "@/components/ui/hint";
import { usePlanner } from "@/lib/planner-store";
import type { Task } from "@/lib/planner-types";
import { isBlocked, wouldCycle } from "@/lib/task-deps";

export function DependsBlock({ task }: { task: Task }) {
  const tasks = usePlanner((s) => s.tasks);
  const setTaskDependsOn = usePlanner((s) => s.setTaskDependsOn);
  const options = tasks
    .filter((item) => item.id !== task.id && !item.done)
    .filter((item) => !wouldCycle(task.id, item.id, tasks))
    .sort((a, b) => a.title.localeCompare(b.title, "ru"));
  const prereq = task.dependsOn ? tasks.find((item) => item.id === task.dependsOn) : null;
  const blocked = isBlocked(task, tasks);

  return (
    <section className="mt-3" data-testid="depends-block">
      <FieldLabel hint="Дело не появится в «Сегодня», пока не выполнено выбранное. Циклы запрещены.">
        Ждёт
      </FieldLabel>
      <div className="mt-1 flex items-center gap-2">
        {blocked ? <Lock className="size-4 shrink-0 text-warn" aria-hidden="true" /> : null}
        <select
          aria-label="Ждёт дело"
          value={task.dependsOn ?? ""}
          onChange={(event) => setTaskDependsOn(task.id, event.target.value || null)}
          className="h-11 min-w-0 flex-1 rounded-md border border-line bg-elevated px-3 text-base text-fg"
        >
          <option value="">Не ждёт</option>
          {options.map((item) => (
            <option key={item.id} value={item.id}>
              {item.title || "Без названия"}
            </option>
          ))}
          {prereq && !options.some((item) => item.id === prereq.id) ? (
            <option value={prereq.id}>{prereq.title}{prereq.done ? " (готово)" : ""}</option>
          ) : null}
        </select>
      </div>
      {blocked && prereq ? (
        <p className="mt-1 text-xs text-warn">Скрыто из «Сегодня», пока не готово: «{prereq.title}».</p>
      ) : null}
    </section>
  );
}
