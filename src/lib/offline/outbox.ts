/**
 * «Ждут отправки»: a persisted journal of what was changed on this device and
 * has not reached the server yet. One entry per changed entity (the newest
 * change wins), with a sequence number so a successful upload removes exactly
 * what it carried — edits made while it was in flight stay queued.
 *
 * The upload itself is the whole merged document (src/lib/server-sync.ts):
 * the per-field stamps in src/lib/sync/merge.ts decide every conflict, so the
 * journal never has to replay operations and cannot lose or reorder them.
 *
 * Pure: node --test loads this file directly.
 */

export const OUTBOX_COLLECTIONS = ["lists", "tasks", "habits", "milestones", "projects", "assets"] as const;
export type OutboxCollection = (typeof OUTBOX_COLLECTIONS)[number] | "settings";

export type OutboxEntry = {
  collection: OutboxCollection;
  id: string;
  op: "put" | "delete";
  at: number;
  seq: number;
};

export type Outbox = {
  v: 1;
  seq: number;
  entries: OutboxEntry[];
  /** Failed upload attempts in a row (for the retry delay). */
  attempts: number;
  /** Earliest next automatic attempt (ms), null = any time. */
  retryAt: number | null;
};

type Entity = { id: string; updatedAt?: number };
export type Snapshot = Partial<Record<(typeof OUTBOX_COLLECTIONS)[number], readonly Entity[] | undefined>> & { settingsUpdatedAt?: number };

export function emptyOutbox(): Outbox {
  return { v: 1, seq: 0, entries: [], attempts: 0, retryAt: null };
}

export function parseOutbox(raw: unknown): Outbox {
  const value = raw as Partial<Outbox> | null;
  if (!value || typeof value !== "object" || !Array.isArray(value.entries)) return emptyOutbox();
  const entries = value.entries.filter(
    (e): e is OutboxEntry => !!e && typeof e.id === "string" && typeof e.seq === "number" && (e.op === "put" || e.op === "delete") && typeof e.collection === "string",
  );
  return {
    v: 1,
    seq: Math.max(Number(value.seq) || 0, ...entries.map((e) => e.seq)),
    entries,
    attempts: Number(value.attempts) || 0,
    retryAt: typeof value.retryAt === "number" ? value.retryAt : null,
  };
}

/** What changed between two states of the planner (by reference, then by stamp). */
export function diffChanges(prev: Snapshot, next: Snapshot): Pick<OutboxEntry, "collection" | "id" | "op">[] {
  const out: Pick<OutboxEntry, "collection" | "id" | "op">[] = [];
  for (const key of OUTBOX_COLLECTIONS) {
    const before = prev[key] ?? [];
    const after = next[key] ?? [];
    if (before === after) continue;
    const old = new Map(before.map((item) => [item.id, item]));
    const seen = new Set<string>();
    for (const item of after) {
      seen.add(item.id);
      const was = old.get(item.id);
      if (was === item) continue;
      if (!was || (was.updatedAt ?? 0) !== (item.updatedAt ?? 0) || JSON.stringify(was) !== JSON.stringify(item)) {
        out.push({ collection: key, id: item.id, op: "put" });
      }
    }
    for (const item of before) if (!seen.has(item.id)) out.push({ collection: key, id: item.id, op: "delete" });
  }
  if ((prev.settingsUpdatedAt ?? 0) !== (next.settingsUpdatedAt ?? 0)) out.push({ collection: "settings", id: "settings", op: "put" });
  return out;
}

/** Add changes; an entity already queued keeps one entry with the newest change. */
export function record(outbox: Outbox, changes: Pick<OutboxEntry, "collection" | "id" | "op">[], at: number): Outbox {
  if (!changes.length) return outbox;
  let seq = outbox.seq;
  const byKey = new Map(outbox.entries.map((e) => [`${e.collection}:${e.id}`, e]));
  for (const change of changes) {
    seq++;
    byKey.set(`${change.collection}:${change.id}`, { ...change, at, seq });
  }
  return { ...outbox, seq, entries: [...byKey.values()].sort((a, b) => a.seq - b.seq) };
}

/** The server has everything up to `seq`: drop those entries, reset the retry delay. */
export function acknowledge(outbox: Outbox, seq: number): Outbox {
  return { ...outbox, entries: outbox.entries.filter((e) => e.seq > seq), attempts: 0, retryAt: null };
}

export const RETRY_BASE_MS = 2_000;
export const RETRY_MAX_MS = 5 * 60_000;

/** Exponential delay with ±20 % jitter: 2 s, 4 s, 8 s … 5 min. */
export function retryDelay(attempts: number, random = Math.random): number {
  const plain = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1));
  return Math.round(plain * (0.8 + 0.4 * random()));
}

export function failed(outbox: Outbox, now: number, random = Math.random): Outbox {
  const attempts = outbox.attempts + 1;
  return { ...outbox, attempts, retryAt: now + retryDelay(attempts, random) };
}

export function pendingCount(outbox: Outbox): number {
  return outbox.entries.length;
}
