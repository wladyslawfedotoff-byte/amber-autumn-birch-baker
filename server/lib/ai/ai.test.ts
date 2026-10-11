import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ChatEvent } from "../../../src/lib/assistant/types.ts";
import { emptyData, type SyncData } from "../../../src/lib/sync/merge.ts";
import type { Principal } from "../principal.ts";
import { SyncStore } from "../sync-store.ts";
import { parseJsonReply, runAgent } from "./agent.ts";
import { aiEnabled, readAiConfig } from "./config.ts";
import { AssistantStore } from "./conversations.ts";
import { HEALTH_TTL_MS, ProviderChain, UsageBook, chatClient } from "./provider.ts";
import { Assistant, dataFor } from "./service.ts";
import { freeSlots, runTool } from "./tools.ts";

const KEY = "sk-test-secret-key-1234567890";
const TODAY = "2026-10-12";

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "pora-ai-"));
}

/** Streams an OpenAI-compatible reply: text and/or tool calls. */
function sse(reply: { text?: string; calls?: { name: string; args: unknown }[]; usage?: number }): Response {
  const lines: string[] = [];
  for (const word of (reply.text ?? "").match(/\S+\s*/g) ?? []) lines.push(JSON.stringify({ choices: [{ delta: { content: word } }] }));
  (reply.calls ?? []).forEach((call, index) => {
    const args = JSON.stringify(call.args);
    lines.push(JSON.stringify({ choices: [{ delta: { tool_calls: [{ index, id: `c${index}`, function: { name: call.name, arguments: args.slice(0, 5) } }] } }] }));
    lines.push(JSON.stringify({ choices: [{ delta: { tool_calls: [{ index, function: { arguments: args.slice(5) } }] } }] }));
  });
  if (reply.usage) lines.push(JSON.stringify({ choices: [], usage: { total_tokens: reply.usage } }));
  const body = `${lines.map((l) => `data: ${l}\n\n`).join("")}data: [DONE]\n\n`;
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

type Script = { tags?: () => Response | Promise<Response>; chat: ((body: Record<string, unknown>, url: string) => Response | Promise<Response>)[] };

/** Fake network: /api/tags (home PC) and /chat/completions (scripted turns). */
function fakeFetch(script: Script) {
  const calls: { url: string; body: Record<string, unknown> | null; auth: string | null }[] = [];
  let turn = 0;
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    calls.push({ url, body, auth: headers.get("authorization") });
    if (url.endsWith("/api/tags")) {
      if (!script.tags) throw new TypeError("fetch failed");
      return script.tags();
    }
    if (url.endsWith("/chat/completions")) {
      const handler = script.chat[turn++];
      if (!handler) throw new Error(`unexpected chat turn ${turn}`);
      return handler(body ?? {}, url);
    }
    if (url.endsWith("/models")) return new Response("{}", { status: 200 });
    throw new TypeError("fetch failed");
  }) as typeof fetch;
  return { fn, calls };
}

const user1: Principal = { login: "user1", name: "Пользователь 1", multiUser: true, owner: "user1", users: [{ login: "user1", name: "Пользователь 1" }, { login: "user2", name: "Пользователь 2" }] };

function seed(): SyncData {
  const data = emptyData();
  data.lists = [{ id: "l1", name: "Работа", owner: "user1", updatedAt: 1 }];
  data.tasks = [
    { id: "t1", title: "Отчёт за квартал", notes: "", listId: "l1", done: false, priority: 2, due: TODAY, tags: [], subtasks: [], createdAt: 1, completedAt: null, owner: "user1", updatedAt: 1 },
    { id: "t2", title: "Позвонить в банк", notes: "", listId: null, done: false, priority: 0, due: "2026-10-10", tags: [], subtasks: [], createdAt: 1, completedAt: null, owner: "user1", updatedAt: 1 },
    { id: "t9", title: "Чужой секрет", notes: "", listId: null, done: false, priority: 0, due: TODAY, tags: [], subtasks: [], createdAt: 1, completedAt: null, owner: "user2", updatedAt: 1 },
  ];
  return data;
}

