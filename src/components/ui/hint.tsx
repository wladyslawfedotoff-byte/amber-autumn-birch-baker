import { useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";

/** A small «?» that unfolds a short explanation: hints stay available but take no room. */
export function HintButton({ open, onToggle, label = "Подсказка", className }: { open: boolean; onToggle: () => void; label?: string; className?: string }) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-label={label}
      onClick={onToggle}
      className={cn(
        "-my-2 inline-flex size-8 shrink-0 items-center justify-center rounded-full align-middle",
        open ? "text-accent" : "text-subtle",
        className,
      )}
    >
      <span className="flex size-4 items-center justify-center rounded-full border border-current text-[0.625rem] font-semibold leading-none">?</span>
    </button>
  );
}

/** Field label with an optional «?» hint underneath. */
/** Label above a field; `caps` = a section header (same style as the kit SectionHeader). */
export function FieldLabel({ children, hint, className, caps }: { children: ReactNode; hint?: ReactNode; className?: string; caps?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={className}>
      <p className={caps ? "flex items-center gap-1 text-[0.6875rem] font-semibold tracking-wide text-tertiary-label uppercase" : "flex items-center gap-1 text-xs font-medium text-subtle"}>
        {children}
        {hint ? <HintButton open={open} onToggle={() => setOpen(!open)} /> : null}
      </p>
      {hint && open ? <p className="mt-1 mb-1 text-xs text-muted">{hint}</p> : null}
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

/** A one-line «? label» that unfolds a short explanation (keeps screens compact). */
export function InlineHint({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={cn("text-xs text-subtle", className)}>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className={cn("inline-flex h-8 items-center gap-2 px-1", open && "text-accent")}>
        <span aria-hidden="true" className="flex size-4 items-center justify-center rounded-full border border-current text-[0.625rem] font-semibold leading-none">
          ?
        </span>
        {label}
      </button>
      {open ? <p className="px-1 pb-2 text-[0.8125rem] leading-snug text-muted">{children}</p> : null}
    </div>
  );
}
