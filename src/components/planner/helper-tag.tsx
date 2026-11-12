import { Bot, CircleCheck, CircleX, MessageSquare } from "lucide-react";
import { GroupedCard } from "@/components/ui/kit";
import { cn } from "@/lib/cn";
import type { Task } from "@/lib/planner-types";

/** «от помощника · Оркестратор» (1.25): the task was created by a bot with a helper key. */
export function HelperTag({ name, className }: { name: string; className?: string }) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1 text-accent-ink", className)} data-testid="helper-tag">
      <Bot className="size-3 shrink-0" aria-hidden="true" />
      <span className="max-w-48 truncate">от помощника · {name}</span>
    </span>
  );
}

function when(at: number): string {
  const d = new Date(at);
  const time = d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  return new Date().toDateString() === d.toDateString() ? `сегодня ${time}` : `${d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" })} ${time}`;
}

/** The bot's comments on its task, newest first (task sheet). */
export function HelperNotes({ task }: { task: Task }) {
  const notes = (task.helperNotes ?? []).slice().reverse();
  if (!notes.length) return null;
  return (
    <GroupedCard className="mt-3" title="Отчёт помощника">
      {notes.map((note) => {
        const Icon = note.result === "ok" ? CircleCheck : note.result === "fail" ? CircleX : MessageSquare;
        return (
          <li key={note.id} className="flex gap-2 px-3 py-2">
            <Icon
              className={cn("mt-0.5 size-4 shrink-0", note.result === "ok" ? "text-success" : note.result === "fail" ? "text-danger" : "text-secondary-label")}
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1">
              <p className="text-caption text-secondary-label">
                {note.result === "ok" ? "Получилось" : note.result === "fail" ? "Не получилось" : "Комментарий"} · {when(note.at)}
              </p>
              {note.text ? <p className="text-body whitespace-pre-wrap break-words text-label">{note.text}</p> : null}
            </div>
          </li>
        );
      })}
    </GroupedCard>
  );
}
