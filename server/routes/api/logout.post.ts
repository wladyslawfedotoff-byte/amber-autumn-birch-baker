import { json, redirect, type ServerEvent } from "../../lib/http.ts";
import { clearedSessionCookies, withCookies } from "../../lib/session-cookie.ts";

export default function logout(event: ServerEvent): Response {
  const cookies = clearedSessionCookies(event);
  const type = event.req.headers.get("content-type") ?? "";
  if (type.includes("form")) return withCookies(redirect("/login", 303), cookies);
  return withCookies(json(200, { ok: true }), cookies);
}
