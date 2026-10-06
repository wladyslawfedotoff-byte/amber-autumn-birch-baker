import { getAuthConfig } from "../lib/auth.ts";
import { html, redirect, type ServerEvent } from "../lib/http.ts";
import { loginPage, safeNext } from "../lib/pages.ts";
import { lastLogin, readSession } from "../lib/session-cookie.ts";

export default function loginGet(event: ServerEvent): Response {
  const next = safeNext(event.url.searchParams.get("next"));
  const config = getAuthConfig();
  if (config.mode === "disabled" || readSession(event)) return redirect(next);
  const multiUser = "multiUser" in config && config.multiUser;
  const login = event.url.searchParams.get("u") || lastLogin(event);
  return html(200, loginPage({ error: event.url.searchParams.get("e"), next, login, multiUser }));
}
