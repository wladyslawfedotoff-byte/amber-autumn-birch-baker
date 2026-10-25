/**
 * The UI kit (1.20): one look for every screen. Built only on the tokens in
 * src/tokens.css. States everywhere: pressed (active:), focus-visible (global
 * ring), disabled (40 %), loading (spinner, inert), error / success.
 * Live catalogue: /kit.
 */
import { useId, type InputHTMLAttributes, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Info, Loader2, Search, X, XCircle, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { icon as iconColor, type IconColor } from "@/lib/design/tokens";

const paint = (color: IconColor | string) => (color.startsWith("var(") ? color : iconColor(color as IconColor));

/** Solid squircle (radius 25 %) with a white glyph. md = 28 px (rows), lg = 32 px (tiles). */
export function IconBadge({ icon: Icon, color, size = "md" }: { icon: LucideIcon; color: IconColor | string; size?: "md" | "lg" }) {
  return (
    <span
      aria-hidden="true"
      className={cn("flex shrink-0 items-center justify-center rounded-[var(--r-badge)] text-[var(--on-badge)]", size === "lg" ? "size-[var(--badge-lg)]" : "size-[var(--badge)]")}
      style={{ background: paint(color) }}
    >
      <Icon className={size === "lg" ? "size-[var(--icon-md)]" : "size-[var(--icon-sm)]"} strokeWidth={2.25} />
    </span>
  );
}

/** Right-aligned number; nothing for zero. */
export function Counter({ value, tone = "plain" }: { value: number | string | null | undefined; tone?: "plain" | "danger" | "accent" }) {
  if (value === null || value === undefined || value === 0 || value === "") return null;
  return (
    <span className={cn("shrink-0 text-body tabular-nums", tone === "danger" ? "text-danger" : tone === "accent" ? "text-accent-ink" : "text-tertiary-label")}>{value}</span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("size-[var(--icon-sm)] animate-spin", className)} aria-label="Загрузка" />;
}

/** Caps caption above a card; a button with a chevron when the card folds. */
/** Подпись секции капсом — общий стиль для всех экранов. */
export const CAPS = "text-[0.6875rem] font-semibold tracking-wide text-tertiary-label uppercase";

export function SectionHeader({ title, count, folded, onFold }: { title: string; count?: number; folded?: boolean; onFold?: () => void }) {
  const label = <span className={CAPS}>{title}</span>;
  if (!onFold) return <div className="mb-1 px-1">{label}</div>;
  return (
    <button type="button" aria-expanded={!folded} onClick={onFold} className="mb-1 flex min-h-8 w-full items-center gap-1 px-1 text-left">
      {label}
      {folded && count ? <span className="text-caption text-tertiary-label tabular-nums">{count}</span> : null}
      <ChevronDown className={cn("ml-auto size-[var(--icon-sm)] text-tertiary-label transition-transform duration-[var(--dur-fast)]", folded && "-rotate-90")} aria-hidden="true" />
    </button>
  );
}

/** Grouped inset card: rounded, card background, hairlines inset after the icon. */
export function GroupedCard({
  title,
  count,
  folded,
  onFold,
  children,
  className,
}: {
  title?: string;
  count?: number;
  folded?: boolean;
  onFold?: () => void;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section aria-label={title} className={cn("mt-4", className)}>
      {title ? <SectionHeader title={title} count={count} folded={folded} onFold={onFold} /> : null}
      {folded ? null : <ul className="menu-card overflow-hidden rounded-card">{children}</ul>}
    </section>
  );
}

const ROW =
  "flex min-h-[var(--row-h)] w-full touch-manipulation items-center gap-3 px-3 py-1 text-left text-body transition-colors duration-[var(--dur-fast)] select-none [-webkit-touch-callout:none] active:bg-fg/[0.06] disabled:pointer-events-none disabled:opacity-40";

export type ListRowProps = {
  icon?: LucideIcon;
  color?: IconColor | string;
  /** Any leading node instead of a badge (an avatar, a check). */
  lead?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  value?: ReactNode;
  counter?: number | string | null;
  /** Shows a chevron (navigation). Default: when onClick is set and there is no toggle. */
  chevron?: boolean;
  toggle?: { checked: boolean; onChange: (next: boolean) => void };
  destructive?: boolean;
  accent?: boolean;
  active?: boolean;
  disabled?: boolean;
  loading?: boolean;
  trailing?: ReactNode;
  onClick?: () => void;
  /** Extra props for the row button (long press handlers, data-*). */
  buttonProps?: Record<string, unknown>;
  children?: ReactNode;
};

/** One row of a grouped card. Renders an <li>. */
export function ListRow({
  icon,
  color = "grey",
  lead,
  title,
  subtitle,
  value,
  counter,
  chevron,
  toggle,
  destructive,
  accent,
  active,
  disabled,
  loading,
  trailing,
  onClick,
  buttonProps,
  children,
}: ListRowProps) {
  const id = useId();
  const body = (
    <>
      {lead ?? (icon ? <IconBadge icon={icon} color={destructive ? "red" : color} /> : null)}
      <span className={value ? "min-w-0 max-w-[65%] shrink-0" : "min-w-0 flex-1"}>
        <span className={cn("block truncate", destructive ? "text-danger" : accent ? "menu-add font-medium" : "text-label", active && "font-semibold")}>{title}</span>
        {subtitle ? <span className="block truncate text-caption text-secondary-label">{subtitle}</span> : null}
      </span>
      {value ? <span className="min-w-0 flex-1 truncate text-right text-body text-secondary-label">{value}</span> : null}
      <Counter value={counter} />
      {trailing}
      {loading ? <Spinner className="text-tertiary-label" /> : null}
      {!loading && (chevron ?? (Boolean(onClick) && !toggle)) ? <ChevronRight className="size-[var(--icon-sm)] shrink-0 text-tertiary-label" aria-hidden="true" /> : null}
    </>
  );
  if (toggle) {
    return (
      <li>
        <label htmlFor={id} className={cn(ROW, "cursor-pointer", disabled && "pointer-events-none opacity-40")}>
          {body}
          <input
            id={id}
            type="checkbox"
            role="switch"
            disabled={disabled}
            checked={toggle.checked}
            onChange={(event) => toggle.onChange(event.target.checked)}
            className="ios-switch shrink-0"
          />
        </label>
        {children}
      </li>
    );
  }
  return (
    <li>
      {onClick ? (
        <button
          type="button"
          aria-current={active ? "page" : undefined}
          aria-busy={loading || undefined}
          disabled={disabled || loading}
          onClick={onClick}
          className={cn(ROW, active && "bg-fg/[0.06]")}
          {...buttonProps}
        >
          {body}
        </button>
      ) : (
        <div className={ROW}>{body}</div>
      )}
      {children}
    </li>
  );
}

/** Smart-list tile: badge top-left, big count top-right, name below. */
export function Tile({ icon, color, label, count, active, onClick }: { icon: LucideIcon; color: IconColor | string; label: string; count: number; active?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      onClick={onClick}
      className={cn("press menu-card flex h-[4.5rem] w-full flex-col justify-between rounded-card p-2 text-left", active && "ring-2 ring-accent/60")}
    >
      <span className="flex w-full items-start justify-between">
        <IconBadge icon={icon} color={color} size="lg" />
        <span className={cn("text-[1.375rem] leading-none font-bold tabular-nums", count === 0 && "opacity-35")}>{count}</span>
      </span>
      <span className="truncate text-[0.875rem] leading-tight font-semibold text-secondary-label">{label}</span>
    </button>
  );
}

/** Card with icon, title, subtitle, value and chevron (a summary that opens something). */
export function InfoCard({ icon, color, title, subtitle, value, onClick }: { icon: LucideIcon; color: IconColor | string; title: ReactNode; subtitle?: ReactNode; value?: ReactNode; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} disabled={!onClick} className="press menu-card flex min-h-16 w-full items-center gap-3 rounded-card px-3 py-2 text-left disabled:cursor-default">
      <IconBadge icon={icon} color={color} size="lg" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-caption text-secondary-label">{title}</span>
        {value ? <span className="block truncate text-title leading-tight font-bold tabular-nums">{value}</span> : null}
        {subtitle ? <span className="block truncate text-caption text-tertiary-label">{subtitle}</span> : null}
      </span>
      {onClick ? <ChevronRight className="size-[var(--icon-sm)] shrink-0 text-tertiary-label" aria-hidden="true" /> : null}
    </button>
  );
}

