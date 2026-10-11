/**
 * iOS Safari ignores `interactive-widget=resizes-content`: when the keyboard
 * opens it keeps the layout viewport and pans the *visual* viewport instead,
 * so a full-height app slides up and the focused field drifts off-screen.
 * We pin the app frame to the visual viewport (top = offsetTop, height =
 * visible height) while the keyboard is open, and to the whole screen
 * otherwise. Pure part here; the DOM wiring is in use-viewport-frame.ts.
 */

/** Smaller gaps are toolbars collapsing, not a keyboard. */
export const KEYBOARD_MIN = 120;

export type FrameInput = { innerHeight: number; vvHeight: number; vvTop: number };
export type Frame = { keyboard: boolean; top: number; height: number };

export function keyboardFrame({ innerHeight, vvHeight, vvTop }: FrameInput): Frame {
  const height = Math.max(0, Math.round(vvHeight));
  const keyboard = innerHeight - vvHeight > KEYBOARD_MIN;
  return { keyboard, top: keyboard ? Math.max(0, Math.round(vvTop)) : 0, height };
}

/**
 * How far to scroll a container so that the field (its rect) is fully inside
 * the container's visible rect, with a margin. 0 = already visible.
 */
export function revealDelta(field: { top: number; bottom: number }, box: { top: number; bottom: number }, margin = 12): number {
  if (field.bottom + margin > box.bottom) {
    const down = field.bottom + margin - box.bottom;
    // Never push the top of the field above the container.
    return Math.min(down, Math.max(0, field.top - box.top - margin));
  }
  if (field.top - margin < box.top) return field.top - margin - box.top;
  return 0;
}
