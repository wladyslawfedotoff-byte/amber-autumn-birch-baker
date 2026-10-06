import { TOMBSTONE_TTL_MS } from "../../../src/lib/sync/merge.ts";
import { json, type ServerEvent } from "../../lib/http.ts";
import { getStore } from "../../lib/sync-store.ts";

export default async function syncGet(event: ServerEvent): Promise<Response> {
  const doc = await getStore().get();
  const etag = `"${doc.revision}"`;
  const now = Date.now();
  if (event.req.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { etag, "cache-control": "no-store", "x-server-now": String(now) } });
  }
  return json(
    200,
    { revision: doc.revision, updatedAt: doc.updatedAt, serverNow: now, cutoff: now - TOMBSTONE_TTL_MS, data: doc.data },
    { etag },
  );
}
