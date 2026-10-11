/**
 * One answer of «Помощник»: the model may read the user's data through tools
 * (several rounds) and prepare changes, which come back as proposals.
 * Models without function calling get the same tools described in the prompt
 * and answer with JSON (fallback mode).
 */
import type { Proposal } from "../../../src/lib/assistant/types.ts";
import type { ToolsMode } from "./config.ts";
import { TOOL_SPECS, WRITE_TOOLS, runTool, snapshot, type ToolContext } from "./tools.ts";
import { ToolsUnsupportedError, type ChatFn, type WireMessage } from "./provider.ts";

const WEEKDAYS = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];
const MAX_ROUNDS = 5;

export function systemPrompt(ctx: ToolContext): string {
  const weekday = WEEKDAYS[new Date(`${ctx.today}T12:00:00Z`).getUTCDay()] ?? "";
  const lists = ctx.data.lists
    .map((l) => (typeof l.name === "string" ? l.name : ""))
    .filter(Boolean)
    .slice(0, 30);
  return [
    "Ты — «Помощник» в планировщике «Пора». Отвечай по-русски, коротко и по делу. Можно простой markdown: **жирный**, *курсив*, списки «- » и «1. »; без таблиц и HTML.",
    `Сегодня ${ctx.today} (${weekday}), сейчас ${ctx.now}. Списки: ${lists.length ? lists.join(", ") : "только «Входящие»"}.`,
    snapshot(ctx),
    "Отвечай по этим данным; подробности (задачи без даты, поиск, другой день) читай инструментами list_tasks, search_tasks, free_slots. Не выдумывай задачи и не говори, что у тебя нет доступа к данным.",
    "Чтобы что-то создать или изменить, вызывай инструменты create_tasks, update_tasks, complete_tasks, break_down_task, plan_day, create_habits: они ничего не меняют сами, а показывают пользователю карточку для подтверждения. Не пиши, что изменения уже сделаны.",
    "Для плана дня сначала узнай задачи на сегодня и просроченные и свободное время, потом предложи plan_day.",
    "Даты — YYYY-MM-DD, время — HH:mm. «Завтра», «в пятницу» переводи в даты сам.",
  ].join("\n");
}

function jsonModePrompt(): string {
  const tools = TOOL_SPECS.map((t) => `- ${t.function.name}: ${t.function.description} Параметры: ${JSON.stringify(t.function.parameters.properties)}`).join("\n");
  return [
    "Вызов функций здесь не работает: инструменты вызываются через JSON. Отвечай ТОЛЬКО одним JSON-объектом, без текста вокруг:",
    '{"reply":"текст для пользователя","actions":[{"name":"имя инструмента","arguments":{...}}]}',
    "Чтобы что-то создать или изменить, положи инструмент записи в actions — пользователь увидит карточку и подтвердит; в reply коротко скажи, что предлагаешь. Если хватает данных выше — отвечай сразу, actions пустой. Чтобы дочитать данные, верни actions с инструментом чтения и пустой reply — результат придёт следующим сообщением. Доступно:",
    tools,
  ].join("\n");
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

/** Pulls `{"reply":…, "actions":[…]}` out of a JSON-mode answer (tolerates ```json fences and prose around). */
export function parseJsonReply(raw: string): { reply: string; actions: { name: string; arguments: unknown }[] } {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return { reply: cleaned.trim(), actions: [] };
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1)) as { reply?: unknown; actions?: unknown };
    const actions = Array.isArray(parsed.actions)
      ? parsed.actions.flatMap((a) => {
          const row = (a ?? {}) as { name?: unknown; arguments?: unknown };
          return typeof row.name === "string" ? [{ name: row.name, arguments: row.arguments ?? {} }] : [];
        })
      : [];
    return { reply: typeof parsed.reply === "string" ? parsed.reply : "", actions };
  } catch {
    return { reply: cleaned.trim(), actions: [] };
  }
}

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
  signal?: AbortSignal;
}): Promise<AgentResult & { jsonMode: boolean }> {
  const { chat, ctx, events, signal } = options;
  const mode: ToolsMode = options.jsonMode ? "json" : (options.tools ?? "auto");
  let jsonMode = mode === "json";
  let calledTools = false;
  const proposals: Proposal[] = [];
  const base: WireMessage[] = [{ role: "system", content: systemPrompt(ctx) }, ...options.history.map((m) => ({ role: m.role, content: m.text }) as WireMessage)];
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
        reply = await chat({ messages, tools: TOOL_SPECS, onDelta: (d) => ((text += d), events.onDelta(d)), signal });
      } catch (error) {
        if (!(error instanceof ToolsUnsupportedError)) throw error;
        if (text) {
          text = "";
          events.onReset?.();
        }
        jsonMode = true;
        messages = [{ role: "system", content: `${systemPrompt(ctx)}\n${jsonModePrompt()}` }, ...base.slice(1)];
        round--;
        continue;
      }
      if (!reply.toolCalls.length) {
        // auto: the model answered without ever calling a tool but clearly needed one → ask again in JSON mode.
        if (mode === "auto" && !calledTools && !proposals.length && looksToolless(reply.content)) {
          text = "";
          events.onReset?.();
          jsonMode = true;
          messages = [{ role: "system", content: `${systemPrompt(ctx)}\n${jsonModePrompt()}` }, ...base.slice(1)];
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
    // JSON mode: no streaming of raw JSON; the reply text is sent at once.
    if (messages[0]?.role === "system" && !messages[0].content.includes('"actions"')) messages[0] = { role: "system", content: `${systemPrompt(ctx)}\n${jsonModePrompt()}` };
    const reply = await chat({ messages, tools: null, signal });
    const parsed = parseJsonReply(reply.content);
    const reads: string[] = [];
    for (const action of parsed.actions) {
      const result = runTool(action.name, (action.arguments ?? {}) as Record<string, unknown>, ctx);
      take(result.proposal);
      if (!WRITE_TOOLS.has(action.name)) reads.push(`${action.name}: ${result.content}`);
    }
    if (reads.length && !parsed.reply.trim()) {
      messages.push({ role: "assistant", content: reply.content }, { role: "user", content: `Результаты:\n${reads.join("\n")}\nТеперь ответь пользователю тем же JSON.` });
      continue;
    }
    const answer = parsed.reply.trim() || (proposals.length ? "Вот что предлагаю:" : "");
    if (answer) {
      text += answer;
      events.onDelta(answer);
    }
    return { text, proposals, jsonMode };
  }
  if (!text.trim()) {
    const fallback = proposals.length ? "Вот что предлагаю:" : "Не получилось ответить. Попробуйте сформулировать короче.";
    text = fallback;
    events.onDelta(fallback);
  }
  return { text, proposals, jsonMode };
}
