import { TOMBSTONE_TTL_MS } from "../../../src/lib/sync/merge.ts";
import { json, type ServerEvent } from "../../lib/http.ts";
import { principalOf } from "../../lib/principal.ts";
import { aclFor } from "../../lib/sync-access.ts";
import { getStore } from "../../lib/sync-store.ts";

export default async function syncGet(event: ServerEvent): Promise<Response> {
  const user = principalOf(event);
  if (!user) return json(401, { error: "unauthorized" });
  const acl = aclFor(user);
  const doc = acl ? await getStore().getFor(user.login, acl) : await getStore().get();
  const etag = `"${doc.revision}"`;
  const now = Date.now();
  if (event.req.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { etag, "cache-control": "no-store", "x-server-now": String(now), vary: "cookie" } });
  }
  return json(
    200,
    { revision: doc.revision, updatedAt: doc.updatedAt, serverNow: now, cutoff: now - TOMBSTONE_TTL_MS, user: user.login, profiles: user.multiUser, data: doc.data },
    { etag, vary: "cookie" },
  );
}
