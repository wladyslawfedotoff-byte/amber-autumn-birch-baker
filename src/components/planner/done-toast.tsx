import { useEffect } from "react";
import { Check } from "lucide-react";
import { dueLabel, todayIso } from "@/lib/dates";
import { useDoneToast } from "@/lib/done-toast";
import { usePlanner } from "@/lib/planner-store";

/** «Готово ✓ · Отменить» for a few seconds after ticking a task. */
export function DoneToastBar() {
  const toast = useDoneToast((s) => s.toast);
  const clear = useDoneToast((s) => s.clear);
  const toggleTask = usePlanner((s) => s.toggleTask);
  const undoRepeat = usePlanner((s) => s.undoRepeat);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(clear, 5000);
    return () => window.clearTimeout(timer);
  }, [toast, clear]);
  if (!toast) return null;
  const text = toast.repeat
    ? `отмечено, следующий раз ${toast.next ? dueLabel(toast.next, todayIso()) : "—"}`
    : "готово — внизу списка, в «Готово»";
  return (
    <div role="status" className="pointer-events-none absolute inset-x-0 bottom-[5.5rem] z-30 flex justify-center px-4 md:bottom-6">
      <div className="card-lift pointer-events-auto flex w-full max-w-md min-w-0 items-center gap-3 rounded-xl bg-fg px-4 py-2 text-sm text-surface">
        <Check className="size-4 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">
          «{toast.title}» {text}
        </span>
        <button
          type="button"
          className="h-9 shrink-0 rounded-md px-2 font-medium underline-offset-2 hover:underline"
          onClick={() => {
            if (toast.repeat) undoRepeat(toast.id);
            else toggleTask(toast.id);
            clear();
          }}
        >
          Отменить
        </button>
      </div>
    </div>
  );
}
