/**
 * The provider chain: models are tried in the configured order (home PC
 * first when it answers, then free cloud models, then paid ones). A model
 * that fails, hits a limit or times out is skipped for a cooldown; paid
 * providers can have a monthly token cap. All of them speak the same
 * OpenAI-compatible chat protocol (Ollama serves it under /v1).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { AiWhich, ProviderState } from "../../../src/lib/assistant/types.ts";
import { log } from "../log.ts";
import { KV_USAGE, readKv, writeKv } from "../db/records.ts";
import { storageFor, type SqliteStorage } from "../db/storage.ts";
import { DEFAULT_LOCAL_MODEL, hostOf, type AiConfig, type LocalType, type ProviderConfig, type ToolsMode } from "./config.ts";

export type Endpoint = {
  provider: string;
  which: AiWhich;
  baseUrl: string;
  apiKey: string | null;
  model: string;
  paid: boolean;
  /** JSON mode may send response_format (some servers reject json_object). */
  jsonFormat?: boolean;
  /** auto | native | json (see ToolsMode); json once the model was seen ignoring tools. */
  tools?: ToolsMode;
  /** max_tokens; 0/undefined = not sent. */
  maxTokens?: number;
  reasoningEffort?: string | null;
};

/** Why nothing could be asked (for a clear message). */
export type Blocked = "down" | "cloud_not_allowed" | "paid_not_allowed" | "cooldown" | "cap";

type FetchFn = typeof fetch;

export const HEALTH_TTL_MS = 60_000;
const HEALTH_TIMEOUT_MS = 2_500;

/** Tokens per provider for the current month, kept in a small JSON file. */
export class UsageBook {
  private month = "";
  private tokens: Record<string, number> = {};
  private readonly file: string | null;
  private readonly now: () => number;
  private readonly sql: SqliteStorage | null = null;

  /** `dataDir`: keep the counters in that folder's storage (pora.db when active); otherwise in `file`. */
  constructor(file: string | null, now: () => number = Date.now, options: { dataDir?: string } = {}) {
    this.file = file;
    this.now = now;
    if (options.dataDir) {
      const storage = storageFor(options.dataDir);
      if (storage.mode === "sqlite") this.sql = storage;
    }
    if (this.sql) {
      const saved = readKv(this.sql.db, KV_USAGE) as { month?: string; tokens?: Record<string, number> } | null;
      this.month = saved?.month ?? "";
      this.tokens = saved?.tokens ?? {};
      return;
    }
    if (!file) return;
    try {
      const saved = JSON.parse(readFileSync(file, "utf8")) as { month?: string; tokens?: Record<string, number> };
      this.month = saved.month ?? "";
      this.tokens = saved.tokens ?? {};
    } catch {
      // first run
    }
  }

  private roll(): void {
    const month = new Date(this.now()).toISOString().slice(0, 7);
    if (month !== this.month) {
      this.month = month;
      this.tokens = {};
    }
  }

  used(name: string): number {
    this.roll();
    return this.tokens[name] ?? 0;
  }

  add(name: string, count: number): void {
    if (count <= 0) return;
    this.roll();
    this.tokens[name] = (this.tokens[name] ?? 0) + Math.round(count);
    if (this.sql) {
      try {
        writeKv(this.sql.db, KV_USAGE, { month: this.month, tokens: this.tokens });
      } catch {
        // counting is best effort
      }
      return;
    }
    if (!this.file) return;
    try {
      mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
      writeFileSync(this.file, JSON.stringify({ month: this.month, tokens: this.tokens }), { mode: 0o600 });
    } catch {
      // counting is best effort
    }
  }
}

export type LocalProbe = { up: boolean; type: Exclude<LocalType, "auto"> | null; models: string[] };

/** Per-model endpoints: «https://host/{model}/v1» → «https://host/<model>/v1». */
export function modelUrl(baseUrl: string, model: string): string {
  return baseUrl.replaceAll("{model}", encodeURIComponent(model));
}

