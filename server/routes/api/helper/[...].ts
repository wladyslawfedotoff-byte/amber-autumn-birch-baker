/**
 * API for bots with a «ключ помощника» (1.25). Auth: only
 * `Authorization: Bearer porah_<id>.<secret>` (01.auth lets /api/helper/*
 * through without a session only with that header; a session cookie is never
 * accepted here). The key reaches only the tasks it created:
 *
 *   GET   /api/helper/me                    → { name }
 *   GET   /api/helper/tasks                 → { items: [task] }   own tasks, newest first
 *   POST  /api/helper/tasks {title, notes?, due?, startAt?, endAt?} → 201 { item }  into «Входящие»
 *   GET   /api/helper/tasks/:id             → { item }
 *   PATCH /api/helper/tasks/:id {title?, notes?, due?, startAt?, endAt?} → { item }
 *   POST  /api/helper/tasks/:id/complete    → { item }
 *   POST  /api/helper/tasks/:id/reopen      → { item }
 *   POST  /api/helper/tasks/:id/comments {text, result?: "ok"|"fail"} → 201 { item }
 *
 * Someone else's task, a deleted task or an unknown id → 404 (the same answer,
 * nothing is revealed). There is no DELETE. Limits: helper/limit.ts. Logs and
 * the action log carry the key id, never the key.
 */
import { BodyTooLargeError, clientIp, json, readBodyLimited, type ServerEvent } from "../../../lib/http.ts";
import { log } from "../../../lib/log.ts";
import { principalForLogin, type Principal } from "../../../lib/principal.ts";
import { HelperUnavailable, audit, helperKeyIdOf, verifyHelperKey, type HelperAction } from "../../../lib/helper/keys.ts";
import { allowHelper, ipMayTryHelperKey, noteBadHelperKey, retryAfter, type HelperOp } from "../../../lib/helper/limit.ts";
import {
  InputError,
  commentOwn,
  createOwn,
  getOwn,
  listOwn,
  parseComment,
  parseFields,
  setDoneOwn,
  updateOwn,
  type HelperTaskView,
} from "../../../lib/helper/tasks.ts";

const NO_STORE = { "cache-control": "no-store" };
const MAX_BODY = 16 * 1024;
const BAD_KEY_DELAY_MS = 300;
const ID_RE = /^[A-Za-z0-9_-]{1,200}$/;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Who = { user: Principal; keyId: string; name: string };

async function authorize(event: ServerEvent): Promise<Who | Response> {
  const header = event.req.headers.get("authorization") ?? "";
  const badKey = () => json(401, { error: "bad_key", message: "Нужен действующий ключ помощника (Настройки → Помощники)." }, NO_STORE);
  if (!/^bearer\s/i.test(header)) return badKey();
  const raw = header.replace(/^bearer\s+/i, "").trim();
  if (!helperKeyIdOf(raw)) return badKey();
  const ip = clientIp(event);
  if (!ipMayTryHelperKey(ip)) return json(429, { error: "rate_limited", message: "Слишком много неверных ключей." }, { "retry-after": "900" });
  const found = verifyHelperKey(raw);
  const user = found ? principalForLogin(found.login) : null;
  if (!found || !user) {
    noteBadHelperKey(ip);
    log("warn", "helper.bad_key", { ip, key: helperKeyIdOf(raw) ?? "-" });
    await sleep(BAD_KEY_DELAY_MS);
    return badKey();
  }
  return { user, keyId: found.id, name: found.name };
}

async function body(event: ServerEvent): Promise<unknown> {
  let text: string;
  try {
    text = await readBodyLimited(event.req, MAX_BODY);
  } catch (error) {
    if (error instanceof BodyTooLargeError) throw new InputError("тело запроса больше 16 КБ");
    throw error;
  }
  try {
    return JSON.parse(text || "{}");
  } catch {
    throw new InputError("нужен JSON");
  }
}

const FIELD_NAMES: Record<string, string> = { title: "название", notes: "заметка", due: "дата", startAt: "начало", endAt: "конец" };

const notFound = () => json(404, { error: "not_found", message: "Задачи нет или она не ваша." }, NO_STORE);

