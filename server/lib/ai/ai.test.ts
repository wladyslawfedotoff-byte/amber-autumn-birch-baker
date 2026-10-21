import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ChatEvent, ChatMessage } from "../../../src/lib/assistant/types.ts";
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
  const store = new AssistantStore(dir, { dataDir: dir });
  const usage = new UsageBook(join(dir, "usage.json"), now, { dataDir: dir });
  // Local answers are tested separately; here every question goes to a model.
  const assistant = new Assistant({ config: readAiConfig({ AI_LOCAL_ANSWERS: "0", ...env }), fetchFn: fn, store, loadData: async () => data, now, usage, principal: (login) => (login === "user1" ? user1 : null) });
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
  assert.equal(auto.providers[0]?.localRoot, "http://192.168.1.20:11434");
  assert.equal(auto.providers[0]?.localType, "ollama", "AI_OLLAMA_URL implies Ollama");
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

test("executive style: terse rules in the prompt, clean titles, «было» on changes, plan as a timeline", async () => {
  let n = 0;
  const ctx = { data: seed(), today: TODAY, now: "10:00", newId: () => `id-${++n}` };
  const { systemPrompt } = await import("./agent.ts");
  const prompt = systemPrompt(ctx, { json: true });
  for (const rule of [/1–3 короткие строки/, /Без вступлений, «конечно», пересказа вопроса/, /глагол в начале/, /«Позвонить в сервис — записаться на ТО»/, /детали — в notes\/subtasks/, /План дня — только строки «HH:mm — задача»/, /без таблиц, HTML и эмодзи/]) assert.match(prompt, rule);
  // Titles and steps: no emoji, no trailing period.
  const create = runTool("create_tasks", { tasks: [{ title: "📞 Позвонить в сервис  — записаться на ТО.", subtasks: ["✅ Найти номер.", "Позвонить 👍"] }] }, ctx);
  const item = create.proposal?.items[0];
  assert.equal(item?.op === "create" && item.title, "Позвонить в сервис — записаться на ТО");
  assert.deepEqual(item?.op === "create" && item.subtasks, ["Найти номер", "Позвонить"]);
  // Changes carry the old values («было → стало»).
  const update = runTool("update_tasks", { changes: [{ id: "t2", due: "2026-10-13", priority: 3, title: "Позвонить в банк — уточнить лимит" }] }, ctx);
  assert.deepEqual(update.proposal?.items[0], { op: "update", key: "id-3", taskId: "t2", taskTitle: "Позвонить в банк", title: "Позвонить в банк — уточнить лимит", due: "2026-10-13", priority: 3, was: { title: "Позвонить в банк", due: "2026-10-10", priority: 0 } });
  // A day plan: marked for the timeline and sorted by time.
  const plan = runTool("plan_day", { items: [{ id: "t1", time: "14:00" }, { id: "t2", time: "09:30", end: "10:00" }] }, ctx);
  assert.equal(plan.proposal?.kind, "plan");
  assert.deepEqual(plan.proposal?.items.map((i) => i.op === "update" && [i.taskTitle, i.start, i.was?.start]), [["Позвонить в банк", "09:30", null], ["Отчёт за квартал", "14:00", null]]);
});

