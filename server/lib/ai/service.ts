/**
 * «Помощник» on the server: status, settings, conversations and one streamed
 * answer. Everything is per signed-in user; the model sees only that user's
 * view of the data, and only through tools.
 */
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { AiWhich, AssistantStatus, ChatEvent, ChatMessage, ProposalItem, ProposalStatus, QueuedRequest } from "../../../src/lib/assistant/types.ts";
import type { SyncData } from "../../../src/lib/sync/merge.ts";
import { log } from "../log.ts";
import { principalForLogin, type Principal } from "../principal.ts";
import { aclFor } from "../sync-access.ts";
import { dataDir, getStore, type SyncStore } from "../sync-store.ts";
import { runAgent } from "./agent.ts";
import { chipsAfter, intentOf, localAnswer } from "./context.ts";
import { aiEnabled, readAiConfig, type AiConfig } from "./config.ts";
import { AssistantStore, titleFrom, type AssistantSettings } from "./conversations.ts";
import { ProviderChain, ProviderError, UsageBook, chatClient, type Blocked, type ChatFn } from "./provider.ts";

export const UNAVAILABLE = "Помощник сейчас недоступен.";
const PC_OFF = "Помощник сейчас недоступен: компьютер с локальной моделью не отвечает.";
const CLOUD_OFF = "Помощник сейчас недоступен: компьютер с локальной моделью не отвечает, а облако выключено в «Настройках → Помощник».";
const PAID_OFF = "Помощник сейчас недоступен: бесплатные модели не отвечают, а платные выключены в «Настройках → Помощник».";
const BUSY = "Помощник сейчас недоступен: все модели заняты или исчерпали лимит. Попробуйте через несколько минут.";
const GAVE_UP = "Не удалось получить ответ за сутки: модели так и не ответили. Можно повторить.";
/** Earlier messages sent with a question (tokens!); long ones are cut. */
const HISTORY = 4;
const APP_SOURCE = "Пора · без модели";
const HISTORY_CHARS = 600;
/** «Отложить» keeps trying for a day at most. */
export const QUEUE_MAX_AGE_MS = 24 * 3_600_000;

type Outcome =
  | { type: "answer"; message: ChatMessage }
  | { type: "consent"; provider: AiWhich }
  | { type: "unavailable"; text: string }
  | { type: "broken"; text: string; provider: AiWhich }
  | { type: "aborted" };

/** The last messages that worked, as model history. */
function historyOf(messages: ChatMessage[]): { role: "user" | "assistant"; text: string }[] {
  return messages
    .filter((m) => !m.error && m.text)
    .slice(-HISTORY)
    .map((m) => ({ role: m.role, text: m.text.length > HISTORY_CHARS ? `${m.text.slice(0, HISTORY_CHARS)}…` : m.text }));
}

/** Server-local date and time (TZ of the container) for background answers. */
function localNow(ms: number): { today: string; time: string } {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return { today: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}

/** Sliding one-hour window per login. */
export class UserRateLimit {
  private hits = new Map<string, number[]>();
  private readonly perHour: number;
  private readonly now: () => number;
  constructor(perHour: number, now: () => number = Date.now) {
    this.perHour = perHour;
    this.now = now;
  }
  take(login: string): boolean {
    if (this.perHour <= 0) return true;
    const from = this.now() - 3_600_000;
    const list = (this.hits.get(login) ?? []).filter((t) => t > from);
    if (list.length >= this.perHour) {
      this.hits.set(login, list);
      return false;
    }
    list.push(this.now());
    this.hits.set(login, list);
    return true;
  }
}

/** The user's own view: with profiles only what they own, share or were assigned. */
export async function dataFor(store: SyncStore, user: Principal): Promise<SyncData> {
  const acl = aclFor(user);
  return (acl ? await store.getFor(user.login, acl) : await store.get()).data;
}

export type AssistantDeps = {
  config: AiConfig;
  fetchFn?: typeof fetch;
  /** Monthly token counter (a file in DATA_DIR in production). */
  usage?: UsageBook;
  store: AssistantStore;
  loadData: (user: Principal) => Promise<SyncData>;
  /** Background answers («Отложить»): the profile of a login, null when it no longer exists. */
  principal?: (login: string) => Principal | null;
  now?: () => number;
};

export type ChatInput = { conversationId: string | null; text: string; today: string; now: string; retryOf?: string };

export function parseChatInput(body: unknown): ChatInput | null {
  const b = (body ?? {}) as Record<string, unknown>;
  const text = typeof b.text === "string" ? b.text.trim().slice(0, 4000) : "";
  if (!text) return null;
  const id = typeof b.conversationId === "string" && /^[a-z0-9-]{8,64}$/i.test(b.conversationId) ? b.conversationId : null;
  const today = typeof b.today === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.today) ? b.today : new Date().toISOString().slice(0, 10);
  const now = typeof b.now === "string" && /^\d{2}:\d{2}$/.test(b.now) ? b.now : "12:00";
  const retryOf = typeof b.retryOf === "string" && /^[a-z0-9-]{8,64}$/i.test(b.retryOf) ? b.retryOf : undefined;
  return { conversationId: id, text, today, now, ...(retryOf ? { retryOf } : {}) };
}

