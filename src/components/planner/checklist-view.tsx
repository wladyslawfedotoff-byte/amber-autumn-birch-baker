import { useState } from "react";
import { TaskRow } from "@/components/planner/task-row";
import { Button } from "@/components/ui/button";
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
  const [bulk, setBulk] = useState("");
  const open = tasks.filter((task) => !task.done).sort(byNewest);

  return (
    <div>
      <form
        className="rounded-lg border border-line bg-elevated p-3"
        onSubmit={(event) => {
          event.preventDefault();
          const lines = bulk
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean)
            .slice(0, 20);
          for (const title of lines) addTask({ title, listId: null, due: null });
          setBulk("");
        }}
      >
        <label className="block text-xs font-medium text-subtle">
          Несколько дел — каждое с новой строки
          <textarea
            value={bulk}
            onChange={(event) => setBulk(event.target.value)}
            rows={4}
            placeholder={"Купить хлеб\nПозвонить маме\nОтправить счёт"}
            className="mt-2 w-full resize-y rounded-md border border-line bg-surface px-3 py-3 text-sm text-fg outline-none placeholder:text-subtle"
          />
        </label>
        <Button type="submit" variant="primary" className="mt-3" disabled={!bulk.trim()}>
          Добавить в список
        </Button>
      </form>

      <div className="mt-4">
        {open.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted">Список дел пуст.</p>
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