/**
 * Some OpenAI-compatible services report errors as HTTP 200 with a JSON body
 * {"code": 402, "msg": "..."}: turn that into the usual status code.
 */
export function embeddedStatus(body: unknown): number | null {
  const code = (body as { code?: unknown } | null)?.code;
  const n = typeof code === "string" ? Number(code) : code;
  return typeof n === "number" && Number.isFinite(n) && n !== 200 && n !== 0 ? n : null;
}

export type ProviderInfo = {
  name: string;
  kind: AiWhich;
  host: string;
  models: string[];
  paid: boolean;
  state: ProviderState;
  /** Skipped until (ms) after a failure / limit. */
  until: number | null;
  usedTokens: number;
  monthlyTokens: number;
  lastModel: string | null;
};

export class ProviderChain {
  readonly config: AiConfig;
  readonly usage: UsageBook;
  private readonly fetchFn: FetchFn;
  private readonly now: () => number;
  private health = new Map<string, LocalProbe & { at: number }>();
  private cooldown = new Map<string, number>();
  private state = new Map<string, { state: ProviderState; model: string | null }>();

  constructor(config: AiConfig, fetchFn: FetchFn = fetch, now: () => number = Date.now, usage: UsageBook = new UsageBook(null, now)) {
    this.config = config;
    this.fetchFn = fetchFn;
    this.now = now;
    this.usage = usage;
  }

  get hasLocal(): boolean {
    return this.config.providers.some((p) => p.kind === "local");
  }

  /** Is a home-network model reachable? Cached for a minute. */
  async localUp(provider: ProviderConfig, force = false): Promise<boolean> {
    return (await this.probeLocal(provider, force)).up;
  }

