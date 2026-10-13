/** Browser side of «Помощник»: small wrappers over /api/assistant/*. */
import type { AiWhich, AssistantNotice, AssistantStatus, ChatEvent, Conversation, ConversationSummary, ProposalItem, ProposalStatus, QueuedRequest } from "./types";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/assistant/${path}`, {
    credentials: "same-origin",
    cache: "no-store",
    ...init,
    headers: { accept: "application/json", ...(init?.body ? { "content-type": "application/json" } : {}), ...init?.headers },
  });
  if (!res.ok) throw new Error(`assistant ${res.status}`);
  return (await res.json()) as T;
}

export const assistantApi = {
  status: () => call<AssistantStatus>("status"),
  check: () => call<Record<string, boolean>>("check", { method: "POST", body: "{}" }),
  settings: (patch: { allowCloud?: boolean; allowPaid?: boolean; consent?: AiWhich }) => call<AssistantStatus>("settings", { method: "POST", body: JSON.stringify(patch) }),
  list: () => call<{ conversations: ConversationSummary[] }>("conversations").then((r) => r.conversations),
  get: (id: string) => call<Conversation>(`conversations/${id}`),
  remove: (id: string) => call<{ ok: boolean }>(`conversations/${id}`, { method: "DELETE" }),
  setProposal: (conversationId: string, proposalId: string, status: ProposalStatus, items?: ProposalItem[]) =>
    call(`conversations/${conversationId}/proposals/${proposalId}`, { method: "POST", body: JSON.stringify({ status, items }) }),
  /** «Отложить»: the server keeps asking until a model answers. */
  enqueue: (conversationId: string, messageId: string) => call<QueuedRequest>("queue", { method: "POST", body: JSON.stringify({ conversationId, messageId }) }),
  /** A question asked without network: the server queues it and answers in the background. */
  enqueueQuestion: (text: string, conversationId: string | null, clientId: string) =>
    call<QueuedRequest>("queue", { method: "POST", body: JSON.stringify({ text, conversationId, clientId }) }),
  cancelQueued: (id: string) => call<{ ok: boolean }>(`queue/${id}`, { method: "DELETE" }),
  notices: () => call<{ notices: AssistantNotice[] }>("notices").then((r) => r.notices),
  readNotices: (filter: { ids?: string[]; conversationId?: string }) => call<{ removed: number }>("notices/read", { method: "POST", body: JSON.stringify(filter) }),
};

/** POST /api/assistant/chat and read the NDJSON stream event by event. */
export async function streamChat(
  input: { conversationId: string | null; text: string; today: string; now: string; retryOf?: string },
  onEvent: (event: ChatEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch("/api/assistant/chat", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", accept: "application/x-ndjson" },
      body: JSON.stringify(input),
      signal,
    });
  } catch {
    if (signal?.aborted) return;
    onEvent({ type: "error", message: "Нет связи с сервером. Проверьте интернет." });
    return;
  }
  if (!res.ok || !res.body) {
    onEvent({ type: "error", message: res.status === 404 ? "Помощник выключен на сервере." : "Помощник сейчас недоступен." });
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const flush = (line: string) => {
    if (!line.trim()) return;
    try {
      onEvent(JSON.parse(line) as ChatEvent);
    } catch {
      // ignore a broken line
    }
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index: number;
      while ((index = buffer.indexOf("\n")) >= 0) {
        flush(buffer.slice(0, index));
        buffer = buffer.slice(index + 1);
      }
    }
    flush(buffer);
  } catch {
    if (!signal?.aborted) onEvent({ type: "error", message: "Связь оборвалась. Попробуйте ещё раз." });
  }
}
