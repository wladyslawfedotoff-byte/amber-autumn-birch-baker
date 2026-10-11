import assert from "node:assert/strict";
import test from "node:test";
import { ReplyStreamer, parseJsonReply, repairJson } from "./json-reply.ts";

// Exactly what the screen showed (the start of the answer lost, a tag token at the end).
const SAMPLE_1 = 'reply":"У тебя просрочены 2 задачи:\\n\\n- **Взять контакт по маркировке** — срок 7 октября. Приоритет: средний (2).\\n- **Заказать парапет** — срок 9 октября.\\n\\nОбе задачи уже просрочены. Могу перенести их на ближайшие свободные дни.","actions":[]}</escape>';
const SAMPLE_1_TEXT = "У тебя просрочены 2 задачи:\n\n- **Взять контакт по маркировке** — срок 7 октября. Приоритет: средний (2).\n- **Заказать парапет** — срок 9 октября.\n\nОбе задачи уже просрочены. Могу перенести их на ближайшие свободные дни.";
const SAMPLE_2_TAIL = '":{"scope":"today"}},{"name":"list_tasks","arguments":{"scope":"overdue"}},{"name":"free_slots","arguments":{"date":"2026-10-11"}}]}</escape>';
const SAMPLE_2_FULL = '<escape>{"reply":"","actions":[{"name":"list_tasks","arguments":{"scope":"today"}},{"name":"list_tasks","arguments":{"scope":"overdue"}},{"name":"free_slots","arguments":{"date":"2026-10-11"}}]}</escape>';

test("json reply: sample 1 — lost «{\"», escaped line breaks, </escape> junk", () => {
  assert.deepEqual(parseJsonReply(SAMPLE_1), { reply: SAMPLE_1_TEXT, actions: [], ok: true });
  assert.deepEqual(parseJsonReply(`<escape>{"${SAMPLE_1}`), { reply: SAMPLE_1_TEXT, actions: [], ok: true });
  assert.deepEqual(parseJsonReply(`{${SAMPLE_1.replace(/^reply/, '"reply')}`).reply, SAMPLE_1_TEXT);
});

test("json reply: sample 2 — read requests (whole or only the tail) never become text", () => {
  const whole = parseJsonReply(SAMPLE_2_FULL);
  assert.equal(whole.reply, "");
  assert.deepEqual(
    whole.actions.map((a) => [a.name, a.arguments]),
    [
      ["list_tasks", { scope: "today" }],
      ["list_tasks", { scope: "overdue" }],
      ["free_slots", { date: "2026-10-11" }],
    ],
  );
  const tail = parseJsonReply(SAMPLE_2_TAIL);
  assert.equal(tail.reply, "");
  assert.equal(tail.ok, false);
  assert.deepEqual(
    tail.actions.map((a) => a.name),
    ["list_tasks", "free_slots"],
  );
});

test("json reply: fences, text around, trailing commas, unclosed braces, double escapes", () => {
  assert.deepEqual(parseJsonReply('Вот ответ:\n```json\n{"reply":"ок","actions":[],}\n```\nГотово'), { reply: "ок", actions: [], ok: true });
  assert.deepEqual(parseJsonReply('{"reply":"Создам задачу","actions":[{"name":"create_tasks","arguments":{"tasks":[{"title":"A"}]}'), {
    reply: "Создам задачу",
    actions: [{ name: "create_tasks", arguments: { tasks: [{ title: "A" }] } }],
    ok: true,
  });
  assert.equal(parseJsonReply('{"reply":"Строка 1\\\\nСтрока 2","actions":[]}').reply, "Строка 1\nСтрока 2");
  assert.equal(parseJsonReply('{"reply":"Сырой\nперенос","actions":[]}').reply, "Сырой\nперенос");
  assert.deepEqual(parseJsonReply('<|im_start|>{"reply":"x","actions":[{"name":"complete_tasks","arguments":"{\\"ids\\":[\\"t1\\"]}"}]}<|im_end|>').actions, [{ name: "complete_tasks", arguments: { ids: ["t1"] } }]);
  assert.equal(repairJson('{"a":[1,2,'), '{"a":[1,2]}');
});

test("json reply: unrepairable → only the reply text, never keys", () => {
  const broken = '{"reply":"Свободно с \\"утра\\" до 12:00\\nи после обеда", "actions": [ {"name": create_tasks ??? ';
  const parsed = parseJsonReply(broken);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.reply, 'Свободно с "утра" до 12:00\nи после обеда');
  assert.deepEqual(parsed.actions, []);
  assert.deepEqual(parseJsonReply("Обычный текст без JSON."), { reply: "Обычный текст без JSON.", actions: [], ok: true });
});

test("reply streamer: only the reply string, escapes and tags split across chunks", () => {
  for (const source of [`<escape>{"${SAMPLE_1}`, SAMPLE_1, `{"reply" : "${SAMPLE_1.slice(8)}`]) {
    for (const size of [1, 2, 5, 13, 1000]) {
      const streamer = new ReplyStreamer();
      let shown = "";
      for (let i = 0; i < source.length; i += size) streamer.push(source.slice(i, i + size), (t) => (shown += t));
      assert.equal(shown, SAMPLE_1_TEXT, `${size}`);
      assert.equal(streamer.shown, SAMPLE_1_TEXT);
    }
  }
  const reads = new ReplyStreamer();
  let shown = "";
  for (const ch of SAMPLE_2_FULL) reads.push(ch, (t) => (shown += t));
  assert.equal(shown, "");
  const unicode = new ReplyStreamer();
  let u = "";
  for (const ch of '{"reply":"\\u041f\\u0440\\u0438\\u0432\\u0435\\u0442 <b>x</b>","actions":[]}') unicode.push(ch, (t) => (u += t));
  assert.equal(u, "Привет x");
});
