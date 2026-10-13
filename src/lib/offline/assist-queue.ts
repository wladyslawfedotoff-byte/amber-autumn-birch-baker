/**
 * Questions to «Помощник» asked without network («Отложить» while offline).
 * Kept per user on the device; when the connection is back they are handed
 * to the server queue (the same one «Отложить» uses online), which answers in
 * the background — the answer appears in the bell.
 */
import { assistantApi } from "@/lib/assistant/client";
import { readJson, writeJson } from "./device-store";

const KEY = "assist-queue";

export type OfflineQuestion = { id: string; text: string; conversationId: string | null; at: number };

type Listener = () => void;
const listeners = new Set<Listener>();
let items: OfflineQuestion[] = [];
let loaded: Promise<void> | null = null;
let flushing = false;

function emit(): void {
  listeners.forEach((listener) => listener());
}

function load(): Promise<void> {
  loaded ??= readJson<OfflineQuestion[]>(KEY).then((saved) => {
    if (Array.isArray(saved)) items = saved.filter((q) => q && typeof q.id === "string" && typeof q.text === "string");
    emit();
  });
  return loaded;
}

function save(): void {
  void writeJson(KEY, items);
  emit();
}

export function offlineQuestions(): OfflineQuestion[] {
  return items;
}

export function subscribeOfflineQuestions(listener: Listener): () => void {
  listeners.add(listener);
  void load();
  return () => listeners.delete(listener);
}

function newId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function queueOfflineQuestion(text: string, conversationId: string | null): Promise<OfflineQuestion> {
  await load();
  const item = { id: newId(), text: text.slice(0, 4000), conversationId, at: Date.now() };
  items = [...items, item];
  save();
  return item;
}

export async function cancelOfflineQuestion(id: string): Promise<void> {
  await load();
  items = items.filter((q) => q.id !== id);
  save();
}

/** Hand the saved questions to the server queue. Returns how many went out. */
export async function flushOfflineQuestions(): Promise<number> {
  await load();
  if (flushing || !items.length || (typeof navigator !== "undefined" && navigator.onLine === false)) return 0;
  flushing = true;
  let sent = 0;
  try {
    for (const item of [...items]) {
      try {
        await assistantApi.enqueueQuestion(item.text, item.conversationId, item.id);
      } catch (error) {
        // A malformed question is dropped; anything else (no network, queue
        // full, assistant switched off, signed out) keeps it for later.
        if (error instanceof Error && error.message === "assistant 400") {
          items = items.filter((q) => q.id !== item.id);
          save();
          continue;
        }
        break;
      }
      items = items.filter((q) => q.id !== item.id);
      sent++;
      save();
    }
  } finally {
    flushing = false;
  }
  return sent;
}
