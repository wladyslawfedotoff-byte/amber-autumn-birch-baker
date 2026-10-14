import { json, type ServerEvent } from "../../lib/http.ts";
import { fetchTitle } from "../../lib/link-title.ts";
import { principalOf } from "../../lib/principal.ts";

const recent = new Map<string, number[]>();
const PER_MINUTE = 20;

/** GET /api/link-title?url=… → { title: string | null }. Signed-in only; a suggestion, never required. */
export default async function linkTitle(event: ServerEvent): Promise<Response> {
  const user = principalOf(event);
  if (!user) return json(401, { error: "unauthorized" });
  const now = Date.now();
  const key = user.login;
  const hits = (recent.get(key) ?? []).filter((t) => now - t < 60_000);
  if (hits.length >= PER_MINUTE) return json(429, { error: "rate_limited" });
  hits.push(now);
  recent.set(key, hits);
  const url = event.url.searchParams.get("url") ?? "";
  if (!url || url.length > 2000) return json(400, { error: "bad_url" });
  const title = await fetchTitle(url);
  return json(200, { title }, { "cache-control": "no-store" });
}
