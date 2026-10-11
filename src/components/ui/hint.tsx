import { useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";

/** A small «?» that unfolds a short explanation: hints stay available but take no room. */
export function HintButton({ open, onToggle, label = "Подсказка" }: { open: boolean; onToggle: () => void; label?: string }) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-label={label}
      onClick={onToggle}
      className={cn(
        "-my-2 inline-flex size-8 shrink-0 items-center justify-center rounded-full align-middle",
        open ? "text-accent" : "text-subtle",
      )}
    >
      <span className="flex size-4 items-center justify-center rounded-full border border-current text-[10px] font-semibold leading-none">?</span>
    </button>
  );
}

/** Field label with an optional «?» hint underneath. */
export function FieldLabel({ children, hint, className }: { children: ReactNode; hint?: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={className}>
      <p className="flex items-center gap-0.5 text-xs font-medium text-subtle">
        {children}
        {hint ? <HintButton open={open} onToggle={() => setOpen(!open)} /> : null}
      </p>
      {hint && open ? <p className="mt-0.5 mb-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

/** Inline «?» + text (for places without a label). */
export function Hint({ children, label }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="inline">
      <HintButton open={open} onToggle={() => setOpen(!open)} label={label} />
      {open ? <span className="mt-1 block text-xs font-normal text-muted">{children}</span> : null}
    </span>
  );
}
