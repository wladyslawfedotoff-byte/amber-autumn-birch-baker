import { json, type ServerEvent } from "../../lib/http.ts";
import { principalOf } from "../../lib/principal.ts";
import { hasInAppPassword } from "../../lib/user-store.ts";

/** Who is signed in (+ the profiles one can share with). Requires a session (01.auth). */
export default function me(event: ServerEvent): Response {
  const user = principalOf(event);
  if (!user) return json(401, { error: "unauthorized" });
  return json(200, {
    login: user.login,
    name: user.name,
    multiUser: user.multiUser,
    users: user.multiUser ? user.users : [],
    /** Owner of entities without `owner` (APP_OWNER). */
    dataOwner: user.owner,
    passwordInApp: hasInAppPassword(user.login),
    assistant: Boolean(process.env.XAI_API_KEY?.trim()),
  });
}
