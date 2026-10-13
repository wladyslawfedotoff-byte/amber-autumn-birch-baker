/**
 * Browser ↔ own server sync («Подключение»).
 *
 * The server (Nitro routes /api/sync) keeps one document with a revision.
 * This client:
 * - pushes ~700 ms after a local change, pulls on start / focus / visibility /
 *   reconnect and every 15 s while visible, and flushes with `keepalive` on
 *   pagehide / when the tab is hidden;
 * - runs single-flight (and with a Web Lock across tabs when available);
 * - persists `dirty` + base revision in localStorage, so unsent edits survive a
 *   reload and a pull never overwrites them: remote data is always MERGED into
 *   the current local state per entity (see src/lib/sync/merge.ts), never
 *   imported wholesale;
 * - PUTs with If-Match: <base revision>; on 409 it merges the server copy and
 *   retries;
 * - on 401 sends the user to /login — local data stays on the device;
 * - offline (1.8): the planner lives per user in IndexedDB
 *   (src/lib/offline/device-store.ts); every local change is also written to
 *   a persisted journal «ждут отправки» (src/lib/offline/outbox.ts) that a
 *   successful upload empties; failed uploads are retried with a growing
 *   delay (2 s … 5 min) and at once when the network comes back;
 * - several profiles: the device remembers whose data it holds (`meta.login`).
 *   If somebody else signs in on it, the local copy is replaced by that
 *   person's server copy (never uploaded into their account): GET compares
 *   the `user` of the answer, PUT sends X-Pora-User and the server answers
 *   412 user_mismatch. «Выйти» clears the local copy after uploading it.
 */
import { usePlanner } from "@/lib/planner-store";
import { DEFAULT_ARCHIVE_DAYS, normalizeArchiveDays } from "@/lib/task-done";
import type { Habit, Milestone, Project, Task, TaskList } from "@/lib/planner-types";
import { setClockOffset, syncNow } from "@/lib/sync/clock";
import { activeScope, dropScope, onOtherTabSaved, readJson as readLocal, setScope, wipeActiveScope, writeJson } from "@/lib/offline/device-store";
import { acknowledge, diffChanges, emptyOutbox, failed, parseOutbox, pendingCount, record, type Outbox } from "@/lib/offline/outbox";
import { forgetCachedShell } from "@/lib/offline/sw-client";
import { forgetPushOnLogout } from "@/lib/offline/push-client";
import {
  COLLECTIONS,
  adoptOtherTab,
  dropStaleItems,
  mergeData,
  normalizeData,
  pruneTombstones,
  restampEntity,
  sameData,
  type SyncData,
  type SyncEntity,
} from "@/lib/sync/merge";

const META_KEY = "pora-server-sync";
const STORE_KEY = "srok-planner";
const LEGACY_NOTE_KEY = "pora-legacy-note";
const PUSH_DELAY_MS = 700;
const POLL_MS = 15_000;
const KEEPALIVE_LIMIT = 60_000;
const OUTBOX_KEY = "outbox";
/** A request on a weak mobile signal can hang for minutes; give up and retry later. */
const GET_TIMEOUT_MS = 20_000;
/** Uploads get longer: a big document over a slow line is still progress. */
const PUT_TIMEOUT_MS = 90_000;
const SYNCED_FLASH_MS = 2_500;

type Meta = {
  base: number | null;
  revision: number | null;
  dirty: boolean;
  lastSyncAt: number | null;
  lastError: string | null;
  clockOffset: number;
  /** Server time of the last sync after which this device had nothing left to push. */
  syncedThrough: number | null;
  /** Whose data this device holds (several profiles only). */
  login: string | null;
};

export type SyncPhase = "idle" | "syncing" | "offline" | "error" | "unauthorized" | "unavailable";

export type ServerSyncStatus = {
  phase: SyncPhase;
  lastSyncAt: number | null;
  revision: number | null;
  dirty: boolean;
  lastError: string | null;
  legacyNote: string | null;
  /** Changes on this device that have not reached the server yet. */
  pending: number;
  /** «Синхронизировано» for a moment after the pending changes went out. */
  justSynced: boolean;
  /** Next automatic attempt after a failure (ms), null = none planned. */
  retryAt: number | null;
  /** No connection to the server (stays on while a retry is running). */
  offline: boolean;
};

