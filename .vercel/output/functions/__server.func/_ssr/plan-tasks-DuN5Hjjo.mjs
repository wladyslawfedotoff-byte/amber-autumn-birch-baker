import { r as createServerFn } from "./ssr.mjs";
import { t as createServerRpc } from "./createServerRpc-CcvdN_gc.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/plan-tasks-DuN5Hjjo.js
function asPlan(input) {
	const data = input ?? {};
	return {
		mode: data.mode === "plan" ? "plan" : "capture",
		text: String(data.text ?? "").trim().slice(0, 1500),
		today: String(data.today ?? "").slice(0, 10),
		lists: Array.isArray(data.lists) ? data.lists.map(String).slice(0, 20) : [],
		openTasks: Array.isArray(data.openTasks) ? data.openTasks.map(String).slice(0, 30) : []
	};
}
function parseTasks(raw) {
	const cleaned = raw.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/, "").trim();
	const parsed = JSON.parse(cleaned);
	const tasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];
	return {
		note: typeof parsed.note === "string" ? parsed.note.slice(0, 500) : "",
		tasks: tasks.slice(0, 8).flatMap((item) => {
			if (!item || typeof item !== "object") return [];
			const row = item;
			const title = String(row.title ?? "").trim().slice(0, 140);
			if (!title) return [];
			return [{
				title,
				due: typeof row.due === "string" && /^\d{4}-\d{2}-\d{2}$/.test(row.due) ? row.due : null,
				list: typeof row.list === "string" && row.list.trim() ? row.list.trim().slice(0, 40) : null,
				important: Boolean(row.important),
				urgent: Boolean(row.urgent)
			}];
		})
	};
}
var planTasks_createServerFn_handler = createServerRpc({
	id: "e408d72742efa804e11abe92a1bc96d9037502ba50a4946b4fda806cebe4fd74",
	name: "planTasks",
	filename: "src/lib/plan-tasks.ts"
}, (opts) => planTasks.__executeServer(opts));
var planTasks = createServerFn({ method: "POST" }).validator(asPlan).handler(planTasks_createServerFn_handler, async ({ data }) => {
	if (data.mode === "capture" && !data.text) return {
		ok: false,
		error: "Напишите, что разобрать."
	};
	const apiKey = process.env.XAI_API_KEY;
	if (!apiKey) return {
		ok: false,
		error: "Помощник сейчас недоступен."
	};
	const instruction = data.mode === "plan" ? "Составь короткий план на сегодня по уже открытым задачам. В note — 3–5 фраз, что делать сначала. В tasks добавь задачу только если её явно не хватает, иначе пустой массив." : "Разложи текст на конкретные задачи. Не выдумывай то, чего нет в тексте.";
	const res = await fetch("https://api.x.ai/v1/chat/completions", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${apiKey}`
		},
		body: JSON.stringify({
			model: "grok-4.5",
			temperature: .2,
			max_tokens: 600,
			messages: [{
				role: "system",
				content: "Ты помощник планировщика. Отвечай только JSON без markdown: {\"note\":\"коротко по-русски\",\"tasks\":[{\"title\":\"\",\"due\":\"YYYY-MM-DD или null\",\"list\":\"имя списка или null\",\"important\":false,\"urgent\":false}]}. Не больше 8 задач."
			}, {
				role: "user",
				content: [
					instruction,
					`Сегодня: ${data.today || "неизвестно"}.`,
					`Списки: ${data.lists.join(", ") || "нет"}.`,
					`Открытые задачи: ${data.openTasks.join("; ") || "нет"}.`,
					`Текст: ${data.text || "составь план по открытым задачам"}`
				].join("\n")
			}]
		})
	});
	if (!res.ok) return {
		ok: false,
		error: "Не удалось спросить помощника. Попробуйте ещё раз."
	};
	const content = (await res.json()).choices?.[0]?.message?.content ?? "";
	try {
		return {
			ok: true,
			...parseTasks(content)
		};
	} catch {
		return {
			ok: false,
			error: "Помощник ответил неразборчиво. Попробуйте короче."
		};
	}
});
//#endregion
export { planTasks_createServerFn_handler };
