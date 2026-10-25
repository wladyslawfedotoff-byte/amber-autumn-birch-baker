import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Свои размеры шрифта из токенов: без этого twMerge принимает text-body за цвет
// и выкидывает text-accent-fg, отчего основная кнопка теряла цвет текста.
const twMerge = extendTailwindMerge({
  extend: { classGroups: { "font-size": [{ text: ["caption", "body", "title", "large"] }] } },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
