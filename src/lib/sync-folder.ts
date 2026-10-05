import { usePlanner } from "@/lib/planner-store";

const FILE_NAME = "pora.json";
const STAMP_KEY = "pora-sync-stamp";
const DB_NAME = "pora-sync";

type DirHandle = FileSystemDirectoryHandle;

export type SyncStatus = {
  supported: boolean;
  folder: string | null;
  granted: boolean;
};

type Listener = () => void;

let status: SyncStatus = { supported: false, folder: null, granted: false };
const listeners = new Set<Listener>();

function emit(next: SyncStatus) {
  status = next;
  listeners.forEach((listener) => listener());
}

export function getSyncStatus(): SyncStatus {
  return status;
}

export function subscribeSync(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function supported(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("handles");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readHandle(): Promise<DirHandle | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction("handles").objectStore("handles").get("dir");
    request.onsuccess = () => resolve((request.result as DirHandle | undefined) ?? null);
    request.onerror = () => reject(request.error);
  });
}

async function writeHandle(dir: DirHandle | null): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const store = db.transaction("handles", "readwrite").objectStore("handles");
    const request = dir ? store.put(dir, "dir") : store.delete("dir");
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function permission(dir: DirHandle, ask: boolean): Promise<boolean> {
  const mode = { mode: "readwrite" as const };
  const handle = dir as DirHandle & {
    queryPermission?: (descriptor: { mode: "readwrite" }) => Promise<PermissionState>;
    requestPermission?: (descriptor: { mode: "readwrite" }) => Promise<PermissionState>;
  };
  const current = handle.queryPermission ? await handle.queryPermission(mode) : "granted";
  if (current === "granted") return true;
  if (!ask || !handle.requestPermission) return false;
  return (await handle.requestPermission(mode)) === "granted";
}

function stamp(): number {
  return Number(localStorage.getItem(STAMP_KEY) ?? "0") || 0;
}

function setStamp(value: number) {
  localStorage.setItem(STAMP_KEY, String(value));
}

function payload(updatedAt: number) {
  const state = usePlanner.getState();
  return {
    updatedAt,
    lists: state.lists,
    tasks: state.tasks,
    habits: state.habits,
    milestones: state.milestones,
    projects: state.projects,
    workStart: state.workStart,
    workEnd: state.workEnd,
  };
}

function fingerprint(): string {
  const body = payload(0);
  return JSON.stringify({ ...body, updatedAt: undefined });
}

async function readFile(dir: DirHandle): Promise<{ updatedAt: number; data: unknown } | null> {
  try {
    const handle = await dir.getFileHandle(FILE_NAME);
    const file = await handle.getFile();
    const data = JSON.parse(await file.text()) as { updatedAt?: number };
    if (!data || typeof data.updatedAt !== "number") return null;
    return { updatedAt: data.updatedAt, data };
  } catch {
    return null;
  }
}

async function writeFile(dir: DirHandle, updatedAt: number): Promise<void> {
  const handle = await dir.getFileHandle(FILE_NAME, { create: true });
  const writable = await handle.createWritable();
  await writable.write(JSON.stringify(payload(updatedAt)));
  await writable.close();
  setStamp(updatedAt);
}

export async function refreshSyncStatus(): Promise<void> {
  if (!supported()) {
    emit({ supported: false, folder: null, granted: false });
    return;
  }
  try {
    const dir = await readHandle();
    if (!dir) {
      emit({ supported: true, folder: null, granted: false });
      return;
    }
    const granted = await permission(dir, false);
    emit({ supported: true, folder: dir.name, granted });
  } catch {
    emit({ supported: true, folder: null, granted: false });
  }
}

export async function chooseSyncFolder(): Promise<void> {
  const pick = (
    window as Window & { showDirectoryPicker?: (opts: { mode: "readwrite" }) => Promise<DirHandle> }
  ).showDirectoryPicker;
  if (!pick) return;
  const dir = await pick({ mode: "readwrite" });
  await writeHandle(dir);
  emit({ supported: true, folder: dir.name, granted: true });
  await pushFolderNow();
}

export async function allowSyncFolder(): Promise<void> {
  const dir = await readHandle();
  if (!dir) return;
  const granted = await permission(dir, true);
  emit({ supported: true, folder: dir.name, granted });
  if (granted) await pullFolderNow();
}

export async function forgetSyncFolder(): Promise<void> {
  await writeHandle(null);
  emit({ supported: supported(), folder: null, granted: false });
}

let applying = false;

export async function pullFolderNow(): Promise<void> {
  const dir = await readHandle();
  if (!dir || !(await permission(dir, false))) return;
  const remote = await readFile(dir);
  if (!remote || remote.updatedAt <= stamp()) return;
  applying = true;
  usePlanner.getState().importBackup(remote.data);
  setStamp(remote.updatedAt);
  lastBody = fingerprint();
  applying = false;
}

export async function saveToFiles(): Promise<"saved" | "cancelled"> {
  const updatedAt = Date.now();
  const body = JSON.stringify(payload(updatedAt));
  const file =
    [new File([body], FILE_NAME, { type: "application/json" }), new File([body], FILE_NAME, { type: "text/plain" })].find(
      (item) => typeof navigator.canShare === "function" && navigator.canShare({ files: [item] }),
    ) ?? null;
  if (file && typeof navigator.share === "function") {
    try {
      await navigator.share({ files: [file], title: "Пора" });
      setStamp(updatedAt);
      lastBody = fingerprint();
      return "saved";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
    }
  }
  const url = URL.createObjectURL(new File([body], FILE_NAME, { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = FILE_NAME;
  link.click();
  URL.revokeObjectURL(url);
  setStamp(updatedAt);
  lastBody = fingerprint();
  return "saved";
}

export async function openFromFile(file: File): Promise<boolean> {
  const data = JSON.parse(await file.text()) as { updatedAt?: number };
  applying = true;
  const ok = usePlanner.getState().importBackup(data);
  if (ok) {
    setStamp(typeof data.updatedAt === "number" ? data.updatedAt : Date.now());
    lastBody = fingerprint();
  }
  applying = false;
  return ok;
}

export async function pushFolderNow(): Promise<void> {
  const dir = await readHandle();
  if (!dir || !(await permission(dir, false))) return;
  const remote = await readFile(dir);
  if (remote && remote.updatedAt > stamp()) {
    await pullFolderNow();
    return;
  }
  await writeFile(dir, Date.now());
  lastBody = fingerprint();
}

let lastBody = "";
let timer = 0;

export function bindFolderSync(): () => void {
  lastBody = fingerprint();
  void refreshSyncStatus().then(() => pullFolderNow());
  const unsub = usePlanner.subscribe(() => {
    if (applying) return;
    const next = fingerprint();
    if (next === lastBody) return;
    lastBody = next;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      void pushFolderNow();
    }, 600);
  });
  const onShow = () => {
    if (document.visibilityState === "visible") void pullFolderNow();
  };
  document.addEventListener("visibilitychange", onShow);
  const poll = window.setInterval(() => {
    if (document.visibilityState === "visible") void pullFolderNow();
  }, 15000);
  return () => {
    unsub();
    document.removeEventListener("visibilitychange", onShow);
    window.clearTimeout(timer);
    window.clearInterval(poll);
  };
}
