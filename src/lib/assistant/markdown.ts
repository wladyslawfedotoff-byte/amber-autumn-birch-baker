/**
 * A small, safe subset of markdown for assistant answers: paragraphs, line
 * breaks, «- »/«* »/«• » and «1. » lists, «#» headings (shown bold), **bold**,
 * *italic* / _italic_, `code` and http(s) links. The result is plain data the
 * UI turns into React elements: no HTML from the model is ever interpreted.
 */

export type Inline =
  | { type: "text"; text: string }
  | { type: "strong"; children: Inline[] }
  | { type: "em"; children: Inline[] }
  | { type: "code"; text: string }
  | { type: "link"; href: string; children: Inline[] }
  | { type: "br" };

export type Block =
  | { type: "p"; children: Inline[] }
  | { type: "heading"; children: Inline[] }
  | { type: "ul"; items: Inline[][] }
  | { type: "ol"; start: number; items: Inline[][] };

const BULLET = /^\s{0,3}[-*•+]\s+(.*)$/;
const NUMBERED = /^\s{0,3}(\d{1,3})[.)]\s+(.*)$/;
const HEADING = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;

function safeHref(raw: string): string | null {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

/** Inline markup of one line. Unmatched markers stay as text. */
export function parseInline(source: string): Inline[] {
  const out: Inline[] = [];
  let text = "";
  const flush = () => {
    if (text) out.push({ type: "text", text });
    text = "";
  };
  let i = 0;
  while (i < source.length) {
    const rest = source.slice(i);
    // `code`
    if (rest[0] === "`") {
      const end = rest.indexOf("`", 1);
      if (end > 1) {
        flush();
        out.push({ type: "code", text: rest.slice(1, end) });
        i += end + 1;
        continue;
      }
    }
    // **bold** / __bold__
    const strong = /^(\*\*|__)(?=\S)([\s\S]*?\S)\1/.exec(rest);
    if (strong) {
      flush();
      out.push({ type: "strong", children: parseInline(strong[2]!) });
      i += strong[0].length;
      continue;
    }
    // *italic* / _italic_ (not inside words for «_»)
    const em = /^(\*|_)(?=\S)([^*_\n]*?\S)\1(?![\p{L}\p{N}])/u.exec(rest);
    if (em && (em[1] === "*" || !/[\p{L}\p{N}]/u.test(source[i - 1] ?? ""))) {
      flush();
      out.push({ type: "em", children: parseInline(em[2]!) });
      i += em[0].length;
      continue;
    }
    // [text](https://…)
    const link = /^\[([^\]\n]+)\]\(([^)\s]+)\)/.exec(rest);
    if (link) {
      const href = safeHref(link[2]!);
      flush();
      if (href) out.push({ type: "link", href, children: parseInline(link[1]!) });
      else out.push({ type: "text", text: link[1]! });
      i += link[0].length;
      continue;
    }
    // bare https://…
    const bare = /^https?:\/\/[^\s<>«»"]+[^\s<>«»".,;:!?)]/.exec(rest);
    if (bare && !/[\p{L}\p{N}]/u.test(source[i - 1] ?? "")) {
      const href = safeHref(bare[0]);
      if (href) {
        flush();
        out.push({ type: "link", href, children: [{ type: "text", text: bare[0] }] });
        i += bare[0].length;
        continue;
      }
    }
    text += source[i];
    i++;
  }
  flush();
  return out;
}

function withBreaks(lines: string[]): Inline[] {
  return lines.flatMap((line, index) => (index ? [{ type: "br" } as Inline, ...parseInline(line)] : parseInline(line)));
}

export function parseMarkdown(source: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: { type: "ul" } | { type: "ol"; start: number } | null = null;
  let items: string[][] = [];
  const endPara = () => {
    if (para.length) blocks.push({ type: "p", children: withBreaks(para) });
    para = [];
  };
  const endList = () => {
    if (list && items.length) {
      const parsed = items.map(withBreaks);
      blocks.push(list.type === "ul" ? { type: "ul", items: parsed } : { type: "ol", start: list.start, items: parsed });
    }
    list = null;
    items = [];
  };
  for (const raw of source.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) {
      endPara();
      endList();
      continue;
    }
    if (RULE.test(line)) {
      endPara();
      endList();
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      endPara();
      endList();
      blocks.push({ type: "heading", children: parseInline(heading[1]!) });
      continue;
    }
    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    if (bullet || numbered) {
      endPara();
      const kind = bullet ? "ul" : "ol";
      if (!list || list.type !== kind) {
        endList();
        list = kind === "ul" ? { type: "ul" } : { type: "ol", start: Number(numbered![1]) || 1 };
      }
      items.push([bullet ? bullet[1]! : numbered![2]!]);
      continue;
    }
    // A continuation line of a list item (indented) or of a paragraph.
    if (list && /^\s+/.test(raw)) {
      items[items.length - 1]!.push(line.trim());
      continue;
    }
    endList();
    para.push(line);
  }
  endPara();
  endList();
  return blocks;
}
