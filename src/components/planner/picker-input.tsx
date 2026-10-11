import { useLayoutEffect, useRef, type InputHTMLAttributes } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Native date / time input whose own «Сброс» works.
 *
 * Why: a controlled React input keeps the HTML `value` ATTRIBUTE (the
 * default value) equal to the current value. The native picker's
 * «Сброс»/Reset button (iOS Safari, also some Android/desktop builds)
 * resets the field to that default value — i.e. to the value it already has,
 * so nothing changes and no change event comes. Here the default value is
 * blanked after every render, so «Сброс» empties the field and `onValue("")`
 * fires. A visible «×» does the same for browsers without such a button.
 */
export function PickerInput({
  type,
  value,
  onValue,
  clearLabel,
  className,
  ...rest
}: {
  type: "date" | "time";
  value: string;
  onValue: (value: string) => void;
  /** aria-label of the «×» button; omit to hide it. */
  clearLabel?: string;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange" | "defaultValue">) {
  const ref = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || node.defaultValue === "") return;
    // Mark the value dirty first: then changing the default no longer touches what is shown.
    node.value = value;
    node.defaultValue = "";
  });
  return (
    <span className="relative block">
      <input
        ref={ref}
        type={type}
        value={value}
        onChange={(event) => onValue(event.target.value)}
        // Some engines only fire `input` on reset.
        onInput={(event) => {
          const next = (event.target as HTMLInputElement).value;
          if (next !== value) onValue(next);
        }}
        onReset={() => onValue("")}
        className={cn(className, clearLabel && value ? "pr-11" : "")}
        {...rest}
      />
      {clearLabel && value ? (
        <button
          type="button"
          aria-label={clearLabel}
          title={clearLabel}
          onClick={() => onValue("")}
          className="absolute top-1/2 right-1 flex size-9 -translate-y-1/2 items-center justify-center rounded-full text-subtle hover:text-fg"
        >
          <X className="size-4" />
        </button>
      ) : null}
    </span>
  );
}
