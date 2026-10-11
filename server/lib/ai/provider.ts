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
import { DEFAULT_LOCAL_MODEL, hostOf, type AiConfig, type LocalType, type ProviderConfig } from "./config.ts";

export type Endpoint = {
  provider: string;
  which: AiWhich;
  baseUrl: string;
  apiKey: string | null;
  model: string;
  paid: boolean;
  /** JSON mode may send response_format (some servers reject json_object). */
  jsonFormat?: boolean;
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

  constructor(file: string | null, now: () => number = Date.now) {
    this.file = file;
    this.now = now;
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
        endpoints.push({ provider: p.name, which: p.kind, baseUrl: modelUrl(p.baseUrl, model), apiKey: p.apiKey, model, paid: p.paid, jsonFormat });
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

export type ChatReply = { content: string; toolCalls: WireToolCall[]; tokens: number };

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
export function chatClient(endpoint: Endpoint, timeoutMs: number, fetchFn: FetchFn = fetch): ChatFn {
  return async ({ messages, tools, onDelta, signal }) => {
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
      if (tools && res.status >= 400 && res.status < 500 && /tool|function/i.test(text)) throw new ToolsUnsupportedError("tools unsupported");
      throw new ProviderError(`http ${res.status}`, false);
    }
    if (!res.body) throw new ProviderError("empty body", false);
    // Not a stream: an error reported with HTTP 200, or a plain (non-streamed) completion.
    if (/application\/json/i.test(res.headers.get("content-type") ?? "")) return plainReply(await res.text(), Boolean(tools), onDelta);
    try {
      return await readStream(res.body, onDelta);
    } catch (error) {
      if (error instanceof ProviderError || signal?.aborted) throw error;
      throw new ProviderError(timeout.aborted ? "timeout" : "stream broken", true);
    }
  };
}

/** A JSON (non-streamed) answer: {"code":…,"msg":…} errors or a regular completion. */
function plainReply(text: string, tools: boolean, onDelta?: (text: string) => void): ChatReply {
  let body: { choices?: { message?: { content?: string | null; tool_calls?: WireToolCall[] } }[]; usage?: { total_tokens?: number }; msg?: string; error?: unknown };
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
  const content = message.content ?? "";
  if (content) onDelta?.(content);
  return { content, tokens: body.usage?.total_tokens ?? 0, toolCalls: (message.tool_calls ?? []).map((c, i) => ({ id: c.id || `call_${i}`, type: "function" as const, function: { name: c.function.name, arguments: c.function.arguments || "{}" } })) };
}

/** Parses the SSE stream («data: {...}» lines) of a chat completion. */
export async function readStream(body: ReadableStream<Uint8Array>, onDelta?: (text: string) => void): Promise<ChatReply> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let usage = 0;
  let streamError = "";
  const calls: { id: string; name: string; args: string }[] = [];
  const handle = (line: string) => {
    const trimmed = line.trim();
    // A bare JSON line is an error body sent without the SSE framing.
    if (!trimmed.startsWith("data:") && !trimmed.startsWith("{")) return;
    const payload = trimmed.startsWith("data:") ? trimmed.slice(5).trim() : trimmed;
    if (!payload || payload === "[DONE]") return;
    let chunk: { usage?: { total_tokens?: number }; error?: { message?: string; code?: number | string }; choices?: { delta?: { content?: string | null; tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[] }; message?: { content?: string } }[] };
    try {
      chunk = JSON.parse(payload);
    } catch {
      return;
    }
    if (chunk.error) streamError = `${chunk.error.code ?? ""} ${chunk.error.message ?? ""}`;
    const embedded = embeddedStatus(chunk);
    if (embedded !== null) streamError = `${embedded} ${(chunk as { msg?: string }).msg ?? ""}`;
    if (typeof chunk.usage?.total_tokens === "number") usage = chunk.usage.total_tokens;
    const choice = chunk.choices?.[0];
    const delta = choice?.delta;
    const text = delta?.content ?? choice?.message?.content ?? "";
    if (text) {
      content += text;
      onDelta?.(text);
    }
    for (const call of delta?.tool_calls ?? []) {
      const index = call.index ?? calls.length;
      const slot = (calls[index] ??= { id: "", name: "", args: "" });
      if (call.id) slot.id = call.id;
      if (call.function?.name) slot.name += call.function.name;
      if (call.function?.arguments) slot.args += call.function.arguments;
    }
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      handle(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
    }
  }
  if (buffer) handle(buffer);
  if (streamError && !content) {
    if (/^\s*40[13]\b/.test(streamError)) throw new ProviderError(`http ${streamError.trim().slice(0, 3)}`, false);
    throw new ProviderError("stream error", false, /rate.?limit|quota|credit|insufficient|exceeded|too many|429|402/i.test(streamError));
  }
  return {
    content,
    tokens: usage,
    toolCalls: calls.filter(Boolean).map((call, i) => ({ id: call.id || `call_${i}`, type: "function" as const, function: { name: call.name, arguments: call.args || "{}" } })),
  };
}
