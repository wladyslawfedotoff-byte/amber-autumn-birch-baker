import { AddTaskForm, TaskRow } from "@/components/planner/task-row";
import { Empty } from "@/components/planner/empty-state";
import { todayIso } from "@/lib/dates";
import { usePlanner } from "@/lib/planner-store";
import { byNewest } from "@/lib/queries";

export function ChecklistView({
  selectedId,
  onOpen,
}: {
  selectedId: string | null;
  onOpen: (id: string) => void;
}) {
  const tasks = usePlanner((s) => s.tasks);
  const addTask = usePlanner((s) => s.addTask);
  const today = todayIso();
  const open = tasks.filter((task) => !task.done).sort(byNewest);

  return (
    <div>
      <AddTaskForm
        className="mb-3 hidden md:block"
        placeholder="Созвон завтра в 10"
        onAdd={(title, quick) => addTask({ title, ...quick, listId: null, due: null })}
      />
      <div>
        {open.length === 0 ? (
          <Empty title="Всё сделано" hint="Нажмите «+», чтобы добавить задачу. Можно вставить сразу несколько строк — каждая станет задачей." />
        ) : (
          open.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              today={today}
              selected={selectedId === task.id}
              showDue
              showList
              onOpen={onOpen}
            />
          ))
        )}
      </div>
    </div>
  );
}
