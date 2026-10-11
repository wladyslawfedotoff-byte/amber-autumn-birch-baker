/**
 * Per-user assistant data in DATA_DIR/assistant/<login>.json: conversations,
 * questions waiting for a model («Отложить»), notices for the bell
 * and settings (consent per provider kind, «Разрешить облако», «Разрешить платные»). Only the
 * owner's requests ever read or write their file.
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AiWhich, AssistantNotice, ChatMessage, Conversation, ConversationSummary, Proposal, ProposalItem, ProposalStatus, QueuedRequest } from "../../../src/lib/assistant/types.ts";

export type AssistantSettings = { allowCloud: boolean; allowPaid: boolean; consent: Partial<Record<AiWhich, number>> };
type UserFile = { v: 1; login: string; settings: AssistantSettings; conversations: Conversation[]; queue: QueuedRequest[]; notices: AssistantNotice[] };

const MAX_CONVERSATIONS = 50;
const MAX_MESSAGES = 120;
const MAX_QUEUE = 10;
const MAX_NOTICES = 20;

function safeName(login: string): string {
  return /^[a-z0-9_.-]{1,64}$/i.test(login) && !login.startsWith(".") ? login : createHash("sha256").update(login).digest("hex").slice(0, 32);
}

function empty(login: string): UserFile {
  return { v: 1, login, settings: { allowCloud: true, allowPaid: true, consent: {} }, conversations: [], queue: [], notices: [] };
}

/** Keeps the «В очереди, попробую в …» line of a message in step with the queue. */
function mark(data: UserFile, item: QueuedRequest, queued: boolean): ChatMessage | null {
  const message = data.conversations.find((c) => c.id === item.conversationId)?.messages.find((m) => m.id === item.messageId) ?? null;
  if (message) {
    if (queued) message.queued = { id: item.id, nextAt: item.nextAt };
    else delete message.queued;
  }
  return message;
}

export class AssistantStore {
  private queues = new Map<string, Promise<unknown>>();
  readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  private file(login: string): string {
    return join(this.dir, `${safeName(login)}.json`);
  }

  private async load(login: string): Promise<UserFile> {
    try {
      const parsed = JSON.parse(await readFile(this.file(login), "utf8")) as Partial<UserFile>;
      return {
        v: 1,
        login,
        settings: { allowCloud: parsed.settings?.allowCloud !== false, allowPaid: parsed.settings?.allowPaid !== false, consent: { ...(parsed.settings?.consent ?? {}) } },
        conversations: Array.isArray(parsed.conversations) ? parsed.conversations : [],
        queue: Array.isArray(parsed.queue) ? parsed.queue : [],
        notices: Array.isArray(parsed.notices) ? parsed.notices : [],
      };
    } catch {
      return empty(login);
    }
  }