type FieldState = "error" | "success" | undefined;
export const FIELD =
  "h-11 w-full rounded-md border bg-surface-2 px-3 text-base text-label outline-none transition-[border-color,box-shadow] duration-[var(--dur-fast)] placeholder:text-tertiary-label focus:border-accent focus:ring-2 focus:ring-accent/25 disabled:opacity-40";

/** Text field: label above, helper or error below; error = red border, success = green check. */
export function TextField({
  label,
  helper,
  state,
  className,
  ...input
}: InputHTMLAttributes<HTMLInputElement> & { label?: string; helper?: ReactNode; state?: FieldState }) {
  const id = useId();
  return (
    <div className={className}>
      {label ? (
        <label htmlFor={id} className="mb-1 block px-1 text-caption text-secondary-label">
          {label}
        </label>
      ) : null}
      <div className="relative">
        <input
          id={id}
          aria-invalid={state === "error" || undefined}
          aria-describedby={helper ? `${id}-help` : undefined}
          className={cn(FIELD, state === "error" ? "border-danger focus:border-danger focus:ring-danger/25" : state === "success" ? "border-success pr-9" : "border-separator")}
          {...input}
        />
        {state === "success" ? <CheckCircle2 className="absolute top-1/2 right-3 size-[var(--icon-sm)] -translate-y-1/2 text-success" aria-label="верно" /> : null}
      </div>
      {helper ? (
        <p id={`${id}-help`} className={cn("mt-1 px-1 text-caption", state === "error" ? "text-danger" : "text-secondary-label")}>
          {helper}
        </p>
      ) : null}
    </div>
  );
}

