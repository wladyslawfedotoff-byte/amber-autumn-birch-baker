/**
 * JSON mode: the model answers `{"reply": "...", "actions": [...]}` as text.
 * Models get this wrong in many small ways — code fences, tag tokens such as
 * <escape>…</escape>, a missing opening `{"`, text after the object, trailing
 * commas, an unclosed brace — so the answer is repaired before parsing, and
 * when nothing helps only the reply text is pulled out. Raw JSON keys must
 * never reach the user.
 */

export type JsonAction = { name: string; arguments: unknown };
export type JsonReply = { reply: string; actions: JsonAction[]; ok: boolean };

/** Tag tokens some models leak: <escape>, </escape>, <|im_end|>, <eos>, <think>… */
const TAG = /<\|[^|>\n]{1,40}\|>|<\/?[a-zA-Z_][\w:-]{0,30}\s*\/?>/g;
const REPLY_KEY = /(?:"|\b)reply"?\s*:\s*/;

export function stripJunk(raw: string): string {
  return raw
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/```(?:json|JSON)?/g, "")
    .replace(TAG, "")
    .trim();
}

/** Closes what the model left open: strings, arrays, objects; drops trailing commas. */
export function repairJson(text: string): string {
  let out = "";
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (const ch of text) {
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      // Raw line breaks inside strings are invalid JSON.
      out += ch === "\n" ? "\\n" : ch === "\r" ? "" : ch === "\t" ? "\\t" : ch;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") stack.push("}");
    else if (ch === "[") stack.push("]");
    else if (ch === "}" || ch === "]") {
      if (stack[stack.length - 1] !== ch) continue; // stray closer
      stack.pop();
      out = out.replace(/,\s*$/, "");
      out += ch;
      if (!stack.length) break; // text after the object is not ours
      continue;
    }
    out += ch;
  }
  if (inString) out += escaped ? '\\"' : '"';
  out = out.replace(/,\s*$/, "").replace(/:\s*$/, ": null");
  while (stack.length) out += stack.pop();
  return out.replace(/,(\s*[}\]])/g, "$1");
}

function tryJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** The text of a JSON string body (without quotes), escapes resolved. */
export function unescapeJsonString(body: string): string {
  const parsed = tryJson(`"${body.replace(/\n/g, "\\n").replace(/\r/g, "")}"`);
  if (typeof parsed === "string") return parsed;
  return body.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_, e: string) => (e[0] === "u" ? String.fromCharCode(parseInt(e.slice(1), 16)) : e === "n" ? "\n" : e === "t" ? "\t" : e === "r" ? "" : e));
}

/** Literal «\n» left in a reply that was escaped twice. */
function tidy(reply: string): string {
  const text = !reply.includes("\n") && /\\n/.test(reply) ? reply.replace(/\\n/g, "\n").replace(/\\"/g, '"') : reply;
  return text.trim();
}

function actionsOf(value: unknown): JsonAction[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((a) => {
    const row = (a ?? {}) as { name?: unknown; tool?: unknown; arguments?: unknown; args?: unknown };
    const name = typeof row.name === "string" ? row.name : typeof row.tool === "string" ? row.tool : null;
    if (!name) return [];
    let args = row.arguments ?? row.args ?? {};
    if (typeof args === "string") args = tryJson(args) ?? {};
    return [{ name, arguments: args }];
  });
}

/** The balanced {…} starting at `from` (string-aware), or null. */
function balanced(text: string, from: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = from; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return text.slice(from, i + 1);
  }
  return null;
}

/** Tool requests `{"name": …, "arguments": …}` anywhere in a broken answer. */
export function namedObjects(text: string): JsonAction[] {
  const out: JsonAction[] = [];
  for (let i = text.indexOf("{"); i >= 0; i = text.indexOf("{", i + 1)) {
    const chunk = balanced(text, i);
    if (!chunk) continue;
    const parsed = tryJson(chunk) ?? tryJson(repairJson(chunk));
    const found = actionsOf([parsed]);
    if (found.length && parsed && typeof parsed === "object" && ("arguments" in parsed || "args" in parsed)) {
      out.push(...found);
      i += chunk.length - 1;
    }
  }
  return out;
}

/** Looks like a piece of JSON rather than prose. */
function jsonish(text: string): boolean {
  return /^[\s"':,\]}{[]/.test(text) || (/"[\w-]+"\s*:/.test(text) && /[}\]]\s*$/.test(text));
}

/** Reads `{"reply","actions"}` from a JSON-mode answer as well as it can. */
export function parseJsonReply(raw: string): JsonReply {
  const text = stripJunk(raw);
  const key = REPLY_KEY.exec(text);
  const brace = text.indexOf("{");
  // Where the object starts: the first «{», or — when «{"» was lost — the reply key.
  let candidate: string | null = null;
  if (brace >= 0 && (!key || brace <= key.index)) candidate = text.slice(brace);
  else if (key) candidate = `{"reply": ${text.slice(key.index + key[0].length)}`;
  else if (/"actions"\s*:/.test(text) && brace >= 0) candidate = text.slice(brace);
  if (candidate !== null) {
    const end = candidate.lastIndexOf("}");
    const parsed = (end > 0 ? tryJson(candidate.slice(0, end + 1)) : undefined) ?? tryJson(repairJson(candidate));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const obj = parsed as { reply?: unknown; text?: unknown; actions?: unknown };
      const reply = typeof obj.reply === "string" ? obj.reply : typeof obj.text === "string" ? obj.text : "";
      if ("reply" in obj || "actions" in obj || "text" in obj) return { reply: tidy(reply), actions: actionsOf(obj.actions), ok: true };
    }
    // Unparseable: keep only the reply text.
    const m = /(?:"|\b)reply"?\s*:\s*"((?:[^"\\]|\\[\s\S])*)/.exec(text);
    if (m) return { reply: tidy(unescapeJsonString(m[1]!)), actions: [], ok: false };
    if (key || /"actions"\s*:/.test(text)) return { reply: "", actions: namedObjects(text), ok: false };
  }
  // A fragment of JSON without a reply (e.g. its start was lost): keep tool requests, show nothing raw.
  if (jsonish(text)) return { reply: "", actions: namedObjects(text), ok: false };
  // No JSON at all: the model answered in plain text.
  return { reply: text, actions: [], ok: true };
}

/**
 * Streams only the reply string out of a JSON-mode answer as it arrives:
 * waits for `"reply": "` and passes on its characters (escapes resolved),
 * stops at the closing quote. Everything else (keys, actions) is never shown.
 */
export class ReplyStreamer {
  private raw = "";
  private start = -1;
  private pos = 0;
  private done = false;
  shown = "";

  push(delta: string, emit: (text: string) => void): void {
    this.raw += delta;
    if (this.done) return;
    if (this.start < 0) {
      const cleaned = this.raw.replace(TAG, "");
      const m = /(?:"|\b)reply"?\s*:\s*"/.exec(cleaned);
      if (!m) return;
      this.raw = cleaned;
      this.start = m.index + m[0].length;
      this.pos = this.start;
    }
    let out = "";
    while (this.pos < this.raw.length) {
      const ch = this.raw[this.pos]!;
      if (ch === '"') {
        this.done = true;
        break;
      }
      if (ch === "\\") {
        const next = this.raw[this.pos + 1];
        if (next === undefined) break; // the escape continues in the next chunk
        if (next === "u") {
          const hex = this.raw.slice(this.pos + 2, this.pos + 6);
          if (hex.length < 4) break;
          out += String.fromCharCode(parseInt(hex, 16) || 32);
          this.pos += 6;
          continue;
        }
        out += next === "n" ? "\n" : next === "t" ? "\t" : next === "r" ? "" : next;
        this.pos += 2;
        continue;
      }
      // A tag token inside the text (e.g. «</escape»): wait until it is complete, then skip.
      if (ch === "<") {
        const rest = this.raw.slice(this.pos);
        const tag = /^(?:<\|[^|>\n]{1,40}\|>|<\/?[a-zA-Z_][\w:-]{0,30}\s*\/?>)/.exec(rest);
        if (tag) {
          this.pos += tag[0].length;
          continue;
        }
        if (/^<\/?[\w|:-]{0,30}$/.test(rest)) break;
      }
      out += ch;
      this.pos++;
    }
    if (out) {
      this.shown += out;
      emit(out);
    }
  }
}
