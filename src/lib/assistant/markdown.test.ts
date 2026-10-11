import assert from "node:assert/strict";
import test from "node:test";
import { parseInline, parseMarkdown } from "./markdown.ts";

test("markdown: bold, italic, code, safe links only", () => {
  assert.deepEqual(parseInline("**Создавать задачи** — с *датой* и `10:00`"), [
    { type: "strong", children: [{ type: "text", text: "Создавать задачи" }] },
    { type: "text", text: " — с " },
    { type: "em", children: [{ type: "text", text: "датой" }] },
    { type: "text", text: " и " },
    { type: "code", text: "10:00" },
  ]);
  assert.deepEqual(parseInline("[сайт](https://example.com/a) и [плохая](javascript:alert(1))"), [
    { type: "link", href: "https://example.com/a", children: [{ type: "text", text: "сайт" }] },
    { type: "text", text: " и " },
    { type: "text", text: "плохая" },
    { type: "text", text: ")" },
  ]);
  assert.deepEqual(parseInline("snake_case_name и 2*3*4"), [{ type: "text", text: "snake_case_name и 2*3*4" }]);
  assert.deepEqual(parseInline("<b>не HTML</b> **незакрыто"), [{ type: "text", text: "<b>не HTML</b> **незакрыто" }]);
});

test("markdown: paragraphs, lists, headings", () => {
  const blocks = parseMarkdown("Умею:\n\n- **Создавать задачи** — с датой.\n- Находить окна\n\n1. Раз\n2. Два\n## Итог\nСтрока 1\nСтрока 2");
  assert.deepEqual(
    blocks.map((b) => b.type),
    ["p", "ul", "ol", "heading", "p"],
  );
  const ul = blocks[1];
  assert.equal(ul?.type === "ul" && ul.items.length, 2);
  assert.deepEqual(ul?.type === "ul" && ul.items[0]?.[0], { type: "strong", children: [{ type: "text", text: "Создавать задачи" }] });
  const last = blocks[4];
  assert.deepEqual(last?.type === "p" && last.children.map((c) => c.type), ["text", "br", "text"]);
  assert.deepEqual(parseMarkdown("3. три\n4. четыре")[0], { type: "ol", start: 3, items: [[{ type: "text", text: "три" }], [{ type: "text", text: "четыре" }]] });
});