  private async save(login: string, data: UserFile): Promise<void> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    const target = this.file(login);
    const tmp = `${target}.${randomUUID()}.tmp`;
    await writeFile(tmp, JSON.stringify(data), { mode: 0o600 });
    await rename(tmp, target);
  }

  /** Serialises read-modify-write per user. */
  private exclusive<T>(login: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.queues.get(login) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.queues.set(
      login,
      next.catch(() => undefined),
    );
    return next;
  }

  private update<T>(login: string, fn: (data: UserFile) => T): Promise<T> {
    return this.exclusive(login, async () => {
      const data = await this.load(login);
      const result = fn(data);
      await this.save(login, data);
      return result;
    });
  }

  settings(login: string): Promise<AssistantSettings> {
    return this.exclusive(login, async () => (await this.load(login)).settings);
  }

  setSettings(login: string, patch: { allowCloud?: boolean; allowPaid?: boolean; consent?: AiWhich }): Promise<AssistantSettings> {
    return this.update(login, (data) => {
      if (typeof patch.allowCloud === "boolean") data.settings.allowCloud = patch.allowCloud;
      if (typeof patch.allowPaid === "boolean") data.settings.allowPaid = patch.allowPaid;
      if (patch.consent) data.settings.consent[patch.consent] = Date.now();
      return data.settings;
    });
  }

  list(login: string): Promise<ConversationSummary[]> {
    return this.exclusive(login, async () =>
      (await this.load(login)).conversations.map(({ id, title, updatedAt }) => ({ id, title, updatedAt })).sort((a, b) => b.updatedAt - a.updatedAt),
    );
  }

  get(login: string, id: string): Promise<Conversation | null> {
    return this.exclusive(login, async () => (await this.load(login)).conversations.find((c) => c.id === id) ?? null);
  }

  remove(login: string, id: string): Promise<boolean> {
    return this.update(login, (data) => {
      const before = data.conversations.length;
      data.conversations = data.conversations.filter((c) => c.id !== id);
      data.queue = data.queue.filter((q) => q.conversationId !== id);
      data.notices = data.notices.filter((n) => n.conversationId !== id);
      return data.conversations.length < before;
    });
  }

  /** Appends messages (creates the conversation when `id` is new). */
  append(login: string, id: string, messages: ChatMessage[], title: string): Promise<Conversation> {
    return this.update(login, (data) => {
      const now = Date.now();
      let conv = data.conversations.find((c) => c.id === id);
      if (!conv) {
        conv = { id, title: title.slice(0, 80) || "Беседа", createdAt: now, updatedAt: now, messages: [] };
        data.conversations.push(conv);
      }
      conv.messages.push(...messages);
      conv.messages = conv.messages.slice(-MAX_MESSAGES);
      conv.updatedAt = now;
      data.conversations = data.conversations.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_CONVERSATIONS);
      return conv;
    });
  }

  /** «Применить» / «Отклонить» on a card (and the items left after editing). */
  setProposal(login: string, conversationId: string, proposalId: string, status: ProposalStatus, items?: ProposalItem[]): Promise<Proposal | null> {
    return this.update(login, (data) => {
      const conv = data.conversations.find((c) => c.id === conversationId);
      for (const message of conv?.messages ?? []) {
        const proposal = message.proposals?.find((p) => p.id === proposalId);
        if (proposal) {
          proposal.status = status;
          if (items) proposal.items = items;
          return proposal;
        }
      }
      return null;
    });
  }

  /** «Повторить»: drops the failed answer and its question (they are asked again). */
  dropExchange(login: string, conversationId: string, messageId: string): Promise<boolean> {
    return this.update(login, (data) => {
      const conv = data.conversations.find((c) => c.id === conversationId);
      const index = conv?.messages.findIndex((m) => m.id === messageId && m.error) ?? -1;
      if (!conv || index < 0) return false;
      const from = index > 0 && conv.messages[index - 1]?.role === "user" ? index - 1 : index;
      conv.messages.splice(from, index - from + 1);
      data.queue = data.queue.filter((q) => q.messageId !== messageId);
      return true;
    });
  }

  /* ---- «Отложить»: questions kept until a model answers ---------------- */

  queue(login: string): Promise<QueuedRequest[]> {
    return this.exclusive(login, async () => (await this.load(login)).queue);
  }

  /** Queues the question behind a failed, retryable answer. */
  enqueue(login: string, conversationId: string, messageId: string, nextAt: number, now: number = Date.now()): Promise<QueuedRequest | null> {
    return this.update(login, (data) => {
      const conv = data.conversations.find((c) => c.id === conversationId);
      const index = conv?.messages.findIndex((m) => m.id === messageId) ?? -1;
      const failed = conv?.messages[index];
      const question = conv?.messages[index - 1];
      if (!failed?.retryable || question?.role !== "user") return null;
      const existing = data.queue.find((q) => q.messageId === messageId);
      if (existing) return existing;
      if (data.queue.length >= MAX_QUEUE) return null;
      const item: QueuedRequest = { id: randomUUID(), conversationId, messageId, text: question.text, createdAt: now, nextAt, attempts: 0 };
      data.queue.push(item);
      mark(data, item, true);
      return item;
    });
  }

  cancelQueued(login: string, id: string): Promise<boolean> {
    return this.update(login, (data) => {
      const item = data.queue.find((q) => q.id === id);
      if (!item) return false;
      data.queue = data.queue.filter((q) => q.id !== id);
      mark(data, item, false);
      return true;
    });
  }

  /** Another failed attempt: next try at `nextAt`. */
  reschedule(login: string, id: string, nextAt: number): Promise<QueuedRequest | null> {
    return this.update(login, (data) => {
      const item = data.queue.find((q) => q.id === id);
      if (!item) return null;
      item.attempts += 1;
      item.nextAt = nextAt;
      mark(data, item, true);
      return item;
    });
  }

  /**
   * The queued question got an answer (or gave up): the failed message is
   * replaced, the item leaves the queue and a notice goes to the bell.
   * Returns false when the user cancelled or deleted it meanwhile.
   */
  resolveQueued(login: string, id: string, answer: ChatMessage, notice: Omit<AssistantNotice, "id" | "conversationId" | "title">): Promise<boolean> {
    return this.update(login, (data) => {
      const item = data.queue.find((q) => q.id === id);
      if (!item) return false;
      data.queue = data.queue.filter((q) => q.id !== id);
      const conv = data.conversations.find((c) => c.id === item.conversationId);
      const index = conv?.messages.findIndex((m) => m.id === item.messageId) ?? -1;
      if (!conv || index < 0) return false;
      conv.messages[index] = answer;
      conv.updatedAt = notice.at;
      data.notices = [{ id: randomUUID(), conversationId: conv.id, title: conv.title, ...notice }, ...data.notices].slice(0, MAX_NOTICES);
      return true;
    });
  }

  notices(login: string): Promise<AssistantNotice[]> {
    return this.exclusive(login, async () => (await this.load(login)).notices);
  }

  /** Read in the bell (or the conversation was opened). */
  dismissNotices(login: string, filter: { ids?: string[]; conversationId?: string }): Promise<number> {
    return this.update(login, (data) => {
      const before = data.notices.length;
      data.notices = data.notices.filter((n) => !(filter.ids?.includes(n.id) || n.conversationId === filter.conversationId));
      return before - data.notices.length;
    });
  }

  /** Logins with something in the queue (for the background worker). */
  async queuedLogins(): Promise<string[]> {
    let names: string[];
    try {
      names = (await readdir(this.dir)).filter((name) => name.endsWith(".json"));
    } catch {
      return [];
    }
    const out: string[] = [];
    for (const name of names) {
      try {
        const parsed = JSON.parse(await readFile(join(this.dir, name), "utf8")) as Partial<UserFile>;
        if (typeof parsed.login === "string" && parsed.queue?.length && `${safeName(parsed.login)}.json` === name) out.push(parsed.login);
      } catch {
        // a broken or foreign file: skip
      }
    }
    return out;
  }

  /** Test helper / account cleanup. */
  async wipe(login: string): Promise<void> {
    await rm(this.file(login), { force: true });
  }
}

/** Short title from the first question. */
export function titleFrom(text: string): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > 60 ? `${one.slice(0, 57)}…` : one;
}
