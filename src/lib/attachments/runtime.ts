/**
 * Attachments in the browser: every new file is written to the device first
 * (IndexedDB blob + queue entry) and its meta goes onto the task/project at
 * once, so it shows and syncs even without network. A background loop sends
 * queued files when the server is reachable.
 */
import { useSyncExternalStore } from "react";
import { usePlanner } from "../planner-store";
import type { AttachmentMeta } from "../planner-types";
import { readTakenAt } from "./exif";
import { getServerSyncStatus, subscribeServerSync } from "../server-sync";
import { activeScope, readJson, writeJson } from "../offline/device-store";
import { compressImage } from "./compress";
import { blobKey, idbBlobs, memoryBlobs, type BlobKv } from "./blob-store";
import {
  emptyQueue,
  enqueue,
  isFatal,
  markFailed,
  nextReady,
  parseQueue,
  pendingFor,
  remove,
  type ParentKind,
  type UploadQueue,
} from "./queue";

/** Extension → canonical type. The server re-checks every file by its bytes. */
const BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  csv: "text/csv",
  txt: "text/plain",
  rtf: "application/rtf",
};
const ACCEPTED = new Set(Object.values(BY_EXT));
export const ACCEPT = [...new Set([...Object.keys(BY_EXT).map((ext) => `.${ext}`), ...ACCEPTED])].join(",");
const ACCEPT_HINT = "Только фото, PDF, документы и таблицы (DOC, DOCX, XLS, XLSX, ODT, ODS, CSV, TXT, RTF).";

/** Picks the type from the extension for documents (phones often send an empty or generic type). */
export function resolveMime(name: string, type: string): string | null {
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? "";
  const byExt = BY_EXT[ext];
  const given = (type || "").toLowerCase();
  if (given.startsWith("image/") && ACCEPTED.has(given)) return given;
  return byExt ?? null;
}

/**
 * EXIF has no zone: «14:30» means the phone's wall clock. readTakenAt
 * returns it as if UTC; shift by the local offset so the caption shows 14:30.
 */
export function exifToInstant(wallAsUtc: number | null): number | null {
  if (wallAsUtc === null) return null;
  return wallAsUtc + new Date(wallAsUtc).getTimezoneOffset() * 60_000;
}

export type FileKind = "image" | "pdf" | "text" | "sheet" | "doc";
export function fileKind(mime: string): FileKind {
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf") return "pdf";
  if (mime === "text/plain" || mime === "text/csv") return "text";
  if (mime.includes("excel") || mime.includes("spreadsheet")) return "sheet";
  return "doc";
}
const QUEUE_KEY = "uploads";
const DELETES_KEY = "upload-deletes";

type State = { queue: UploadQueue; deletes: string[]; busy: boolean; lastError: string | null };

let state: State = { queue: emptyQueue(), deletes: [], busy: false, lastError: null };
let loaded: Promise<void> | null = null;
let blobs: BlobKv | null = null;
const listeners = new Set<() => void>();
const previews = new Map<string, string>();
let timer = 0;

function emit(): void {
  listeners.forEach((fn) => fn());
}

function setState(patch: Partial<State>): void {
  state = { ...state, ...patch };
  emit();
}

function store(): BlobKv {
  if (blobs) return blobs;
  blobs = typeof indexedDB !== "undefined" ? idbBlobs() : memoryBlobs();
  return blobs;
}

/** Same partition as the planner copy on this device. */
function user(): string {
  return activeScope();
}

function ensureLoaded(): Promise<void> {
  loaded ??= (async () => {
    const [queue, deletes] = await Promise.all([readJson<unknown>(QUEUE_KEY), readJson<unknown>(DELETES_KEY)]);
    state = {
      ...state,
      queue: parseQueue(queue),
      deletes: Array.isArray(deletes) ? deletes.filter((d): d is string => typeof d === "string") : [],
    };
    emit();
  })();
  return loaded;
}

async function saveQueue(queue: UploadQueue): Promise<void> {
  setState({ queue });
  await writeJson(QUEUE_KEY, queue);
}

async function saveDeletes(deletes: string[]): Promise<void> {
  setState({ deletes });
  await writeJson(DELETES_KEY, deletes);
}

export function online(): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return false;
  return !getServerSyncStatus().offline;
}

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID().replace(/-/g, "");
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

export type AddResult = { added: AttachmentMeta[]; rejected: { name: string; reason: string }[] };

let addChain: Promise<unknown> = Promise.resolve();

