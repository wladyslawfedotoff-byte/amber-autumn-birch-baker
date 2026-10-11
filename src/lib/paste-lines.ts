/**
 * Multi-line paste into the quick composer: every non-empty line becomes a
 * task. List markers from notes apps («- », «• », «1. », «[ ] ») are dropped.
 * Capped so an accidental paste of a whole document does not flood the list.
 */
export const PASTE_LIMIT = 30;

export function pastedLines(text: string, limit = PASTE_LIMIT): string[] {
  return text
    .split(/\r?\n/)
    .map((line) =>
      line
        .trim()
        .replace(/^(?:[-*•–—]\s*)?(?:\[[ xX]?\]\s*)?(?:\d{1,3}[.)]\s+)?/, "")
        .trim(),
    )
    .filter(Boolean)
    .slice(0, limit);
}