export default async function helperApi(event: ServerEvent): Promise<Response> {
  const method = event.req.method.toUpperCase();
  const parts = event.url.pathname.replace(/^\/api\/helper\/?/, "").split("/").filter(Boolean);
  let who: Who | Response;
  try {
    who = await authorize(event);
  } catch (error) {
    if (error instanceof HelperUnavailable) return json(503, { error: "unavailable", message: "Ключи помощника работают только с базой SQLite." });
    throw error;
  }
  if (who instanceof Response) return who;
  const { user, keyId, name } = who;

  const limited = (op: HelperOp) => {
    if (allowHelper(keyId, op)) return null;
    log("warn", "helper.rate_limited", { key: keyId, op });
    return json(429, { error: "rate_limited", message: "Слишком часто — подождите." }, { "retry-after": String(retryAfter(op)) });
  };
  const note = (action: HelperAction, taskId: string | null, summary: string) => {
    audit(keyId, user.login, action, taskId, summary);
    log("info", `helper.${action}`, { key: keyId, ...(taskId ? { task: taskId } : {}) });
  };
  const own = (item: HelperTaskView | null, action: HelperAction, id: string, summary: (item: HelperTaskView) => string, status = 200) => {
    if (!item) {
      note("denied", id.slice(0, 60), `${action}: задача не найдена или чужая`);
      return notFound();
    }
    note(action, item.id, summary(item));
    return json(status, { item }, NO_STORE);
  };

  try {
    const [first, id, sub, extra] = parts;
    if (first === "me" && parts.length === 1 && method === "GET") return limited("read") ?? json(200, { name }, NO_STORE);
    if (first !== "tasks" || extra !== undefined) return json(404, { error: "not_found" });
    if (id !== undefined && !ID_RE.test(id)) return notFound();
    if (method === "DELETE") {
      // There is no delete for a helper key; the attempt is logged.
      note("denied", id ? id.slice(0, 60) : null, "удаление запрещено");
      return json(405, { error: "method_not_allowed", message: "Ключ помощника ничего не удаляет." }, { allow: id ? (sub ? "POST" : "GET, PATCH") : "GET, POST" });
    }

    if (id === undefined) {
      if (method === "GET") return limited("read") ?? json(200, { items: await listOwn(user, keyId) }, NO_STORE);
      if (method === "POST") {
        const fields = parseFields(await body(event), true);
        const stop = limited("create");
        if (stop) return stop;
        const result = await createOwn(user, { keyId, name }, fields);
        if ("error" in result) return json(409, { error: "too_many_tasks", message: "У ключа слишком много задач." });
        note("create", result.item.id, result.item.title);
        return json(201, { item: result.item }, NO_STORE);
      }
      return json(405, { error: "method_not_allowed" }, { allow: "GET, POST" });
    }

    if (sub === undefined) {
      if (method === "GET") {
        const stop = limited("read");
        if (stop) return stop;
        const item = await getOwn(user, keyId, id);
        if (!item) note("denied", id.slice(0, 60), "чтение: задача не найдена или чужая");
        return item ? json(200, { item }, NO_STORE) : notFound();
      }
      if (method === "PATCH") {
        const fields = parseFields(await body(event), false);
        const stop = limited("change");
        if (stop) return stop;
        return own(await updateOwn(user, keyId, id, fields), "update", id, (item) => `${item.title} · ${Object.keys(fields).map((key) => FIELD_NAMES[key] ?? key).join(", ")}`);
      }
      return json(405, { error: "method_not_allowed" }, { allow: "GET, PATCH" });
    }

    if (method !== "POST") return json(405, { error: "method_not_allowed" }, { allow: "POST" });
    if (sub === "complete" || sub === "reopen") {
      const stop = limited("change");
      if (stop) return stop;
      return own(await setDoneOwn(user, keyId, id, sub === "complete"), sub, id, (item) => item.title);
    }
    if (sub === "comments") {
      const input = parseComment(await body(event));
      const stop = limited("change");
      if (stop) return stop;
      const mark = input.result === "ok" ? "получилось" : input.result === "fail" ? "не получилось" : "комментарий";
      return own(await commentOwn(user, keyId, id, input), "comment", id, (item) => `${item.title} · ${mark}${input.text ? `: ${input.text}` : ""}`, 201);
    }
    return json(404, { error: "not_found" });
  } catch (error) {
    if (error instanceof InputError) return json(400, { error: "bad_request", message: error.message });
    if (error instanceof HelperUnavailable) return json(503, { error: "unavailable", message: "Ключи помощника работают только с базой SQLite." });
    log("error", "helper.write_failed", { key: keyId }, error);
    return json(503, { error: "storage_error", message: "Не удалось сохранить на сервере." });
  }
}