type RemoteDoc = {
  revision: number;
  updatedAt: number;
  serverNow: number;
  cutoff: number;
  data: unknown;
  user?: string;
  profiles?: boolean;
  /** Profile that owns data created before profiles were enabled. */
  owner?: string;
};

const DEFAULT_META: Meta = {
  base: null,
  revision: null,
  dirty: false,
  lastSyncAt: null,
  lastError: null,
  clockOffset: 0,
  syncedThrough: null,
  login: null,
};

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function readMeta(): Meta {
  const raw = storage()?.getItem(META_KEY);
  if (!raw) return { ...DEFAULT_META };
  try {
    return { ...DEFAULT_META, ...(JSON.parse(raw) as Partial<Meta>) };
  } catch {
    return { ...DEFAULT_META };
  }
}

function writeMeta(patch: Partial<Meta>): Meta {
  const next = { ...readMeta(), ...patch };
  storage()?.setItem(META_KEY, JSON.stringify(next));
  emit();
  return next;
}

// ---- status for the UI -------------------------------------------------------

type Listener = () => void;
const listeners = new Set<Listener>();
let phase: SyncPhase = "idle";
let status: ServerSyncStatus = {
  phase: "idle",
  lastSyncAt: null,
  revision: null,
  dirty: false,
  lastError: null,
  legacyNote: null,
  pending: 0,
  justSynced: false,
  retryAt: null,
  offline: false,
};

let offline = false;

let outbox: Outbox = emptyOutbox();
let justSynced = false;
let flashTimer = 0;

function emit(): void {
  const meta = readMeta();
  status = {
    phase,
    lastSyncAt: meta.lastSyncAt,
    revision: meta.revision,
    dirty: meta.dirty,
    lastError: meta.lastError,
    legacyNote: storage()?.getItem(LEGACY_NOTE_KEY) ?? null,
    pending: Math.max(pendingCount(outbox), meta.dirty ? 1 : 0),
    justSynced,
    retryAt: outbox.retryAt,
    offline,
  };
  listeners.forEach((listener) => listener());
}

function setPhase(next: SyncPhase): void {
  if (next === "offline") offline = true;
  else if (next !== "syncing") offline = false;
  if (phase === next) return;
  phase = next;
  emit();
}

export function getServerSyncStatus(): ServerSyncStatus {
  return status;
}

