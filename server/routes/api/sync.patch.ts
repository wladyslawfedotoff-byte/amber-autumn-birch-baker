/**
 * PATCH /api/sync (1.15): only the entities a device changed. They are merged
 * into the server copy with the same per-field rules as a full PUT, and the
 * answer is just the new revision — not the whole document. `prevRevision` is
 * the revision the change was merged into: when it is not the device's base,
 * somebody else wrote meanwhile and the device pulls once.
 *
 * Old clients keep using PUT (full document); nothing in pora.db changes.
 */
import { TOMBSTONE_TTL_MS, normalizeData } from "../../../src/lib/sync/merge.ts";
import { applyPatch, readAfterHints } from "../../../src/lib/sync/engine.ts";
import { BodyTooLargeError, NO_LOG_HEADER, clientIp, json, readBodyLimited, type ServerEvent } from "../../lib/http.ts";
import { log } from "../../lib/log.ts";
import { principalOf } from "../../lib/principal.ts";
import { aclFor } from "../../lib/sync-access.ts";
import { dataDir, getStore } from "../../lib/sync-store.ts";

const MAX_PATCH_BODY = 5 * 1024 * 1024;

export default async function syncPatch(event: ServerEvent): Promise<Response> {
  const user = principalOf(event);
  if (!user) return json(401, { error: "unauthorized" });
  const claimed = (event.req.headers.get("x-pora-user") ?? "").trim();
  if (user.multiUser && claimed && claimed !== user.login) {
    log("info", "sync.user_mismatch", { user: user.login, device: claimed.slice(0, 32) });
    return json(412, { error: "user_mismatch", user: user.login, message: "На этом устройстве были данные другого профиля." });
  }
  let text: string;
  try {
    text = await readBodyLimited(event.req, MAX_PATCH_BODY);
  } catch (error) {
    if (error instanceof BodyTooLargeError) return json(413, { error: "too_large", message: "Слишком большой пакет изменений (больше 5 МБ)." });
    throw error;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    log("warn", "sync.bad_json", { ip: clientIp(event), bytes: text.length });
    return json(400, { error: "bad_json" });
  }
  const normalized = normalizeData(raw);
  if (!normalized.ok) {
    log("warn", "sync.invalid", { ip: clientIp(event), reason: normalized.error });
    return json(400, { error: "invalid_document", message: normalized.error });
  }
  const changes = normalized.data;
  const after = readAfterHints(raw);
  const acl = aclFor(user);
  const store = getStore();
  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      const now = Date.now();
      const cutoff = now - TOMBSTONE_TTL_MS;
      const current = acl ? await store.getFor(user.login, acl) : await store.get();
      // Server copy first (keeps its order); the changed entities merge in field by field.
      const full = applyPatch(current.data, changes, after, cutoff);
      const result = acl ? await store.putFor(user.login, acl, current.revision, full) : await store.put(current.revision, full);
      if (result.status === "conflict") continue;
      if (result.changed) log("info", "sync.patched", { user: user.login, rev: result.doc.revision, base: current.revision, bytes: text.length });
      const etag = `"${result.doc.revision}"`;
      return json(200, { revision: result.doc.revision, prevRevision: current.revision, updatedAt: result.doc.updatedAt, serverNow: Date.now(), cutoff }, { etag });
    }
  } catch (error) {
    log("error", "sync.write_failed", { dataDir: dataDir() }, error);
    return json(503, { error: "storage_error", message: "Сервер не смог сохранить данные. Изменения остаются на устройстве." }, { [NO_LOG_HEADER]: "1" });
  }
  return json(409, { error: "busy", message: "Сервер занят, попробуем ещё раз." });
}
