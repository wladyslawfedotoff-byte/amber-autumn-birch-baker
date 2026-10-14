/** Move the item with `id` so it ends at index `to` (clamped). Same array if nothing changes. */
export function placeItem<T extends { id: string }>(items: readonly T[], id: string, to: number): T[] {
  const from = items.findIndex((item) => item.id === id);
  if (from < 0) return [...items];
  const target = Math.max(0, Math.min(items.length - 1, Math.round(to)));
  if (target === from) return [...items];
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(target, 0, moved!);
  return next;
}

/** Index the dragged row should take, from the pointer Y and the row rectangles (top→bottom). */
export function dropIndex(y: number, rects: readonly { top: number; height: number }[]): number {
  for (let i = 0; i < rects.length; i++) {
    const rect = rects[i]!;
    if (y < rect.top + rect.height / 2) return i;
  }
  return Math.max(0, rects.length - 1);
}