export function subscribeServerSync(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function setOutbox(next: Outbox): void {
  if (next === outbox) return;
  outbox = next;
  void writeJson(OUTBOX_KEY, outbox);
  emit();
}

/** Everything up to `seq` reached the server. */
function delivered(seq: number): void {
  const had = pendingCount(outbox) > 0;
  setOutbox(acknowledge(outbox, seq));
  if (had && pendingCount(outbox) === 0 && typeof window !== "undefined") {
    justSynced = true;
    emit();
    window.clearTimeout(flashTimer);
    flashTimer = window.setTimeout(() => {
      justSynced = false;
      emit();
    }, SYNCED_FLASH_MS);
  }
}

export function dismissLegacyNote(): void {
  storage()?.removeItem(LEGACY_NOTE_KEY);
  emit();
}

// ---- local document ----------------------------------------------------------

let applying = 0;
let editSeq = 0;
let pristine = false;
/** Set after a 412 user_mismatch: the next server copy replaces the local one. */
let forceReplace = false;

export function localData(): SyncData {
  const s = usePlanner.getState();
  return {
    v: 1,
    lists: s.lists as unknown as SyncEntity[],
    tasks: s.tasks as unknown as SyncEntity[],
    habits: s.habits as unknown as SyncEntity[],
    milestones: s.milestones as unknown as SyncEntity[],
    projects: s.projects as unknown as SyncEntity[],
    settings: { workStart: s.workStart, workEnd: s.workEnd, ...(s.archiveDays !== DEFAULT_ARCHIVE_DAYS ? { archiveDays: s.archiveDays } : {}), updatedAt: s.settingsUpdatedAt ?? 0 },
    tombstones: s.tombstones,
  };
}

function fillTask(task: SyncEntity): SyncEntity {
  if (Array.isArray(task.tags) && Array.isArray(task.subtasks)) return task;
  return { ...task, tags: Array.isArray(task.tags) ? task.tags : [], subtasks: Array.isArray(task.subtasks) ? task.subtasks : [] };
}

function fillProject(project: SyncEntity): SyncEntity {
  return Array.isArray(project.stages) ? project : { ...project, stages: [] };
}

function fillMilestone(item: SyncEntity): SyncEntity {
  return Array.isArray(item.items) ? item : { ...item, items: [] };
}

function fillHabit(habit: SyncEntity): SyncEntity {
  return Array.isArray(habit.checks) ? habit : { ...habit, checks: [] };
}

function applyData(data: SyncData): void {
  applying++;
  try {
    usePlanner.setState({
      lists: data.lists as unknown as TaskList[],
      tasks: data.tasks.map(fillTask) as unknown as Task[],
      habits: data.habits.map(fillHabit) as unknown as Habit[],
      milestones: data.milestones.map(fillMilestone) as unknown as Milestone[],
      projects: data.projects.map(fillProject) as unknown as Project[],
      workStart: data.settings.workStart,
      workEnd: data.settings.workEnd,
      settingsUpdatedAt: data.settings.updatedAt,
      archiveDays: normalizeArchiveDays(data.settings.archiveDays),
      tombstones: data.tombstones,
    });
  } finally {
    applying--;
  }
}

/**
 * Merge a server document into the CURRENT local state. Returns true when the
 * local side has something the server does not (→ needs a push).
 */
function integrate(remote: RemoteDoc, timing?: { t0: number; t1: number }): boolean {
  const offset =
    timing && Number.isFinite(remote.serverNow) ? remote.serverNow - (timing.t0 + timing.t1) / 2 : readMeta().clockOffset;
  setClockOffset(offset);
  const normalized = normalizeData(remote.data);
  if (!normalized.ok) throw new SyncError("error", `Сервер прислал неверные данные: ${normalized.error}`);
  const remoteData = normalized.data;
  const cutoff = Number(remote.cutoff) || 0;
  let meta = readMeta();
  const remoteUser = remote.profiles && typeof remote.user === "string" ? remote.user : null;
  let switched = false;
  // Somebody else signed in on this device: their data only. A device that
  // synced before profiles were enabled (no meta.login yet) holds the data
  // owner's copy, so another profile must not merge it into their own.
  const legacyCopyOfOwner = !meta.login && meta.revision !== null && typeof remote.owner === "string";
  if (remoteUser && (meta.login ? meta.login !== remoteUser : legacyCopyOfOwner && remote.owner !== remoteUser)) {
    switched = true;
    meta = writeMeta({ ...DEFAULT_META, clockOffset: meta.clockOffset });
  }
  // The local copy is kept per user: from now on this device writes into the
  // signed-in user's partition. The previous user's copy (with any unsent
  // edits) stays in theirs and is merged when they sign in here again.
  if (remoteUser) {
    const before = activeScope();
    if (setScope(remoteUser)) {
      if (before === "_" && !switched) {
        // A copy from before 1.8 (no user known yet) that belongs to this
        // user: move it into their partition.
        applying++;
        try {
          usePlanner.setState({});
        } finally {
          applying--;
        }
        void writeJson(OUTBOX_KEY, outbox);
        void dropScope(before);
      } else {
        switched = true;
        outbox = emptyOutbox();
        void writeJson(OUTBOX_KEY, outbox);
      }
    }
  }
  if (forceReplace) {
    switched = true;
    forceReplace = false;
  }
  let merged: SyncData;
  if (switched || (pristine && editSeq === 0 && remote.revision > 0)) {
    // First start on a fresh device: there is nothing local except the demo
    // seed, so take the server copy instead of mixing demo tasks into it.
    merged = remoteData;
  } else {
    let local = localData();
    // Back after a long time offline: drop what was deleted elsewhere while
    // the server's tombstones for it have already expired. Skipped when the
    // server document went backwards (reset data folder) — then nothing local
    // is dropped and everything is uploaded again.
    const serverIntact = remote.revision > 0 && (meta.revision === null || remote.revision >= meta.revision);
    if (serverIntact) local = dropStaleItems(local, remoteData, cutoff, meta.syncedThrough);
    merged = mergeData(local, remoteData, { cutoff });
  }
  pristine = false;
  if (!sameData(merged, localData())) applyData(merged);
  const needsPush = !sameData(pruneTombstones(merged, cutoff), pruneTombstones(remoteData, cutoff));
  const synced = !needsPush && Number.isFinite(remote.serverNow) ? { syncedThrough: remote.serverNow } : {};
  writeMeta({
    base: remote.revision,
    revision: remote.revision,
    dirty: needsPush,
    clockOffset: offset,
    login: remoteUser,
    ...synced,
  });
  return needsPush;
}

// ---- network -----------------------------------------------------------------

class SyncError extends Error {
  constructor(
    readonly kind: SyncPhase,
    message: string,
    readonly status = 0,
  ) {
    super(message);
  }
}

async function readJson(response: Response): Promise<Record<string, unknown> | null> {
  const type = response.headers.get("content-type") ?? "";
  if (!type.includes("application/json")) return null;
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function failure(response: Response, body: Record<string, unknown> | null): SyncError {
  if (response.status === 401) return new SyncError("unauthorized", "Нужно войти заново.", 401);
  if (response.status === 412 && body?.error === "user_mismatch") {
    return new SyncError("error", "На этом устройстве вошёл другой профиль.", 412);
  }
  if (response.status === 503 && body?.error === "auth_not_configured") {
    return new SyncError("error", "На сервере не задан пароль (APP_PASSWORD).", 503);
  }
  if (response.status === 413) return new SyncError("error", "Данных больше 5 МБ — сервер их не принял.", 413);
  if (response.status === 403) return new SyncError("error", "Сервер отклонил запрос (чужой адрес). Откройте приложение по его основному адресу.", 403);
  if (!body) {
    return new SyncError("unavailable", `Сервер синхронизации не найден (ответ ${response.status}).`, response.status);
  }
  const message = typeof body.message === "string" ? body.message : `Ошибка сервера ${response.status}.`;
  return new SyncError("error", message, response.status);
}

async function call(method: "GET" | "PUT", base?: number, body?: string, keepalive = false): Promise<{ status: number; doc: RemoteDoc }> {
  let response: Response;
  try {
    response = await fetch("/api/sync", {
      method,
      cache: "no-store",
      credentials: "same-origin",
      keepalive,
      ...(keepalive || typeof AbortSignal === "undefined" || !("timeout" in AbortSignal) ? {} : { signal: AbortSignal.timeout(method === "PUT" ? PUT_TIMEOUT_MS : GET_TIMEOUT_MS) }),
      headers: {
        Accept: "application/json",
        ...(method === "PUT" ? { "Content-Type": "application/json", "If-Match": `"${base ?? 0}"` } : {}),
        ...(method === "PUT" && readMeta().login ? { "X-Pora-User": readMeta().login! } : {}),
      },
      body,
    });
  } catch {
    throw new SyncError("offline", "Нет связи с сервером.");
  }
  const json = await readJson(response);
  if ((response.ok || response.status === 409) && json && typeof json.revision === "number") {
    return { status: response.status, doc: json as unknown as RemoteDoc };
  }
  throw failure(response, json);
}

// ---- run loop ----------------------------------------------------------------

let redirecting = false;

async function runOnce(): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    setPhase("offline");
    return;
  }
  setPhase("syncing");
  const carried = outbox.seq;
  try {
    let settled = false;
    for (let attempt = 0; attempt < 5 && !settled; attempt++) {
      let meta = readMeta();
      if (meta.base === null || !meta.dirty) {
        const t0 = Date.now();
        const { doc } = await call("GET");
        integrate(doc, { t0, t1: Date.now() });
        meta = readMeta();
        if (!meta.dirty) {
          settled = true;
          break;
        }
      }
      const seq = editSeq;
      const t0 = Date.now();
      let put: Awaited<ReturnType<typeof call>>;
      try {
        put = await call("PUT", meta.base ?? 0, JSON.stringify(localData()));
      } catch (error) {
        if (error instanceof SyncError && error.status === 412) {
          // Another profile signed in on this device: never upload the old local copy into it.
          writeMeta({ ...DEFAULT_META, clockOffset: readMeta().clockOffset });
          forceReplace = true;
          continue;
        }
        throw error;
      }
      const { status: code, doc } = put;
      const needsPush = integrate(doc, { t0, t1: Date.now() });
      if (code === 409) {
        settled = !needsPush;
        continue;
      }
      settled = !needsPush && editSeq === seq;
      if (!settled) writeMeta({ dirty: true });
    }
    writeMeta({ lastSyncAt: Date.now(), lastError: null });
    // The server now holds everything that was journalled before this run.
    if (!readMeta().dirty) delivered(outbox.seq);
    else if (settled) delivered(carried);
    else setOutbox({ ...outbox, attempts: 0, retryAt: null });
    setPhase("idle");
    if (!settled) schedulePush();
  } catch (error) {
    const err = error instanceof SyncError ? error : new SyncError("error", error instanceof Error ? error.message : "Не удалось синхронизировать.");
    writeMeta({ lastError: err.message });
    if (err.kind !== "unauthorized") {
      // Try again later with a growing delay (and at once when the network is back).
      setOutbox(failed(outbox, Date.now()));
      if (readMeta().dirty || pendingCount(outbox) > 0) schedulePush(Math.max(0, (outbox.retryAt ?? Date.now()) - Date.now()));
    }
    setPhase(err.kind);
    if (err.kind === "unauthorized" && !redirecting && typeof window !== "undefined") {
      redirecting = true;
      // Local data and the dirty flag are already in localStorage; after login
      // the next sync merges and uploads them.
      window.location.assign("/login?e=expired");
    }
  }
}

