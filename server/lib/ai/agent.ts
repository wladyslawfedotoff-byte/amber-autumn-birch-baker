/**
 * One answer of «Помощник»: the model may read the user's data through tools
 * (several rounds) and prepare changes, which come back as proposals.
 * Models without function calling get the same tools described in the prompt
 * and answer with JSON (fallback mode).
 */
import type { Proposal } from "../../../src/lib/assistant/types.ts";
import { TOOL_SPECS, WRITE_TOOLS, runTool, type ToolContext } from "./tools.ts";
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
    "Ты — «Помощник» в планировщике «Пора». Отвечай по-русски, коротко и по делу, без markdown-таблиц.",
    `Сегодня ${ctx.today} (${weekday}), сейчас ${ctx.now}. Списки: ${lists.length ? lists.join(", ") : "только «Входящие»"}.`,
    "Данные пользователя читай инструментами (list_tasks, search_tasks, free_slots) — не выдумывай задачи.",
    "Чтобы что-то создать или изменить, вызывай инструменты create_tasks, update_tasks, complete_tasks, break_down_task, plan_day, create_habits: они ничего не меняют сами, а показывают пользователю карточку для подтверждения. Не пиши, что изменения уже сделаны.",
    "Для плана дня сначала узнай задачи на сегодня и просроченные и свободное время, потом предложи plan_day.",
    "Даты — YYYY-MM-DD, время — HH:mm. «Завтра», «в пятницу» переводи в даты сам.",
  ].join("\n");
}

function jsonModePrompt(): string {
  const tools = TOOL_SPECS.map((t) => `- ${t.function.name}: ${t.function.description} Параметры: ${JSON.stringify(t.function.parameters.properties)}`).join("\n");
  return [
    "Инструменты недоступны напрямую. Отвечай ТОЛЬКО одним JSON-объектом:",
    '{"reply":"текст для пользователя","actions":[{"name":"имя инструмента","arguments":{...}}]}',
    "Чтобы прочитать данные, верни actions с инструментом чтения и пустой reply — результат придёт следующим сообщением. Доступно:",
    tools,
  ].join("\n");
}

export type AgentEvents = {
  onDelta: (text: string) => void;
  onProposal: (proposal: Proposal) => void;
};

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
  jsonMode?: boolean;
  signal?: AbortSignal;
}): Promise<AgentResult & { jsonMode: boolean }> {
  const { chat, ctx, events, signal } = options;
  let jsonMode = options.jsonMode ?? false;
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
        jsonMode = true;
        messages = [{ role: "system", content: `${systemPrompt(ctx)}\n${jsonModePrompt()}` }, ...base.slice(1)];
        round--;
        continue;
      }
      if (!reply.toolCalls.length) return { text, proposals, jsonMode };
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