export function SearchField({ value, onChange, placeholder = "Поиск", className }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  return (
    <label className={cn("relative block", className)}>
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-[var(--icon-sm)] -translate-y-1/2 text-tertiary-label" aria-hidden="true" />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-9 w-full rounded-md bg-fg/[0.07] pr-3 pl-8 text-body outline-none placeholder:text-tertiary-label focus:ring-2 focus:ring-accent/25"
      />
    </label>
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (next: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <input
      type="checkbox"
      role="switch"
      aria-label={label}
      checked={checked}
      disabled={disabled}
      onChange={(event) => onChange(event.target.checked)}
      className="ios-switch shrink-0 disabled:opacity-40"
    />
  );
}

export function SegmentedControl<T extends string>({ options, value, onChange, label }: { options: { id: T; label: string }[]; value: T; onChange: (id: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="grid rounded-md bg-fg/[0.06] p-0.5" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="radio"
          aria-checked={option.id === value}
          onClick={() => onChange(option.id)}
          className={cn(
            "min-h-8 rounded-[calc(var(--r-md)-2px)] text-[0.8125rem] transition-colors duration-[var(--dur-fast)]",
            option.id === value ? "bg-surface-2 font-semibold text-label shadow-[var(--shadow-1)]" : "text-secondary-label",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** Sheet header: «Отменить» — title — «Готово». */
export function SheetHeader({ title, onCancel, onDone, doneLabel = "Готово", doneDisabled, loading }: { title: string; onCancel?: () => void; onDone?: () => void; doneLabel?: string; doneDisabled?: boolean; loading?: boolean }) {
  return (
    <div className="grid min-h-11 grid-cols-[1fr_auto_1fr] items-center gap-2 px-2">
      <div>
        {onCancel ? (
          <button type="button" onClick={onCancel} className="min-h-11 px-2 text-body text-link">
            Отменить
          </button>
        ) : null}
      </div>
      <h2 className="truncate text-center text-body font-semibold">{title}</h2>
      <div className="flex justify-end">
        {onDone ? (
          <button type="button" onClick={onDone} disabled={doneDisabled || loading} className="flex min-h-11 items-center gap-1 px-2 text-body font-semibold text-link disabled:opacity-40">
            {loading ? <Spinner /> : null}
            {doneLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export type Tone = "success" | "error" | "info" | "warning";
const TONE: Record<Tone, { icon: LucideIcon; text: string; tint: string }> = {
  success: { icon: CheckCircle2, text: "text-success", tint: "bg-success/12" },
  error: { icon: XCircle, text: "text-danger", tint: "bg-danger/12" },
  info: { icon: Info, text: "text-info", tint: "bg-info/12" },
  warning: { icon: AlertTriangle, text: "text-warning", tint: "bg-warning/12" },
};

/** Inline status banner (also the toast body): icon, title, subtitle, close. */
export function Banner({ tone, title, subtitle, onClose, action }: { tone: Tone; title: ReactNode; subtitle?: ReactNode; onClose?: () => void; action?: ReactNode }) {
  const meta = TONE[tone];
  const Icon = meta.icon;
  return (
    <div role={tone === "error" ? "alert" : "status"} className={cn("menu-card flex items-start gap-3 rounded-card p-3", "relative overflow-hidden")}>
      <span className={cn("pointer-events-none absolute inset-0", meta.tint)} aria-hidden="true" />
      <Icon className={cn("relative mt-0.5 size-[var(--icon-lg)] shrink-0", meta.text)} strokeWidth={2} aria-hidden="true" />
      <div className="relative min-w-0 flex-1">
        <p className="text-body font-semibold text-label">{title}</p>
        {subtitle ? <p className="text-caption text-secondary-label">{subtitle}</p> : null}
        {action ? <div className="mt-2">{action}</div> : null}
      </div>
      {onClose ? (
        <button type="button" aria-label="Закрыть" onClick={onClose} className="relative -mt-2 -mr-2 flex size-11 shrink-0 items-center justify-center text-tertiary-label">
          <X className="size-[var(--icon-sm)]" />
        </button>
      ) : null}
    </div>
  );
}

/** Floating toast at the bottom (wraps a Banner). */
export function Toast(props: Parameters<typeof Banner>[0]) {
  return (
    <div className="pointer-events-auto mx-auto w-full max-w-sm shadow-[var(--shadow-pop)]">
      <Banner {...props} />
    </div>
  );
}

export function EmptyState({ icon: Icon, title, text, action }: { icon: LucideIcon; title: string; text?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-8 text-center">
      <Icon className="size-8 text-tertiary-label" strokeWidth={1.5} aria-hidden="true" />
      <p className="mt-2 text-body font-semibold text-label">{title}</p>
      {text ? <p className="mt-1 max-w-xs text-caption text-secondary-label">{text}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
