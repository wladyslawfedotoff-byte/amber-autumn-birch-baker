import type { AclConfig } from "../../src/lib/sync/world.ts";
import type { Principal } from "./principal.ts";

/** ACL for several profiles; null with one profile (the whole document, as before). */
export function aclFor(user: Principal): AclConfig | null {
  if (!user.multiUser) return null;
  return { owner: user.owner, users: user.users.map((item) => item.login) };
}
