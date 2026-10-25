import type { Task } from "./planner-types";

/**
 * «Задача удалена · Вернуть» (1.22): удаление запоминает задачу целиком
 * (подзадачи, заметки, вложения, напоминание), её место в списке и задачи,
 * которые её ждали. «Вернуть» кладёт всё обратно. Синхронизация видит
 * возвращённую задачу как правку новее метки удаления, поэтому она
 * восстанавливается и на сервере.
 */
export type DeletedTask = { task: Task; index: number; dependents: string[] };

export function removeTask(tasks: readonly Task[], id: string): { tasks: Task[]; deleted: DeletedTask | null } {
  const index = tasks.findIndex((t) => t.id === id);
  if (index < 0) return { tasks: [...tasks], deleted: null };
  const dependents = tasks.filter((t) => t.dependsOn === id).map((t) => t.id);
  const next = tasks.filter((t) => t.id !== id).map((t) => (t.dependsOn === id ? { ...t, dependsOn: null } : t));
  return { tasks: next, deleted: { task: tasks[index]!, index, dependents } };
}

export function restoreDeleted(tasks: readonly Task[], deleted: DeletedTask): Task[] {
  if (tasks.some((t) => t.id === deleted.task.id)) return [...tasks];
  const back = new Set(deleted.dependents);
  const next = tasks.map((t) => (back.has(t.id) && !t.dependsOn ? { ...t, dependsOn: deleted.task.id } : t));
  next.splice(Math.min(deleted.index, next.length), 0, deleted.task);
  return next;
}