  /**
   * Probes the home PC: Ollama answers GET /api/tags, LM Studio (and other
   * OpenAI-compatible servers) GET /v1/models. «auto» tries both. Also
   * learns which models are there (used when AI_LOCAL_MODEL is empty).
   */
  async probeLocal(provider: ProviderConfig, force = false): Promise<LocalProbe> {
    if (!provider.localRoot) return { up: true, type: null, models: [] };
    const now = this.now();
    const cached = this.health.get(provider.name);
    if (!force && cached && now - cached.at < HEALTH_TTL_MS) return cached;
    const order: Exclude<LocalType, "auto">[] = provider.localType === "lmstudio" ? ["lmstudio"] : provider.localType === "ollama" ? ["ollama"] : ["ollama", "lmstudio"];
    let probe: LocalProbe = { up: false, type: null, models: [] };
    for (const type of order) {
      try {
        const res = await this.fetchFn(`${provider.localRoot}${type === "ollama" ? "/api/tags" : "/v1/models"}`, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
        if (!res.ok) continue;
        const body = (await res.json().catch(() => ({}))) as { models?: { name?: string; model?: string }[]; data?: { id?: string }[] };
        const models = type === "ollama" ? (body.models ?? []).map((m) => m.name ?? m.model ?? "") : (body.data ?? []).map((m) => m.id ?? "");
        probe = { up: true, type, models: models.filter((m) => m && !/embed/i.test(m)) };
        break;
      } catch {
        // try the next kind, or the PC is off
      }
    }
    this.health.set(provider.name, { ...probe, at: now });
    if (!probe.up) this.state.set(provider.name, { state: "down", model: null });
    else if (this.state.get(provider.name)?.state === "down") this.state.delete(provider.name);
    return probe;
  }

  /** Models to ask on the home PC: the configured ones, else what it has. */
  private localModels(provider: ProviderConfig, probe: LocalProbe): string[] {
    if (provider.models.length) return provider.models;
    if (probe.type === "ollama" && (probe.models.includes(DEFAULT_LOCAL_MODEL) || !probe.models.length)) return [DEFAULT_LOCAL_MODEL];
    return probe.models.slice(0, 1);
  }

  /** Models seen rejecting or ignoring `tools` (auto mode): asked in JSON mode from now on. */
  private jsonOnly = new Set<string>();

  rememberJsonMode(endpoint: Endpoint): void {
    this.jsonOnly.add(`${endpoint.provider}|${endpoint.model}`);
  }

  private cooled(key: string): boolean {
    const until = this.cooldown.get(key);
    if (!until) return false;
    if (until > this.now()) return true;
    this.cooldown.delete(key);
    return false;
  }

  /** Endpoints to try, in order, for one answer. */
  async candidates(options: { allowCloud: boolean; allowPaid: boolean }): Promise<{ endpoints: Endpoint[]; blocked: Blocked[] }> {
    const endpoints: Endpoint[] = [];
    const blocked = new Set<Blocked>();
    for (const p of this.config.providers) {
      let models = p.models;
      let jsonFormat = p.jsonFormat;
      if (p.kind === "local") {
        const probe = await this.probeLocal(p);
        if (!probe.up) {
          blocked.add("down");
          continue;
        }
        models = this.localModels(p, probe);
        if (probe.type === "lmstudio") jsonFormat = false;
      } else if (this.hasLocal && !options.allowCloud) {
        blocked.add("cloud_not_allowed");
        continue;
      }
      if (p.paid && !options.allowPaid) {
        blocked.add("paid_not_allowed");
        continue;
      }
      if (p.monthlyTokens && this.usage.used(p.name) >= p.monthlyTokens) {
        this.state.set(p.name, { state: "cap", model: null });
        blocked.add("cap");
        continue;
      }
      if (this.cooled(p.name)) {
        blocked.add("cooldown");
        continue;
      }
      for (const model of models) {
        if (this.cooled(`${p.name}|${model}`)) {
          blocked.add("cooldown");
          continue;
        }
        const tools = p.tools === "auto" && this.jsonOnly.has(`${p.name}|${model}`) ? "json" : p.tools;
        endpoints.push({ provider: p.name, which: p.kind, baseUrl: modelUrl(p.baseUrl, model), apiKey: p.apiKey, model, paid: p.paid, jsonFormat, tools, maxTokens: p.maxTokens, reasoningEffort: p.reasoningEffort });
      }
    }
    return { endpoints, blocked: [...blocked] };
  }

  /** Outcome of one attempt: success clears the cooldown, a failure starts one. */
  report(endpoint: Endpoint, outcome: "ok" | "limit" | "error", options: { tokens?: number; wholeProvider?: boolean } = {}): void {
    const key = `${endpoint.provider}|${endpoint.model}`;
    if (outcome === "ok") {
      this.cooldown.delete(key);
      this.state.set(endpoint.provider, { state: "ok", model: endpoint.model });
      this.usage.add(endpoint.provider, options.tokens ?? 0);
      return;
    }
    const until = this.now() + this.config.cooldownMs;
    this.cooldown.set(options.wholeProvider ? endpoint.provider : key, until);
    this.state.set(endpoint.provider, { state: outcome, model: endpoint.model });
    if (endpoint.which === "local" && options.wholeProvider) this.health.set(endpoint.provider, { at: this.now(), up: false, type: null, models: [] });
  }

  info(): ProviderInfo[] {
    return this.config.providers.map((p) => {
      const s = this.state.get(p.name);
      const until = Math.max(this.cooldown.get(p.name) ?? 0, ...p.models.map((m) => this.cooldown.get(`${p.name}|${m}`) ?? 0));
      return {
        name: p.name,
        kind: p.kind,
        host: hostOf(p.baseUrl),
        models: p.kind === "local" ? this.localModels(p, this.health.get(p.name) ?? { up: false, type: null, models: [] }) : p.models,
        paid: p.paid,
        state: s?.state ?? "unknown",
        until: until > this.now() ? until : null,
        usedTokens: this.usage.used(p.name),
        monthlyTokens: p.monthlyTokens,
        lastModel: s?.model ?? null,
      };
    });
  }

  /** «Проверить»: fresh check of every provider (no question is sent). */
  async check(): Promise<Record<string, boolean>> {
    const out: Record<string, boolean> = {};
    for (const p of this.config.providers) {
      if (p.kind === "local") {
        out[p.name] = await this.localUp(p, true);
        continue;
      }
      try {
        const url = p.checkUrl ?? `${modelUrl(p.baseUrl, p.models[0] ?? "")}/models`;
        const res = await this.fetchFn(url, { headers: p.apiKey ? { authorization: `Bearer ${p.apiKey}` } : {}, signal: AbortSignal.timeout(6000) });
        const body = res.ok ? await res.json().catch(() => null) : null;
        const status = embeddedStatus(body) ?? res.status;
        // The key works and the host answers: fine even if it has no model list (404).
        const ok = status < 300 || (!p.checkUrl && (status === 404 || status === 405));
        out[p.name] = ok;
        if (status === 401 || status === 403) this.state.set(p.name, { state: "error", model: null });
        else if (status === 402 || status === 429) this.state.set(p.name, { state: "limit", model: null });
        else if (ok && (this.state.get(p.name)?.state ?? "unknown") === "unknown") this.state.set(p.name, { state: "ok", model: null });
      } catch {
        out[p.name] = false;
      }
    }
    return out;
  }
}

/* ---- OpenAI-compatible chat ------------------------------------------- */

export type WireMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: WireToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export type WireToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };

