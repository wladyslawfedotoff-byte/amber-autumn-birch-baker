import type { Task } from "./planner-types";

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
  /** Task colour id (see task-colors.ts). */
  color?: string | null;
  /** «Вмещает дела» (1.23): tasks fully inside are drawn on top and are not a conflict. */
  host?: boolean;
};

export function taskSpan(task: Task): Span | null {
  const start = toMinutes(task.startAt) ?? toMinutes(task.remindAt);
  if (start == null) return null;
  const explicit = toMinutes(task.endAt);
  const assumed = explicit == null || explicit <= start;
  const end = assumed ? Math.min(start + 60, 24 * 60) : explicit;
  if (end == null || end <= start) return null;
  return { id: task.id, title: task.title, start, end, done: task.done, assumed, color: task.color ?? null, ...(task.host === true && !assumed ? { host: true } : {}) };
}

export type Placed = Span & {
  lane: number;
  lanes: number;
  clash: boolean;
  /** Set on a task drawn inside a «Вмещает дела» block: the host and its column. */
  inside?: { id: string; title: string; lane: number; lanes: number };
};

/**
 * Which host each task sits in: the task must lie fully inside the host's
 * range (a task that sticks out stays an ordinary block and a conflict).
 * Hosts never nest in each other; with two hosts the shorter one wins.
 */
export function hostOf(spans: readonly Span[]): Map<string, Span> {
  const hosts = spans.filter((span) => span.host).sort((a, b) => a.end - a.start - (b.end - b.start));
  const out = new Map<string, Span>();
  if (hosts.length === 0) return out;
  for (const span of spans) {
    if (span.host) continue;
    const host = hosts.find((h) => h.start <= span.start && span.end <= h.end);
    if (host) out.set(span.id, host);
  }
  return out;
}

function lanes(spans: readonly Span[]): Map<string, { lane: number; lanes: number; overlaps: number }> {
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
  const out = new Map<string, { lane: number; lanes: number; overlaps: number }>();
  for (const span of spans) {
    const overlapping = spans.filter((other) => other.start < span.end && span.start < other.end);
    const used = new Set(overlapping.map((other) => laneOf.get(other.id) ?? 0));
    out.set(span.id, { lane: laneOf.get(span.id) ?? 0, lanes: Math.max(used.size, 1), overlaps: overlapping.length - 1 });
  }
  return out;
}

/**
 * Lanes and conflicts of one day. Tasks inside a host get their own lanes
 * inside the host's column and clash only with each other (or with another
 * top-level block that crosses them); the host itself clashes only with
 * top-level blocks.
 */
export function placeSpans(spans: Span[]): Placed[] {
  const parent = hostOf(spans);
  const top = spans.filter((span) => !parent.has(span.id));
  const topLanes = lanes(top);
  const groups = new Map<string, Span[]>();
  for (const span of spans) {
    const host = parent.get(span.id);
    if (host) groups.set(host.id, [...(groups.get(host.id) ?? []), span]);
  }
  const innerLanes = new Map<string, { lane: number; lanes: number; overlaps: number }>();
  for (const group of groups.values()) for (const [id, value] of lanes(group)) innerLanes.set(id, value);
  return spans.map((span) => {
    const host = parent.get(span.id);
    if (!host) {
      const at = topLanes.get(span.id)!;
      return { ...span, lane: at.lane, lanes: at.lanes, clash: at.overlaps > 0 };
    }
    const at = innerLanes.get(span.id)!;
    const hostAt = topLanes.get(host.id)!;
    const crossed = top.some((other) => other.id !== host.id && other.start < span.end && span.start < other.end);
    return {
      ...span,
      lane: at.lane,
      lanes: at.lanes,
      clash: at.overlaps > 0 || crossed,
      inside: { id: host.id, title: host.title, lane: hostAt.lane, lanes: hostAt.lanes },
    };
  });
}

/** Tasks that move together with a host when it is dragged (fully inside it, not done). */
export function riders(spans: readonly Span[], hostId: string): Span[] {
  const parent = hostOf(spans);
  return spans.filter((span) => parent.get(span.id)?.id === hostId && !span.done && !span.assumed);
}

export function freeWindows(
  workStart: number,
  workEnd: number,
  spans: Span[],
): { start: number; end: number }[] {
  if (workEnd - workStart < 15) return [];
  // A «Вмещает дела» block is room for work, not busy time: its free parts are offered too.
  const clipped = spans
    .filter((span) => !span.done && !span.host)
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

/** Tap on an empty part of the board: the half-hour slot under the finger, one hour long, kept inside the board. */
export function slotAt(fraction: number, from: number, to: number, length = 60): { start: number; end: number } {
  const raw = from + Math.max(0, Math.min(1, fraction)) * (to - from);
  let start = Math.floor(raw / 30) * 30;
  start = Math.max(from, Math.min(start, to - 30));
  return { start, end: Math.min(to, start + length) };
}

/** Where the board opens: an hour before «now» today, otherwise just before the first block or the start of work. */
export function focusMinute({ isToday, now, spans, workStart }: { isToday: boolean; now: number; spans: Span[]; workStart: number }): number {
  if (isToday) return Math.max(0, now - 60);
  const first = spans.reduce((min, span) => Math.min(min, span.start), Number.POSITIVE_INFINITY);
  return Math.max(0, (Number.isFinite(first) ? first : workStart) - 30);
}
