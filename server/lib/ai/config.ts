/**
 * «Помощник»: which models to ask, from .env (server only; keys never leave it).
 *
 * Chain (recommended):
 *   AI_PROVIDERS=local,free,paid          order in which providers are tried
 *   local:  the home PC — AI_LOCAL_URL, AI_LOCAL_MODEL, AI_LOCAL_TYPE
 *           (ollama | lmstudio | auto, default auto: probes /api/tags, then /v1/models).
 *           AI_OLLAMA_URL / AI_OLLAMA_MODEL still work as aliases.
 *   any other NAME:  AI_<NAME>_BASE_URL (may contain {model} for per-model URLs),
 *                    AI_<NAME>_API_KEY, AI_<NAME>_MODEL (comma-separated: tried in order),
 *                    AI_<NAME>_PAID=1, AI_<NAME>_MONTHLY_TOKENS=…,
 *                    AI_<NAME>_CHECK_URL (for «Проверить связь», default <base>/models),
 *                    AI_<NAME>_JSON_FORMAT=0 (no response_format in JSON mode),
 *                    AI_<NAME>_KIND=local (+ AI_<NAME>_TYPE) makes it a home-network model too.
 *
 * Simple setups (no AI_PROVIDERS):
 *   AI_PROVIDER = off | auto | openai | ollama
 *     default: auto when any AI_* (or the old XAI_API_KEY) is set, otherwise off.
 *   auto:   the home PC (AI_LOCAL_URL/AI_LOCAL_MODEL) first (AI_PREFER=cloud swaps), then
 *           the cloud API AI_BASE_URL/AI_API_KEY/AI_MODEL.
 *   openai: only the cloud API; ollama: only the local model (AI_BASE_URL for short).
 *   XAI_API_KEY without AI_*: the cloud API at api.x.ai (as in 1.5 and before).
 */
import type { AiWhich } from "../../../src/lib/assistant/types.ts";

export type AiMode = "off" | "auto" | "openai" | "ollama" | "chain";

/** Which server runs on the home PC (both speak the OpenAI-compatible API under /v1). */
export type LocalType = "ollama" | "lmstudio" | "auto";

export type ProviderConfig = {
  /** Short name from AI_PROVIDERS («local», «free», …). */
  name: string;
  kind: AiWhich;
  /** OpenAI-compatible base (…/v1); «{model}» is replaced per model. */
  baseUrl: string;
  /** Local only: server root (health: /api/tags or /v1/models). */
  localRoot: string | null;
  localType: LocalType | null;
  /** «Проверить связь» for cloud providers; null = <base>/models. */
  checkUrl: string | null;
  /** JSON mode may send response_format: {type: "json_object"}. */
  jsonFormat: boolean;
  apiKey: string | null;
  /** Tried in order. */
  models: string[];
  paid: boolean;
  /** 0 = no cap. */
  monthlyTokens: number;
};

export type AiConfig = {
  mode: AiMode;
  providers: ProviderConfig[];
  /** One model request (a local model on an 8 GB card can be slow). */
  timeoutMs: number;
  /** Requests per user per hour; 0 = no limit. */
  rateLimit: number;
  /** "json": never send `tools` (models without function calling). */
  tools: "auto" | "json";
  /** A failed provider/model is skipped for this long. */
  cooldownMs: number;
};

type Env = Record<string, string | undefined>;

export const DEFAULT_LOCAL_MODEL = "qwen2.5:7b-instruct";
const LEGACY_URL = "https://api.x.ai/v1";
const LEGACY_MODEL = "grok-4.5";

function str(env: Env, name: string): string {
  return (env[name] ?? "").trim();
}