export type ToolSpec = { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } };

export type ChatRequest = {
  messages: WireMessage[];
  /** null = JSON mode (no function calling). */
  tools: ToolSpec[] | null;
  onDelta?: (text: string) => void;
  signal?: AbortSignal;
};

export type ChatReply = { content: string; toolCalls: WireToolCall[]; tokens: number; finish?: string };

export type ChatFn = (request: ChatRequest) => Promise<ChatReply>;

/** The endpoint rejected `tools` (model without function calling): retry in JSON mode. */
export class ToolsUnsupportedError extends Error {}
/** Could not reach the endpoint / it failed. The message is safe to log (no key, no body). */
export class ProviderError extends Error {
  /** Could not connect / timed out (the whole provider is likely down). */
  readonly network: boolean;
  /** Rate limit, quota or credits: try the next one. */
  readonly limit: boolean;
  constructor(message: string, network: boolean, limit = false) {
    super(message);
    this.network = network;
    this.limit = limit;
  }
}

/** Limit / quota answers: 429, 402, or 4xx bodies that talk about limits and credits. */
export function isLimit(status: number, body: string): boolean {
  if (status === 429 || status === 402) return true;
  return status >= 400 && status < 500 && /rate.?limit|quota|credit|insufficient|exceeded|too many/i.test(body);
}

/** Streams a chat completion; collects text deltas and tool calls. */
/** Endpoints that rejected max_tokens / reasoning_effort: asked without them from now on. */
const plainEndpoints = new Set<string>();
const PARAM_WORDS = /max_tokens|max_completion_tokens|reasoning_effort|unsupported (parameter|value)|unrecognized|unknown (field|param|argument)|additional properties|not permitted/i;

/** The endpoint refused one of the optional parameters (max_tokens, reasoning_effort). */
class ParamsRejectedError extends Error {}

