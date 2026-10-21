/**
 * Request body of POST /api/quick-add, as phones really send it:
 * - JSON {text, url};
 * - application/x-www-form-urlencoded (the shortcut's «Форма» without a file);
 * - multipart/form-data (the «Форма» with a file; iOS may send image/heic,
 *   a name without extension, or other field names);
 * - text/plain or no type: the raw text.
 * Field names are matched loosely (text/текст/…, url/link/…, file/photo/…);
 * with one unnamed text field, that field is the text.
 */
import { BodyTooLargeError, readBodyLimited } from "../http.ts";

export const MAX_TEXT_BYTES = 4096;

export type QuickBody = { text: string; url: string; file: File | null };
export type QuickBodyError = { status: number; error: string; message?: string };

const TEXT_KEYS = ["text", "текст", "note", "title", "body", "content", "input"];
const URL_KEYS = ["url", "link", "ссылка", "href"];
const MAX_FIELDS = 8;

function pick(entries: [string, string][], keys: string[]): string | null {
  for (const [k, v] of entries) if (keys.includes(k.trim().toLowerCase())) return v;
  return null;
}

/** From named string fields: text and url; an only/unknown field counts as text. */
export function fromFields(entries: [string, string][]): { text: string; url: string } {
  const url = pick(entries, URL_KEYS) ?? "";
  let text = pick(entries, TEXT_KEYS);
  if (text === null) {
    const rest = entries.filter(([k]) => !URL_KEYS.includes(k.trim().toLowerCase())).map(([, v]) => v.trim()).filter(Boolean);
    text = rest.join("\n");
  }
  return { text, url };
}

export async function parseQuickBody(req: Request, maxFile: number): Promise<QuickBody | QuickBodyError> {
  const type = (req.headers.get("content-type") ?? "").toLowerCase();
  if (type.includes("multipart/form-data")) {
    const declared = Number(req.headers.get("content-length") ?? "");
    if (Number.isFinite(declared) && declared > maxFile + 256 * 1024) return { status: 413, error: "too_large", message: "Файл слишком большой." };
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return { status: 400, error: "bad_multipart" };
    }
    const all = [...form.entries()];
    if (all.length > MAX_FIELDS) return { status: 400, error: "too_many_fields" };
    const files = all.filter((e): e is [string, File] => typeof e[1] !== "string" && e[1].size > 0);
    const strings = all.filter((e): e is [string, string] => typeof e[1] === "string");
    if (files.length > 1) return { status: 400, error: "too_many_files", message: "Один файл за раз." };
    return { ...fromFields(strings), file: files[0]?.[1] ?? null };
  }
  let raw: string;
  try {
    // Url-encoded Cyrillic is up to 3× longer than the text itself.
    raw = await readBodyLimited(req, MAX_TEXT_BYTES * 3 + 1024);
  } catch (error) {
    if (error instanceof BodyTooLargeError) return { status: 413, error: "too_large", message: "Текст длиннее 4 КБ." };
    throw error;
  }
  if (type.includes("json")) {
    try {
      const body = JSON.parse(raw) as { text?: unknown; url?: unknown };
      return { text: typeof body.text === "string" ? body.text : "", url: typeof body.url === "string" ? body.url : "", file: null };
    } catch {
      return { status: 400, error: "bad_json" };
    }
  }
  // A form sent without its type (or as text/plain): «text=…&url=…» with no spaces.
  const formLike = /^(text|url|link|note|title|input|%D1%82%D0%B5%D0%BA%D1%81%D1%82)=/i.test(raw) && !/\s/.test(raw.trim());
  if (type.includes("application/x-www-form-urlencoded") || formLike) {
    const entries = [...new URLSearchParams(raw).entries()];
    if (entries.length > MAX_FIELDS) return { status: 400, error: "too_many_fields" };
    return { ...fromFields(entries), file: null };
  }
  return { text: raw, url: "", file: null };
}

const URL_RE = /https?:\/\/[^\s<>"«»]+/i;

/**
 * Text + optional url → title, notes, link. A link inside the text becomes the
 * link (trailing punctuation dropped); the words around it stay the title.
 */
export function splitInput(rawText: string, rawUrl: string): { title: string; notes: string; url: string } {
  let text = rawText.replace(/\r\n?/g, "\n").trim();
  let url = rawUrl.trim();
  if (!url) {
    const found = URL_RE.exec(text);
    if (found) {
      url = found[0].replace(/[.,;:!?)\]]+$/, "");
      text = (text.slice(0, found.index) + text.slice(found.index + found[0].length)).replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    }
  }
  const nl = text.indexOf("\n");
  const title = (nl < 0 ? text : text.slice(0, nl)).trim();
  const notes = nl < 0 ? "" : text.slice(nl + 1).trim();
  return { title, notes, url };
}