function makeAssistant(env: Record<string, string>, script: Script, data: SyncData = seed(), now = () => 1_000_000) {
  const dir = tmp();
  const { fn, calls } = fakeFetch(script);
  const store = new AssistantStore(dir);
  const usage = new UsageBook(join(dir, "usage.json"), now);
  const assistant = new Assistant({ config: readAiConfig(env), fetchFn: fn, store, loadData: async () => data, now, usage, principal: (login) => (login === "user1" ? user1 : null) });
  return { assistant, store, calls, dir };
}

async function ask(assistant: Assistant, text: string, conversationId: string | null = null): Promise<ChatEvent[]> {
  const events: ChatEvent[] = [];
  await assistant.chat(user1, { conversationId, text, today: TODAY, now: "10:00" }, (e) => events.push(e));
  return events;
}

const ok = () => new Response("{}", { status: 200 });

/* ---- config ------------------------------------------------------------ */

test("config: off by default, auto when any AI_* is set, legacy XAI key", () => {
  assert.equal(readAiConfig({}).mode, "off");
  assert.equal(aiEnabled(readAiConfig({})), false);
  const auto = readAiConfig({ AI_OLLAMA_URL: "http://192.168.1.20:11434/", AI_BASE_URL: "https://api.example.com/v1", AI_API_KEY: KEY, AI_MODEL: "m-cloud" });
  assert.equal(auto.mode, "auto");
  assert.deepEqual(
    auto.providers.map((p) => [p.name, p.kind, p.baseUrl, p.models]),
    [
      ["local", "local", "http://192.168.1.20:11434/v1", ["qwen2.5:7b-instruct"]],
      ["cloud", "cloud", "https://api.example.com/v1", ["m-cloud"]],
    ],
  );
  assert.equal(auto.providers[0]?.healthUrl, "http://192.168.1.20:11434/api/tags");
  const legacy = readAiConfig({ XAI_API_KEY: KEY });
  assert.equal(legacy.mode, "auto");
  assert.deepEqual(
    legacy.providers.map((p) => [p.kind, p.baseUrl]),
    [["cloud", "https://api.x.ai/v1"]],
  );
  const ollama = readAiConfig({ AI_PROVIDER: "ollama", AI_BASE_URL: "http://pc:11434", AI_MODEL: "llama3.1:8b" });
  assert.deepEqual(
    ollama.providers.map((p) => [p.kind, p.baseUrl, p.models[0]]),
    [["local", "http://pc:11434/v1", "llama3.1:8b"]],
  );
  const cloudOnly = readAiConfig({ AI_PROVIDER: "openai", AI_OLLAMA_URL: "http://pc:11434", AI_BASE_URL: "https://x/v1", AI_API_KEY: KEY, AI_MODEL: "m" });
  assert.deepEqual(
    cloudOnly.providers.map((p) => p.kind),
    ["cloud"],
  );
  assert.equal(readAiConfig({ AI_PROVIDER: "off", AI_API_KEY: KEY }).mode, "off");
  const preferCloud = readAiConfig({ AI_OLLAMA_URL: "http://pc:11434", AI_BASE_URL: "https://x/v1", AI_API_KEY: KEY, AI_MODEL: "m", AI_PREFER: "cloud" });
  assert.deepEqual(
    preferCloud.providers.map((p) => p.kind),
    ["cloud", "local"],
  );
});

const CHAIN = {
  AI_PROVIDERS: "local, free ,paid,broken",
  AI_OLLAMA_URL: "http://pc:11434",
  AI_FREE_BASE_URL: "https://free.example/api/v1/",
  AI_FREE_API_KEY: "free-key-0001",
  AI_FREE_MODEL: "a:free, b:free",
  AI_PAID_BASE_URL: "https://paid.example/v1",
  AI_PAID_API_KEY: KEY,
  AI_PAID_MODEL: "cheap-1",
  AI_PAID_PAID: "1",
  AI_PAID_MONTHLY_TOKENS: "1000",
  AI_BROKEN_API_KEY: "no-url",
};

