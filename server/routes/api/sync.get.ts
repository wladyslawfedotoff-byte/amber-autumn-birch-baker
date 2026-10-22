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
  // A proxy that compresses may turn the tag into W/"…": compare the revision only.
  const known = (event.req.headers.get("if-none-match") ?? "").split(",").map((tag) => tag.trim().replace(/^W\//, ""));
  if (known.includes(etag)) {
    return new Response(null, { status: 304, headers: { etag, "cache-control": "no-store", "x-server-now": String(now), vary: "cookie" } });
  }
  return json(
    200,
    { revision: doc.revision, updatedAt: doc.updatedAt, serverNow: now, cutoff: now - TOMBSTONE_TTL_MS, user: user.login, profiles: user.multiUser, owner: user.owner, data: doc.data },
    { etag, vary: "cookie" },
  );
}
