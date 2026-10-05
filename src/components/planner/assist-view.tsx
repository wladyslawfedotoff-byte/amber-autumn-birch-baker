import { useState } from "react";
import { Button } from "@/components/ui/button";
import { todayIso } from "@/lib/dates";
import { planTasks, type PlannedTask } from "@/lib/plan-tasks";
import { usePlanner } from "@/lib/planner-store";

export function AssistView({ onOpen }: { onOpen: (id: string) => void }) {
  const lists = usePlanner((s) => s.lists);
  const tasks = usePlanner((s) => s.tasks);
  const addTask = usePlanner((s) => s.addTask);
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [drafts, setDrafts] = useState<PlannedTask[]>([]);
  const [picked, setPicked] = useState<boolean[]>([]);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<"capture" | "plan" | null>(null);

  async function ask(mode: "capture" | "plan") {
    if (pending) return;
    setPending(mode);
    setError("");
    try {
      const result = await planTasks({
        data: {
          mode,
          text,
          today: todayIso(),
          lists: lists.map((list) => list.name),
          openTasks: tasks.filter((task) => !task.done).map((task) => task.title),
        },
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setNote(result.note);
      setDrafts(result.tasks);
      setPicked(result.tasks.map(() => true));
    } catch {
      setError("Не удалось спросить помощника.");
    } finally {
      setPending(null);
    }
  }

  function accept() {
    for (const [index, draft] of drafts.entries()) {
      if (!picked[index]) continue;
      const list = lists.find((item) => item.name.toLowerCase() === (draft.list ?? "").toLowerCase());
      const id = addTask({
        title: draft.title,
        due: draft.due,
        listId: list?.id ?? null,
        important: draft.important,
        urgent: draft.urgent,
        priority: draft.important && draft.urgent ? 3 : draft.important ? 2 : draft.urgent ? 1 : 0,
      });
      if (index === drafts.findIndex((_, i) => picked[i])) onOpen(id);
    }
    setDrafts([]);
    setPicked([]);
    setText("");
    setNote(note ? `${note} Добавлено.` : "Добавлено.");
  }

  return (
    <div className="mx-auto max-w-xl">
      <p className="text-sm text-muted">
        Напишите, что крутится в голове. Помощник разложит это на задачи или соберёт план на сегодня из того, что уже есть.
      </p>
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={6}
        placeholder="Завтра созвон, купить подарок к дню рождения, дописать отчёт..."
        className="mt-4 w-full resize-y rounded-lg border border-line bg-elevated px-3 py-3 text-sm outline-none placeholder:text-subtle"
      />
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="primary" disabled={pending !== null || !text.trim()} onClick={() => void ask("capture")}>
          {pending === "capture" ? "Разбираю…" : "Разобрать в задачи"}
        </Button>
        <Button variant="soft" disabled={pending !== null} onClick={() => void ask("plan")}>
          {pending === "plan" ? "Думаю…" : "План на сегодня"}
        </Button>
      </div>
      {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
      {note ? <p className="mt-4 text-sm text-fg">{note}</p> : null}
      {drafts.length > 0 ? (
        <ul className="mt-4 divide-y divide-line rounded-lg border border-line">
          {drafts.map((draft, index) => (
            <li key={`${draft.title}-${index}`} className="flex items-start gap-3 px-3 py-3">
              <input
                type="checkbox"
                className="mt-1 size-4"
                checked={picked[index] ?? false}
                onChange={() =>
                  setPicked((current) => current.map((value, i) => (i === index ? !value : value)))
                }
                aria-label={draft.title}
              />
              <div className="min-w-0">
                <p className="text-sm">{draft.title}</p>
                <p className="text-xs text-muted">
                  {[
                    draft.due,
                    draft.list,
                    draft.important ? "важно" : null,
                    draft.urgent ? "срочно" : null,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "без даты"}
                </p>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {drafts.some((_, index) => picked[index]) ? (
        <Button variant="primary" className="mt-3" onClick={accept}>
          Добавить выбранные
        </Button>
      ) : null}
    </div>
  );
}