test("config: provider chain from AI_PROVIDERS", () => {
  const config = readAiConfig(CHAIN);
  assert.equal(config.mode, "chain");
  assert.deepEqual(
    config.providers.map((p) => ({ name: p.name, kind: p.kind, baseUrl: p.baseUrl, models: p.models, paid: p.paid, cap: p.monthlyTokens })),
    [
      { name: "local", kind: "local", baseUrl: "http://pc:11434/v1", models: ["qwen2.5:7b-instruct"], paid: false, cap: 0 },
      { name: "free", kind: "cloud", baseUrl: "https://free.example/api/v1", models: ["a:free", "b:free"], paid: false, cap: 0 },
      { name: "paid", kind: "cloud", baseUrl: "https://paid.example/v1", models: ["cheap-1"], paid: true, cap: 1000 },
    ],
    "incomplete providers are skipped",
  );
  assert.equal(config.cooldownMs, 300_000);
  assert.equal(readAiConfig({ AI_PROVIDERS: "nothing" }).mode, "off");
});

/* ---- switching --------------------------------------------------------- */

test("auto: local when the PC answers, cloud when it is off, cached for a minute", async () => {
  let up = true;
  let clock = 0;
  const { fn, calls } = fakeFetch({ tags: () => (up ? ok() : Promise.reject(new TypeError("down"))), chat: [] });
  const chain = new ProviderChain(readAiConfig({ AI_OLLAMA_URL: "http://pc:11434", AI_BASE_URL: "https://cloud/v1", AI_API_KEY: KEY, AI_MODEL: "m" }), fn, () => clock);
  const all = { allowCloud: true, allowPaid: true };
  const first = await chain.candidates(all);
  assert.deepEqual(
    first.endpoints.map((e) => [e.which, e.baseUrl]),
    [
      ["local", "http://pc:11434/v1"],
      ["cloud", "https://cloud/v1"],
    ],
  );
  up = false;
  assert.equal((await chain.candidates(all)).endpoints[0]?.which, "local", "health is cached");
  assert.equal(calls.filter((c) => c.url.endsWith("/api/tags")).length, 1);
  clock += HEALTH_TTL_MS + 1;
  const fallback = await chain.candidates(all);
  assert.deepEqual(
    fallback.endpoints.map((e) => e.which),
    ["cloud"],
  );
  const denied = await chain.candidates({ allowCloud: false, allowPaid: true });
  assert.deepEqual(denied, { endpoints: [], blocked: ["down", "cloud_not_allowed"] });
  up = true;
  clock += HEALTH_TTL_MS + 1;
  assert.deepEqual(
    (await chain.candidates({ allowCloud: false, allowPaid: true })).endpoints.map((e) => e.which),
    ["local"],
  );
});

test("auto with AI_PREFER=cloud, local-only and cloud-only setups", async () => {
  const { fn } = fakeFetch({ tags: ok, chat: [] });
  const all = { allowCloud: true, allowPaid: true };
  const both = { AI_OLLAMA_URL: "http://pc:11434", AI_BASE_URL: "https://cloud/v1", AI_API_KEY: KEY, AI_MODEL: "m" };
  const preferCloud = await new ProviderChain(readAiConfig({ ...both, AI_PREFER: "cloud" }), fn).candidates(all);
  assert.equal(preferCloud.endpoints[0]?.which, "cloud");
  const preferCloudDenied = await new ProviderChain(readAiConfig({ ...both, AI_PREFER: "cloud" }), fn).candidates({ allowCloud: false, allowPaid: true });
  assert.deepEqual(
    preferCloudDenied.endpoints.map((e) => e.which),
    ["local"],
  );
  const down = fakeFetch({ chat: [] }).fn;
  const localOnly = await new ProviderChain(readAiConfig({ AI_OLLAMA_URL: "http://pc:11434" }), down).candidates(all);
  assert.deepEqual(localOnly, { endpoints: [], blocked: ["down"] });
  const cloudOnly = await new ProviderChain(readAiConfig({ AI_BASE_URL: "https://cloud/v1", AI_API_KEY: KEY, AI_MODEL: "m" }), down).candidates({ allowCloud: false, allowPaid: true });
  assert.equal(cloudOnly.endpoints[0]?.which, "cloud", "without a local model the cloud is the main path");
});

/* ---- tools and agent --------------------------------------------------- */

