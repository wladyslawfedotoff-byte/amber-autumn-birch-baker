import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * One editing surface for the whole app: a bottom sheet on phones (like iOS),
 * a centred dialog on wide screens. Header: «×» on the left, title in the
 * middle, the ONE primary action on the right («Готово», «Сохранить»).
 */
export function Sheet({
  open,
  title,
  onClose,
  action,
  children,
  className,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  /** Primary action in the header; omit for sheets that save as you type. */
  action?: { label: string; onClick: () => void; disabled?: boolean };
  children: ReactNode;
  className?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end justify-center md:items-center" role="presentation">
      <button type="button" aria-hidden="true" tabIndex={-1} className="scrim absolute inset-0" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          "sheet-panel relative flex max-h-[92dvh] w-full flex-col rounded-t-2xl bg-surface shadow-xl md:max-w-lg md:rounded-2xl",
          className,
        )}
      >
        <div className="flex shrink-0 items-center gap-2 px-2 pt-2 pb-1">
          <button type="button" aria-label="Закрыть" onClick={onClose} className="flex size-11 items-center justify-center rounded-full text-muted">
            <X className="size-5" />
          </button>
          <p className="min-w-0 flex-1 truncate text-center text-[15px] font-semibold">{title}</p>
          {action ? (
            <button
              type="button"
              onClick={action.onClick}
              disabled={action.disabled}
              className="h-9 shrink-0 rounded-full bg-accent px-4 text-sm font-medium text-accent-fg disabled:opacity-40"
            >
              {action.label}
            </button>
          ) : (
            <span className="size-11 shrink-0" aria-hidden="true" />
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-1 pb-[max(1rem,env(safe-area-inset-bottom))]">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
