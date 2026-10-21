/**
 * Device keys for «Быстрое добавление» (signed-in, same-origin — 01.auth):
 *   GET    /api/quick-tokens         → { items: [{ id, name, createdAt, lastUsedAt }] }
 *   POST   /api/quick-tokens {name}  → { token, item }  (the full key, only in this answer)
 *   DELETE /api/quick-tokens/:id     → revoke
 */
import { json, readBodyLimited, type ServerEvent } from "../../../lib/http.ts";
import { log } from "../../../lib/log.ts";
import { principalOf } from "../../../lib/principal.ts";
import { MAX_TOKENS_PER_USER, QuickAddUnavailable, cleanName, createToken, listTokens, revokeToken } from "../../../lib/quick-add/tokens.ts";

const NO_STORE = { "cache-control": "no-store" };

export default async function quickTokens(event: ServerEvent): Promise<Response> {
  const user = principalOf(event);
  if (!user) return json(401, { error: "unauthorized" });
  const method = event.req.method.toUpperCase();
  const id = event.url.pathname.replace(/^\/api\/quick-tokens\/?/, "").split("/")[0] ?? "";
  try {
    if (!id && method === "GET") return json(200, { items: listTokens(user.login) }, NO_STORE);
    if (!id && method === "POST") {
      let name: unknown = "";
      try {
        name = (JSON.parse((await readBodyLimited(event.req, 2048)) || "{}") as { name?: unknown }).name;
      } catch {
        return json(400, { error: "bad_json" });
      }
      const result = createToken(user.login, cleanName(name));
      if ("error" in result) return json(409, { error: "too_many", message: `Не больше ${MAX_TOKENS_PER_USER} устройств — отзовите ненужное.` });
      log("info", "quick_add.key_created", { user: user.login, key: result.item.id });
      return json(201, result, NO_STORE);
    }
    if (id && method === "DELETE") {
      if (!/^[A-Za-z0-9_-]{12}$/.test(id) || !revokeToken(user.login, id)) return json(404, { error: "not_found" });
      log("info", "quick_add.key_revoked", { user: user.login, key: id });
      return json(200, { ok: true });
    }
  } catch (error) {
    if (error instanceof QuickAddUnavailable) return json(503, { error: "unavailable", message: "Быстрое добавление работает только с базой SQLite (1.12+)." });
    throw error;
  }
  return json(405, { error: "method_not_allowed" });
}
