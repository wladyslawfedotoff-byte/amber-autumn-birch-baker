import { todayIso } from "@/lib/dates";
import { usePlanner } from "@/lib/planner-store";
import { isImportant, isUrgent, type Task } from "@/lib/planner-types";
import { cn } from "@/lib/cn";

const QUADS: { title: string; hint: string; important: boolean; urgent: boolean }[] = [
  { title: "Сделать", hint: "важно и срочно", important: true, urgent: true },
  { title: "Запланировать", hint: "важно, не горит", important: true, urgent: false },
  { title: "Быстро", hint: "горит, но не важно", important: false, urgent: true },
  { title: "Потом", hint: "не важно и не горит", important: false, urgent: false },
];

export function MatrixView({
  selectedId,
  onOpen,
}: {
  selectedId: string | null;
  onOpen: (id: string) => void;
}) {
  const tasks = usePlanner((s) => s.tasks);
  const updateTask = usePlanner((s) => s.updateTask);
  const today = todayIso();
  const open = tasks.filter((task) => !task.done);

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {QUADS.map((quad) => {
        const items = open.filter(
          (task) => isImportant(task) === quad.important && isUrgent(task) === quad.urgent,
        );
        return (
          <section key={quad.title} className="rounded-lg border border-line bg-elevated p-3">
            <h2 className="text-sm font-medium">{quad.title}</h2>
            <p className="text-xs text-subtle">{quad.hint}</p>
            <ul className="mt-3 space-y-2">
              {items.length === 0 ? <li className="py-4 text-sm text-muted">Пусто</li> : null}
              {items.map((task) => (
                <li key={task.id}>
                  <MatrixCard
                    task={task}
                    today={today}
                    selected={selectedId === task.id}
                    onOpen={onOpen}
                    onFlag={(patch) => updateTask(task.id, patch)}
                  />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function MatrixCard({
  task,
  today,
  selected,
  onOpen,
  onFlag,
}: {
  task: Task;
  today: string;
  selected: boolean;
  onOpen: (id: string) => void;
  onFlag: (patch: { important?: boolean; urgent?: boolean }) => void;
}) {
  const overdue = task.due != null && task.due < today;
  return (
    <div className={cn("rounded-md border border-line px-2 py-2", selected && "bg-surface")}>
      <button type="button" onClick={() => onOpen(task.id)} className="w-full text-left text-sm">
        {task.title}
        {task.due ? (
          <span className={cn("mt-1 block text-xs", overdue ? "text-danger" : "text-muted")}>{task.due}</span>
        ) : null}
      </button>
      <div className="mt-2 flex gap-1">
        <button
          type="button"
          aria-pressed={isImportant(task)}
          onClick={() => onFlag({ important: !isImportant(task) })}
          className={cn(
            "h-11 rounded-md border px-3 text-xs",
            isImportant(task) ? "border-accent text-fg" : "border-line text-subtle",
          )}
        >
          Важно
        </button>
        <button
          type="button"
          aria-pressed={isUrgent(task)}
          onClick={() => onFlag({ urgent: !isUrgent(task) })}
          className={cn(
            "h-11 rounded-md border px-3 text-xs",
            isUrgent(task) ? "border-danger text-danger" : "border-line text-subtle",
          )}
        >
          Срочно
        </button>
      </div>
    </div>
  );
}
