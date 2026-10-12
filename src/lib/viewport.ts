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

export type BottomInput = {
  /** Home Screen web app (display-mode: standalone / navigator.standalone). */
  standalone: boolean;
  innerWidth: number;
  innerHeight: number;
  screenWidth: number;
  screenHeight: number;
  /** env(safe-area-inset-top) in px, as the page sees it. */
  safeTop: number;
  keyboard: boolean;
};

/**
 * Does the page end above the bottom edge of the screen?
 *
 * Some iOS releases lay out a Home Screen web app that has a manifest or a
 * translucent status bar with a page that starts under the status bar (so
 * `safe-area-inset-top` > 0) but is one status-bar-height shorter than the
 * screen: the strip below the page is painted by the system. The page still
 * gets `safe-area-inset-bottom` (~34px for the home indicator), so a bottom
 * bar that pads itself by that inset ends up about two insets above the
 * screen edge with an empty band under it. When this returns true the bottom
 * inset is already outside the page and must not be added again.
 *
 * A correct standalone frame either fills the screen (no gap) or starts below
 * the status bar (gap at the top, `safeTop` = 0); Safari tabs are never
 * affected (their toolbars are real and the inset is right there).
 */
export function frameEndsAboveScreen(input: BottomInput): boolean {
  if (!input.standalone || input.keyboard || input.safeTop <= 0) return false;
  const portrait = input.innerHeight >= input.innerWidth;
  const long = Math.max(input.screenWidth, input.screenHeight);
  const short = Math.min(input.screenWidth, input.screenHeight);
  const screenHeight = portrait ? long : short;
  return screenHeight - input.innerHeight >= SHORT_FRAME_MIN;
}

/** Rounding and sub-pixel toolbars stay below this; the status bar is ~44–62px. */
export const SHORT_FRAME_MIN = 20;
