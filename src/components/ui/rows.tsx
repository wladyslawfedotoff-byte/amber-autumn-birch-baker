import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";

/** iOS-settings-like group of rows. */
export function RowGroup({ children, className, title }: { children: ReactNode; className?: string; title?: string }) {
  return (
    <div className={cn("mt-3", className)}>
      {title ? <p className="mb-1 px-1 text-xs font-medium text-subtle">{title}</p> : null}
      <div className="divide-y divide-line overflow-hidden rounded-xl bg-elevated">{children}</div>
    </div>
  );
}

/**
 * «Дата        11 окт ›»: label left, value right. With `open` + children the row
 * unfolds its editor right under itself (an accordion), so nothing jumps far.
 */
export function Row({
  label,
  value,
  icon,
  onClick,
  open,
  children,
  danger,
}: {
  label: ReactNode;
  value?: ReactNode;
  icon?: ReactNode;
  onClick?: () => void;
  open?: boolean;
  children?: ReactNode;
  danger?: boolean;
}) {
  return (
    <div>
      <button
        type="button"
        aria-expanded={children !== undefined ? Boolean(open) : undefined}
        onClick={onClick}
        className={cn("flex min-h-11 w-full items-center gap-3 px-3 text-left text-[0.9375rem]", danger ? "text-danger" : "text-fg")}
      >
        {icon ? <span className="flex size-5 shrink-0 items-center justify-center text-subtle">{icon}</span> : null}
        <span className="shrink-0">{label}</span>
        <span className="min-w-0 flex-1 truncate text-right text-sm text-muted">{value}</span>
        {onClick ? <ChevronRight className={cn("size-4 shrink-0 text-subtle transition-transform", open && "rotate-90")} aria-hidden="true" /> : null}
      </button>
      {open && children ? <div className="px-3 pb-3">{children}</div> : null}
    </div>
  );
}

/** Row with a switch on the right. */
export function SwitchRow({ label, checked, onChange, hint }: { label: ReactNode; checked: boolean; onChange: (next: boolean) => void; hint?: ReactNode }) {
  return (
    <label className="flex min-h-11 w-full cursor-pointer items-center gap-3 px-3 text-[0.9375rem]">
      <span className="min-w-0 flex-1">
        {label}
        {hint ? <span className="block text-xs text-muted">{hint}</span> : null}
      </span>
      <input type="checkbox" role="switch" checked={checked} onChange={(event) => onChange(event.target.checked)} className="ios-switch shrink-0" />
    </label>
  );
}