function withLock(task: () => Promise<void>): Promise<void> {
  const locks = typeof navigator !== "undefined" ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
  if (locks?.request) return locks.request("pora-sync", () => task()).then(() => undefined);
  return task();
}

let running: Promise<void> | null = null;
let again = false;

/** Single-flight sync: concurrent callers share one run (plus one follow-up). */
export function syncServerNow(): Promise<void> {
  if (redirecting) return Promise.resolve();
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    do {
      again = false;
      await withLock(runOnce);
    } while (again && !redirecting);
  })().finally(() => {
    running = null;
  });
  return running;
}

let pushTimer = 0;

function schedulePush(delay = PUSH_DELAY_MS): void {
  if (typeof window === "undefined") return;
  window.clearTimeout(pushTimer);
  pushTimer = window.setTimeout(() => {
    void syncServerNow();
  }, delay);
}

/** Best-effort upload while the page is being hidden or closed. */
function flushOnHide(): void {
  const meta = readMeta();
  if (!meta.dirty || meta.base === null || redirecting) return;
  window.clearTimeout(pushTimer);
  const body = JSON.stringify(localData());
  const t0 = Date.now();
  const carried = outbox.seq;
  void call("PUT", meta.base, body, body.length < KEEPALIVE_LIMIT)
    .then(({ doc }) => {
      if (running) return;
      integrate(doc, { t0, t1: Date.now() });
      if (!readMeta().dirty) {
        writeMeta({ lastSyncAt: Date.now(), lastError: null });
        delivered(carried);
      }
    })
    .catch(() => undefined);
}

