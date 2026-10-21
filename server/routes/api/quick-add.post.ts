/**
 * POST /api/quick-add — «В Пору»: one item into «Входящие».
 *
 * Auth: `Authorization: Bearer pora_<id>.<secret>` (a device key from
 * «Настройки → Быстрое добавление»; 01.auth lets only this path through
 * without a session, and only with that header) or the normal session
 * (the «Проверить» button).
 *
 * Body: JSON {text?, url?}, a url-encoded or multipart form (text?, url?, file?;
 * see quick-add/parse.ts) or plain text. Text up to 4 KB; a link inside the
 * text becomes the task link;
 * a file goes through the attachment rules (type by content, size limit,
 * HEIC → JPEG). A link gets the page title (link-title.ts: public pages only).
 * 30 adds per key per minute. Logs carry the key id, never the key.
 */
import { randomUUID } from "node:crypto";
import { clientIp, json, type ServerEvent } from "../../lib/http.ts";
import { MAX_TEXT_BYTES, parseQuickBody, splitInput } from "../../lib/quick-add/parse.ts";
import { log } from "../../lib/log.ts";
import { principalForLogin, principalOf, type Principal } from "../../lib/principal.ts";
import { LoginLimiter } from "../../lib/rate-limit.ts";
import { checkUrl, fetchTitle } from "../../lib/link-title.ts";
import { attachConfig } from "../../lib/attachments/config.ts";
import { MIME, detectType } from "../../lib/attachments/detect.ts";
import { heicToJpeg } from "../../lib/attachments/heic.ts";
import { attachStore } from "../../lib/attachments/store.ts";
import { safeDisplayName } from "../../lib/attachments/names.ts";
import { readTakenAt } from "../../../src/lib/attachments/exif.ts";
import { QuickAddUnavailable, tokenIdOf, verifyToken } from "../../lib/quick-add/tokens.ts";
import { allowQuickAdd, PER_MINUTE } from "../../lib/quick-add/limit.ts";
import { addToInbox, type InboxInput } from "../../lib/quick-add/add.ts";

const TITLE_MAX = 200;
/** Camera file names: IMG_6150, IMG_6150.HEIC, PXL_2026…, DSC01234. */
export const FILE_NAME = /^(img|dsc|dscn|pxl|photo|image|screenshot)[_ -]?[\w .-]*\d[\w-]*(\.(heic|heif|jpe?g|png|webp|gif|mov|mp4))?$/i;
const badKeys = new LoginLimiter();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function principal(event: ServerEvent): Promise<{ user: Principal; keyId: string | null } | Response> {
  const header = event.req.headers.get("authorization") ?? "";
  if (!/^bearer\s/i.test(header)) {
    const user = principalOf(event);
    return user ? { user, keyId: null } : json(401, { error: "unauthorized", message: "Нужен ключ устройства." });
  }
  const ip = clientIp(event);
  const verdict = badKeys.check(ip);
  if (!verdict.allowed) return json(429, { error: "rate_limited", message: "Слишком много неверных ключей." }, { "retry-after": String(verdict.retryAfterSec) });
  const raw = header.replace(/^bearer\s+/i, "").trim();
  const found = verifyToken(raw);
  const user = found ? principalForLogin(found.login) : null;
  if (!found || !user) {
    const delay = badKeys.fail(ip);
    log("warn", "quick_add.bad_key", { ip, key: tokenIdOf(raw) ?? "-" });
    await sleep(delay);
    return json(401, { error: "bad_key", message: "Ключ не подходит или отозван. Создайте новый в «Настройки → Быстрое добавление»." });
  }
  badKeys.success(ip);
  return { user, keyId: found.id };
}

