/**
 * Device clock corrected by the server's clock (measured on every sync), so
 * per-entity `updatedAt` stamps from a phone whose clock is a few minutes off
 * still order correctly against the computer's edits.
 */
let offsetMs = 0;

export function setClockOffset(ms: number): void {
  if (Number.isFinite(ms)) offsetMs = Math.round(ms);
}

export function getClockOffset(): number {
  return offsetMs;
}

export function syncNow(): number {
  return Date.now() + offsetMs;
}
