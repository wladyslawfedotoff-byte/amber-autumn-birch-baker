/**
 * One answer of «Помощник»: the model may read the user's data through tools
 * (several rounds) and prepare changes, which come back as proposals.
 * Models without function calling get the same tools described in the prompt
 * and answer with JSON (fallback mode).
 */
import type { Proposal } from "../../../src/lib/assistant/types.ts";
import type { ToolsMode } from "./config.ts";
import { TOOL_SPECS, WRITE_TOOLS, runTool, type ToolContext } from "./tools.ts";
import { ToolsUnsupportedError, type ChatFn, type ToolSpec, type WireMessage } from "./provider.ts";
import { contextFor, intentOf, toolsFor, type Intent } from "./context.ts";
import { ReplyStreamer, parseJsonReply } from "./json-reply.ts";
import { log } from "../log.ts";

const WEEKDAYS = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];
const MAX_ROUNDS = 5;
/** JSON mode: rounds of read requests before the model must answer. */
const MAX_JSON_READS = 4;

/*
 * Prompt layout, cheapest first: a static prefix that is byte-identical in
 * every request (providers cache it), then the JSON-mode rules, then the
 * per-request part (date, the data this question needs).
 */
const CORE = [
  "Ты — деловой помощник планировщика «Пора». По-русски: 1–3 короткие строки или короткий список, без таблиц, HTML и эмодзи.",
  "Без вступлений, «конечно», пересказа вопроса и предложений в конце, если не нужны.",
  "Только данные ниже; id — как в них (t1…). Даты YYYY-MM-DD, время HH:mm.",
  "Название задачи: глагол в начале, кратко и конкретно («Позвонить в сервис — записаться на ТО»), детали — в notes/subtasks. План дня — только строки «HH:mm — задача».",
  "Изменения — только инструментами (карточка на подтверждение); не пиши, что уже сделал.",
].join("\n");

/** Compact signatures for JSON mode (the full JSON schema would cost ~4× more). */
const SIGNATURES: Record<string, string> = {
  list_tasks: 'list_tasks {scope:"today|overdue|upcoming|no_date|all", list?} — чтение',
  search_tasks: "search_tasks {query} — чтение",
  free_slots: "free_slots {date} — чтение",
  create_tasks: "create_tasks {tasks:[{title, due?, time?, end?, list?, priority?0-3, subtasks?[], notes?}]}",
  update_tasks: "update_tasks {changes:[{id, due?, time?, end?, title?, list?, priority?}]}",
  complete_tasks: "complete_tasks {ids:[]}",
  break_down_task: "break_down_task {id, steps:[]}",
  plan_day: "plan_day {date, items:[{id, time, end?}]}",
  create_habits: 'create_habits {habits:[{name, goal?, unit?, section?"morning|afternoon|evening|other", days?[1-7], times_per_week?}]}',
};

function jsonRules(tools: ToolSpec[]): string {
  return [
    'Ответ — ТОЛЬКО один JSON-объект, без ```, тегов и текста вокруг: {"reply":"текст","actions":[{"name":"…","arguments":{…}}]}',
    'Пример: {"reply":"Перенос на завтра.","actions":[{"name":"update_tasks","arguments":{"changes":[{"id":"t3","due":"2026-01-02"}]}}]}',
    "Данных ниже обычно хватает — отвечай сразу. Чтение нужно редко: тогда reply пустой, actions с чтением, ответ — следующим сообщением.",
    `Инструменты: ${tools.map((t) => SIGNATURES[t.function.name] ?? t.function.name).join("; ")}`,
  ].join("\n");
}