/** A rough count when the provider does not report usage (~4 characters per token). */
function estimateTokens(chars: number): number {
  return Math.ceil(chars / 4);
}

export class Assistant {
  readonly chain: ProviderChain;
  readonly limit: UserRateLimit;
  private readonly fetchFn: typeof fetch;
  readonly deps: AssistantDeps;

  constructor(deps: AssistantDeps) {
    this.deps = deps;
    this.fetchFn = deps.fetchFn ?? fetch;
    this.chain = new ProviderChain(deps.config, this.fetchFn, deps.now, deps.usage ?? new UsageBook(null, deps.now));
    this.limit = new UserRateLimit(deps.config.rateLimit, deps.now);
  }

  get enabled(): boolean {
    return aiEnabled(this.deps.config);
  }

  async status(user: Principal): Promise<AssistantStatus> {
    const settings = await this.deps.store.settings(user.login);
    return {
      enabled: this.enabled,
      mode: this.deps.config.mode,
      providers: this.chain.info(),
      consent: settings.consent,
      allowCloud: settings.allowCloud,
      allowPaid: settings.allowPaid,
    };
  }

  /** «Проверить»: fresh check of every provider (no question is sent). */
  check(): Promise<Record<string, boolean>> {
    return this.chain.check();
  }

  private unavailable(blocked: Blocked[]): string {
    if (blocked.includes("cooldown") || blocked.includes("cap")) return BUSY;
    if (blocked.includes("paid_not_allowed")) return PAID_OFF;
    if (blocked.includes("cloud_not_allowed")) return CLOUD_OFF;
    if (blocked.includes("down")) return PC_OFF;
    return UNAVAILABLE;
  }

