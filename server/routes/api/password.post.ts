import { MIN_PASSWORD_LENGTH, getAuthConfig, isActive, isPlaceholderPassword } from "../../lib/auth.ts";
import { BodyTooLargeError, NO_LOG_HEADER, clientIp, json, readBodyLimited, type ServerEvent } from "../../lib/http.ts";
import { log } from "../../lib/log.ts";
import { principalOf } from "../../lib/principal.ts";
import { LoginLimiter } from "../../lib/rate-limit.ts";
import { sessionCookie, withCookies } from "../../lib/session-cookie.ts";
import { setUserPassword, verifyCredentials } from "../../lib/user-store.ts";

/** Wrong «текущий пароль» counts per user, so a stolen session cannot guess it from many IPs. */
const limiter = new LoginLimiter();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * «Сменить пароль»: { current, next, repeat? }. Requires a session (01.auth)
 * and the current password. The new scrypt hash goes to data/users.json and
 * wins over .env; the user's other devices are signed out, this one gets a new
 * cookie.
 */
export default async function changePassword(event: ServerEvent): Promise<Response> {
  const config = getAuthConfig();
  const user = principalOf(event);
  if (!isActive(config) || !user) return json(400, { error: "not_available", message: "Вход по паролю выключен на этом сервере." });
  let body: { current?: unknown; next?: unknown; repeat?: unknown };
  try {
    body = JSON.parse((await readBodyLimited(event.req, 8 * 1024)) || "{}");
  } catch (error) {
    if (error instanceof BodyTooLargeError) return json(413, { error: "too_large" });
    return json(400, { error: "bad_request" });
  }
  const current = typeof body.current === "string" ? body.current : "";
  const next = typeof body.next === "string" ? body.next : "";
  const key = `user:${user.login}`;
  const verdict = limiter.check(key);
  if (!verdict.allowed) {
    return json(429, { error: "rate", message: "Слишком много попыток. Подождите 15 минут." }, { "retry-after": String(verdict.retryAfterSec) });
  }
  if (typeof body.repeat === "string" && body.repeat !== next) {
    return json(400, { error: "mismatch", message: "Новый пароль и повтор не совпадают." });
  }
  if ([...next].length < MIN_PASSWORD_LENGTH) {
    return json(400, { error: "too_short", message: `Новый пароль — не короче ${MIN_PASSWORD_LENGTH} символов. Удобно взять фразу из 3–4 слов.` });
  }
  if (isPlaceholderPassword(next)) {
    return json(400, { error: "placeholder", message: "Это пример из инструкции — придумайте свой пароль." });
  }
  if (next === current) return json(400, { error: "same", message: "Новый пароль совпадает с текущим." });
  if (!verifyCredentials(config, user.login, current)) {
    const delay = limiter.fail(key);
    log("warn", "auth.password_change_failed", { user: user.login, ip: clientIp(event) });
    await sleep(delay);
    return json(403, { error: "wrong_current", message: "Текущий пароль неверный." });
  }
  limiter.success(key);
  try {
    setUserPassword(user.login, next);
  } catch (error) {
    log("error", "auth.password_save_failed", { user: user.login }, error);
    return json(
      503,
      { error: "storage_error", message: "Не удалось сохранить на сервере (папка данных недоступна для записи)." },
      { [NO_LOG_HEADER]: "1" },
    );
  }
  return withCookies(json(200, { ok: true }), [sessionCookie(event, { login: user.login })]);
}