function dynamicPart(ctx: ToolContext, intent: Intent, question: string): string {
  const weekday = WEEKDAYS[new Date(`${ctx.today}T12:00:00Z`).getUTCDay()] ?? "";
  const lists = ["create", "update", "general"].includes(intent.kind)
    ? ctx.data.lists
        .map((l) => (typeof l.name === "string" ? l.name : ""))
        .filter(Boolean)
        .slice(0, 20)
    : [];
  const data = contextFor(intent, question, ctx);
  return [`Сегодня ${ctx.today} (${weekday}), ${ctx.now}.${lists.length ? ` Списки: ${lists.join(", ")}.` : ""}`, data].filter(Boolean).join("\n");
}

export function systemPrompt(ctx: ToolContext, options: { json?: boolean; intent?: Intent; question?: string; tools?: ToolSpec[] } = {}): string {
  const intent = options.intent ?? { kind: "general" as const, dates: [], local: false };
  return [CORE, options.json ? jsonRules(options.tools ?? TOOL_SPECS) : "", dynamicPart(ctx, intent, options.question ?? "")].filter(Boolean).join("\n");
}

export type AgentEvents = {
  onDelta: (text: string) => void;
  onProposal: (proposal: Proposal) => void;
  /** The text shown so far is dropped: the answer is asked again in JSON mode. */
  onReset?: () => void;
};

const TOOL_NAMES = TOOL_SPECS.map((t) => t.function.name).join("|");
/**
 * A tools-mode answer that shows the model never got the tools (some
 * services accept `tools` but drop them): it says it has no access, names a
 * tool instead of calling it, or claims a change was made without a card.
 */
const NO_TOOLS = new RegExp(
  [
    "нет доступа к (нужным |необходимым )?(инструмент|функци|данн|задач|календар|планировщик|расписани)",
    "не (могу|удаётся|удается|получается) (вызвать|использовать|запустить|получить доступ|посмотреть|проверить|прочитать|увидеть)[^.]{0,40}(инструмент|функци|задач|данн|календар|расписани)",
    "инструмент[а-я]* (недоступн|не доступн|не работа|не подключ)",
    "(don't|do not|cannot|can't) (have )?access (to )?(the )?(tools|functions)",
    `\\b(${TOOL_NAMES})\\b`,
    "(^|[\\s,.])(я )?(добавил|создал|перен[её]с|отметил|запланировал|поставил|разбил)(а)?( |,)",
  ].join("|"),
  "i",
);

export function looksToolless(text: string): boolean {
  return NO_TOOLS.test(text);
}

export type AgentResult = { text: string; proposals: Proposal[] };

export { parseJsonReply } from "./json-reply.ts";