export function chatClient(endpoint: Endpoint, timeoutMs: number, fetchFn: FetchFn = fetch): ChatFn {
  const key = `${endpoint.provider}|${endpoint.model}`;
  const attempt = async ({ messages, tools, onDelta, signal }: ChatRequest, extras: boolean): Promise<ChatReply> => {
    const timeout = AbortSignal.timeout(timeoutMs);
    const merged = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let res: Response;
    try {
      res = await fetchFn(`${endpoint.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(endpoint.apiKey ? { authorization: `Bearer ${endpoint.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: endpoint.model,
          messages,
          stream: true,
          // Some cloud models only accept their own default temperature.
          ...(endpoint.which === "local" ? { temperature: 0.2 } : {}),
          ...(extras && endpoint.maxTokens ? { max_tokens: endpoint.maxTokens } : {}),
          ...(extras && endpoint.reasoningEffort ? { reasoning_effort: endpoint.reasoningEffort } : {}),
          ...(tools ? { tools, tool_choice: "auto" } : endpoint.jsonFormat === false ? {} : { response_format: { type: "json_object" } }),
        }),
        signal: merged,
      });
    } catch (error) {
      throw new ProviderError(timeout.aborted ? "timeout" : `network: ${(error as Error).name}`, true);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      if (isLimit(res.status, text)) throw new ProviderError(`limit ${res.status}`, false, true);
      if (extras && (res.status === 400 || res.status === 422) && PARAM_WORDS.test(text)) throw new ParamsRejectedError();
      if (tools && res.status >= 400 && res.status < 500 && /tool|function/i.test(text)) throw new ToolsUnsupportedError("tools unsupported");
      throw new ProviderError(`http ${res.status}`, false);
    }
    if (!res.body) throw new ProviderError("empty body", false);
    // Not a stream: an error reported with HTTP 200, or a plain (non-streamed) completion.
    if (/application\/json/i.test(res.headers.get("content-type") ?? "")) {
      const text = await res.text();
      const status = embeddedStatus(tryJson(text));
      if (extras && (status === 400 || status === 422) && PARAM_WORDS.test(text)) throw new ParamsRejectedError();
      return plainReply(text, Boolean(tools), onDelta);
    }
    try {
      return await readStream(res.body, onDelta);
    } catch (error) {
      if (error instanceof ProviderError || signal?.aborted) throw error;
      throw new ProviderError(timeout.aborted ? "timeout" : "stream broken", true);
    }
  };
  return async (request) => {
    const extras = Boolean(endpoint.maxTokens || endpoint.reasoningEffort) && !plainEndpoints.has(key);
    let reply: ChatReply;
    try {
      reply = await attempt(request, extras);
    } catch (error) {
      if (!(error instanceof ParamsRejectedError)) throw error;
      plainEndpoints.add(key);
      log("info", "assistant.params_rejected", { provider: endpoint.provider, model: endpoint.model });
      return attempt(request, false);
    }
    // The cap ate the whole answer (a reasoning model thinks inside it): once more without the cap.
    if (extras && reply.finish === "length" && !reply.content.trim() && !reply.toolCalls.length) {
      log("info", "assistant.cap_too_small", { provider: endpoint.provider, model: endpoint.model, cap: endpoint.maxTokens ?? 0 });
      const again = await attempt(request, false);
      return { ...again, tokens: again.tokens + reply.tokens };
    }
    return reply;
  };
}

function tryJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** A JSON (non-streamed) answer: {"code":…,"msg":…} errors or a regular completion. */
function plainReply(text: string, tools: boolean, onDelta?: (text: string) => void): ChatReply {
  let body: { choices?: { message?: { content?: unknown; tool_calls?: WireToolCall[] } }[]; usage?: { total_tokens?: number }; msg?: string; error?: unknown };
  try {
    body = JSON.parse(text);
  } catch {
    throw new ProviderError("bad json", false);
  }
  const status = embeddedStatus(body);
  if (status !== null) {
    const msg = String(body.msg ?? "");
    if (isLimit(status, msg)) throw new ProviderError(`limit ${status}`, false, true);
    if (tools && status >= 400 && status < 500 && /tool|function/i.test(msg)) throw new ToolsUnsupportedError("tools unsupported");
    throw new ProviderError(`http ${status}`, false);
  }
  const message = body.choices?.[0]?.message;
  if (!message) throw new ProviderError("no answer", false);
  const content = textOf(message.content);
  if (content) onDelta?.(content);
  return { content, tokens: body.usage?.total_tokens ?? 0, toolCalls: (message.tool_calls ?? []).map((c, i) => ({ id: c.id || `call_${i}`, type: "function" as const, function: { name: c.function.name, arguments: c.function.arguments || "{}" } })) };
}

