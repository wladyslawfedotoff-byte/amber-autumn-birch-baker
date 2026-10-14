/**
 * Offline upload queue for attachments. Blobs live in IndexedDB (or memory
 * in tests); the queue state is a small JSON journal like the sync outbox.
 *
 * Pure logic + injected storage so node --test can run it.
 */
export type ParentKind = "task" | "project";

export type QueuedUpload = {
  id: string;
  parentKind: ParentKind;
  parentId: string;
  name: string;
  mime: string;
  size: number;
  createdAt: number;
  takenAt?: number;
  attempts: number;
  retryAt: number | null;
  /** Last server error code (for UI). */
  lastError?: string | null;
};

export type UploadQueue = { v: 1; items: QueuedUpload[] };

export function emptyQueue(): UploadQueue {
  return { v: 1, items: [] };
}

export function parseQueue(raw: unknown): UploadQueue {
  const value = raw as Partial<UploadQueue> | null;
  if (!value || typeof value !== "object" || !Array.isArray(value.items)) return emptyQueue();
  const items = value.items.filter(
    (item): item is QueuedUpload =>
      !!item &&
      typeof item.id === "string" &&
      (item.parentKind === "task" || item.parentKind === "project") &&
      typeof item.parentId === "string" &&
      typeof item.name === "string" &&
      typeof item.mime === "string" &&
      typeof item.size === "number",
  );
  return {
    v: 1,
    items: items.map((item) => ({
      ...item,
      createdAt: typeof item.createdAt === "number" ? item.createdAt : 0,
      attempts: typeof item.attempts === "number" ? item.attempts : 0,
      retryAt: typeof item.retryAt === "number" ? item.retryAt : null,
    })),
  };
}

export function enqueue(queue: UploadQueue, item: Omit<QueuedUpload, "attempts" | "retryAt">): UploadQueue {
  if (queue.items.some((existing) => existing.id === item.id)) return queue;
  return { ...queue, items: [...queue.items, { ...item, attempts: 0, retryAt: null }] };
}

export function remove(queue: UploadQueue, id: string): UploadQueue {
  return { ...queue, items: queue.items.filter((item) => item.id !== id) };
}

export const RETRY_BASE_MS = 3_000;
export const RETRY_MAX_MS = 10 * 60_000;

export function retryDelay(attempts: number, random = Math.random): number {
  const plain = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1));
  return Math.round(plain * (0.8 + 0.4 * random()));
}

export function markFailed(queue: UploadQueue, id: string, now: number, error: string, random = Math.random): UploadQueue {
  return {
    ...queue,
    items: queue.items.map((item) =>
      item.id === id
        ? { ...item, attempts: item.attempts + 1, retryAt: now + retryDelay(item.attempts + 1, random), lastError: error }
        : item,
    ),
  };
}

/** Next item ready to upload (oldest first), or null. */
export function nextReady(queue: UploadQueue, now: number): QueuedUpload | null {
  const ready = queue.items.filter((item) => item.retryAt == null || item.retryAt <= now);
  ready.sort((a, b) => a.createdAt - b.createdAt);
  return ready[0] ?? null;
}

export function pendingUploads(queue: UploadQueue): number {
  return queue.items.length;
}

export function pendingFor(queue: UploadQueue, parentKind: ParentKind, parentId: string): QueuedUpload[] {
  return queue.items.filter((item) => item.parentKind === parentKind && item.parentId === parentId);
}

/** Errors that will not fix themselves: drop the item (and its blob) instead of retrying. */
export const FATAL_ERRORS = new Set(["bad_type", "too_large", "forbidden", "bad_parent", "missing_file", "unsupported_media", "id_taken"]);

export function isFatal(error: string): boolean {
  return FATAL_ERRORS.has(error);
}
