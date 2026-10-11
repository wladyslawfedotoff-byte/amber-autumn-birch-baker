/** Pure helpers for the compact calendar (week numbers, dots, the hour grid). */

function parts(iso: string): [number, number, number] {
  const [y, m, d] = iso.split("-").map(Number);
  return [y ?? 1970, m ?? 1, d ?? 1];
}

function isoOf(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** ISO-8601 week number (weeks start on Monday, week 1 holds the first Thursday). */
export function isoWeek(iso: string): number {
  const [y, m, d] = parts(iso);
  const date = new Date(Date.UTC(y, m - 1, d));
  const weekday = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - weekday);
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  return Math.ceil(((date.getTime() - yearStart) / 86_400_000 + 1) / 7);
}

/** Monday of the week that holds `iso`. */
export function mondayOf(iso: string): string {
  const [y, m, d] = parts(iso);
  const date = new Date(Date.UTC(y, m - 1, d));
  const weekday = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - (weekday - 1));
  return isoOf(date);
}

/** Where a «Неделя / 3 дня / День» range starts for the chosen day. */
export function rangeStart(mode: "week" | "three" | "day", iso: string): string {
  return mode === "week" ? mondayOf(iso) : iso;
}

/** Up to `max` dots for a month cell: task colours first, then a neutral dot. Never counts. */
export function dotsFor(colors: (string | null | undefined)[], max = 3): string[] {
  const out: string[] = [];
  for (const color of colors) {
    if (out.length >= max) break;
    out.push(color || "");
  }
  return out;
}

export function minutesOf(time: string | null | undefined): number | null {
  if (!time) return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

export type TimedInput = { id: string; startAt?: string | null; endAt?: string | null; remindAt?: string | null };
export type Placed = { id: string; start: number; end: number; lane: number; lanes: number };

/** Default length of a task that has only a start time. */
export const DEFAULT_MINUTES = 30;

/**
 * Hour-grid layout of one day: tasks with a time get a block (start/end in
 * minutes, side-by-side lanes when they overlap); the rest are «весь день».
 */
export function layoutDay(tasks: TimedInput[]): { timed: Placed[]; allDay: string[] } {
  const allDay: string[] = [];
  const items: { id: string; start: number; end: number }[] = [];
  for (const task of tasks) {
    const start = minutesOf(task.startAt) ?? minutesOf(task.remindAt);
    if (start == null) {
      allDay.push(task.id);
      continue;
    }
    const endRaw = task.startAt ? minutesOf(task.endAt) : null;
    const end = endRaw != null && endRaw > start ? endRaw : Math.min(24 * 60, start + DEFAULT_MINUTES);
    items.push({ id: task.id, start, end: Math.max(end, start + 15) });
  }
  items.sort((a, b) => a.start - b.start || b.end - a.end);
  const timed: Placed[] = [];
  // Clusters of overlapping blocks share the same lane count.
  let cluster: Placed[] = [];
  let clusterEnd = -1;
  const flush = () => {
    const lanes = cluster.reduce((max, item) => Math.max(max, item.lane + 1), 1);
    for (const item of cluster) timed.push({ ...item, lanes });
    cluster = [];
  };
  for (const item of items) {
    if (cluster.length > 0 && item.start >= clusterEnd) flush();
    const busy = new Set(cluster.filter((other) => other.end > item.start).map((other) => other.lane));
    let lane = 0;
    while (busy.has(lane)) lane += 1;
    cluster.push({ ...item, lane, lanes: 1 });
    clusterEnd = Math.max(clusterEnd, item.end);
  }
  if (cluster.length > 0) flush();
  return { timed, allDay };
}

/** «09:30» or «09:30–10:00» for a compact agenda row; empty = весь день. */
export function timeRange(task: TimedInput): string {
  if (task.startAt) return task.endAt ? `${task.startAt}–${task.endAt}` : task.startAt;
  return task.remindAt ?? "";
}

/** Sort key: timed tasks first by time, all-day after. */
export function timeKey(task: TimedInput): string {
  return task.startAt ?? task.remindAt ?? "99:99";
}