// ---- legacy WebDAV / folder sync --------------------------------------------

/**
 * The old browser→WebDAV sync (and the «Файл» folder autosync) imported the
 * remote file wholesale and lost edits. It is switched off; its stored WebDAV
 * password is removed from this device.
 */
function retireLegacySync(): void {
  const store = storage();
  if (!store) return;
  const parts: string[] = [];
  if (store.getItem("pora-cloud") !== null) {
    store.removeItem("pora-cloud");
    store.removeItem("pora-cloud-stamp");
    parts.push("Старая синхронизация через WebDAV отключена, её пароль удалён с этого устройства.");
  }
  if (store.getItem("pora-sync-stamp") !== null) {
    store.removeItem("pora-sync-stamp");
    try {
      indexedDB.deleteDatabase("pora-sync");
    } catch {
      // ignore
    }
    parts.push("Автосохранение в папку отключено.");
  }
  if (parts.length) {
    store.setItem(LEGACY_NOTE_KEY, `${parts.join(" ")} Теперь задачи синхронизируются через ваш сервер.`);
  }
}

// ---- backup import -----------------------------------------------------------

/**
 * Add entries from a backup file that this device does not have (and has not
 * deleted). Existing entries are never overwritten. Returns how many were added,
 * or null when the file is not a «Пора» backup.
 */