test("follow-up chips after a model's answer are computed by the app", async () => {
  const { assistant, store, dir } = makeAssistant(PAID_GPT, {
    chat: [() => sse({ calls: [{ name: "plan_day", args: { items: [{ id: "t1", time: "09:00" }] } }] }), () => sse({ text: "09:00 — Отчёт за квартал" })],
  });
  try {
    await store.setSettings("user1", { consent: "cloud", allowPaid: true });
    const events = await ask(assistant, "Спланируй мой день");
    const done = events.at(-1) as { type: string; message: ChatMessage };
    assert.equal(done.type, "done");
    assert.equal(done.message.proposals?.[0]?.kind, "plan");
    assert.deepEqual(done.message.chips, [{ label: "Свободные окна", ask: "Свободные окна сегодня" }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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
  assert.deepEqual(parseJsonReply('```json\n{"reply":"ок","actions":[]}\n```'), { reply: "ок", actions: [], ok: true });
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
    assert.deepEqual(starts(first), ["free · a:free", "free · b:free · запасная модель", "paid · cheap-1 · запасная модель"]);
    const done = first.at(-1);
    assert.equal(done?.type === "done" && done.message.source, "paid · cheap-1 · запасная модель");
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
    assert.deepEqual(starts(events), ["free · a:free", "free · b:free · запасная модель"]);
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

/* ---- home PC: Ollama or LM Studio --------------------------------------- */

/** A home PC that runs one kind of server and lists these models. */
function homePc(kind: "ollama" | "lmstudio" | "off", models: string[]) {
  const urls: string[] = [];
  const fn = (async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    if (kind === "ollama" && url.endsWith("/api/tags")) return Response.json({ models: models.map((name) => ({ name })) });
    if (kind === "lmstudio" && url.endsWith("/v1/models")) return Response.json({ object: "list", data: models.map((id) => ({ id, object: "model" })) });
    if (kind !== "off") return new Response("not found", { status: 404 });
    throw new TypeError("fetch failed");
  }) as typeof fetch;
  return { fn, urls };
}

test("config: AI_LOCAL_* with AI_OLLAMA_* as aliases and AI_LOCAL_TYPE", () => {
  const lm = readAiConfig({ AI_LOCAL_URL: "http://192.168.1.20:1234/v1/", AI_LOCAL_TYPE: "lmstudio", AI_LOCAL_MODEL: "qwen2.5-7b-instruct" });
  assert.equal(lm.mode, "auto");
  assert.deepEqual(
    lm.providers.map((p) => [p.name, p.kind, p.baseUrl, p.localRoot, p.localType, p.models, p.jsonFormat]),
    [["local", "local", "http://192.168.1.20:1234/v1", "http://192.168.1.20:1234", "lmstudio", ["qwen2.5-7b-instruct"], false]],
  );
  const auto = readAiConfig({ AI_LOCAL_URL: "http://pc:1234" });
  assert.deepEqual([auto.providers[0]?.localType, auto.providers[0]?.models], ["auto", []], "auto-detect, model from the PC");
  const alias = readAiConfig({ AI_OLLAMA_URL: "http://pc:11434", AI_OLLAMA_MODEL: "llama3.1:8b" });
  assert.deepEqual([alias.providers[0]?.localType, alias.providers[0]?.models], ["ollama", ["llama3.1:8b"]]);
  const chain = readAiConfig({ AI_PROVIDERS: "local, kie", AI_LOCAL_URL: "http://pc:1234", AI_LOCAL_TYPE: "LM Studio", AI_KIE_BASE_URL: "https://paid.example/{model}/v1", AI_KIE_API_KEY: KEY, AI_KIE_MODEL: "m-1,m-2", AI_KIE_PAID: "1", AI_KIE_CHECK_URL: "https://paid.example/api/credit", AI_KIE_JSON_FORMAT: "0" });
  assert.equal(chain.mode, "chain");
  assert.deepEqual(
    chain.providers.map((p) => [p.name, p.localType, p.baseUrl, p.checkUrl, p.jsonFormat, p.paid]),
    [
      ["local", "lmstudio", "http://pc:1234/v1", null, false, false],
      ["kie", null, "https://paid.example/{model}/v1", "https://paid.example/api/credit", false, true],
    ],
  );
});

test("home PC: LM Studio is found via /v1/models and its model is used", async () => {
  const pc = homePc("lmstudio", ["qwen2.5-7b-instruct", "text-embedding-nomic-embed-text-v1.5"]);
  const chain = new ProviderChain(readAiConfig({ AI_LOCAL_URL: "http://pc:1234" }), pc.fn);
  const all = { allowCloud: true, allowPaid: true };
  const found = await chain.candidates(all);
  assert.deepEqual(
    found.endpoints.map((e) => [e.which, e.baseUrl, e.model, e.jsonFormat]),
    [["local", "http://pc:1234/v1", "qwen2.5-7b-instruct", false]],
  );
  assert.deepEqual(pc.urls, ["http://pc:1234/api/tags", "http://pc:1234/v1/models"], "auto tries Ollama first, then LM Studio");
  assert.equal(chain.info()[0]?.models[0], "qwen2.5-7b-instruct");
  const typed = homePc("lmstudio", ["m"]);
  await new ProviderChain(readAiConfig({ AI_LOCAL_URL: "http://pc:1234", AI_LOCAL_TYPE: "lmstudio" }), typed.fn).candidates(all);
  assert.deepEqual(typed.urls, ["http://pc:1234/v1/models"], "with a type only that server is asked");
  const empty = await new ProviderChain(readAiConfig({ AI_LOCAL_URL: "http://pc:1234", AI_LOCAL_TYPE: "lmstudio" }), homePc("off", []).fn).candidates({ allowCloud: false, allowPaid: false });
  assert.deepEqual(empty, { endpoints: [], blocked: ["down"] });
});

test("home PC: Ollama auto-detected; the default model when it is there", async () => {
  const all = { allowCloud: true, allowPaid: true };
  const withDefault = await new ProviderChain(readAiConfig({ AI_LOCAL_URL: "http://pc:11434" }), homePc("ollama", ["llama3.1:8b", "qwen2.5:7b-instruct"]).fn).candidates(all);
  assert.deepEqual(withDefault.endpoints.map((e) => [e.model, e.jsonFormat]), [["qwen2.5:7b-instruct", true]]);
  const other = await new ProviderChain(readAiConfig({ AI_LOCAL_URL: "http://pc:11434" }), homePc("ollama", ["llama3.1:8b"]).fn).candidates(all);
  assert.deepEqual(other.endpoints.map((e) => e.model), ["llama3.1:8b"]);
});

test("home PC: LM Studio answers in JSON mode without response_format", async () => {
  const requests: Record<string, unknown>[] = [];
  const fn = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(JSON.parse(String(init?.body)));
    return sse({ text: '{"reply":"ok"}' });
  }) as typeof fetch;
  await chatClient({ provider: "local", which: "local", baseUrl: "http://pc:1234/v1", apiKey: null, model: "m", paid: false, jsonFormat: false }, 5000, fn)({ messages: [{ role: "user", content: "hi" }], tools: null });
  assert.equal(requests[0]?.response_format, undefined);
  await chatClient({ provider: "local", which: "local", baseUrl: "http://pc:11434/v1", apiKey: null, model: "m", paid: false }, 5000, fn)({ messages: [{ role: "user", content: "hi" }], tools: null });
  assert.deepEqual(requests[1]?.response_format, { type: "json_object" });
});

/* ---- per-model URLs, errors sent as HTTP 200 ----------------------------- */

const KIE = {
  AI_PROVIDERS: "free,kie",
  AI_FREE_BASE_URL: "https://free.example/api/v1",
  AI_FREE_API_KEY: KEY,
  AI_FREE_MODEL: "a:free",
  AI_KIE_BASE_URL: "https://paid.example/{model}/v1",
  AI_KIE_API_KEY: KEY,
  AI_KIE_MODEL: "flash-openai,pro-openai",
  AI_KIE_PAID: "1",
  AI_KIE_MONTHLY_TOKENS: "100000",
  AI_KIE_CHECK_URL: "https://paid.example/api/v1/chat/credit",
};

test("per-model URL template and {code,msg} errors with HTTP 200 → next model", async () => {
  const { assistant, store, calls, dir } = makeAssistant(KIE, {
    chat: [
      limited,
      () => Response.json({ code: 402, msg: "Credits insufficient" }),
      () => sse({ text: "Готово", usage: 120 }),
    ],
  });
  try {
    await store.setSettings("user1", { consent: "cloud", allowPaid: true });
    const events = await ask(assistant, "Привет");
    assert.deepEqual(starts(events), ["free · a:free", "kie · flash-openai · запасная модель", "kie · pro-openai · запасная модель"]);
    assert.equal(events.at(-1)?.type, "done");
    const chatUrls = calls.filter((c) => c.url.endsWith("/chat/completions")).map((c) => c.url);
    assert.deepEqual(chatUrls, ["https://free.example/api/v1/chat/completions", "https://paid.example/flash-openai/v1/chat/completions", "https://paid.example/pro-openai/v1/chat/completions"]);
    assert.ok(calls.every((c) => !c.url.includes("{model}")));
    assert.equal((await assistant.status(user1)).providers.find((p) => p.name === "kie")?.usedTokens, 120);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("errors inside a 200 body: 401 skips the provider, bare JSON in the stream, plain JSON answers", async () => {
  const fn401 = (async () => Response.json({ code: 401, msg: "You do not have access permissions" })) as typeof fetch;
  const endpoint = { provider: "kie", which: "cloud" as const, baseUrl: "https://paid.example/m/v1", apiKey: KEY, model: "m", paid: true };
  await assert.rejects(chatClient(endpoint, 5000, fn401)({ messages: [{ role: "user", content: "hi" }], tools: null }), /http 401/);
  const streamed = (async () => new Response('{"code":429,"msg":"Rate limited"}\n', { status: 200, headers: { "content-type": "text/event-stream" } })) as typeof fetch;
  await assert.rejects(chatClient(endpoint, 5000, streamed)({ messages: [{ role: "user", content: "hi" }], tools: null }), (e: Error & { limit?: boolean }) => e.limit === true);
  const plain = (async () => Response.json({ choices: [{ message: { content: "Привет" } }], usage: { total_tokens: 7 } })) as typeof fetch;
  const reply = await chatClient(endpoint, 5000, plain)({ messages: [{ role: "user", content: "hi" }], tools: null });
  assert.deepEqual([reply.content, reply.tokens], ["Привет", 7]);
});

test("«Проверить связь» uses the check URL and reads {code} from the body", async () => {
  let code = 200;
  const urls: string[] = [];
  const fn = (async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return Response.json({ code, msg: "success", data: 100 });
  }) as typeof fetch;
  const chain = new ProviderChain(readAiConfig({ ...KIE, AI_PROVIDERS: "kie" }), fn);
  assert.deepEqual(await chain.check(), { kie: true });
  assert.deepEqual(urls, ["https://paid.example/api/v1/chat/credit"]);
  code = 401;
  assert.deepEqual(await chain.check(), { kie: false });
  assert.equal(chain.info()[0]?.state, "error");
});

/* ---- 1.6.1: tools per provider, JSON fallback, stream shapes ------------- */

function rawStream(text: string, split = 7): Response {
  const bytes = new TextEncoder().encode(text);
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += split) controller.enqueue(bytes.slice(i, i + split));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

const PAID_GPT = {
  AI_PROVIDERS: "kieai",
  AI_KIEAI_BASE_URL: "https://paid.example/{model}/v1",
  AI_KIEAI_API_KEY: KEY,
  AI_KIEAI_MODEL: "gpt-5-2",
  AI_KIEAI_PAID: "1",
  AI_KIEAI_JSON_FORMAT: "0",
};

test("config: AI_<NAME>_TOOLS and AI_LOCAL_TOOLS (default auto)", () => {
  assert.equal(readAiConfig(PAID_GPT).providers[0]?.tools, "auto");
  assert.equal(readAiConfig({ ...PAID_GPT, AI_KIEAI_TOOLS: "JSON" }).providers[0]?.tools, "json");
  assert.equal(readAiConfig({ ...PAID_GPT, AI_KIEAI_TOOLS: "native" }).providers[0]?.tools, "native");
  assert.equal(readAiConfig({ AI_LOCAL_URL: "http://pc:1234", AI_LOCAL_TOOLS: "json" }).providers[0]?.tools, "json");
  assert.equal(readAiConfig({ AI_PROVIDERS: "local", AI_LOCAL_URL: "http://pc:1234", AI_LOCAL_TOOLS: "json" }).providers[0]?.tools, "json");
});

test("token economy: only the data and tools the question needs; short ids; max_tokens; static prefix first", async () => {
  const data = seed();
  data.tasks = data.tasks.filter((t) => t.owner === "user1");
  data.tasks.push({ id: "t3", title: "Встреча с командой", notes: "", listId: null, done: false, priority: 0, due: "2026-10-13", startAt: "10:00", endAt: "11:30", tags: [], subtasks: [], createdAt: 1, completedAt: null, owner: "user1", updatedAt: 1 } as never);
  const reply = () => sse({ text: '{"reply":"Ок","actions":[]}' });
  const { assistant, store, calls, dir } = makeAssistant({ ...PAID_GPT, AI_KIEAI_TOOLS: "json", AI_KIEAI_REASONING_EFFORT: "low" }, { chat: [reply, reply, reply] }, data);
  try {
    await store.setSettings("user1", { consent: "cloud", allowPaid: true });
    await ask(assistant, "Что у меня просрочено и почему так вышло?");
    await ask(assistant, "Спланируй мой день");
    await ask(assistant, "Добавь купить молоко во вторник");
    const systems = calls.map((c) => String((c.body?.messages as { content: string }[])[0]?.content));
    // «просрочено» → only overdue
    assert.match(systems[0]!, /Просрочено:\nt2 Позвонить в банк 10-10$/);
    assert.doesNotMatch(systems[0]!, /Отчёт за квартал|Встреча/);
    // plan → today, overdue, free time today; tools for planning only
    assert.match(systems[1]!, /Задачи сегодня:\nt1 Отчёт за квартал \[Работа\] !2/);
    assert.match(systems[1]!, /Свободно \(09:00-18:00\): 10-12 пн: 10:00-18:00/);
    assert.match(systems[1]!, /рабочие действия \(приложение выполняет их из actions\): list_tasks [^\n]*; update_tasks [^\n]*; plan_day [^\n]*$/m);
    assert.doesNotMatch(systems[1]!, /create_habits/);
    // create on a day → free time of that day, no task lists
    assert.match(systems[2]!, /Свободно: 10-13 вт: 09:00-10:00, 11:30-18:00/);
    assert.doesNotMatch(systems[2]!, /Позвонить в банк/);
    // the static prefix is byte-identical
    const prefix = (t: string) => t.slice(0, t.indexOf("Ответ — ТОЛЬКО"));
    assert.equal(prefix(systems[0]!), prefix(systems[2]!));
    assert.ok(systems.every((t) => !/[0-9a-f]{8}-[0-9a-f]{4}-/.test(t)), "no long ids");
    assert.equal(calls[0]?.body?.max_tokens, 600);
    assert.equal(calls[0]?.body?.reasoning_effort, "low");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("token economy: history is the last 4 messages, long ones cut", async () => {
  const replies = Array.from({ length: 4 }, (_, i) => () => sse({ text: `Ответ ${i} ${"х".repeat(900)}` }));
  const { assistant, store, calls, dir } = makeAssistant(FREE_ONLY, { chat: replies });
  try {
    await store.setSettings("user1", { consent: "cloud" });
    let id: string | null = null;
    for (let i = 0; i < 4; i++) {
      const events = await ask(assistant, `Вопрос ${i}`, id);
      const start = events.find((e) => e.type === "start");
      id = start?.type === "start" ? start.conversationId : id;
    }
    const last = calls.at(-1)?.body?.messages as { role: string; content: string }[];
    assert.deepEqual(
      last.slice(1).map((m) => m.content.slice(0, 9)),
      ["Вопрос 1", "Ответ 1 х", "Вопрос 2", "Ответ 2 х", "Вопрос 3"].map((t) => t.slice(0, 9)),
    );
    assert.ok(last.every((m) => m.content.length < 1200 || m.role === "system"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("answers without a model: overdue, a day, free windows — zero requests, stored, marked «без модели»", async () => {
  const data = seed();
  data.tasks = data.tasks.filter((t) => t.owner === "user1");
  data.tasks.push({ id: "t3", title: "Встреча с командой", notes: "", listId: null, done: false, priority: 0, due: "2026-10-13", startAt: "10:00", endAt: "11:30", tags: [], subtasks: [], createdAt: 1, completedAt: null, owner: "user1", updatedAt: 1 } as never);
  const dir = tmp();
  const { fn, calls } = fakeFetch({ chat: [] });
  const store = new AssistantStore(dir, { dataDir: dir });
  const assistant = new Assistant({ config: readAiConfig(PAID_GPT), fetchFn: fn, store, loadData: async () => data, now: () => 1, usage: new UsageBook(null, () => 1), principal: () => user1 });
  try {
    const overdue = await ask(assistant, "Что у меня просрочено?");
    assert.deepEqual(overdue.map((e) => e.type), ["start", "delta", "done"]);
    assert.equal(overdue[0]?.type === "start" && overdue[0].provider, "app");
    const text = overdue.at(-1)?.type === "done" ? (overdue.at(-1) as { message: { text: string; provider: string } }).message : null;
    assert.equal(text?.provider, "app");
    // Terse: the list and nothing else (no preamble, no offer at the end).
    assert.equal(text!.text, "Просрочена 1 задача:\n\n- **10.10** — Позвонить в банк");
    const done = (events: ChatEvent[]) => (events.at(-1) as { message: ChatMessage }).message;
    // Drawn by the app as task rows, with one-tap follow-ups.
    assert.deepEqual(done(overdue).view, { kind: "tasks", mode: "overdue", date: TODAY, title: "Просрочена 1 задача:", ids: [data.tasks.find((t) => t.title === "Позвонить в банк")!.id], more: 0 });
    const move = done(overdue).chips?.[0];
    assert.equal(move?.label, "Перенести на завтра");
    assert.deepEqual(
      move?.proposal?.items.map((i) => i.op === "update" && [i.taskTitle, i.due, i.was?.due]),
      [["Позвонить в банк", "2026-10-13", "2026-10-10"]],
    );
    assert.deepEqual(done(overdue).chips?.[1], { label: "Спланировать день", ask: "Спланируй мой день" });
    const day = await ask(assistant, "Что на сегодня?");
    assert.equal(done(day).text, "На сегодня 1 задача:\n\n- Отчёт за квартал\n\nЕщё просрочено: 1.");
    const dayView = done(day).view;
    assert.equal(dayView?.kind === "tasks" && dayView.note, "Ещё просрочено: 1.");
    assert.deepEqual(done(day).chips?.map((c) => c.label), ["Спланировать день", "Свободные окна", "Разбить на шаги"]);
    assert.equal(done(day).chips?.[2]?.ask, "Разбей задачу «Отчёт за квартал» на шаги");
    const free = await ask(assistant, "Найди свободные окна на завтра и послезавтра");
    assert.equal(done(free).text, "Свободно (09:00–18:00):\n\n- **Завтра:** 09:00–10:00, 11:30–18:00\n- **Послезавтра:** 09:00–18:00");
    assert.deepEqual(done(free).view, { kind: "free", title: "Свободно (09:00–18:00):", days: [{ date: "2026-10-13", label: "Завтра", slots: ["09:00–10:00", "11:30–18:00"] }, { date: "2026-10-14", label: "Послезавтра", slots: ["09:00–18:00"] }] });
    // The chip's card, once applied, becomes an ordinary card of that answer.
    const conv = { id: (overdue[0] as { conversationId: string }).conversationId };
    const saved = await store.setProposal("user1", conv.id, move!.proposal!.id, "applied");
    assert.equal(saved?.status, "applied");
    const after = (await store.get("user1", conv.id))!.messages.find((m) => m.id === done(overdue).id)!;
    assert.equal(after.proposals?.[0]?.id, move!.proposal!.id);
    assert.deepEqual(after.chips?.map((c) => c.label), ["Спланировать день"]);
    assert.equal(calls.length, 0, "no model, no consent needed");
    assert.equal((await store.list("user1")).length, 3);
    // Not simple → the model is asked.
    const { intentOf } = await import("./context.ts");
    for (const q of ["Перенеси просроченные на завтра", "Что у меня просрочено и что с этим делать?", "Спланируй мой день", "Добавь встречу завтра в 10", "Найди свободное окно завтра и поставь туда звонок"]) assert.equal(intentOf(q, TODAY).local, false, q);
    for (const q of ["что просрочено", "Покажи задачи на завтра", "Когда я свободен в пятницу?", "что у меня сегодня?"]) assert.equal(intentOf(q, TODAY).local, true, q);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("TOOLS=json: no `tools` sent, actions in the JSON answer become cards", async () => {
  const { assistant, store, calls, dir } = makeAssistant(
    { ...PAID_GPT, AI_KIEAI_TOOLS: "json" },
    { chat: [() => sse({ text: '{"reply":"Предлагаю **две** задачи:","actions":[{"name":"create_tasks","arguments":{"tasks":[{"title":"Купить молоко","due":"2026-10-13","time":"10:00"},{"title":"Позвонить маме"}]}}]}' })] },
  );
  try {
    await store.setSettings("user1", { consent: "cloud", allowPaid: true });
    const events = await ask(assistant, "Добавь купить молоко послезавтра в 10 и позвонить маме");
    assert.equal(calls[0]?.body?.tools, undefined);
    assert.equal(calls[0]?.body?.response_format, undefined, "JSON_FORMAT=0");
    assert.equal(calls[0]?.url, "https://paid.example/gpt-5-2/v1/chat/completions");
    const done = events.at(-1);
    assert.equal(done?.type, "done");
    if (done?.type !== "done") return;
    assert.equal(done.message.text, "Предлагаю **две** задачи:");
    assert.deepEqual(done.message.proposals?.[0]?.items.map((i) => (i.op === "create" ? [i.title, i.due, i.start] : null)), [
      ["Купить молоко", "2026-10-13", "10:00"],
      ["Позвонить маме", null, null],
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("auto: tools silently ignored («нет доступа к инструментам») → asked again in JSON mode, remembered for next time", async () => {
  const { assistant, store, calls, dir } = makeAssistant(PAID_GPT, {
    chat: [
      () => sse({ text: "«free_slots», поэтому пока не могу. Сейчас у меня нет доступа к нужным инструментам планировщика." }),
      () => sse({ text: '{"reply":"Завтра свободно 09:00–18:00.","actions":[]}' }),
      () => sse({ text: '{"reply":"Предлагаю задачу.","actions":[{"name":"create_tasks","arguments":{"tasks":[{"title":"Тест"}]}}]}' }),
    ],
  });
  try {
    await store.setSettings("user1", { consent: "cloud", allowPaid: true });
    const events = await ask(assistant, "Найди свободные окна на завтра");
    assert.deepEqual(events.map((e) => e.type).filter((t) => t !== "delta"), ["start", "start", "done"], "the second start clears the text on screen");
    const afterReset = events.slice(events.map((e) => e.type).lastIndexOf("start") + 1).flatMap((e) => (e.type === "delta" ? [e.text] : []));
    assert.equal(afterReset.join(""), "Завтра свободно 09:00–18:00.");
    const done = events.at(-1);
    assert.equal(done?.type === "done" && done.message.text, "Завтра свободно 09:00–18:00.");
    assert.ok(Array.isArray(calls[0]?.body?.tools));
    assert.equal(calls[1]?.body?.tools, undefined);
    assert.match(String((calls[1]?.body?.messages as { content: string }[])[0]?.content), /ТОЛЬКО один JSON/);
    const next = await ask(assistant, "Добавь задачу Тест");
    assert.equal(calls[2]?.body?.tools, undefined, "remembered: straight to JSON mode");
    const card = next.at(-1);
    assert.equal(card?.type === "done" && card.message.proposals?.[0]?.items[0]?.op, "create");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("auto: a normal answer, and TOOLS=native, are not asked again", async () => {
  for (const [env, text] of [
    [PAID_GPT, "Сегодня у вас одна задача: «Отчёт за квартал»."],
    [{ ...PAID_GPT, AI_KIEAI_TOOLS: "native" }, "Сейчас у меня нет доступа к нужным инструментам."],
  ] as const) {
    const { assistant, store, calls, dir } = makeAssistant(env, { chat: [() => sse({ text })] });
    try {
      await store.setSettings("user1", { consent: "cloud", allowPaid: true });
      const events = await ask(assistant, "Что сегодня?");
      assert.equal(calls.length, 1);
      assert.equal(events.at(-1)?.type === "done" && (events.at(-1) as { message: { text: string } }).message.text, text);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("auto: tools rejected in a 200 body ({code:422,msg:'tools …'}) → JSON mode", async () => {
  const { assistant, store, calls, dir } = makeAssistant(PAID_GPT, {
    chat: [() => Response.json({ code: 422, msg: "Only the built-in web_search function is supported in tools" }), () => sse({ text: '{"reply":"Готово к работе.","actions":[]}' })],
  });
  try {
    await store.setSettings("user1", { consent: "cloud", allowPaid: true });
    const events = await ask(assistant, "Привет");
    assert.equal(events.at(-1)?.type, "done");
    assert.equal(calls[1]?.body?.tools, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/* stream shapes seen from OpenAI-compatible services */

const endpointOf = (fetchFn: typeof fetch) => chatClient({ provider: "kieai", which: "cloud", baseUrl: "https://paid.example/m/v1", apiKey: KEY, model: "m", paid: true }, 5000, fetchFn);
const chunk = (delta: Record<string, unknown>) => JSON.stringify({ id: "c1", object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason: null }] });
const TEXT = "«Завтра», поэтому свободно: **09:00–12:00**.\n\n- пункт";

test("stream: the start of the answer survives glued, split, multi-line and CRLF events", async () => {
  const parts = ["«Завтра»", ", поэтому свободно: ", "**09:00–12:00**.", "\n\n- пункт"];
  const shapes: Record<string, string> = {
    standard: `${parts.map((p) => `data: ${chunk({ content: p })}\n\n`).join("")}data: [DONE]\n\n`,
    roleFirst: `data: ${chunk({ role: "assistant", content: "" })}\n\n${parts.map((p) => `data: ${chunk({ content: p })}\n\n`).join("")}data: [DONE]\n\n`,
    noBlankLines: `${parts.map((p) => `data: ${chunk({ content: p })}\n`).join("")}data: [DONE]\n`,
    crlf: `${parts.map((p) => `data: ${chunk({ content: p })}\r\n\r\n`).join("")}data: [DONE]\r\n\r\n`,
    glued: `data: ${chunk({ content: parts[0] })}data: ${chunk({ content: parts[1] })}\n\n${parts
      .slice(2)
      .map((p) => `data: ${chunk({ content: p })}\n\n`)
      .join("")}data: [DONE]\n\n`,
    multiLine: `data: ${JSON.stringify(JSON.parse(chunk({ content: parts[0] })), null, 2)}\n\n${parts
      .slice(1)
      .map((p) => `data: ${chunk({ content: p })}\n\n`)
      .join("")}data: [DONE]\n\n`,
    withEventLines: `: keep-alive\n\n${parts.map((p) => `event: message\nid: 1\ndata: ${chunk({ content: p })}\n\n`).join("")}data: [DONE]\n\n`,
    contentParts: `${parts.map((p) => `data: ${chunk({ content: [{ type: "text", text: p }] })}\n\n`).join("")}data: [DONE]\n\n`,
    reasoningFirst: `data: ${chunk({ reasoning_content: "Думаю о free_slots…" })}\n\n${parts.map((p) => `data: ${chunk({ content: p })}\n\n`).join("")}data: [DONE]\n\n`,
    wholeMessage: `data: ${JSON.stringify({ choices: [{ index: 0, message: { role: "assistant", content: TEXT }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
  };
  for (const [name, body] of Object.entries(shapes)) {
    for (const split of [3, 64, 100_000]) {
      const shown: string[] = [];
      const reply = await endpointOf((async () => rawStream(body, split)) as typeof fetch)({ messages: [{ role: "user", content: "?" }], tools: null, onDelta: (d) => shown.push(d) });
      assert.equal(reply.content, TEXT, `${name} / ${split}`);
      assert.equal(shown.join(""), TEXT, `${name} / ${split}: streamed`);
    }
  }
});

test("stream: tool calls with index, without index, arguments as an object, in a whole message", async () => {
  const expected = [
    { name: "free_slots", arguments: '{"date":"2026-10-12"}' },
    { name: "list_tasks", arguments: '{"scope":"today"}' },
  ];
  const shapes: Record<string, string> = {
    indexed: [
      chunk({ tool_calls: [{ index: 0, id: "a", type: "function", function: { name: "free_slots", arguments: "" } }] }),
      chunk({ tool_calls: [{ index: 0, function: { arguments: '{"date":' } }] }),
      chunk({ tool_calls: [{ index: 0, function: { arguments: '"2026-10-12"}' } }] }),
      chunk({ tool_calls: [{ index: 1, id: "b", type: "function", function: { name: "list_tasks", arguments: '{"scope":"today"}' } }] }),
    ]
      .map((c) => `data: ${c}\n\n`)
      .join(""),
    noIndex: [
      chunk({ tool_calls: [{ id: "a", type: "function", function: { name: "free_slots", arguments: '{"date":' } }] }),
      chunk({ tool_calls: [{ function: { arguments: '"2026-10-12"}' } }] }),
      chunk({ tool_calls: [{ id: "b", type: "function", function: { name: "list_tasks", arguments: '{"scope":"today"}' } }] }),
    ]
      .map((c) => `data: ${c}\n\n`)
      .join(""),
    objectArgs: `data: ${chunk({ tool_calls: [{ id: "a", type: "function", function: { name: "free_slots", arguments: { date: "2026-10-12" } } }, { id: "b", type: "function", function: { name: "list_tasks", arguments: { scope: "today" } } }] })}\n\n`,
    wholeMessage: `data: ${JSON.stringify({ choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "a", type: "function", function: { name: "free_slots", arguments: '{"date":"2026-10-12"}' } }, { id: "b", type: "function", function: { name: "list_tasks", arguments: '{"scope":"today"}' } }] } }] })}\n\n`,
  };
  for (const [name, body] of Object.entries(shapes)) {
    const reply = await endpointOf((async () => rawStream(`${body}data: [DONE]\n\n`, 11)) as typeof fetch)({ messages: [{ role: "user", content: "?" }], tools: [] });
    assert.deepEqual(
      reply.toolCalls.map((c) => c.function),
      expected,
      name,
    );
  }
});

test("looksToolless: the phrases that mean the tools never reached the model", async () => {
  const { looksToolless } = await import("./agent.ts");
  for (const text of ["Сейчас у меня нет доступа к нужным инструментам планировщика.", "Не могу вызвать инструмент free_slots", "Я добавил задачу «Купить молоко».", "I don't have access to the tools", "Доступ к команде создания задач не подключён"]) assert.ok(looksToolless(text), text);
  for (const text of ["Сегодня у вас 3 задачи.", "Вы добавили много дел — давайте разберём.", "Свободно с 9 до 12."]) assert.ok(!looksToolless(text), text);
});

/* ---- 1.6.2: JSON mode as seen from the paid service --------------------- */

const SAMPLE_READS = '<escape>{"reply":"","actions":[{"name":"list_tasks","arguments":{"scope":"today"}},{"name":"list_tasks","arguments":{"scope":"overdue"}},{"name":"free_slots","arguments":{"date":"2026-10-12"}}]}</escape>';

test("JSON mode: read requests are run on the server and fed back; the screen never shows JSON", async () => {
  const final = '{"reply":"План на день:\\n\\n- 10:00 **Отчёт за квартал**","actions":[{"name":"plan_day","arguments":{"date":"2026-10-12","items":[{"id":"t1","time":"10:00","end":"11:00"}]}}]}</escape>';
  const { assistant, store, calls, dir } = makeAssistant({ ...PAID_GPT, AI_KIEAI_TOOLS: "json" }, { chat: [() => sse({ text: SAMPLE_READS }), () => sse({ text: final })] });
  try {
    await store.setSettings("user1", { consent: "cloud", allowPaid: true });
    const events = await ask(assistant, "Спланируй мой день");
    const shown = events.flatMap((e) => (e.type === "delta" ? [e.text] : [])).join("");
    assert.equal(shown, "План на день:\n\n- 10:00 **Отчёт за квартал**");
    assert.doesNotMatch(shown, /"name"|actions|<\/?escape>|[{}]/);
    const second = calls[1]?.body?.messages as { role: string; content: string }[];
    assert.match(second.at(-1)!.content, /^Результаты чтения:\nlist_tasks\(\{"scope":"today"\}\): \{"scope":"today","count":\d,"tasks":\[\{"id":"t1","title":"Отчёт за квартал","due":"2026-10-12","list":"Работа","priority":2\}/);
    assert.match(second.at(-1)!.content, /free_slots\(\{"date":"2026-10-12"\}\): \{"date":"2026-10-12"/);
    const done = events.at(-1);
    assert.equal(done?.type === "done" && done.message.proposals?.[0]?.items[0]?.op, "update");
    assert.equal(done?.type === "done" && done.message.proposals?.[0]?.items[0]?.op === "update" && done.message.proposals[0].items[0].taskId, "t1");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("JSON mode: the two broken samples (start lost, </escape>) — readable text or another round, never raw keys", async () => {
  const sample1 = 'reply":"У тебя просрочена 1 задача:\\n\\n- **Позвонить в банк** — срок 10 октября.","actions":[]}</escape>';
  const sample2 = '":{"scope":"today"}},{"name":"list_tasks","arguments":{"scope":"overdue"}},{"name":"free_slots","arguments":{"date":"2026-10-12"}}]}</escape>';
  const { assistant, store, calls, dir } = makeAssistant({ ...PAID_GPT, AI_KIEAI_TOOLS: "json" }, { chat: [() => sse({ text: sample1 }), () => sse({ text: sample2 }), () => sse({ text: '{"reply":"Готово: план ниже.","actions":[]}' })] });
  try {
    await store.setSettings("user1", { consent: "cloud", allowPaid: true });
    const first = await ask(assistant, "Что у меня просрочено и что с этим делать?");
    assert.equal((first.at(-1) as { message: { text: string } }).message.text, "У тебя просрочена 1 задача:\n\n- **Позвонить в банк** — срок 10 октября.");
    const second = await ask(assistant, "Спланируй мой день");
    assert.equal(calls.length, 3, "the read requests got a second round");
    assert.equal((second.at(-1) as { message: { text: string } }).message.text, "Готово: план ниже.");
    for (const e of [...first, ...second]) if (e.type === "delta") assert.doesNotMatch(e.text, /reply"|"actions|"name"|escape/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("JSON mode: the model keeps asking to read → stops after a few rounds with a plain message", async () => {
  const reads = () => sse({ text: SAMPLE_READS });
  const { assistant, store, calls, dir } = makeAssistant({ ...PAID_GPT, AI_KIEAI_TOOLS: "json" }, { chat: [reads, reads, reads, reads, reads, reads] });
  try {
    await store.setSettings("user1", { consent: "cloud", allowPaid: true });
    const events = await ask(assistant, "Спланируй мой день");
    assert.ok(calls.length <= 5);
    assert.equal(events.at(-1)?.type, "done");
    assert.doesNotMatch(JSON.stringify(events), /\\"name\\"/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("stream: an event with a raw control byte (leaked special token) keeps its text — the lost start", async () => {
  const first = `data: {"choices":[{"index":0,"delta":{"role":"assistant","content":"\u001b{\\"reply\\":\\"Привет"}}]}\n\n`;
  const rest = `data: ${chunk({ content: ', мир","actions":[]}' })}\n\ndata: [DONE]\n\n`;
  const reply = await endpointOf((async () => rawStream(first + rest, 5)) as typeof fetch)({ messages: [{ role: "user", content: "?" }], tools: null });
  assert.equal(reply.content, '{"reply":"Привет, мир","actions":[]}');
  const bom = await endpointOf((async () => rawStream(`\ufeff${`data: ${chunk({ content: "Начало" })}\n\n`}data: ${chunk({ content: " и конец" })}\n\n`, 3)) as typeof fetch)({ messages: [{ role: "user", content: "?" }], tools: null });
  assert.equal(bom.content, "Начало и конец");
});

test("max_tokens: rejected parameter → asked again without it (and remembered); empty answer cut by the cap → once more uncapped", async () => {
  const bodies: Record<string, unknown>[] = [];
  let turn = 0;
  const answers = [
    () => Response.json({ code: 422, msg: "Unrecognized request argument supplied: max_tokens" }),
    () => sse({ text: "Ок" }),
    () => sse({ text: "Снова ок" }),
  ];
  const fn = (async (_u: unknown, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    return answers[turn++]!();
  }) as typeof fetch;
  const ep = { provider: "strict", which: "cloud" as const, baseUrl: "https://s/v1", apiKey: KEY, model: "m-strict", paid: true, maxTokens: 600 };
  assert.equal((await chatClient(ep, 5000, fn)({ messages: [{ role: "user", content: "?" }], tools: null })).content, "Ок");
  assert.equal((await chatClient(ep, 5000, fn)({ messages: [{ role: "user", content: "?" }], tools: null })).content, "Снова ок");
  assert.deepEqual(
    bodies.map((b) => b.max_tokens),
    [600, undefined, undefined],
  );
  const cut: Record<string, unknown>[] = [];
  let n = 0;
  const fn2 = (async (_u: unknown, init?: RequestInit) => {
    cut.push(JSON.parse(String(init?.body)));
    return n++ === 0 ? rawStream(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "length" }], usage: { total_tokens: 700 } })}\n\ndata: [DONE]\n\n`) : sse({ text: "Полный ответ", usage: 900 });
  }) as typeof fetch;
  const reply = await chatClient({ ...ep, provider: "thinker", model: "m-think" }, 5000, fn2)({ messages: [{ role: "user", content: "?" }], tools: null });
  assert.deepEqual([reply.content, reply.tokens, cut[0]?.max_tokens, cut[1]?.max_tokens], ["Полный ответ", 1600, 600, undefined]);
});

test("a question asked without network is queued once and answered in the background", async () => {
  const clock = 2_000_000;
  const { assistant, store, dir } = makeAssistant(FREE_ONLY, { chat: [() => sse({ text: "Ответ без спешки." })] }, seed(), () => clock);
  try {
    await store.setSettings("user1", { consent: "cloud" });
    const first = await assistant.enqueueQuestion(user1, { text: "Что у меня завтра?", conversationId: null, clientId: "abc123def456" });
    assert.ok(first && first !== "known");
    assert.equal(first.nextAt, clock, "asked at the next pass, not in 5 minutes");
    const again = await assistant.enqueueQuestion(user1, { text: "Что у меня завтра?", conversationId: null, clientId: "abc123def456" });
    assert.equal(again !== "known" && again?.id, first.id, "a repeated upload does not ask twice");
    assert.equal((await store.queue("user1")).length, 1);
    assert.deepEqual(await assistant.processQueue(), { answered: 1, retried: 0, expired: 0 });
    const conv = await store.get("user1", first.conversationId);
    assert.deepEqual(conv?.messages.map((m) => [m.role, m.text]), [
      ["user", "Что у меня завтра?"],
      ["assistant", "Ответ без спешки."],
    ]);
    assert.equal((await store.notices("user1"))[0]?.text, "Помощник ответил");
    assert.equal(await assistant.enqueueQuestion(user1, { text: "Что у меня завтра?", conversationId: first.conversationId, clientId: "abc123def456" }), "known");
    assert.deepEqual(await store.queue("user2"), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/* ---- 1.8.1: «что ты умеешь» and JSON-mode actions with a tool-less service ---- */

const KIE_LIKE = { AI_PROVIDERS: "kieai", AI_KIEAI_BASE_URL: "https://api.example.com/v1", AI_KIEAI_API_KEY: KEY, AI_KIEAI_MODEL: "m-json", AI_KIEAI_TOOLS: "json", AI_KIEAI_REASONING_EFFORT: "low" };
/** A service that ignores `tools` and answers with one plain (non-streamed) completion. */
const plainReply = (content: string) => () => Response.json({ choices: [{ message: { content } }], usage: { total_tokens: 300 } });

test("1.8.1: meta questions are answered by the app, without a model", async () => {
  const { intentOf, isMetaQuestion } = await import("./context.ts");
  for (const q of ["Что ты умеешь?", "что можешь делать", "Какие права тебе нужны?", "напиши какие задачи ты можешь сделать и какие права и команды тебе нужны чтоб я открыл доступ", "какие у тебя команды"]) {
    assert.ok(isMetaQuestion(q), q);
    assert.equal(intentOf(q, TODAY).kind, "about", q);
  }
  for (const q of ["добавь задачу купить хлеб завтра в 10", "что на сегодня?", "перенеси отчёт на пятницу", "напомни что ты умеешь готовить"]) assert.notEqual(intentOf(q, TODAY).kind, "about", q);

  const dir = tmp();
  const { fn, calls } = fakeFetch({ chat: [] });
  const assistant = new Assistant({ config: readAiConfig(KIE_LIKE), fetchFn: fn, store: new AssistantStore(dir, { dataDir: dir }), loadData: async () => seed(), now: () => 1, usage: new UsageBook(null, () => 1), principal: () => user1 });
  const events = await ask(assistant, "Что ты умеешь и какие права тебе нужны?");
  const done = events.find((e) => e.type === "done") as Extract<ChatEvent, { type: "done" }>;
  assert.ok(done, "answered");
  assert.equal(done.message.provider, "app");
  assert.equal(calls.filter((c) => c.url.endsWith("/chat/completions")).length, 0, "0 tokens: no model call");
  assert.match(done.message.text, /^Умею:/);
  assert.match(done.message.text, /открывать доступ не нужно/);
  assert.doesNotMatch(done.message.text, /list_tasks|create_tasks|update_tasks|plan_day/);
  rmSync(dir, { recursive: true, force: true });
});

test("1.8.1: JSON mode with a tool-less service still turns «добавь задачу» into a card", async () => {
  const action = { reply: "Добавлю.", actions: [{ name: "create_tasks", arguments: { tasks: [{ title: "Купить хлеб", due: "2026-10-13", time: "10:00" }] } }] };
  const { assistant, calls, dir, store } = makeAssistant(KIE_LIKE, { chat: [plainReply(JSON.stringify(action))] });
  await store.setSettings("user1", { consent: "cloud" });
  const events = await ask(assistant, "добавь задачу купить хлеб завтра в 10");
  const sent = calls.find((c) => c.url.endsWith("/chat/completions"))!.body!;
  assert.equal(sent.tools, undefined, "json mode: tools are never sent");
  assert.equal(sent.reasoning_effort, "low");
  const proposal = events.find((e) => e.type === "proposal") as Extract<ChatEvent, { type: "proposal" }>;
  assert.ok(proposal, "a card is offered");
  assert.equal(proposal.proposal.items[0]?.op, "create");
  assert.equal((proposal.proposal.items[0] as { title: string }).title, "Купить хлеб");
  assert.equal((proposal.proposal.items[0] as { start: string | null }).start, "10:00");
  rmSync(dir, { recursive: true, force: true });
});

test("1.8.1: the prompt says the actions work and forbids asking to open access", async () => {
  const { systemPrompt } = await import("./agent.ts");
  const ctx = { data: seed(), today: TODAY, now: "10:00", newId: () => "x" };
  for (const json of [true, false]) {
    const prompt = systemPrompt(ctx, { json });
    assert.match(prompt, /подключены и работают/);
    assert.match(prompt, /Никогда не проси открыть доступ/);
  }
  assert.match(systemPrompt(ctx, { json: true }), /рабочие действия \(приложение выполняет их из actions\)/);
});

test("1.8.1: a reply that names tools or asks to open access is replaced by the app's list", async () => {
  const { leaksTools } = await import("./agent.ts");
  assert.ok(leaksTools("Нужны list_tasks и create_tasks"));
  assert.ok(leaksTools("Интеграция должна открыть доступ к задачам"));
  assert.ok(leaksTools("Это перечень команд, заявленных в конфигурации планировщика"));
  assert.ok(!leaksTools("На завтра две задачи."));
  const leak = { reply: "Команды list_tasks, create_tasks заявлены в конфигурации; нужно открыть доступ.", actions: [] };
  const { assistant, dir, store } = makeAssistant(KIE_LIKE, { chat: [plainReply(JSON.stringify(leak))] });
  await store.setSettings("user1", { consent: "cloud" });
  const events = await ask(assistant, "расскажи подробно про свою интеграцию");
  const done = events.find((e) => e.type === "done") as Extract<ChatEvent, { type: "done" }>;
  assert.match(done.message.text, /^Умею:/);
  assert.doesNotMatch(done.message.text, /list_tasks|открыть доступ/);
  rmSync(dir, { recursive: true, force: true });
});

test("1.8.1: JSON mode retries once when the model says «доступ не подключён» instead of create_tasks", async () => {
  const refuse = { reply: "Доступ к команде создания задач не подключён. Интеграция должна открыть доступ.", actions: [] };
  const ok = { reply: "Добавлю.", actions: [{ name: "create_tasks", arguments: { tasks: [{ title: "Купить хлеб", due: "2026-10-13", time: "10:00" }] } }] };
  const { assistant, calls, dir, store } = makeAssistant(KIE_LIKE, { chat: [plainReply(JSON.stringify(refuse)), plainReply(JSON.stringify(ok))] });
  await store.setSettings("user1", { consent: "cloud" });
  const events = await ask(assistant, "добавь задачу купить хлеб завтра в 10");
  assert.equal(calls.filter((c) => c.url.endsWith("/chat/completions")).length, 2, "one nudge retry");
  const nudge = calls[1]!.body!.messages as { role: string; content: string }[];
  assert.match(nudge.at(-1)!.content, /Действия уже подключены/);
  const proposal = events.find((e) => e.type === "proposal") as Extract<ChatEvent, { type: "proposal" }>;
  assert.ok(proposal, "card after retry");
  assert.equal((proposal.proposal.items[0] as { title: string }).title, "Купить хлеб");
  const done = events.find((e) => e.type === "done") as Extract<ChatEvent, { type: "done" }>;
  assert.doesNotMatch(done.message.text, /не подключ|открыть доступ|create_tasks/);
  rmSync(dir, { recursive: true, force: true });
});

test("1.8.1: leaksTools catches «доступ к команде … не подключён»", async () => {
  const { leaksTools, looksToolless } = await import("./agent.ts");
  const text = "Доступ к команде создания задач не подключён";
  assert.ok(leaksTools(text));
  assert.ok(looksToolless(text));
});
