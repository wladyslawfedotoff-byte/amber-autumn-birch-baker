import { usePlanner } from "@/lib/planner-store";

const KEY = "pora-cloud";
const STAMP_KEY = "pora-cloud-stamp";

export type CloudConfig = {
  url: string;
  user: string;
  password: string;
};

export type CloudStatus = {
  connected: boolean;
  url: string;
  note: string;
};

type Listener = () => void;

let status: CloudStatus = { connected: false, url: "", note: "" };
const listeners = new Set<Listener>();
let applying = false;
let lastBody = "";

function emit(note = status.note) {
  const config = readCloud();
  status = { connected: Boolean(config), url: config?.url ?? "", note };
  listeners.forEach((listener) => listener());
}

export function getCloudStatus(): CloudStatus {
  return status;
}

export function subscribeCloud(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function readCloud(): CloudConfig | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as CloudConfig;
    if (!data.url?.trim() || !data.user?.trim()) return null;
    return { url: data.url.trim(), user: data.user, password: data.password ?? "" };
  } catch {
    return null;
  }
}

export function writeCloud(config: CloudConfig | null) {
  if (!config) localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, JSON.stringify(config));
  emit(config ? "Подключено. Файл pora.json в вашей папке." : "");
}

function stamp(): number {
  return Number(localStorage.getItem(STAMP_KEY) ?? "0") || 0;
}

function setStamp(value: number) {
  localStorage.setItem(STAMP_KEY, String(value));
}

function fileUrl(config: CloudConfig): string {
  return `${config.url.replace(/\/+$/, "")}/pora.json`;
}

function authHeader(config: CloudConfig): string {
  const bytes = new TextEncoder().encode(`${config.user}:${config.password}`);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return `Basic ${btoa(binary)}`;
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
  return JSON.stringify(payload(0));
}

class CloudError extends Error {}

async function call(config: CloudConfig, method: string, url: string, body?: string): Promise<Response> {
  try {
    return await fetch(url, {
      method,
      headers: {
        Authorization: authHeader(config),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body,
    });
  } catch {
    throw new CloudError("Телефон не открыл ваше облако. Нужен адрес https, и сервер должен пускать браузер.");
  }
}

async function writeFile(config: CloudConfig, updatedAt: number) {
  const response = await call(config, "PUT", fileUrl(config), JSON.stringify(payload(updatedAt)));
  if (response.status === 401 || response.status === 403) throw new CloudError("Облако не приняло имя или пароль.");
  if (!response.ok) throw new CloudError("Облако не записало файл. Проверьте, что папка уже есть.");
  setStamp(updatedAt);
  lastBody = fingerprint();
  emit("Записано в ваше облако.");
}

export async function syncCloud(forceWrite = false): Promise<void> {
  const config = readCloud();
  if (!config) return;
  const response = await call(config, "GET", fileUrl(config));
  if (response.status === 401 || response.status === 403) throw new CloudError("Облако не приняло имя или пароль.");
  if (response.status === 404) {
    await writeFile(config, Date.now());
    return;
  }
  if (!response.ok) throw new CloudError("Облако не отдало файл.");
  const remote = JSON.parse(await response.text()) as { updatedAt?: number };
  const remoteAt = typeof remote.updatedAt === "number" ? remote.updatedAt : 0;
  if (remoteAt > stamp()) {
    applying = true;
    usePlanner.getState().importBackup(remote);
    setStamp(remoteAt);
    lastBody = fingerprint();
    applying = false;
    emit("Список взят из вашего облака.");
    return;
  }
  if (forceWrite || fingerprint() !== lastBody) await writeFile(config, Date.now());
}

export function bindCloudSync(): () => void {
  lastBody = fingerprint();
  emit();
  const run = (force: boolean) => {
    void syncCloud(force).catch((error: unknown) => {
      emit(error instanceof Error ? error.message : "Облако не ответило.");
    });
  };
  run(false);
  let timer = 0;
  const unsub = usePlanner.subscribe(() => {
    if (applying || !readCloud()) return;
    const next = fingerprint();
    if (next === lastBody) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => run(true), 700);
  });
  const onShow = () => {
    if (document.visibilityState === "visible") run(false);
  };
  document.addEventListener("visibilitychange", onShow);
  const poll = window.setInterval(() => {
    if (document.visibilityState === "visible") run(false);
  }, 15000);
  return () => {
    unsub();
    document.removeEventListener("visibilitychange", onShow);
    window.clearTimeout(timer);
    window.clearInterval(poll);
  };
}
