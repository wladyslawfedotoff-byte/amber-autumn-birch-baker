import { useEffect, useState, type RefObject } from "react";
import { Plus } from "lucide-react";
import { AddTaskForm, type QuickOptions } from "@/components/planner/task-row";
import { cn } from "@/lib/cn";
import { useSheetDrag } from "@/lib/sheet-drag";
import { parseQuick } from "@/lib/quick-add";
import { formatLong, shiftIso, todayIso } from "@/lib/dates";

/**
 * Quick add on phones: a round «+» opens a composer docked to
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
        "press absolute right-4 bottom-[calc(4.25rem+var(--safe-b))] z-30 flex size-14 items-center justify-center rounded-full bg-accent text-accent-fg shadow-lg md:hidden",
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
  const { panelRef, onPointerDown: onDragDown } = useSheetDrag(onClose);
  const [draft, setDraft] = useState("");
  const heading = headingFor(title, parseQuick(draft).due);
  useEffect(() => {
    if (!open) return;
    // A sheet closed by a drag keeps its inline transform; reset it for the next open.
    if (panelRef.current) panelRef.current.style.transform = "";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, panelRef]);

  return (
    <div
      className={cn("absolute inset-0 z-[60] flex flex-col justify-end md:items-center", open ? "" : "pointer-events-none", !open && "md:hidden")}
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
        ref={panelRef}
        className={cn(
          "relative rounded-t-2xl bg-surface px-3 md:mb-6 md:w-[32rem] md:rounded-2xl pt-2 pb-[max(0.5rem,var(--safe-b))] shadow-xl transition-[transform,opacity] duration-150",
          open ? "translate-y-0 opacity-100" : "translate-y-[110%] opacity-0",
        )}
      >
        <div className="-mx-3 -mt-2 touch-none px-3 pt-0 pb-2" onPointerDown={onDragDown}>
          <span aria-hidden="true" className="sheet-grabber md:hidden" />
          <p className="px-1 text-xs font-medium text-subtle" aria-live="polite">{heading}</p>
        </div>
        <AddTaskForm placeholder={placeholder} inputRef={inputRef} onAdd={onAdd} onEscape={onClose} onDraft={setDraft} />
        <p className="px-1 pt-2 text-xs text-subtle">«завтра в 10», «в пятницу в 15» — дата и время распознаются сами. Несколько строк — несколько задач.</p>
      </div>
    </div>
  );
}

/** Шапка следует распознанной дате (1.22): «На завтра», «В список «Дом» · на завтра». */
function headingFor(title: string, due: string | null): string {
  if (!due) return title;
  const today = todayIso();
  const day = due === today ? "На сегодня" : due === shiftIso(today, 1) ? "На завтра" : `На ${formatLong(due).toLowerCase()}`;
  return title.startsWith("На ") ? day : `${title} · ${day.toLowerCase()}`;
}