/** Add files to a task/project. Returns the new meta rows (already on the entity). Calls run one after another. */
export function addFiles(files: Iterable<File>, parent: { kind: ParentKind; id: string; entryId?: string }, maxBytes: number): Promise<AddResult> {
  const list = [...files];
  const run = addChain.then(() => addFilesNow(list, parent, maxBytes));
  addChain = run.catch(() => undefined);
  return run;
}

async function addFilesNow(files: File[], parent: { kind: ParentKind; id: string; entryId?: string }, maxBytes: number): Promise<AddResult> {
  await ensureLoaded();
  const added: AttachmentMeta[] = [];
  const rejected: { name: string; reason: string }[] = [];
  for (const file of files) {
    const mime = resolveMime(file.name || "", file.type);
    if (!mime) {
      rejected.push({ name: file.name, reason: ACCEPT_HINT });
      continue;
    }
    let shrunk;
    let takenAt: number | undefined;
    try {
      if (mime.startsWith("image/")) {
        const head = new Uint8Array(await file.slice(0, 512 * 1024).arrayBuffer());
        takenAt = exifToInstant(readTakenAt(head)) ?? (file.lastModified || Date.now());
      }
      shrunk = await compressImage(file);
    } catch {
      rejected.push({ name: file.name, reason: "Не удалось прочитать файл." });
      continue;
    }
    const finalMime = mime.startsWith("image/") ? (shrunk.mime || mime).toLowerCase() : mime;
    if (!ACCEPTED.has(finalMime)) {
      rejected.push({ name: file.name, reason: ACCEPT_HINT });
      continue;
    }
    if (shrunk.blob.size > maxBytes) {
      rejected.push({ name: file.name, reason: `Больше ${Math.round(maxBytes / 1024 / 1024)} МБ.` });
      continue;
    }
    const id = newId();
    try {
      await store().set(blobKey(user(), id), shrunk.blob);
    } catch {
      rejected.push({ name: file.name, reason: "Не хватило места на устройстве." });
      continue;
    }
    const meta: AttachmentMeta = { id, name: shrunk.name, mime: finalMime, size: shrunk.blob.size, createdAt: Date.now(), ...(takenAt !== undefined ? { takenAt } : {}), ...(parent.entryId ? { entryId: parent.entryId } : {}) };
    // Always against the newest queue: the sender may have removed entries meanwhile.
    await saveQueue(enqueue(state.queue, { id, parentKind: parent.kind, parentId: parent.id, name: meta.name, mime: meta.mime, size: meta.size, createdAt: meta.createdAt, ...(meta.takenAt !== undefined ? { takenAt: meta.takenAt } : {}) }));
    usePlanner.getState().addAttachment(parent.kind, parent.id, meta);
    added.push(meta);
  }
  kick(0);
  return { added, rejected };
}

/** Remove from the entity, the device queue and the server (later, if offline). */
export async function deleteFile(parent: { kind: ParentKind; id: string }, id: string): Promise<void> {
  await ensureLoaded();
  usePlanner.getState().removeAttachment(parent.kind, parent.id, id);
  revokePreview(id);
  if (state.queue.items.some((item) => item.id === id)) {
    await saveQueue(remove(state.queue, id));
    await store().del(blobKey(user(), id)).catch(() => undefined);
    return;
  }
  await saveDeletes([...new Set([...state.deletes, id])]);
  kick(0);
}

/** Pending on this device (not on the NAS yet). */
export function isPending(id: string): boolean {
  return state.queue.items.some((item) => item.id === id);
}

