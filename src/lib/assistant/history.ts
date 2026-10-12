/** «История» of conversations: search and day groups (pure, for the full-screen panel). */

export type HistoryItem = { id: string; title: string; updatedAt: number };
export type HistoryGroup<T extends HistoryItem> = { day: string; items: T[] };

/** Local calendar day «YYYY-MM-DD» of a timestamp (not UTC: a late-evening chat stays on its day). */
export function localDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Newest first, grouped by local day; `query` filters by title (case-insensitive). */
export function groupHistory<T extends HistoryItem>(items: readonly T[], query = ""): HistoryGroup<T>[] {
  const q = query.trim().toLocaleLowerCase("ru");
  const sorted = items.filter((item) => !q || item.title.toLocaleLowerCase("ru").includes(q)).sort((a, b) => b.updatedAt - a.updatedAt);
  const groups: HistoryGroup<T>[] = [];
  for (const item of sorted) {
    const day = localDay(item.updatedAt);
    const last = groups.at(-1);
    if (last && last.day === day) last.items.push(item);
    else groups.push({ day, items: [item] });
  }
  return groups;
}
