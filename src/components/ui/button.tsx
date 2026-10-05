import type { ButtonHTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const buttonVariants = cva(
  "press inline-flex items-center justify-center gap-2 rounded-md font-medium disabled:pointer-events-none disabled:opacity-40",
  {
    variants: {
      variant: {
        primary: "bg-accent text-accent-fg hover:opacity-90",
        soft: "border border-line bg-elevated text-fg hover:bg-surface",
        ghost: "bg-transparent text-fg hover:bg-elevated",
        destructive: "bg-danger text-on-danger hover:opacity-90",
      },
      size: {
        md: "h-11 px-4 text-sm",
        sm: "h-11 px-3 text-sm",
        icon: "size-11",
      },
    },
    defaultVariants: { variant: "ghost", size: "md" },
  },
);

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>;

export function Button({ className, variant, size, type = "button", ...props }: ButtonProps) {
  return (
    <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  );
}
