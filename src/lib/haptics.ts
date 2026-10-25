/**
 * Light haptic tick (Apple-style feedback). `navigator.vibrate` exists on
 * Android browsers; iOS Safari ignores it, so this is a quiet no-op there.
 * Off under «Уменьшить движение».
 */
export function haptic(kind: "tick" | "select" | "warn" = "tick"): void {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  if (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  navigator.vibrate(kind === "warn" ? [10, 40, 10] : kind === "select" ? 6 : 10);
}