test("tools: reads see the given view only, writes become proposals", () => {
  let n = 0;
  const ctx = { data: seed(), today: TODAY, now: "10:00", newId: () => `id-${++n}` };
  const overdue = JSON.parse(runTool("list_tasks", { scope: "overdue" }, ctx).content);
  assert.deepEqual(
    overdue.tasks.map((t: { title: string }) => t.title),
    ["Позвонить в банк"],
  );
  const create = runTool("create_tasks", JSON.stringify({ tasks: [{ title: "Купить молоко", due: "2026-10-13", time: "9:30", list: "Дом", subtasks: ["2 л"] }, { title: "" }] }), ctx);
  assert.equal(create.proposal?.title, "Создать 1 задачу?");
  assert.deepEqual(create.proposal?.items[0], { op: "create", key: "id-1", title: "Купить молоко", due: "2026-10-13", start: "09:30", end: null, list: "Дом", priority: 0, subtasks: ["2 л"], notes: "" });
  const unknown = runTool("complete_tasks", { ids: ["nope"] }, ctx);
  assert.equal(unknown.proposal, null, "unknown ids are dropped");
  const plan = runTool("plan_day", { items: [{ id: "t1", time: "11:00", end: "12:30" }] }, ctx);
  assert.equal(plan.proposal?.items[0]?.op, "update");
  const steps = runTool("break_down_task", { id: "t1", steps: ["Собрать цифры", "Черновик", "Отправить"] }, ctx);
  assert.equal(steps.proposal?.title, "Добавить 3 шага к «Отчёт за квартал»?");
  const habits = runTool("create_habits", { habits: [{ name: "Вода", goal: 8, unit: "стаканов" }, { name: "Бег", times_per_week: 3 }] }, ctx);
  assert.equal(habits.proposal?.title, "Создать 2 привычки?");
  assert.deepEqual(freeSlots({ ...ctx.data, tasks: [{ ...ctx.data.tasks[0]!, startAt: "11:00", endAt: "12:00" }] }, TODAY, TODAY, "10:05"), [
    { start: "10:15", end: "11:00", minutes: 45 },
    { start: "12:00", end: "18:00", minutes: 360 },
  ]);
});

test("agent: tool round trip streams the answer and returns proposals", async () => {
  const { fn, calls } = fakeFetch({
    chat: [
      () => sse({ calls: [{ name: "list_tasks", args: { scope: "today" } }] }),
      () => sse({ calls: [{ name: "create_tasks", args: { tasks: [{ title: "Подготовить слайды", due: TODAY }] } }] }),
      () => sse({ text: "Предлагаю добавить одну задачу." }),
    ],
  });
  const deltas: string[] = [];
  const result = await runAgent({
    chat: chatClient({ provider: "local", which: "local", baseUrl: "http://pc:11434/v1", apiKey: null, model: "q", paid: false }, 5000, fn),
    ctx: { data: seed(), today: TODAY, now: "10:00", newId: () => "x" },
    history: [{ role: "user", text: "Что на сегодня?" }],
    events: { onDelta: (d) => deltas.push(d), onProposal: () => {} },
  });
  assert.equal(result.text, "Предлагаю добавить одну задачу.");
  assert.ok(deltas.length > 1, "streamed in pieces");
  assert.equal(result.proposals.length, 1);
  const toolMessage = (calls[1]!.body!.messages as { role: string; content: string }[]).find((m) => m.role === "tool");
  assert.match(toolMessage!.content, /Отчёт за квартал/);
  assert.equal(calls[0]!.auth, null, "no key is sent to the local model");
});

test("agent: models without function calling fall back to JSON mode", async () => {
  const { fn, calls } = fakeFetch({
    chat: [
      () => new Response(JSON.stringify({ error: "model does not support tools" }), { status: 400 }),
      () => sse({ text: JSON.stringify({ reply: "Готово, вот предложение.", actions: [{ name: "create_tasks", arguments: { tasks: [{ title: "Позвонить маме" }] } }] }) }),
    ],
  });
  const result = await runAgent({
    chat: chatClient({ provider: "local", which: "local", baseUrl: "http://pc/v1", apiKey: null, model: "q", paid: false }, 5000, fn),
    ctx: { data: seed(), today: TODAY, now: "10:00", newId: () => "x" },
    history: [{ role: "user", text: "Позвонить маме" }],
    events: { onDelta: () => {}, onProposal: () => {} },
  });
  assert.equal(result.jsonMode, true);
  assert.equal(result.text, "Готово, вот предложение.");
  assert.equal(result.proposals[0]?.items[0]?.op, "create");
  assert.equal(calls[1]!.body!.tools, undefined);
  assert.deepEqual(parseJsonReply('```json\n{"reply":"ок","actions":[]}\n```'), { reply: "ок", actions: [] });
});

