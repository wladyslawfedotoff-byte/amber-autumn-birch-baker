import { createServerFn } from "@tanstack/react-start";

export type PlannedTask = {
  title: string;
  due: string | null;
  list: string | null;
  important: boolean;
  urgent: boolean;
};

export type PlanResult =
  | { ok: true; note: string; tasks: PlannedTask[] }
  | { ok: false; error: string };

type PlanInput = {
  mode: "capture" | "plan";
  text: string;
  today: string;
  lists: string[];
  openTasks: string[];
};

function asPlan(input: unknown): PlanInput {
  const data = (input ?? {}) as Partial<PlanInput>;
  const mode = data.mode === "plan" ? "plan" : "capture";
  return {
    mode,
    text: String(data.text ?? "").trim().slice(0, 1500),
    today: String(data.today ?? "").slice(0, 10),
    lists: Array.isArray(data.lists) ? data.lists.map(String).slice(0, 20) : [],
    openTasks: Array.isArray(data.openTasks) ? data.openTasks.map(String).slice(0, 30) : [],
  };
}

function parseTasks(raw: string): { note: string; tasks: PlannedTask[] } {
  const cleaned = raw
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/, "")
    .trim();
  const parsed = JSON.parse(cleaned) as { note?: unknown; tasks?: unknown };
  const tasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];
  return {
    note: typeof parsed.note === "string" ? parsed.note.slice(0, 500) : "",
    tasks: tasks.slice(0, 8).flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const row = item as Record<string, unknown>;
      const title = String(row.title ?? "").trim().slice(0, 140);
      if (!title) return [];
      const due = typeof row.due === "string" && /^\d{4}-\d{2}-\d{2}$/.test(row.due) ? row.due : null;
      const list = typeof row.list === "string" && row.list.trim() ? row.list.trim().slice(0, 40) : null;
      return [
        {
          title,
          due,
          list,
          important: Boolean(row.important),
          urgent: Boolean(row.urgent),
        },
      ];
    }),
  };
}

export const planTasks = createServerFn({ method: "POST" })
  .validator(asPlan)
  .handler(async ({ data }): Promise<PlanResult> => {
    if (data.mode === "capture" && !data.text) {
      return { ok: false, error: "Напишите, что разобрать." };
    }
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) return { ok: false, error: "Помощник сейчас недоступен." };

    const instruction =
      data.mode === "plan"
        ? "Составь короткий план на сегодня по уже открытым задачам. В note — 3–5 фраз, что делать сначала. В tasks добавь задачу только если её явно не хватает, иначе пустой массив."
        : "Разложи текст на конкретные задачи. Не выдумывай то, чего нет в тексте.";

    const res = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "grok-4.5",
        temperature: 0.2,
        max_tokens: 600,
        messages: [
          {
            role: "system",
            content:
              "Ты помощник планировщика. Отвечай только JSON без markdown: " +
              '{"note":"коротко по-русски","tasks":[{"title":"","due":"YYYY-MM-DD или null","list":"имя списка или null","important":false,"urgent":false}]}. ' +
              "Не больше 8 задач.",
          },
          {
            role: "user",
            content: [
              instruction,
              `Сегодня: ${data.today || "неизвестно"}.`,
              `Списки: ${data.lists.join(", ") || "нет"}.`,
              `Открытые задачи: ${data.openTasks.join("; ") || "нет"}.`,
              `Текст: ${data.text || "составь план по открытым задачам"}`,
            ].join("\n"),
          },
        ],
      }),
    });

    if (!res.ok) return { ok: false, error: "Не удалось спросить помощника. Попробуйте ещё раз." };
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = body.choices?.[0]?.message?.content ?? "";
    try {
      return { ok: true, ...parseTasks(content) };
    } catch {
      return { ok: false, error: "Помощник ответил неразборчиво. Попробуйте короче." };
    }
  });