export default async function quickAdd(event: ServerEvent): Promise<Response> {
  let who;
  try {
    who = await principal(event);
  } catch (error) {
    if (error instanceof QuickAddUnavailable) return json(503, { error: "unavailable", message: "Быстрое добавление работает только с базой SQLite (1.12+)." });
    throw error;
  }
  if (who instanceof Response) return who;
  const { user, keyId } = who;
  if (!allowQuickAdd(keyId ?? `session:${user.login}`)) {
    log("warn", "quick_add.rate_limited", { key: keyId ?? "session" });
    return json(429, { error: "rate_limited", message: `Не больше ${PER_MINUTE} в минуту.` }, { "retry-after": "60" });
  }

  const config = attachConfig();
  const parsed = await parseQuickBody(event.req, config.maxBytes);
  if ("status" in parsed) return json(parsed.status, { error: parsed.error, message: parsed.message });
  if (new TextEncoder().encode(parsed.text).byteLength > MAX_TEXT_BYTES) return json(413, { error: "too_large", message: "Текст длиннее 4 КБ." });

  const split = splitInput(parsed.text, parsed.url);
  const url = split.url;
  let link: InboxInput["link"] = null;
  if (url) {
    const checked = url.length <= 2000 ? checkUrl(url) : null;
    if (!checked || !/^https?:$/.test(checked.protocol)) return json(400, { error: "bad_url", message: "Нужна ссылка http(s)." });
    const title = await fetchTitle(checked.href).catch(() => null);
    link = { url: checked.href, ...(title ? { title: title.slice(0, TITLE_MAX) } : {}) };
  }

  const taskId = randomUUID();
  let attachment: InboxInput["attachment"] = null;
  if (parsed.file) {
    if (parsed.file.size > config.maxBytes) return json(413, { error: "too_large", message: "Файл слишком большой." });
    let bytes: Uint8Array = new Uint8Array(await parsed.file.arrayBuffer());
    let name = safeDisplayName(parsed.file.name || "фото");
    let mime = detectType(bytes, name);
    if (!mime || !config.allowed.has(mime)) return json(415, { error: "bad_type", message: "Этот тип файла не принимается." });
    if (mime === MIME.heic || mime === MIME.heif) {
      const jpeg = await heicToJpeg(bytes, name);
      if (jpeg.converted) {
        bytes = jpeg.bytes;
        mime = jpeg.mime;
        name = jpeg.name;
      }
    }
    const exif = readTakenAt(bytes);
    const takenAt = exif !== null ? exif + new Date(exif).getTimezoneOffset() * 60_000 : Date.now();
    const meta = await attachStore().put({ owner: user.login, parent: { kind: "task", id: taskId }, name, mime, bytes, takenAt });
    attachment = { id: meta.id, name: meta.name, mime: meta.mime, size: meta.size, createdAt: meta.createdAt, ...(meta.takenAt !== undefined ? { takenAt: meta.takenAt } : {}) };
  }

  // iOS may send the photo's file name as the text («IMG_6150»): not a title.
  const ownName = attachment ? attachment.name.replace(/\.\w+$/, "").toLowerCase() : "";
  const nameLike = split.title && !split.notes && (FILE_NAME.test(split.title) || (ownName && split.title.replace(/\.\w+$/, "").toLowerCase() === ownName));
  const typed = attachment && nameLike ? "" : split.title;
  if (!typed && !split.notes && !link && !attachment && !split.title) return json(400, { error: "empty", message: "Пусто: нужен текст, ссылка или файл." });
  const photoTitle = `Фото ${new Date().toLocaleString("ru-RU", { timeZone: process.env.TZ || "Europe/Moscow", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`;
  const title = (typed || link?.title || (link ? new URL(link.url).hostname : "") || (attachment ? photoTitle : split.title) || split.notes.split("\n")[0]!).slice(0, TITLE_MAX);
  const notes = typed || link || attachment ? split.notes : split.notes.split("\n").slice(1).join("\n").trim();
  try {
    await addToInbox(user, { id: taskId, title, notes, link, attachment });
  } catch (error) {
    log("error", "quick_add.write_failed", { key: keyId ?? "session" }, error);
    return json(503, { error: "storage_error", message: "Не удалось сохранить на сервере." });
  }
  log("info", "quick_add.ok", { key: keyId ?? "session", kind: attachment ? "file" : link ? "link" : "text" });
  return json(201, { ok: true, id: taskId, title });
}