function int(env: Env, name: string, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(str(env, name), 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function flag(env: Env, name: string): boolean {
  return /^(1|true|yes|да)$/i.test(str(env, name));
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

function models(raw: string, fallback = ""): string[] {
  const list = raw
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  return list.length ? list : fallback ? [fallback] : [];
}

function localType(raw: string): LocalType {
  const t = raw.toLowerCase().replace(/[^a-z]/g, "");
  return t === "ollama" || t === "lmstudio" ? t : "auto";
}

/**
 * Home PC → OpenAI-compatible base; accepts a URL with or without /v1.
 * Without a model: an Ollama PC gets DEFAULT_LOCAL_MODEL; otherwise the
 * model the server reports is used (see ProviderChain.probeLocal).
 */
function localProvider(name: string, url: string, model: string, type: LocalType): ProviderConfig {
  const root = trimSlash(url).replace(/\/v1$/, "");
  return { name, kind: "local", baseUrl: `${root}/v1`, localRoot: root, localType: type, checkUrl: null, jsonFormat: type !== "lmstudio", apiKey: null, models: models(model, type === "ollama" ? DEFAULT_LOCAL_MODEL : ""), paid: false, monthlyTokens: 0 };
}

/** AI_LOCAL_* with the older AI_OLLAMA_* names as aliases. */
function localFromEnv(env: Env, name: string, extra: { url?: string; model?: string; type?: string } = {}): ProviderConfig | null {
  const url = extra.url || str(env, "AI_LOCAL_URL") || str(env, "AI_OLLAMA_URL");
  if (!url) return null;
  const model = extra.model || str(env, "AI_LOCAL_MODEL") || str(env, "AI_OLLAMA_MODEL");
  const type = extra.type || str(env, "AI_LOCAL_TYPE") || (!str(env, "AI_LOCAL_URL") && str(env, "AI_OLLAMA_URL") ? "ollama" : "");
  return localProvider(name, url, model, localType(type));
}

export function envKey(name: string): string {
  return name.toUpperCase().replace(/[^A-Z0-9]/g, "_");
}

function chainFrom(env: Env, names: string[]): ProviderConfig[] {
  const out: ProviderConfig[] = [];
  for (const raw of names) {
    const name = raw.trim().toLowerCase();
    if (!/^[a-z0-9_-]{1,32}$/.test(name) || out.some((p) => p.name === name)) continue;
    const key = envKey(name);
    const local = name === "local" || name === "ollama" || name === "lmstudio" || str(env, `AI_${key}_KIND`).toLowerCase() === "local";
    if (local) {
      const own = name === "local" ? null : { url: str(env, `AI_${key}_BASE_URL`) || str(env, `AI_${key}_URL`), model: str(env, `AI_${key}_MODEL`), type: str(env, `AI_${key}_TYPE`) || (name === "local" ? "" : name) };
      const provider = own?.url ? localProvider(name, own.url, own.model, localType(own.type)) : localFromEnv(env, name, own ? { model: own.model, type: own.type } : {});
      if (provider) out.push(provider);
      continue;
    }
    const baseUrl = str(env, `AI_${key}_BASE_URL`);
    const list = models(str(env, `AI_${key}_MODEL`));
    if (!baseUrl || !list.length) continue;
    out.push({
      name,
      kind: "cloud",
      baseUrl: trimSlash(baseUrl),
      localRoot: null,
      localType: null,
      checkUrl: str(env, `AI_${key}_CHECK_URL`) || null,
      jsonFormat: !/^(0|false|no|нет)$/i.test(str(env, `AI_${key}_JSON_FORMAT`)),
      apiKey: str(env, `AI_${key}_API_KEY`) || null,
      models: list,
      paid: flag(env, `AI_${key}_PAID`),
      monthlyTokens: int(env, `AI_${key}_MONTHLY_TOKENS`, 0, 0, 1_000_000_000),
    });
  }
  return out;
}

function simpleFrom(env: Env, mode: Exclude<AiMode, "off" | "chain">): ProviderConfig[] {
  const local =
    mode === "openai"
      ? null
      : localFromEnv(env, "local", mode === "ollama" && !str(env, "AI_LOCAL_URL") && !str(env, "AI_OLLAMA_URL") ? { url: str(env, "AI_BASE_URL"), model: str(env, "AI_MODEL"), type: "ollama" } : {});
  let cloud: ProviderConfig | null = null;
  if (mode !== "ollama") {
    const key = str(env, "AI_API_KEY");
    const url = str(env, "AI_BASE_URL");
    const model = str(env, "AI_MODEL");
    const base = { name: "cloud", kind: "cloud" as const, localRoot: null, localType: null, checkUrl: null, jsonFormat: true, paid: flag(env, "AI_PAID"), monthlyTokens: int(env, "AI_MONTHLY_TOKENS", 0, 0, 1_000_000_000) };
    if (key && url && model) cloud = { ...base, baseUrl: trimSlash(url), apiKey: key, models: models(model) };
    else if (str(env, "XAI_API_KEY") && !key) cloud = { ...base, baseUrl: trimSlash(url || LEGACY_URL), apiKey: str(env, "XAI_API_KEY"), models: models(model, LEGACY_MODEL) };
  }
  const preferCloud = str(env, "AI_PREFER").toLowerCase() === "cloud";
  const order = preferCloud ? [cloud, local] : [local, cloud];
  return order.filter((p): p is ProviderConfig => p !== null);
}

export function readAiConfig(env: Env = process.env): AiConfig {
  const raw = str(env, "AI_PROVIDER").toLowerCase();
  const base = {
    timeoutMs: int(env, "AI_TIMEOUT_SEC", 90, 5, 600) * 1000,
    rateLimit: int(env, "AI_RATE_LIMIT", 60, 0, 10_000),
    tools: str(env, "AI_TOOLS").toLowerCase() === "json" ? ("json" as const) : ("auto" as const),
    cooldownMs: int(env, "AI_COOLDOWN_SEC", 300, 0, 86_400) * 1000,
  };
  if (raw === "off") return { mode: "off", providers: [], ...base };
  const chain = str(env, "AI_PROVIDERS");
  if (chain) {
    const providers = chainFrom(env, chain.split(","));
    return { mode: providers.length ? "chain" : "off", providers, ...base };
  }
  const anySet = ["AI_LOCAL_URL", "AI_OLLAMA_URL", "AI_BASE_URL", "AI_API_KEY", "XAI_API_KEY"].some((name) => str(env, name));
  const mode = raw === "auto" || raw === "openai" || raw === "ollama" ? raw : anySet ? "auto" : "off";
  if (mode === "off") return { mode, providers: [], ...base };
  const providers = simpleFrom(env, mode);
  return { mode: providers.length ? mode : "off", providers, ...base };
}

/** The assistant is shown at all. */
export function aiEnabled(config: AiConfig): boolean {
  return config.mode !== "off" && config.providers.length > 0;
}

/** Host only (for «Настройки → Помощник»): no path, no credentials. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}
