/**
 * The signed-in user of a request. 01.auth stores the login from the verified
 * session cookie in `event.context`; routes read it from here and never trust
 * anything the client says about who it is.
 */
import { getAuthConfig, isActive } from "./auth.ts";
import type { ServerEvent } from "./http.ts";

const KEY = "poraUser";

export type Principal = {
  login: string;
  name: string;
  /** Several profiles configured (APP_USERS): sharing and per-user data are on. */
  multiUser: boolean;
  /** Owner of data created before profiles existed (APP_OWNER). */
  owner: string;
  /** All configured logins (for «Назначить» / «Совместная»). */
  users: { login: string; name: string }[];
};

export function setPrincipalLogin(event: ServerEvent, login: string): void {
  event.context[KEY] = login;
}

export function principalOf(event: ServerEvent): Principal | null {
  const config = getAuthConfig();
  if (!isActive(config) && config.mode !== "disabled") return null;
  const login = typeof event.context[KEY] === "string" ? (event.context[KEY] as string) : config.mode === "disabled" ? config.owner : "";
  const account = config.accounts.get(login);
  if (!account) return null;
  return {
    login,
    name: account.name,
    multiUser: config.multiUser,
    owner: config.owner,
    users: config.logins.map((item) => ({ login: item, name: config.accounts.get(item)!.name })),
  };
}