/** Parses the SSE stream («data: {...}» lines) of a chat completion. */
type StreamCall = { index?: number; id?: string; type?: string; function?: { name?: string; arguments?: string | Record<string, unknown> } };
type StreamChunk = {
  usage?: { total_tokens?: number };
  error?: { message?: string; code?: number | string };
  msg?: string;
  choices?: {
    finish_reason?: string | null;
    delta?: { content?: unknown; tool_calls?: StreamCall[]; function_call?: { name?: string; arguments?: string } };
    message?: { content?: unknown; tool_calls?: StreamCall[] };
    text?: string;
  }[];
};

/** Text of `content`: a string or an array of parts ({type:"text", text}). */
function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => (typeof part === "string" ? part : typeof (part as { text?: unknown })?.text === "string" ? (part as { text: string }).text : "")).join("");
  return "";
}

/**
 * JSON objects in a piece of stream text that did not parse as one: several
 * objects glued together («{…}data: {…}»), an object spread over several
 * lines, or raw line breaks inside strings. Anything between objects is skipped.
 */
/**
 * Makes control characters JSON-safe: inside strings they become \u00XX,
 * outside strings they are dropped. Some services pass a model's special
 * tokens (e.g. an «escape» token) through as raw control bytes, which makes
 * the whole event invalid JSON — and its text, often the start of the
 * answer, used to be lost.
 */
export function escapeControls(text: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      out += code < 0x20 ? `\\u${code.toString(16).padStart(4, "0")}` : ch;
      continue;
    }
    if (ch === '"') inString = true;
    if (code < 0x20 && ch !== "\n" && ch !== "\t" && ch !== "\r") continue;
    out += ch;
  }
  return out;
}

/** Control characters that are not text (special tokens leaked as bytes). */
// eslint-disable-next-line no-control-regex -- matching control bytes is the point
const JUNK_CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\ufeff]/g;

export function scanObjects(text: string): unknown[] {
  const out: unknown[] = [];
  let depth = 0;
  let inString = false;
  let escaped = false;
  let current = "";
  for (const ch of text) {
    if (depth === 0) {
      if (ch === "{") {
        depth = 1;
        current = ch;
      }
      continue;
    }
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      const code = ch.charCodeAt(0);
      current += ch === "\n" ? "\\n" : ch === "\r" ? "" : code < 0x20 ? `\\u${code.toString(16).padStart(4, "0")}` : ch;
      continue;
    }
    current += ch;
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) {
      try {
        out.push(JSON.parse(current));
      } catch {
        // not JSON after all
      }
      current = "";
    }
  }
  return out;
}

/**
 * Parses an OpenAI-style SSE stream: `data: {chunk}` events with text deltas,
 * tool-call fragments (`index`, `id`, name and argument pieces), usage, and
 * errors (`error` or a {"code","msg"} body). Tolerates what some services
 * send instead: no blank lines between events, an event spread over several
 * lines, glued events, bare JSON lines, content as an array of parts, a
 * whole `message` in a chunk, tool calls without `index`.
 */