export function importBackupData(raw: unknown): number | null {
  const normalized = normalizeData(raw);
  if (!normalized.ok) return null;
  const incoming = normalized.data;
  const local = localData();
  const next: SyncData = { ...local };
  let added = 0;
  for (const key of COLLECTIONS) {
    const known = new Set(local[key].map((item) => item.id));
    const deleted = local.tombstones[key];
    // Fresh stamp: an imported entry must not look like an old one that was
    // deleted elsewhere long ago (and be dropped again on the next sync).
    const now = syncNow();
    const fresh = incoming[key]
      .filter((item) => !known.has(item.id) && deleted[item.id] === undefined)
      .map((item) => restampEntity(item, now));
    if (fresh.length) {
      next[key] = [...local[key], ...fresh];
      added += fresh.length;
    }
  }
  if (added > 0) {
    applyData(next);
    editSeq++;
    writeMeta({ dirty: true });
    schedulePush(0);
  }
  return added;
}

// ---- logout ------------------------------------------------------------------

/**
 * With several profiles the local copy is removed on «Выйти» (after uploading
 * unsent changes), so the next person signing in on this device sees nothing
 * of it. With one profile it stays (offline use as before).
 */
async function forgetLocalCopy(): Promise<void> {
  const store = storage();
  store?.removeItem(STORE_KEY);
  store?.removeItem(META_KEY);
  store?.removeItem("pora-profile");
  outbox = emptyOutbox();
  await wipeActiveScope();
  forgetCachedShell();
}

export async function logout(): Promise<void> {
  if (readMeta().dirty) await syncServerNow().catch(() => undefined);
  await forgetPushOnLogout();
  try {
    await fetch("/api/logout", { method: "POST", credentials: "same-origin", headers: { Accept: "application/json" } });
  } finally {
    redirecting = true;
    // Unsent changes (no network) stay in this user's own partition; nobody else sees them.
    if (!readMeta().dirty) await forgetLocalCopy();
    window.location.assign("/login");
  }
}

/**
 * «Выйти на всех устройствах»: upload unsent changes, invalidate every session
 * on the server (including this one) and go to the login page. Throws with a
 * user-facing message when the server refused.
 */
export async function logoutEverywhere(): Promise<void> {
  if (readMeta().dirty) await syncServerNow().catch(() => undefined);
  await forgetPushOnLogout();
  let response: Response;
  try {
    response = await fetch("/api/logout-all", {
      method: "POST",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
  } catch {
    throw new Error("Нет связи с сервером.");
  }
  if (response.status === 401) {
    redirecting = true;
    window.location.assign("/login?e=expired");
    return;
  }
  if (!response.ok) throw new Error(`Сервер не смог завершить сеансы (ответ ${response.status}).`);
  redirecting = true;
  if (!readMeta().dirty) await forgetLocalCopy();
  window.location.assign("/login");
}

// ---- password ----------------------------------------------------------------

/**
 * «Сменить пароль». Resolves on success (this device stays signed in with a
 * new cookie, the user's other devices are signed out); throws with a
 * user-facing Russian message otherwise.
 */
export async function changePassword(current: string, next: string, repeat: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch("/api/password", {
      method: "POST",
      credentials: "same-origin",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ current, next, repeat }),
    });
  } catch {
    throw new Error("Нет связи с сервером — пароль не изменён.");
  }
  if (response.ok) return;
  const body = await readJson(response);
  if (response.status === 401) throw new Error("Сеанс закончился — войдите заново и повторите.");
  throw new Error(typeof body?.message === "string" ? body.message : `Не получилось (ответ ${response.status}).`);
}

// ---- wiring ------------------------------------------------------------------

