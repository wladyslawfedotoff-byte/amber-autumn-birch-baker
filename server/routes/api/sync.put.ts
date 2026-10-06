import { TOMBSTONE_TTL_MS, normalizeData } from "../../../src/lib/sync/merge.ts";
import { BodyTooLargeError, NO_LOG_HEADER, clientIp, json, readBodyLimited, type ServerEvent } from "../../lib/http.ts";
import { log } from "../../lib/log.ts";
import { principalOf } from "../../lib/principal.ts";
import { aclFor } from "../../lib/sync-access.ts";
import { dataDir, getStore, type ViewPutResult } from "../../lib/sync-store.ts";

const MAX_SYNC_BODY = 5 * 1024 * 1024;

function parseIfMatch(value: string | null): number | null {
  if (!value) return null;
  const match = /^\s*(?:W\/)?"?(\d{1,15})"?\s*$/.exec(value);
  return match ? Number(match[1]) : null;
}

export default async function syncPut(event: ServerEvent): Promise<Response> {
  const user = principalOf(event);
  if (!user) return json(401, { error: "unauthorized" });
  // A device that still holds another profile's copy must not upload it into this account.
  const claimed = (event.req.headers.get("x-pora-user") ?? "").trim();
  if (user.multiUser && claimed && claimed !== user.login) {
    log("info", "sync.user_mismatch", { user: user.login, device: claimed.slice(0, 32) });
    return json(412, { error: "user_mismatch", user: user.login, message: "На этом устройстве были данные другого профиля." });
  }
  const base = parseIfMatch(event.req.headers.get("if-match"));
  if (base === null) {
    return json(428, { error: "if_match_required", message: "Нужен заголовок If-Match с ревизией." });
  }
  let text: string;
  try {
    text = await readBodyLimited(event.req, MAX_SYNC_BODY);
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      log("warn", "sync.too_large", { ip: clientIp(event) });
      return json(413, { error: "too_large", message: "Слишком большой документ (больше 5 МБ)." });
    }
    throw error;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    log("warn", "sync.bad_json", { ip: clientIp(event), bytes: text.length });
    return json(400, { error: "bad_json" });
  }
  const body = raw && typeof raw === "object" && "data" in (raw as Record<string, unknown>) ? (raw as { data: unknown }).data : raw;
  const normalized = normalizeData(body);
  if (!normalized.ok) {
    log("warn", "sync.invalid", { ip: clientIp(event), reason: normalized.error });
    return json(400, { error: "invalid_document", message: normalized.error });
  }
  const acl = aclFor(user);
  let result: ViewPutResult;
  try {
    if (acl) {
      result = await getStore().putFor(user.login, acl, base, normalized.data);
    } else {
      const single = await getStore().put(base, normalized.data);
      result = single.status === "ok" ? { ...single, denied: 0 } : single;
    }
  } catch (error) {
    log("error", "sync.write_failed", { dataDir: dataDir(), base }, error);
    return json(
      503,
      { error: "storage_error", message: "Сервер не смог сохранить данные (папка данных недоступна для записи?). Изменения остаются на устройстве." },
      { [NO_LOG_HEADER]: "1" },
    );
  }
  const now = Date.now();
  const payload = {
    revision: result.doc.revision,
    updatedAt: result.doc.updatedAt,
    serverNow: now,
    cutoff: now - TOMBSTONE_TTL_MS,
    user: user.login,
    profiles: user.multiUser,
    data: result.doc.data,
  };
  const etag = `"${result.doc.revision}"`;
  if (result.status === "conflict") {
    log("info", "sync.conflict", { ip: clientIp(event), user: user.login, base, current: result.doc.revision });
    return json(409, { error: "conflict", ...payload }, { etag });
  }
  if (result.changed) {
    log("info", "sync.saved", { user: user.login, rev: result.doc.revision, base, tasks: result.doc.data.tasks.length, bytes: text.length });
  }
  if (result.status === "ok" && result.denied > 0) {
    log("warn", "sync.denied", { user: user.login, ip: clientIp(event), count: result.denied, note: "entities of other profiles were ignored" });
  }
  return json(200, payload, { etag });
}
