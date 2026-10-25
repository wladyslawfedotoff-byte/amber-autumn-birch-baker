import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import { useSheetDrag } from "@/lib/sheet-drag";

/**
 * One editing surface for the whole app: a bottom sheet on phones (like iOS),
 * a centred dialog on wide screens. Header: «×» on the left, title in the
 * middle, the ONE primary action on the right («Готово», «Добавить»).
 * The overlay follows the visual viewport, so with the iOS keyboard open the
 * sheet shrinks to the space above it instead of sliding off-screen.
 * Apple style (1.18): grabber on top, pull the header down to close,
 * «Отменить» on the left when there is a primary action, «Готово» otherwise.
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
  /** With `icon` the action is a round accent button («✓»), `label` becomes its aria-label. */
  action?: { label: string; onClick: () => void; disabled?: boolean; icon?: ReactNode };
  children: ReactNode;
  className?: string;
}) {
  const drag = useSheetDrag(onClose);
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
    <div className="vv-frame z-[70] flex items-end justify-center pt-[env(safe-area-inset-top)] md:items-center" role="presentation">
      <button type="button" aria-hidden="true" tabIndex={-1} className="scrim absolute inset-0" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={drag.panelRef}
        className={cn(
          "sheet-panel relative flex max-h-[calc(100%-0.5rem)] md:max-h-[92%] w-full flex-col rounded-t-2xl bg-surface shadow-xl md:max-w-lg md:rounded-2xl",
          className,
        )}
      >
        <div className="shrink-0 touch-none" onPointerDown={drag.onPointerDown}>
        <span aria-hidden="true" className="sheet-grabber md:hidden" />
        <div className="flex items-center gap-2 px-2 pt-1 pb-1">
          {action ? (
            <button type="button" onClick={onClose} className="h-11 min-w-11 shrink-0 rounded-full px-2 text-body text-accent">
              Отменить
            </button>
          ) : (
            <span className="h-11 min-w-11 shrink-0" aria-hidden="true" />
          )}
          <p className="min-w-0 flex-1 truncate text-center text-body font-semibold">{title}</p>
          {action?.icon ? (
            <button
              type="button"
              aria-label={action.label}
              title={action.label}
              onClick={action.onClick}
              disabled={action.disabled}
              className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent text-accent-fg disabled:opacity-40"
            >
              {action.icon}
            </button>
          ) : action ? (
            <button
              type="button"
              onClick={action.onClick}
              disabled={action.disabled}
              className="h-9 shrink-0 rounded-full bg-accent px-4 text-sm font-medium text-accent-fg disabled:opacity-40"
            >
              {action.label}
            </button>
          ) : (
            <button type="button" onClick={onClose} className="h-11 min-w-11 shrink-0 rounded-full px-2 text-body font-semibold text-accent">
              Готово
            </button>
          )}
        </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-1 pb-[max(1rem,var(--safe-b))]">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
