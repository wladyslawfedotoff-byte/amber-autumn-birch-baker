import type { ServerEvent } from "../../lib/http.ts";
import me from "./me.get.ts";

/**
 * What optional features this server has, plus the signed-in profile
 * (authenticated: not on the login surface, so 01.auth requires a session).
 * Never reveals the key itself. Same payload as /api/me.
 */
export default function capabilities(event: ServerEvent): Response {
  return me(event);
}
