import type { Task } from "@/lib/planner-types";

export const BOARD_FROM = 7 * 60;
export const BOARD_TO = 22 * 60;

export function toMinutes(value: string | null | undefined): number | null {
  if (!value || !/^\d{2}:\d{2}$/.test(value)) return null;
  const [h, m] = value.split(":").map(Number);
  if (h == null || m == null || h > 23 || m > 59) return null;
  return h * 60 + m;
}

export function fromMinutes(total: number): string {
  const clamped = Math.max(0, Math.min(24 * 60, total));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export type Span = {
  id: string;
  title: string;
  start: number;
  end: number;
  done: boolean;
  /** Drawn from the reminder, not a real range. */
  assumed: boolean;
};

export function taskSpan(task: Task): Span | null {
  const start = toMinutes(task.startAt) ?? toMinutes(task.remindAt);
  if (start == null) return null;
  const explicit = toMinutes(task.endAt);
  const assumed = explicit == null || explicit <= start;
  const end = assumed ? Math.min(start + 60, 24 * 60) : explicit;
  if (end == null || end <= start) return null;
  return { id: task.id, title: task.title, start, end, done: task.done, assumed };
}

export type Placed = Span & { lane: number; lanes: number; clash: boolean };

export function placeSpans(spans: Span[]): Placed[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start || a.end - b.end);
  const laneEnds: number[] = [];
  const laneOf = new Map<string, number>();
  for (const span of sorted) {
    let lane = laneEnds.findIndex((end) => end <= span.start);
    if (lane < 0) {
      lane = laneEnds.length;
      laneEnds.push(span.end);
    } else {
      laneEnds[lane] = span.end;
    }
    laneOf.set(span.id, lane);
  }
  return spans.map((span) => {
    const overlapping = spans.filter((other) => other.start < span.end && span.start < other.end);
    const used = new Set(overlapping.map((other) => laneOf.get(other.id) ?? 0));
    return {
      ...span,
      lane: laneOf.get(span.id) ?? 0,
      lanes: Math.max(used.size, 1),
      clash: overlapping.length > 1,
    };
  });
}

export function freeWindows(
  workStart: number,
  workEnd: number,
  spans: Span[],
): { start: number; end: number }[] {
  if (workEnd - workStart < 15) return [];
  const clipped = spans
    .filter((span) => !span.done)
    .map((span) => ({
      start: Math.max(span.start, workStart),
      end: Math.min(span.end, workEnd),
    }))
    .filter((span) => span.end > span.start)
    .sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [];
  for (const span of clipped) {
    const last = merged[merged.length - 1];
    if (!last || span.start > last.end) merged.push({ ...span });
    else last.end = Math.max(last.end, span.end);
  }
  const gaps: { start: number; end: number }[] = [];
  let cursor = workStart;
  for (const block of merged) {
    if (block.start - cursor >= 15) gaps.push({ start: cursor, end: block.start });
    cursor = Math.max(cursor, block.end);
  }
  if (workEnd - cursor >= 15) gaps.push({ start: cursor, end: workEnd });
  return gaps;
}

export function boardBounds(spans: Span[], workStart: number, workEnd: number): { from: number; to: number } {
  const points = [BOARD_FROM, BOARD_TO, workStart, workEnd, ...spans.flatMap((span) => [span.start, span.end])];
  const from = Math.floor(Math.min(...points) / 60) * 60;
  const to = Math.ceil(Math.max(...points) / 60) * 60;
  return { from: Math.max(0, from), to: Math.min(24 * 60, Math.max(to, from + 60)) };
}
