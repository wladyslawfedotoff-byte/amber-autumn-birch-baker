/**
 * «Помощники» in Settings (signed-in, same-origin — 01.auth):
 *   GET    /api/helper-keys            → { items: [{ id, name, createdAt, lastUsedAt }] }
 *   POST   /api/helper-keys {name}     → { token, item }  (the full key, only in this answer)
 *   DELETE /api/helper-keys/:id        → revoke
 *   GET    /api/helper-keys/:id/log    → { items: [{ at, action, taskId, summary }] }  newest first, 90 days
 * A helper key itself never gets here (no session → 401).
 */
import { json, readBodyLimited, type ServerEvent } from "../../../lib/http.ts";
import { log } from "../../../lib/log.ts";
import { principalOf } from "../../../lib/principal.ts";
import { HelperUnavailable, MAX_HELPER_KEYS, auditLog, cleanKeyName, createHelperKey, listHelperKeys, revokeHelperKey } from "../../../lib/helper/keys.ts";

const NO_STORE = { "cache-control": "no-store" };
const ID_RE = /^[A-Za-z0-9_-]{12}$/;

export default async function helperKeys(event: ServerEvent): Promise<Response> {
  const user = principalOf(event);
  if (!user) return json(401, { error: "unauthorized" });
  const method = event.req.method.toUpperCase();
  const [id = "", sub, extra] = event.url.pathname.replace(/^\/api\/helper-keys\/?/, "").split("/");
  try {
    if (!id && method === "GET") return json(200, { items: listHelperKeys(user.login) }, NO_STORE);
    if (!id && method === "POST") {
      let name: unknown = "";
      try {
        name = (JSON.parse((await readBodyLimited(event.req, 2048)) || "{}") as { name?: unknown }).name;
      } catch {
        return json(400, { error: "bad_json" });
      }
      const result = createHelperKey(user.login, cleanKeyName(name));
      if ("error" in result) return json(409, { error: "too_many", message: `Не больше ${MAX_HELPER_KEYS} ключей — отзовите ненужный.` });
      log("info", "helper.key_created", { user: user.login, key: result.item.id });
      return json(201, result, NO_STORE);
    }
    if (id && !ID_RE.test(id)) return json(404, { error: "not_found" });
    const mine = () => listHelperKeys(user.login).some((k) => k.id === id);
    if (id && sub === "log" && extra === undefined && method === "GET") {
      if (!mine()) return json(404, { error: "not_found" });
      return json(200, { items: auditLog(user.login, id) }, NO_STORE);
    }
    if (id && sub === undefined && method === "DELETE") {
      if (!revokeHelperKey(user.login, id)) return json(404, { error: "not_found" });
      log("info", "helper.key_revoked", { user: user.login, key: id });
      return json(200, { ok: true });
    }
  } catch (error) {
    if (error instanceof HelperUnavailable) return json(503, { error: "unavailable", message: "Ключи помощника работают только с базой SQLite (1.12+)." });
    throw error;
  }
  return json(405, { error: "method_not_allowed" });
}
