/**
 * One sync run (1.15), without browser globals so it can be tested with node --test.
 *
 * - Pull: a conditional GET (If-None-Match: the revision this device already
 *   merged). Nothing new → 304 with no body instead of the whole document.
 * - Push: only the entities this device changed (PATCH /api/sync). The server
 *   merges them into its copy with the same per-field rules as a full upload
 *   and answers with the new revision only. When somebody else wrote in the
 *   meantime (`prevRevision` ≠ our base) the device pulls the document once.
 * - Full upload (PUT, the 1.14 way) is still used for the first sync of a
 *   device, after merges that found local entities the server lacks, after a
 *   backup import, and when the server does not know PATCH (older image).
 */
import { COLLECTIONS, mergeData, type SyncData } from "./merge.ts";

export type SyncMeta = {
  base: number | null;
  revision: number | null;
  dirty: boolean;
  /** Next upload must be the whole document (see the header). */
  full?: boolean;
};

export type RemoteDoc = {
  revision: number;
  updatedAt: number;
  serverNow: number;
  cutoff: number;
  data: unknown;
  user?: string;
  profiles?: boolean;
  owner?: string;
};

export type PatchAnswer = {
  revision: number;
  /** Server revision the change was merged into. Equal to our base = nobody else wrote. */
  prevRevision: number;
  serverNow?: number;
};

export class UserMismatch extends Error {}

export type SyncDeps = {
  readMeta(): SyncMeta;
  writeMeta(patch: Partial<SyncMeta>): void;
  /** Counter of local edits (an edit during a request means: push again). */
  editSeq(): number;
  /** null → no conditional header. Resolves `null` for 304 Not Modified. */
  get(knownRevision: number | null): Promise<RemoteDoc | null>;
  put(base: number, body: string): Promise<{ status: number; doc: RemoteDoc }>;
  /** Resolves `null` when the server has no PATCH (older image). */
  patch(base: number, body: string): Promise<PatchAnswer | null>;
  /** Merge a server copy into the local state; true = local still has more (needs a push). */
  integrate(doc: RemoteDoc, timing: { t0: number; t1: number }): boolean;
  fullBody(): string;
  /** Changed entities only, or null when nothing is journalled (→ full upload). */
  partialBody(): string | null;
  /** 412 user_mismatch on a full upload. */
  onUserMismatch(): void;
  /** Force the next GET to be unconditional (another profile, replaced copy). */
  forceFresh(): boolean;
  now(): number;
};

export type RunResult = { settled: boolean; pulled: boolean; pushed: "none" | "patch" | "put"; notModified: number };

/** Where new entities sit on the device: id → the id right before it (null = first). */
export type AfterHints = Partial<Record<(typeof COLLECTIONS)[number], Record<string, string | null>>>;

/** Body of PATCH /api/sync: a normal sync document with only the changed entities (+ order hints for new ones). */
export type PartialDocument = SyncData & { after?: AfterHints };

export function partialDocument(local: SyncData, changed: { collection: string; id: string; op: "put" | "delete" }[]): PartialDocument | null {
  if (!changed.length) return null;
  const out: PartialDocument = {
    v: 1,
    lists: [],
    tasks: [],
    habits: [],
    milestones: [],
    projects: [],
    assets: [],
    settings: local.settings,
    tombstones: { lists: {}, tasks: {}, habits: {}, milestones: {}, projects: {}, assets: {} },
    after: {},
  };
  const seen = new Set<string>();
  for (const entry of changed) {
    if (entry.collection === "settings") continue;
    const key = entry.collection as (typeof COLLECTIONS)[number];
    if (!COLLECTIONS.includes(key) || seen.has(`${key}:${entry.id}`)) continue;
    seen.add(`${key}:${entry.id}`);
    const rows = local[key];
    const index = rows.findIndex((row) => row.id === entry.id);
    if (index >= 0) {
      out[key].push(rows[index]!);
      (out.after![key] ??= {})[entry.id] = index > 0 ? rows[index - 1]!.id : null;
    }
    const deletedAt = local.tombstones[key]?.[entry.id];
    if (deletedAt !== undefined) out.tombstones[key][entry.id] = deletedAt;
  }
  return out;
}

/**
 * Server side of PATCH: merge the changed entities into the server copy (the
 * server keeps its order) and put entities it did not have where the device
 * has them, so both copies end up identical.
 */
