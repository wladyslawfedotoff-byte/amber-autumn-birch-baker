import { useEffect, type RefObject } from "react";
import { Plus } from "lucide-react";
import { AddTaskForm, type QuickOptions } from "@/components/planner/task-row";
import { cn } from "@/lib/cn";

/**
 * TickTick-like quick add on phones: a round «+» opens a composer docked to
 * the bottom of the app frame. The frame follows the visual viewport, so the
 * composer sits right above the iOS keyboard. The composer is always mounted
 * (just hidden) so the tap can focus it synchronously — iOS shows the keyboard
 * only for focus inside the tap.
 */
export function Fab({ label, onClick, className }: { label: string; onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "press absolute right-4 bottom-4 z-30 flex size-14 items-center justify-center rounded-full bg-accent text-accent-fg shadow-lg md:hidden",
        className,
      )}
    >
      <Plus className="size-6" strokeWidth={2.25} />
    </button>
  );
}

export function QuickComposer({
  open,
  onClose,
  inputRef,
  title,
  placeholder,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  inputRef: RefObject<HTMLInputElement | null>;
  /** «На сегодня», «На 14 октября», «В список «Дом»». */
  title: string;
  placeholder: string;
  onAdd: (title: string, options: QuickOptions) => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <div
      className={cn("absolute inset-0 z-[60] flex flex-col justify-end md:hidden", open ? "" : "pointer-events-none")}
    >
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        onClick={onClose}
        className={cn("scrim absolute inset-0 transition-opacity duration-150", open ? "opacity-100" : "opacity-0")}
      />
      <div
        role="dialog"
        aria-label="Новая задача"
        className={cn(
          "relative rounded-t-2xl bg-surface px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-xl transition-[transform,opacity] duration-150",
          open ? "translate-y-0 opacity-100" : "translate-y-[110%] opacity-0",
        )}
      >
        <p className="px-1 pb-1.5 text-xs font-medium text-subtle">{title}</p>
        <AddTaskForm placeholder={placeholder} inputRef={inputRef} onAdd={onAdd} onEscape={onClose} />
        <p className="px-1 pt-1.5 text-xs text-subtle">Дата и время распознаются сами: «завтра в 10», «в пятницу в 15», «через неделю».</p>
      </div>
    </div>
  );
}