function syncedChanged(a: ReturnType<typeof usePlanner.getState>, b: ReturnType<typeof usePlanner.getState>): boolean {
  return (
    COLLECTIONS.some((key) => a[key] !== b[key]) ||
    a.tombstones !== b.tombstones ||
    a.workStart !== b.workStart ||
    a.workEnd !== b.workEnd ||
    a.settingsUpdatedAt !== b.settingsUpdatedAt ||
    a.archiveDays !== b.archiveDays
  );
}

/**
 * Start syncing. Call after `usePlanner.persist.rehydrate()`. `pristine` = this
 * device had no saved planner data before (only the demo seed).
 */
export function bindServerSync(options: { pristine: boolean; switched?: boolean }): () => void {
  retireLegacySync();
  // Another person signed in on this device: the sync state belonged to the previous one.
  if (options.switched) writeMeta({ ...DEFAULT_META, clockOffset: readMeta().clockOffset });
  const meta = readMeta();
  setClockOffset(meta.clockOffset);
  pristine = options.pristine && meta.base === null;
  emit();

  const unsub = usePlanner.subscribe((state, prev) => {
    if (applying || !syncedChanged(state, prev)) return;
    setOutbox(record(outbox, diffChanges(prev, state), Date.now()));
    editSeq++;
    if (!readMeta().dirty) writeMeta({ dirty: true });
    schedulePush();
  });

  let lastPull = 0;
  const pull = () => {
    const now = Date.now();
    if (now - lastPull < 1500) return;
    lastPull = now;
    void syncServerNow();
  };
  const onVisibility = () => {
    if (document.visibilityState === "hidden") flushOnHide();
    else pull();
  };
  const onPageHide = () => flushOnHide();
  const onOnline = () => {
    if (outbox.retryAt) setOutbox({ ...outbox, attempts: 0, retryAt: null });
    lastPull = 0;
    pull();
  };
  const onOffline = () => setPhase("offline");
  const adoptFromOtherTab = (removed: boolean) => {
    // Another tab saved: adopt it without treating it as our own edit (that
    // tab already marked the shared dirty flag and will upload it). Merge,
    // never replace: its save may predate an edit made here a moment ago
    // (that is how freshly added subtasks used to vanish). A removed copy
    // (sign-out in that tab) is taken as is.
    {
      const mine = removed ? null : localData();
      applying++;
      void Promise.resolve(usePlanner.persist.rehydrate())
        .then(() => {
          if (!mine) return;
          const theirs = localData();
          const merged = adoptOtherTab(mine, theirs);
          if (!sameData(merged, theirs)) applyData(merged);
        })
        .finally(() => {
          applying--;
        });
    }
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORE_KEY) {
      adoptFromOtherTab(event.newValue === null);
    } else if (event.key === META_KEY || event.key === LEGACY_NOTE_KEY) {
      emit();
    }
  };

  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", onPageHide);
  window.addEventListener("focus", pull);
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);
  window.addEventListener("storage", onStorage);
  const poll = window.setInterval(() => {
    if (document.visibilityState !== "visible") return;
    // After a failure the retry timer decides; polling would only hammer a dead network.
    if (outbox.retryAt && Date.now() < outbox.retryAt) return;
    void syncServerNow();
  }, POLL_MS);
  const unsubTabs = onOtherTabSaved((name) => {
    if (name === STORE_KEY) adoptFromOtherTab(false);
    else if (name === OUTBOX_KEY) {
      void readLocal<unknown>(OUTBOX_KEY).then((raw) => {
        const theirs = parseOutbox(raw);
        if (theirs.seq >= outbox.seq) {
          outbox = theirs;
          emit();
        }
      });
    }
  });

  let stopped = false;
  void readLocal<unknown>(OUTBOX_KEY).then((raw) => {
    if (stopped) return;
    const saved = parseOutbox(raw);
    // Edits made before the journal was read are kept on top of it.
    outbox = outbox.entries.length ? record(saved, outbox.entries, Date.now()) : saved;
    emit();
    pull();
  });

  return () => {
    stopped = true;
    unsubTabs();
    unsub();
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("pagehide", onPageHide);
    window.removeEventListener("focus", pull);
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", onOffline);
    window.removeEventListener("storage", onStorage);
    window.clearInterval(poll);
    window.clearTimeout(pushTimer);
  };
}