export function applyPatch(current: SyncData, changes: SyncData, after: AfterHints | undefined, cutoff = 0): SyncData {
  const merged = mergeData(current, changes, { cutoff });
  if (!after) return merged;
  for (const key of COLLECTIONS) {
    const hints = after[key];
    if (!hints) continue;
    const known = new Set(current[key].map((row) => row.id));
    let rows = merged[key];
    // Place a new entity only after its neighbour was placed (several new ones in a row).
    const pending = new Set(changes[key].map((item) => item.id).filter((id) => !known.has(id) && id in hints));
    let progress = true;
    while (pending.size && progress) {
      progress = false;
      for (const id of [...pending]) {
        const prev = hints[id] ?? null;
        if (prev !== null && pending.has(prev)) continue;
        pending.delete(id);
        progress = true;
        const from = rows.findIndex((row) => row.id === id);
        if (from < 0) continue;
        const moved = rows[from]!;
        const rest = rows.filter((_, i) => i !== from);
        const at = prev === null ? 0 : rest.findIndex((row) => row.id === prev) + 1;
        if (prev !== null && at === 0) continue;
        rows = [...rest.slice(0, at), moved, ...rest.slice(at)];
      }
    }
    merged[key] = rows;
  }
  return merged;
}

export function readAfterHints(raw: unknown): AfterHints | undefined {
  const after = (raw as { after?: unknown } | null)?.after;
  if (!after || typeof after !== "object") return undefined;
  const out: AfterHints = {};
  for (const key of COLLECTIONS) {
    const map = (after as Record<string, unknown>)[key];
    if (!map || typeof map !== "object") continue;
    const clean: Record<string, string | null> = {};
    for (const [id, prev] of Object.entries(map as Record<string, unknown>)) {
      if (typeof prev === "string" || prev === null) clean[id] = prev;
    }
    out[key] = clean;
  }
  return out;
}

export async function runSyncOnce(deps: SyncDeps, patchSupported = { value: true }): Promise<RunResult> {
  const result: RunResult = { settled: false, pulled: false, pushed: "none", notModified: 0 };
  for (let attempt = 0; attempt < 5 && !result.settled; attempt++) {
    let meta = deps.readMeta();
    if (meta.base === null || !meta.dirty) {
      const known = meta.base !== null && meta.revision !== null && !deps.forceFresh() ? meta.revision : null;
      const t0 = deps.now();
      const doc = await deps.get(known);
      if (doc) {
        result.pulled = true;
        // Local entities the server lacks without a journalled edit: only a full upload carries them.
        if (deps.integrate(doc, { t0, t1: deps.now() })) deps.writeMeta({ full: true });
      } else result.notModified++;
      meta = deps.readMeta();
      if (!meta.dirty) {
        result.settled = true;
        break;
      }
    }
    const base = meta.base ?? 0;
    const seq = deps.editSeq();
    const partial = meta.base !== null && !meta.full && patchSupported.value ? deps.partialBody() : null;
    if (partial !== null) {
      const answer = await deps.patch(base, partial);
      if (answer === null) {
        patchSupported.value = false;
        continue;
      }
      result.pushed = "patch";
      if (answer.prevRevision === base) {
        const clean = deps.editSeq() === seq;
        deps.writeMeta({ base: answer.revision, revision: answer.revision, dirty: !clean });
        result.settled = clean;
      } else {
        // Somebody else wrote too: take the server copy (it already holds our change).
        const t0 = deps.now();
        const doc = await deps.get(null);
        if (doc) {
          result.pulled = true;
          const needsPush = deps.integrate(doc, { t0, t1: deps.now() });
          const edited = deps.editSeq() !== seq;
          result.settled = !needsPush && !edited;
          if (!result.settled) deps.writeMeta(needsPush && !edited ? { dirty: true, full: true } : { dirty: true });
        }
      }
      continue;
    }
    let put: { status: number; doc: RemoteDoc };
    try {
      put = await deps.put(base, deps.fullBody());
    } catch (error) {
      if (error instanceof UserMismatch) {
        deps.onUserMismatch();
        continue;
      }
      throw error;
    }
    result.pushed = "put";
    const t0 = deps.now();
    const needsPush = deps.integrate(put.doc, { t0, t1: deps.now() });
    if (put.status === 409) {
      result.settled = !needsPush;
      continue;
    }
    result.settled = !needsPush && deps.editSeq() === seq;
    if (result.settled) deps.writeMeta({ full: false });
    else deps.writeMeta({ dirty: true });
  }
  return result;
}
