import type { ButtonHTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Buttons (1.20 kit). primary = filled accent, secondary = outline,
 * plain = text only, destructive = filled danger. «soft» / «ghost» are the
 * older names of secondary / plain. All are ≥ 44 px tall.
 */
const buttonVariants = cva(
  "press inline-flex items-center justify-center gap-2 rounded-md font-medium transition-[opacity,background-color] duration-[var(--dur-fast)] disabled:pointer-events-none disabled:opacity-40 aria-busy:pointer-events-none",
  {
    variants: {
      variant: {
        primary: "bg-accent text-accent-fg active:opacity-80",
        secondary: "border border-accent/60 bg-transparent text-accent active:bg-accent/10",
        plain: "bg-transparent text-accent active:bg-accent/10",
        destructive: "bg-danger text-on-danger active:opacity-80",
        soft: "border border-line bg-elevated text-fg active:bg-surface",
        ghost: "bg-transparent text-fg active:bg-elevated",
      },
      size: {
        md: "h-11 px-4 text-body",
        sm: "h-11 px-3 text-sm",
        icon: "size-11",
      },
    },
    defaultVariants: { variant: "ghost", size: "md" },
  },
);

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants> & { loading?: boolean };

export function Button({ className, variant, size, type = "button", loading, children, ...props }: ButtonProps) {
  return (
    <button type={type} aria-busy={loading || undefined} className={cn(buttonVariants({ variant, size }), className)} {...props}>
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}
