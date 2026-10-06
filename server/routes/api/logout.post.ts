import { json, redirect, type ServerEvent } from "../../lib/http.ts";
import { clearedSessionCookie } from "../../lib/session-cookie.ts";

export default function logout(event: ServerEvent): Response {
  const cookie = clearedSessionCookie(event);
  const type = event.req.headers.get("content-type") ?? "";
  if (type.includes("form")) return redirect("/login", 303, { "set-cookie": cookie });
  return json(200, { ok: true }, { "set-cookie": cookie });
}
