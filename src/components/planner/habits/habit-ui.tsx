import { Check } from "lucide-react";
import { cn } from "@/lib/cn";
import type { DayState } from "@/lib/habit-plan";
import type { Habit } from "@/lib/planner-types";
import { habitHex } from "@/components/planner/habits/habit-meta";
export function HabitIcon({ habit, size = "md", className }: { habit: Pick<Habit, "color" | "icon" | "name">; size?: "sm" | "md" | "xl"; className?: string }) {
  const hex = habitHex(habit);
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full",
        size === "xl" ? "size-24 text-5xl" : size === "sm" ? "size-8 text-sm" : "size-10 text-lg",
        className,
      )}
      style={{ background: `color-mix(in srgb, ${hex} 20%, var(--elevated))`, color: hex }}
    >
      {habit.icon || habit.name.slice(0, 1).toUpperCase()}
    </span>
  );
}

/**
 * Round check with a progress ring (habit list): empty ring → arc for
 * partial amounts → filled circle with ✓ when done. `progress` is 0…1.
 */
export function RingCheck({
  progress,
  color,
  label,
  pressed,
  onClick,
  size = 36,
  disabled,
  state,
  text,
}: {
  progress: number;
  color: string;
  label: string;
  pressed: boolean;
  onClick?: () => void;
  size?: number;
  disabled?: boolean;
  state?: DayState;
  /** Day number in the calendar; omitted = a ✓ when done. */
  text?: string;
}) {
  const r = size / 2 - 2.5;
  const c = 2 * Math.PI * r;
  const done = progress >= 1;
  const muted = state === "off" || state === "before" || state === "future";
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={cn("relative flex shrink-0 items-center justify-center rounded-full tabular-nums disabled:cursor-default", text ? "text-[0.8125rem]" : "")}
      style={{ width: size, height: size }}
    >
      <svg viewBox={`0 0 ${size} ${size}`} className="absolute inset-0" aria-hidden="true">
        {done ? (
          <circle cx={size / 2} cy={size / 2} r={size / 2 - 1} fill={color} />
        ) : (
          <>
            {muted ? null : <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={2.5} />}
            {progress > 0 ? (
              <circle
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={color}
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeDasharray={c}
                strokeDashoffset={c * (1 - progress)}
                transform={`rotate(-90 ${size / 2} ${size / 2})`}
              />
            ) : null}
          </>
        )}
      </svg>
      <span
        className={cn(
          "relative leading-none",
          done ? "font-semibold text-white" : state === "fail" ? "text-danger" : state === "skip" ? "text-subtle line-through" : muted ? "text-subtle" : "text-fg",
        )}
      >
        {text ?? (done ? <Check className="size-4" strokeWidth={3} /> : null)}
      </span>
    </button>
  );
}