export async function readStream(body: ReadableStream<Uint8Array>, onDelta?: (text: string) => void): Promise<ChatReply> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let usage = 0;
  let streamError = "";
  let unparsed = 0;
  let recovered = 0;
  let finish: string | undefined;
  let debugLines = process.env.AI_DEBUG_STREAM === "1" ? 8 : 0;
  let pending: string | null = null;
  const calls: { id: string; name: string; args: string }[] = [];

  const addCall = (call: StreamCall, position: number) => {
    let index = call.index;
    if (typeof index !== "number") {
      // No index: a new id starts a new call, otherwise the fragment continues the last one.
      const last = calls[calls.length - 1];
      index = !last || (call.id && last.id && last.id !== call.id) || position > 0 ? calls.length : calls.length - 1;
    }
    const slot = (calls[index] ??= { id: "", name: "", args: "" });
    if (call.id) slot.id = call.id;
    if (call.function?.name && !slot.name.endsWith(call.function.name)) slot.name += call.function.name;
    const args = call.function?.arguments;
    if (typeof args === "string") slot.args += args;
    else if (args && typeof args === "object") slot.args = JSON.stringify(args);
  };

  const onChunk = (raw: unknown) => {
    if (!raw || typeof raw !== "object") return;
    const chunk = raw as StreamChunk;
    if (chunk.error) streamError = `${chunk.error.code ?? ""} ${chunk.error.message ?? ""}`;
    const embedded = embeddedStatus(chunk);
    if (embedded !== null) streamError = `${embedded} ${chunk.msg ?? ""}`;
    if (typeof chunk.usage?.total_tokens === "number") usage = chunk.usage.total_tokens;
    const choice = chunk.choices?.[0];
    if (!choice) return;
    if (typeof choice.finish_reason === "string") finish = choice.finish_reason;
    const delta = choice.delta;
    // A whole message (some services end the stream with it): only if nothing came as deltas.
    const whole = !delta && choice.message ? textOf(choice.message.content) : "";
    const text = (delta ? textOf(delta.content) || (typeof choice.text === "string" ? choice.text : "") : whole && !content ? whole : (choice.text ?? "")).replace(JUNK_CONTROLS, "");
    if (text) {
      content += text;
      onDelta?.(text);
    }
    (delta?.tool_calls ?? []).forEach(addCall);
    if (!delta && choice.message?.tool_calls && !calls.length) choice.message.tool_calls.forEach((call, i) => addCall({ ...call, index: i }, i));
    if (delta?.function_call) addCall({ index: 0, function: delta.function_call }, 0);
  };

  const tryParse = (payload: string): boolean => {
    for (const candidate of [payload, escapeControls(payload)]) {
      try {
        const parsed = JSON.parse(candidate);
        if (candidate !== payload) recovered++;
        onChunk(parsed);
        return true;
      } catch {
        // try the next form
      }
    }
    return false;
  };
  const flushPending = () => {
    if (pending === null) return;
    const found = scanObjects(pending);
    if (!found.length && pending.trim()) unparsed++;
    else recovered += found.length;
    found.forEach(onChunk);
    pending = null;
  };
  const handle = (line: string) => {
    const text = line.replace(/\r$/, "").replace(/^\ufeff/, "");
    if (!text.trim()) return flushPending();
    if (text.startsWith("data:")) {
      flushPending();
      const payload = text.slice(5).trim();
      if (!payload || payload === "[DONE]") return;
      if (!tryParse(payload)) pending = payload;
      return;
    }
    if (pending !== null) {
      // The event continues on this line (or a broken one).
      pending += `\n${text}`;
      if (tryParse(pending)) pending = null;
      return;
    }
    // A bare JSON line: an error body sent without the SSE framing.
    if (text.trimStart().startsWith("{") && !tryParse(text.trim())) pending = text.trim();
    // event:, id:, retry:, «: comment» lines carry nothing we need.
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      if (debugLines > 0) {
        debugLines--;
        // AI_DEBUG_STREAM=1: the first raw lines, escaped (they contain the answer text).
        log("info", "assistant.stream_debug", { line: JSON.stringify(buffer.slice(0, Math.min(newline, 400))) });
      }
      handle(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
    }
  }
  buffer += decoder.decode();
  if (buffer) handle(buffer);
  flushPending();
  if (unparsed) log("warn", "assistant.stream_unparsed", { events: unparsed });
  else if (recovered) log("info", "assistant.stream_repaired", { events: recovered });
  if (streamError && !content) {
    if (/^\s*40[13]\b/.test(streamError)) throw new ProviderError(`http ${streamError.trim().slice(0, 3)}`, false);
    throw new ProviderError("stream error", false, /rate.?limit|quota|credit|insufficient|exceeded|too many|429|402/i.test(streamError));
  }
  return {
    content,
    tokens: usage,
    ...(finish ? { finish } : {}),
    toolCalls: calls.filter((call) => call?.name).map((call, i) => ({ id: call.id || `call_${i}`, type: "function" as const, function: { name: call.name, arguments: call.args || "{}" } })),
  };
}