  /**
   * Asks the chain for one answer. Providers and models are tried in order; a
   * failure before anything was shown moves on to the next one. Nothing is
   * sent to a kind of provider (home PC / cloud) the user has not agreed to:
   * live, the app shows the consent screen; in the background such
   * providers are simply skipped.
   */
  private async generate(
    user: Principal,
    args: { history: { role: "user" | "assistant"; text: string }[]; today: string; now: string },
    settings: AssistantSettings,
    emit: (event: ChatEvent) => void,
    options: { conversationId: string; userMessageId: string; background: boolean; signal?: AbortSignal },
  ): Promise<Outcome> {
    const { config } = this.deps;
    const found = await this.chain.candidates({ allowCloud: settings.allowCloud, allowPaid: settings.allowPaid });
    const endpoints = options.background ? found.endpoints.filter((e) => settings.consent[e.which]) : found.endpoints;
    if (!endpoints.length) return { type: "unavailable", text: this.unavailable(found.blocked) };
    let ctx: { data: SyncData; today: string; now: string; newId: () => string } | null = null;
    const skipped = new Set<string>();
    let lastBlocked: Blocked[] = found.blocked;
    for (const endpoint of endpoints) {
      if (skipped.has(endpoint.provider)) continue;
      // The chain reached a kind of provider the user has not agreed to yet: ask first.
      if (!settings.consent[endpoint.which]) return { type: "consent", provider: endpoint.which };
      ctx ??= { data: await this.deps.loadData(user), today: args.today, now: args.now, newId: () => randomUUID() };
      const source = `${endpoint.provider} · ${endpoint.model}`;
      emit({ type: "start", conversationId: options.conversationId, provider: endpoint.which, source, userMessageId: options.userMessageId });
      let committed = false;
      let tokens = 0;
      let counted = 0;
      const client = chatClient(endpoint, config.timeoutMs, this.fetchFn);
      const chat: ChatFn = async (request) => {
        const reply = await client(request);
        const sent = request.messages.reduce((n, m) => n + (m.content?.length ?? 0), 0);
        tokens += reply.tokens || estimateTokens(sent + reply.content.length);
        counted += 1;
        return reply;
      };
      try {
        const result = await runAgent({
          chat,
          ctx,
          history: args.history,
          tools: config.tools === "json" ? "json" : (endpoint.tools ?? "auto"),
          signal: options.signal,
          events: {
            // Asked again in JSON mode: the app drops the text shown so far.
            onReset: () => emit({ type: "start", conversationId: options.conversationId, provider: endpoint.which, source, userMessageId: options.userMessageId }),
            onDelta: (text) => {
              committed = true;
              emit({ type: "delta", text });
            },
            onProposal: (proposal) => {
              committed = true;
              emit({ type: "proposal", proposal });
            },
          },
        });
        if (!result.text.trim() && !result.proposals.length) throw new ProviderError("empty answer", false);
        if (result.jsonMode && (endpoint.tools ?? "auto") === "auto" && config.tools !== "json") {
          this.chain.rememberJsonMode(endpoint);
          log("info", "assistant.json_mode", { provider: endpoint.provider, model: endpoint.model });
        }
        this.chain.report(endpoint, "ok", { tokens });
        const question = [...args.history].reverse().find((m) => m.role === "user")?.text ?? "";
        const chips = chipsAfter(intentOf(question, args.today), ctx, result.proposals);
        const message: ChatMessage = {
          id: randomUUID(),
          role: "assistant",
          text: result.text.trim(),
          at: this.now(),
          provider: endpoint.which,
          source,
          ...(result.proposals.length ? { proposals: result.proposals } : {}),
          ...(chips.length ? { chips } : {}),
        };
        return { type: "answer", message };
      } catch (error) {
        if (options.signal?.aborted) return { type: "aborted" };
        const limit = error instanceof ProviderError && error.limit;
        const network = error instanceof ProviderError && error.network;
        // A dead host or a missing key fails every model of that provider: skip it whole.
        const wholeProvider = network || (error instanceof ProviderError && /http 40[13]/.test(error.message));
        this.chain.report(endpoint, limit ? "limit" : "error", { wholeProvider, tokens: counted ? tokens : 0 });
        if (wholeProvider) skipped.add(endpoint.provider);
        log("warn", "assistant.provider_failed", { provider: endpoint.provider, model: endpoint.model, reason: error instanceof Error ? error.message.slice(0, 80) : "unknown" });
        lastBlocked = [endpoint.which === "local" && network ? "down" : "cooldown"];
        // Part of the answer is already on screen: do not mix two models in one reply.
        if (committed) return { type: "broken", text: UNAVAILABLE, provider: endpoint.which };
      }
    }
    const pcOnly = lastBlocked.includes("down") && !endpoints.some((e) => e.which === "cloud");
    return { type: "unavailable", text: pcOnly ? PC_OFF : endpoints.length > 1 || lastBlocked.includes("cooldown") ? BUSY : UNAVAILABLE };
  }

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }

  /** «что просрочено», «что на сегодня», «свободные окна завтра»: answered from the data directly. */
  private async answerLocally(user: Principal, input: ChatInput, emit: (event: ChatEvent) => void): Promise<boolean> {
    if (!this.deps.config.localAnswers) return false;
    const intent = intentOf(input.text, input.today);
    if (!intent.local) return false;
    const ctx = { data: await this.deps.loadData(user), today: input.today, now: input.now, newId: () => randomUUID() };
    const answer = localAnswer(intent, ctx);
    if (!answer) return false;
    const { text } = answer;
    const { store } = this.deps;
    const previous = input.conversationId ? await store.get(user.login, input.conversationId) : null;
    const conversationId = previous?.id ?? randomUUID();
    const userMessage: ChatMessage = { id: randomUUID(), role: "user", text: input.text, at: this.now() };
    emit({ type: "start", conversationId, provider: "app", source: APP_SOURCE, userMessageId: userMessage.id });
    emit({ type: "delta", text });
    const message: ChatMessage = {
      id: randomUUID(),
      role: "assistant",
      text,
      at: this.now(),
      provider: "app",
      source: APP_SOURCE,
      ...(answer.view ? { view: answer.view } : {}),
      ...(answer.chips?.length ? { chips: answer.chips } : {}),
    };
    const conv = await store.append(user.login, conversationId, [userMessage, message], titleFrom(input.text));
    log("info", "assistant.local_answer", { intent: intent.kind });
    emit({ type: "done", message, title: conv.title });
    return true;
  }

  /** One answer as a stream of events (NDJSON on the wire). */
  async chat(user: Principal, input: ChatInput, emit: (event: ChatEvent) => void, signal?: AbortSignal): Promise<void> {
    const { store } = this.deps;
    if (!this.enabled) return emit({ type: "error", message: UNAVAILABLE });
    // Simple questions are answered by the app: no model, no tokens, no consent, no rate limit.
    if (!input.retryOf && (await this.answerLocally(user, input, emit))) return;
    if (!this.limit.take(user.login)) return emit({ type: "error", message: "Слишком много вопросов подряд. Подождите немного и спросите снова." });
    const settings = await store.settings(user.login);
    // «Повторить»: the failed answer and its question are replaced by this attempt.
    if (input.conversationId && input.retryOf) await store.dropExchange(user.login, input.conversationId, input.retryOf);
    const previous = input.conversationId ? await store.get(user.login, input.conversationId) : null;
    const conversationId = previous?.id ?? randomUUID();
    const userMessage: ChatMessage = { id: randomUUID(), role: "user", text: input.text, at: this.now() };
    const history = [...historyOf(previous?.messages ?? []), { role: "user" as const, text: input.text }];

    const outcome = await this.generate(user, { history, today: input.today, now: input.now }, settings, emit, { conversationId, userMessageId: userMessage.id, background: false, signal });
    switch (outcome.type) {
      case "aborted":
        return;
      case "consent":
        // Nothing is stored: the app asks and sends the same question again.
        return emit({ type: "consent", provider: outcome.provider });
      case "answer": {
        const conv = await store.append(user.login, conversationId, [userMessage, outcome.message], titleFrom(input.text));
        return emit({ type: "done", message: outcome.message, title: conv.title });
      }
      default: {
        // Kept in the conversation so it can be repeated or queued («Отложить»).
        const retryable = outcome.type === "unavailable";
        const failed: ChatMessage = {
          id: randomUUID(),
          role: "assistant",
          text: outcome.text,
          at: this.now(),
          error: true,
          ...(outcome.type === "broken" ? { provider: outcome.provider } : {}),
          ...(retryable ? { retryable: true } : {}),
        };
        await store.append(user.login, conversationId, [userMessage, failed], titleFrom(input.text));
        return emit({ type: "error", message: failed.text, retryable, conversationId, userMessageId: userMessage.id, messageId: failed.id });
      }
    }
  }

  /* ---- «Отложить» ------------------------------------------------------ */

  /** Delay before the next background attempt: 5, 10, then every 15 minutes. */
  static backoff(attempts: number): number {
    return Math.min(15, 5 * 2 ** attempts) * 60_000;
  }

  enqueue(user: Principal, conversationId: string, messageId: string): Promise<QueuedRequest | null> {
    return this.deps.store.enqueue(user.login, conversationId, messageId, this.now() + Assistant.backoff(0), this.now());
  }

  /**
   * A question asked without network («Отложить» offline): stored as a
   * question with a placeholder answer and queued right away, so the
   * background worker answers it like any postponed one (answer in the bell).
   * `clientId` makes a repeated upload of the same question harmless.
   */
  async enqueueQuestion(user: Principal, input: { text: string; conversationId: string | null; clientId: string }): Promise<QueuedRequest | "known" | null> {
    const { store } = this.deps;
    const messageId = `offline-${input.clientId}`;
    const queued = (await store.queue(user.login)).find((q) => q.messageId === messageId);
    if (queued) return queued;
    const previous = input.conversationId ? await store.get(user.login, input.conversationId) : null;
    // Already uploaded and answered (the reply to the first upload was lost).
    if (previous?.messages.some((m) => m.id === `${messageId}-q`)) return "known";
    const conversationId = previous?.id ?? randomUUID();
    const now = this.now();
    const question: ChatMessage = { id: `${messageId}-q`, role: "user", text: input.text, at: now };
    const waiting: ChatMessage = { id: messageId, role: "assistant", text: "Вопрос задан без сети. Отвечу, как только получится.", at: now, error: true, retryable: true };
    await store.append(user.login, conversationId, [question, waiting], titleFrom(input.text));
    return store.enqueue(user.login, conversationId, messageId, now, now);
  }

  /**
   * One pass of the background worker: every due question is asked again
   * (consented providers only). An answer replaces the failed message and
   * lands in the bell; proposals in it still wait for «Применить».
   */
  async processQueue(): Promise<{ answered: number; retried: number; expired: number }> {
    const { store } = this.deps;
    const stats = { answered: 0, retried: 0, expired: 0 };
    if (!this.enabled) return stats;
    for (const login of await store.queuedLogins()) {
      const user = this.deps.principal?.(login) ?? null;
      for (const item of await store.queue(login)) {
        const now = this.now();
        if (item.nextAt > now) continue;
        if (!user || now - item.createdAt >= QUEUE_MAX_AGE_MS) {
          const gaveUp: ChatMessage = { id: item.messageId, role: "assistant", text: GAVE_UP, at: now, error: true, retryable: true };
          if (await store.resolveQueued(login, item.id, gaveUp, { text: "Не удалось получить ответ за сутки", at: now })) stats.expired += 1;
          continue;
        }
        const settings = await store.settings(login);
        const conv = await store.get(login, item.conversationId);
        if (!conv) {
          await store.cancelQueued(login, item.id);
          continue;
        }
        const index = conv.messages.findIndex((m) => m.id === item.messageId);
        const history = [...historyOf(conv.messages.slice(0, Math.max(0, index - 1))), { role: "user" as const, text: item.text }];
        const { today, time } = localNow(now);
        const outcome = await this.generate(user, { history, today, now: time }, settings, () => {}, { conversationId: conv.id, userMessageId: "", background: true });
        if (outcome.type === "answer") {
          if (await store.resolveQueued(login, item.id, outcome.message, { text: "Помощник ответил", at: now })) stats.answered += 1;
        } else {
          await store.reschedule(login, item.id, now + Assistant.backoff(item.attempts + 1));
          stats.retried += 1;
        }
      }
    }
    return stats;
  }

  setProposal(user: Principal, conversationId: string, proposalId: string, status: ProposalStatus, items?: ProposalItem[]) {
    return this.deps.store.setProposal(user.login, conversationId, proposalId, status, items);
  }
}

let singleton: Assistant | null = null;

/** Built from .env once per process. */
export function getAssistant(): Assistant {
  if (!singleton) {
    singleton = new Assistant({
      config: readAiConfig(),
      usage: new UsageBook(join(dataDir(), "assistant-usage.json")),
      store: new AssistantStore(join(dataDir(), "assistant")),
      loadData: (user) => dataFor(getStore(), user),
      principal: principalForLogin,
    });
  }
  return singleton;
}