export async function runAgent(options: {
  chat: ChatFn;
  ctx: ToolContext;
  /** Earlier turns of the conversation (text only) and the new question last. */
  history: { role: "user" | "assistant"; text: string }[];
  events: AgentEvents;
  /** json: describe tools in the prompt; native: always function calling; auto: native, json when tools are rejected or ignored. */
  tools?: ToolsMode;
  /** @deprecated use tools: "json" */
  jsonMode?: boolean;
  /** Decided by the caller (it may have answered locally); else from the last question. */
  intent?: Intent;
  signal?: AbortSignal;
}): Promise<AgentResult & { jsonMode: boolean }> {
  const { chat, ctx, events, signal } = options;
  const mode: ToolsMode = options.jsonMode ? "json" : (options.tools ?? "auto");
  let jsonMode = mode === "json";
  let calledTools = false;
  let jsonReads = 0;
  const proposals: Proposal[] = [];
  const question = [...options.history].reverse().find((m) => m.role === "user")?.text ?? "";
  const intent = options.intent ?? intentOf(question, ctx.today);
  const tools = toolsFor(intent);
  const prompt = (json: boolean) => systemPrompt(ctx, { json, intent, question, tools });
  const base: WireMessage[] = [{ role: "system", content: prompt(jsonMode) }, ...options.history.map((m) => ({ role: m.role, content: m.text }) as WireMessage)];
  let messages: WireMessage[] = [...base];
  let text = "";

  const take = (proposal: Proposal | null) => {
    if (!proposal) return;
    proposals.push(proposal);
    events.onProposal(proposal);
  };

  for (let round = 0; round < MAX_ROUNDS; round++) {
    if (!jsonMode) {
      let reply;
      try {
        reply = await chat({ messages, tools, onDelta: (d) => ((text += d), events.onDelta(d)), signal });
      } catch (error) {
        if (!(error instanceof ToolsUnsupportedError)) throw error;
        if (text) {
          text = "";
          events.onReset?.();
        }
        jsonMode = true;
        messages = [{ role: "system", content: prompt(true) }, ...base.slice(1)];
        round--;
        continue;
      }
      if (!reply.toolCalls.length) {
        // auto: the model answered without ever calling a tool but clearly needed one → ask again in JSON mode.
        if (mode === "auto" && !calledTools && !proposals.length && looksToolless(reply.content)) {
          text = "";
          events.onReset?.();
          jsonMode = true;
          messages = [{ role: "system", content: prompt(true) }, ...base.slice(1)];
          round--;
          continue;
        }
        return { text, proposals, jsonMode };
      }
      calledTools = true;
      messages.push({ role: "assistant", content: reply.content || null, tool_calls: reply.toolCalls });
      for (const call of reply.toolCalls) {
        const result = runTool(call.function.name, call.function.arguments, ctx);
        take(result.proposal);
        messages.push({ role: "tool", tool_call_id: call.id, content: result.content });
      }
      continue;
    }
    // JSON mode: only the reply string is streamed, never the JSON around it.
    if (messages[0]?.role === "system" && !messages[0].content.includes("ТОЛЬКО один JSON")) messages[0] = { role: "system", content: prompt(true) };
    const streamer = new ReplyStreamer();
    const reply = await chat({ messages, tools: null, signal, onDelta: (d) => streamer.push(d, events.onDelta) });
    const parsed = parseJsonReply(reply.content);
    if (!parsed.ok) log("warn", "assistant.json_unparsed", { count: 1 });
    const writes = parsed.actions.filter((a) => WRITE_TOOLS.has(a.name));
    const reads = parsed.actions.filter((a) => !WRITE_TOOLS.has(a.name));
    // Only reads (with or without «сейчас посмотрю»): run them, feed the results back, ask again.
    if (reads.length && !writes.length && jsonReads < MAX_JSON_READS) {
      jsonReads++;
      if (streamer.shown) events.onReset?.();
      const results = reads.map((a) => `${a.name}(${JSON.stringify(a.arguments ?? {})}): ${runTool(a.name, (a.arguments ?? {}) as Record<string, unknown>, ctx).content}`);
      messages.push(
        { role: "assistant", content: JSON.stringify({ reply: "", actions: reads }) },
        { role: "user", content: `Результаты чтения:\n${results.join("\n")}\nТеперь ответь пользователю одним JSON-объектом {"reply": "...", "actions": [...]}, без новых чтений, если данных хватает.` },
      );
      round--;
      continue;
    }
    const answer = parsed.reply.trim() || (writes.length ? "Проверьте карточку." : "");
    if (!answer) {
      if (streamer.shown) events.onReset?.();
      break;
    }
    // What was streamed must equal the final text; otherwise show the final text afresh.
    if (streamer.shown && streamer.shown.trim() !== answer) events.onReset?.();
    for (const action of writes) take(runTool(action.name, (action.arguments ?? {}) as Record<string, unknown>, ctx).proposal);
    if (answer) {
      text = answer;
      if (streamer.shown.trim() !== answer) events.onDelta(answer);
    }
    return { text, proposals, jsonMode };
  }
  if (!text.trim()) {
    const fallback = proposals.length ? "Проверьте карточку." : "Не получилось ответить. Попробуйте сформулировать короче.";
    text = fallback;
    events.onDelta(fallback);
  }
  return { text, proposals, jsonMode };
}