/* ---- service: consent, switching, errors, access, keys ------------------ */

const BOTH = { AI_OLLAMA_URL: "http://pc:11434", AI_BASE_URL: "https://cloud.example/v1", AI_API_KEY: KEY, AI_MODEL: "m-cloud" };

test("service: consent first, then the answer is stored per user", async () => {
  const { assistant, store, calls, dir } = makeAssistant(BOTH, { tags: ok, chat: [() => sse({ text: "Привет!" })] });
  try {
    const first = await ask(assistant, "Привет");
    assert.deepEqual(first, [{ type: "consent", provider: "local" }]);
    assert.equal(calls.filter((c) => c.url.endsWith("/chat/completions")).length, 0, "nothing is sent before consent");
    await store.setSettings("user1", { consent: "local" });
    const events = await ask(assistant, "Привет");
    assert.equal(events[0]?.type, "start");
    assert.equal(events[0]?.type === "start" && events[0].provider, "local");
    const done = events.at(-1);
    assert.equal(done?.type, "done");
    const list = await store.list("user1");
    assert.equal(list.length, 1);
    assert.equal((await store.get("user1", list[0]!.id))?.messages.length, 2);
    assert.deepEqual(await store.list("user2"), [], "other users do not see the conversation");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("service: the PC is off → cloud (asks consent the first time it is used), or a clear error", async () => {
  const off = makeAssistant(BOTH, { chat: [() => sse({ text: "Ответ из облака" })] });
  try {
    await off.store.setSettings("user1", { consent: "local" });
    assert.deepEqual(await ask(off.assistant, "Что просрочено?"), [{ type: "consent", provider: "cloud" }]);
    await off.store.setSettings("user1", { consent: "cloud" });
    const events = await ask(off.assistant, "Что просрочено?");
    assert.equal(events[0]?.type === "start" && events[0].provider, "cloud");
    assert.equal(off.calls.find((c) => c.url.includes("cloud.example"))?.auth, `Bearer ${KEY}`);
    await off.store.setSettings("user1", { allowCloud: false });
    const denied = await ask(off.assistant, "Что просрочено?");
    assert.equal(denied[0]?.type, "error");
    assert.match(denied[0]?.type === "error" ? denied[0].message : "", /Помощник сейчас недоступен/);
  } finally {
    rmSync(off.dir, { recursive: true, force: true });
  }
  const ollama = makeAssistant({ AI_PROVIDER: "ollama", AI_BASE_URL: "http://pc:11434" }, { chat: [] });
  try {
    await ollama.store.setSettings("user1", { consent: "local" });
    const events = await ask(ollama.assistant, "Привет");
    assert.equal(events.length, 1);
    assert.match(events[0]?.type === "error" ? events[0].message : "", /^Помощник сейчас недоступен/);
  } finally {
    rmSync(ollama.dir, { recursive: true, force: true });
  }
});

test("service: the PC drops mid-request → retried in the cloud", async () => {
  const { assistant, store, dir } = makeAssistant(BOTH, {
    tags: ok,
    chat: [() => Promise.reject(new TypeError("fetch failed")), () => sse({ text: "Из облака" })],
  });
  try {
    await store.setSettings("user1", { consent: "local" });
    await store.setSettings("user1", { consent: "cloud" });
    const events = await ask(assistant, "Привет");
    const starts = events.filter((e) => e.type === "start").map((e) => (e.type === "start" ? e.provider : ""));
    assert.deepEqual(starts, ["local", "cloud"]);
    const done = events.at(-1);
    assert.equal(done?.type === "done" && done.message.provider, "cloud");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("service: keys never reach the client (status, events, errors)", async () => {
  const { assistant, store, dir } = makeAssistant(BOTH, { chat: [() => new Response(`{"error":"bad key ${KEY}"}`, { status: 401 })] });
  try {
    await store.setSettings("user1", { consent: "cloud" });
    const status = await assistant.status(user1);
    assert.equal(JSON.stringify(status).includes(KEY), false);
    assert.equal(status.providers.find((p) => p.kind === "cloud")?.host, "cloud.example");
    const events = await ask(assistant, "Привет");
    assert.equal(JSON.stringify(events).includes(KEY), false);
    assert.equal(events.at(-1)?.type, "error");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("access: the model sees only the signed-in user's view", async () => {
  const syncDir = tmp();
  try {
    const sync = new SyncStore(syncDir);
    await sync.put(0, seed());
    const view = await dataFor(sync, user1);
    assert.deepEqual(view.tasks.map((t) => t.title).sort(), ["Отчёт за квартал", "Позвонить в банк"]);
    const { assistant, store, calls, dir } = makeAssistant(BOTH, { tags: ok, chat: [() => sse({ calls: [{ name: "search_tasks", args: { query: "секрет" } }, { name: "list_tasks", args: { scope: "today" } }] }), () => sse({ text: "Нашёл." })] }, view);
    try {
      await store.setSettings("user1", { consent: "local" });
      await ask(assistant, "Найди секрет");
      const sent = JSON.stringify(calls.map((c) => c.body));
      assert.equal(sent.includes("Чужой секрет"), false);
      assert.equal(sent.includes("Отчёт за квартал"), true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  } finally {
    rmSync(syncDir, { recursive: true, force: true });
  }
});

test("rate limit per user", async () => {
  const { assistant, store, dir } = makeAssistant({ ...BOTH, AI_RATE_LIMIT: "1" }, { tags: ok, chat: [() => sse({ text: "Раз" })] });
  try {
    await store.setSettings("user1", { consent: "local" });
    await ask(assistant, "1");
    const second = await ask(assistant, "2");
    assert.equal(second[0]?.type, "error");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/* ---- fallback chain ----------------------------------------------------- */

const starts = (events: ChatEvent[]) => events.flatMap((e) => (e.type === "start" ? [e.source] : []));
const limited = () => new Response('{"error":{"message":"Rate limit exceeded"}}', { status: 429 });

test("chain: 429 → next model, error → next provider, cooldown skips them for 5 minutes", async () => {
  let clock = 1_000_000;
  const { assistant, store, calls, dir } = makeAssistant(
    CHAIN,
    {
      chat: [
        limited,
        () => new Response("upstream failed", { status: 502 }),
        () => sse({ text: "Ответ платной модели", usage: 120 }),
        () => sse({ text: "Снова платная" }),
        () => sse({ text: "Бесплатная вернулась" }),
      ],
    },
    seed(),
    () => clock,
  );
  try {
    await store.setSettings("user1", { consent: "cloud" });
    const first = await ask(assistant, "Привет");
    assert.deepEqual(starts(first), ["free · a:free", "free · b:free", "paid · cheap-1"]);
    const done = first.at(-1);
    assert.equal(done?.type === "done" && done.message.source, "paid · cheap-1");
    assert.equal(calls.find((c) => c.url.startsWith("https://free.example"))?.auth, "Bearer free-key-0001", "each provider gets its own key");
    assert.equal(calls.find((c) => c.url.startsWith("https://paid.example"))?.auth, `Bearer ${KEY}`);

    const status = await assistant.status(user1);
    const free = status.providers.find((p) => p.name === "free");
    assert.ok(free?.until && free.until > clock, "free is paused");
    assert.equal(status.providers.find((p) => p.name === "paid")?.usedTokens, 120);
    assert.equal(JSON.stringify(status).includes(KEY) || JSON.stringify(status).includes("free-key-0001"), false);

    const second = await ask(assistant, "Ещё");
    assert.deepEqual(starts(second), ["paid · cheap-1"], "cooled-down models are skipped");

    clock += 5 * 60_000 + 1;
    const third = await ask(assistant, "И ещё");
    assert.deepEqual(starts(third), ["free · a:free"], "after the pause the free model is first again");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("chain: «Разрешить платные» off and the monthly token cap", async () => {
  const noPaid = makeAssistant(CHAIN, { chat: [limited, limited] });
  try {
    await noPaid.store.setSettings("user1", { consent: "cloud", allowPaid: false });
    const events = await ask(noPaid.assistant, "Привет");
    assert.deepEqual(starts(events), ["free · a:free", "free · b:free"]);
    const last = events.at(-1);
    assert.match(last?.type === "error" ? last.message : "", /^Помощник сейчас недоступен/);
    assert.equal(noPaid.calls.some((c) => c.url.startsWith("https://paid.example")), false, "the paid provider is never asked");
    const again = await ask(noPaid.assistant, "Привет");
    assert.match(again[0]?.type === "error" ? again[0].message : "", /все модели заняты/);
  } finally {
    rmSync(noPaid.dir, { recursive: true, force: true });
  }

  const capped = makeAssistant({ ...CHAIN, AI_PROVIDERS: "paid,free" }, { chat: [() => sse({ text: "Дорого", usage: 1500 }), () => sse({ text: "Бесплатно" })] });
  try {
    await capped.store.setSettings("user1", { consent: "cloud" });
    assert.deepEqual(starts(await ask(capped.assistant, "1")), ["paid · cheap-1"]);
    assert.deepEqual(starts(await ask(capped.assistant, "2")), ["free · a:free"], "over the cap → skipped");
    const status = await capped.assistant.status(user1);
    assert.equal(status.providers.find((p) => p.name === "paid")?.state, "cap");
  } finally {
    rmSync(capped.dir, { recursive: true, force: true });
  }
});

test("chain: a free model without function calling answers in JSON mode", async () => {
  const { assistant, store, calls, dir } = makeAssistant(
    { ...CHAIN, AI_PROVIDERS: "free" },
    {
      chat: [
        () => new Response('{"error":{"message":"No endpoints found that support tool use"}}', { status: 404 }),
        () => sse({ text: JSON.stringify({ reply: "Добавлю задачу.", actions: [{ name: "create_tasks", arguments: { tasks: [{ title: "Купить хлеб", due: TODAY }] } }] }) }),
      ],
    },
  );
  try {
    await store.setSettings("user1", { consent: "cloud" });
    const events = await ask(assistant, "Купить хлеб");
    assert.deepEqual(starts(events), ["free · a:free"]);
    const done = events.at(-1);
    assert.equal(done?.type, "done");
    assert.equal(done?.type === "done" && done.message.proposals?.[0]?.items[0]?.op, "create");
    assert.equal(calls[1]?.body?.tools, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("chain: home PC first, then consent before the first cloud answer", async () => {
  const { assistant, store, dir } = makeAssistant(CHAIN, { tags: ok, chat: [() => Promise.reject(new TypeError("fetch failed")), () => sse({ text: "Из облака" })] });
  try {
    await store.setSettings("user1", { consent: "local" });
    const events = await ask(assistant, "Привет");
    assert.deepEqual(events.map((e) => e.type), ["start", "consent"]);
    await store.setSettings("user1", { consent: "cloud" });
    const next = await ask(assistant, "Привет");
    assert.deepEqual(starts(next), ["free · a:free"], "the PC is skipped while it is down");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/* ---- «Повторить» / «Отложить» ------------------------------------------- */

const FREE_ONLY = { ...CHAIN, AI_PROVIDERS: "free" };

test("queue: all unavailable → kept with «Повторить»/«Отложить»; the server retries with backoff and the answer lands in the conversation and the bell", async () => {
  let clock = 1_000_000;
  const { assistant, store, dir } = makeAssistant(
    FREE_ONLY,
    {
      chat: [
        limited,
        limited,
        limited,
        limited,
        () => sse({ calls: [{ name: "create_tasks", args: { tasks: [{ title: "Купить хлеб" }] } }] }),
        () => sse({ text: "Предлагаю задачу." }),
      ],
    },
    seed(),
    () => clock,
  );
  try {
    await store.setSettings("user1", { consent: "cloud" });
    const events = await ask(assistant, "Добавь купить хлеб");
    const error = events.at(-1);
    assert.ok(error?.type === "error" && error.retryable && error.conversationId && error.messageId, "the failure is retryable and stored");
    const conversationId = error.conversationId!;
    const messageId = error.messageId!;
    const stored = await store.get("user1", conversationId);
    assert.deepEqual(
      stored?.messages.map((m) => [m.role, Boolean(m.retryable)]),
      [
        ["user", false],
        ["assistant", true],
      ],
    );

    const item = await assistant.enqueue(user1, conversationId, messageId);
    assert.equal(item?.nextAt, clock + 5 * 60_000);
    assert.equal((await store.get("user1", conversationId))?.messages[1]?.queued?.id, item?.id, "«В очереди, попробую в …» is shown");
    assert.equal(await store.enqueue("user2", conversationId, messageId, clock), null, "another user cannot queue it");

    assert.deepEqual(await assistant.processQueue(), { answered: 0, retried: 0, expired: 0 }, "not due yet");
    clock += 5 * 60_000 + 1;
    assert.deepEqual(await assistant.processQueue(), { answered: 0, retried: 1, expired: 0 });
    const again = (await store.queue("user1"))[0];
    assert.equal(again?.attempts, 1);
    assert.equal(again?.nextAt, clock + 10 * 60_000, "backoff grows");

    clock += 10 * 60_000 + 1;
    assert.deepEqual(await assistant.processQueue(), { answered: 1, retried: 0, expired: 0 });
    assert.deepEqual(await store.queue("user1"), []);
    const conv = await store.get("user1", conversationId);
    const answer = conv?.messages[1];
    assert.equal(answer?.error, undefined);
    assert.equal(answer?.text, "Предлагаю задачу.");
    assert.equal(answer?.proposals?.[0]?.status, "pending", "changes still wait for «Применить»");
    const notices = await store.notices("user1");
    assert.equal(notices[0]?.text, "Помощник ответил");
    assert.equal(notices[0]?.conversationId, conversationId);
    assert.deepEqual(await store.notices("user2"), []);
    await store.dismissNotices("user1", { conversationId });
    assert.deepEqual(await store.notices("user1"), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("queue: cancel, give up after a day, «Повторить» replaces the failed exchange", async () => {
  let clock = 1_000_000;
  const { assistant, store, dir } = makeAssistant(FREE_ONLY, { chat: [limited, limited, () => sse({ text: "Ответ" })] }, seed(), () => clock);
  try {
    await store.setSettings("user1", { consent: "cloud" });
    const failed = (await ask(assistant, "Вопрос")).at(-1);
    assert.ok(failed?.type === "error" && failed.conversationId && failed.messageId);
    const item = await assistant.enqueue(user1, failed.conversationId!, failed.messageId!);
    assert.ok(item);
    assert.equal(await store.cancelQueued("user1", item.id), true);
    assert.deepEqual(await store.queue("user1"), []);
    assert.equal((await store.get("user1", failed.conversationId!))?.messages[1]?.queued, undefined);

    await assistant.enqueue(user1, failed.conversationId!, failed.messageId!);
    clock += 24 * 3_600_000;
    assert.deepEqual(await assistant.processQueue(), { answered: 0, retried: 0, expired: 1 });
    const gaveUp = (await store.get("user1", failed.conversationId!))?.messages[1];
    assert.match(gaveUp?.text ?? "", /за сутки/);
    assert.equal(gaveUp?.retryable, true);

    const retried: ChatEvent[] = [];
    await assistant.chat(user1, { conversationId: failed.conversationId!, text: "Вопрос", today: TODAY, now: "10:00", retryOf: failed.messageId! }, (e) => retried.push(e));
    assert.equal(retried.at(-1)?.type, "done");
    assert.deepEqual(
      (await store.get("user1", failed.conversationId!))?.messages.map((m) => [m.role, m.text]),
      [
        ["user", "Вопрос"],
        ["assistant", "Ответ"],
      ],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("queue: background answers use only providers the user agreed to", async () => {
  let clock = 1_000_000;
  let up = false;
  const { assistant, store, calls, dir } = makeAssistant(
    { ...CHAIN, AI_PROVIDERS: "local,free" },
    { tags: () => (up ? ok() : Promise.reject(new TypeError("down"))), chat: [limited, limited, () => sse({ text: "Из облака" })] },
    seed(),
    () => clock,
  );
  try {
    await store.setSettings("user1", { consent: "cloud" });
    const failed = (await ask(assistant, "Вопрос")).at(-1);
    assert.ok(failed?.type === "error" && failed.retryable);
    await assistant.enqueue(user1, failed.conversationId!, failed.messageId!);
    up = true; // the PC is back, but the user only agreed to the cloud
    clock += 5 * 60_000 + HEALTH_TTL_MS;
    assert.deepEqual(await assistant.processQueue(), { answered: 1, retried: 0, expired: 0 });
    assert.equal(calls.some((c) => c.url.startsWith("http://pc:11434/v1")), false, "the PC (no consent) is never asked");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