/** Object URL for a file still on the device (null once uploaded). */
/** Text of a text/CSV attachment: from the phone while pending, otherwise from the server. */
export async function readText(id: string, maxChars = 200_000): Promise<string> {
  const local = isPending(id) ? await store().get(blobKey(user(), id)).catch(() => null) : null;
  let text: string;
  if (local) text = await local.text();
  else {
    const res = await fetch(fileUrl(id), { credentials: "same-origin" });
    if (!res.ok) throw new Error(String(res.status));
    text = await res.text();
  }
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n…` : text;
}

export async function localPreview(id: string): Promise<string | null> {
  const cached = previews.get(id);
  if (cached) return cached;
  const blob = await store().get(blobKey(user(), id)).catch(() => null);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  previews.set(id, url);
  return url;
}

function revokePreview(id: string): void {
  const url = previews.get(id);
  if (url) URL.revokeObjectURL(url);
  previews.delete(id);
}

export function fileUrl(id: string): string {
  return `/api/attachments/${encodeURIComponent(id)}`;
}

async function sendOne(): Promise<"done" | "idle" | "wait"> {
  // Deletes first: cheap, and they free space on the NAS.
  const del = state.deletes[0];
  if (del) {
    try {
      const res = await fetch(fileUrl(del), { method: "DELETE", credentials: "same-origin" });
      if (res.ok || res.status === 404 || res.status === 403) {
        await saveDeletes(state.deletes.slice(1));
        return "done";
      }
      return "wait";
    } catch {
      return "wait";
    }
  }
  const now = Date.now();
  const item = nextReady(state.queue, now);
  if (!item) return "idle";
  const blob = await store().get(blobKey(user(), item.id)).catch(() => null);
  if (!blob) {
    await saveQueue(remove(state.queue, item.id));
    return "done";
  }
  const form = new FormData();
  form.set("file", blob, item.name);
  form.set("parentKind", item.parentKind);
  form.set("parentId", item.parentId);
  form.set("id", item.id);
  if (item.takenAt) form.set("takenAt", String(item.takenAt));
  try {
    const res = await fetch("/api/attachments", { method: "POST", body: form, credentials: "same-origin" });
    if (res.ok) {
      const body = (await res.json().catch(() => ({}))) as { item?: { name?: string; mime?: string; size?: number; takenAt?: number } };
      const saved = body.item;
      if (saved && (saved.mime !== item.mime || saved.name !== item.name)) {
        usePlanner.getState().patchAttachment(item.parentKind, item.parentId, item.id, {
          mime: saved.mime ?? item.mime,
          name: saved.name ?? item.name,
          size: saved.size ?? item.size,
        });
      }
      await saveQueue(remove(state.queue, item.id));
      revokePreview(item.id);
      await store().del(blobKey(user(), item.id)).catch(() => undefined);
      setState({ lastError: null });
      return "done";
    }
    const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    const error = body.error ?? `http_${res.status}`;
    if (isFatal(error)) {
      await saveQueue(remove(state.queue, item.id));
      await store().del(blobKey(user(), item.id)).catch(() => undefined);
      usePlanner.getState().removeAttachment(item.parentKind, item.parentId, item.id);
      setState({ lastError: body.message ?? `«${item.name}» не загружен.` });
      return "done";
    }
    // not_found: the task has not reached the server yet — retry after the next sync.
    await saveQueue(markFailed(state.queue, item.id, now, error));
    return "done";
  } catch {
    await saveQueue(markFailed(state.queue, item.id, now, "offline"));
    return "wait";
  }
}

async function drain(): Promise<void> {
  if (state.busy) return;
  await ensureLoaded();
  if (!online()) return;
  setState({ busy: true });
  try {
    for (let i = 0; i < 50; i++) {
      const result = await sendOne();
      if (result !== "done") break;
    }
  } finally {
    setState({ busy: false });
  }
  const soonest = Math.min(...state.queue.items.map((item) => item.retryAt ?? Date.now()));
  if (state.queue.items.length || state.deletes.length) kick(Math.max(2_000, (Number.isFinite(soonest) ? soonest : Date.now()) - Date.now()));
}

export function kick(delay = 0): void {
  if (typeof window === "undefined") return;
  window.clearTimeout(timer);
  timer = window.setTimeout(() => void drain(), delay);
}

let bound = false;
/** Start the background sender (once per page). */
export function bindAttachments(): () => void {
  if (bound || typeof window === "undefined") return () => undefined;
  bound = true;
  void ensureLoaded().then(() => kick(1_000));
  const onOnline = () => kick(500);
  window.addEventListener("online", onOnline);
  let lastPhase = getServerSyncStatus().phase;
  const unsub = subscribeServerSync(() => {
    const phase = getServerSyncStatus().phase;
    // A finished sync may have brought the parent task to the server.
    if (lastPhase === "syncing" && phase === "idle") kick(300);
    lastPhase = phase;
  });
  return () => {
    bound = false;
    window.removeEventListener("online", onOnline);
    unsub();
  };
}

function snapshot(): State {
  return state;
}

export function useUploads(): State {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      void ensureLoaded();
      return () => listeners.delete(fn);
    },
    snapshot,
    snapshot,
  );
}

export function pendingCountFor(queue: UploadQueue, kind: ParentKind, id: string): number {
  return pendingFor(queue, kind, id).length;
}

export function dismissUploadError(): void {
  setState({ lastError: null });
}

/** 1.9.1 dropped «Дата на фото»: forget the old per-device switch. */
try {
  if (typeof localStorage !== "undefined") localStorage.removeItem("pora-photo-stamp");
} catch {
  /* private mode */
}
