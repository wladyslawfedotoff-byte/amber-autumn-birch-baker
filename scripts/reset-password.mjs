#!/usr/bin/env node
/**
 * Reset a password changed in the app («Профиль» → «Сменить пароль»):
 *
 *   docker exec pora-app node scripts/reset-password.mjs --list
 *   docker exec pora-app node scripts/reset-password.mjs <login>
 *
 * Removes the in-app password of <login> from data/users.json, so the password
 * from .env (USER_<LOGIN>_PASSWORD(_HASH), or APP_PASSWORD with one profile /
 * for APP_OWNER) works again, and signs that user out on every device.
 * The running server notices the change by itself; no restart needed.
 */
import { statSync } from "node:fs";
import { readUsersFile, withoutPassword, writeUsersFileSync } from "./users-file.mjs";

const dir = (process.env.DATA_DIR ?? "").trim() || "/data";

function configuredUsers() {
  const list = (process.env.APP_USERS ?? "").trim();
  if (list) return list.split(",").map((item) => item.trim()).filter(Boolean);
  return [((process.env.APP_DEFAULT_USER ?? "").trim().toLowerCase() || "admin")];
}

function owner() {
  try {
    const st = statSync(dir);
    return { uid: st.uid, gid: st.gid };
  } catch {
    return null;
  }
}

function main() {
  const arg = (process.argv[2] ?? "").trim();
  if (!arg || arg === "--help" || arg === "-h") {
    console.error("Сброс пароля, изменённого в приложении / reset an in-app password\n");
    console.error("  node scripts/reset-password.mjs --list      профили и у кого пароль задан в приложении");
    console.error("  node scripts/reset-password.mjs <логин>     вернуть пароль из .env и выйти на всех устройствах");
    process.exit(arg ? 0 : 1);
  }
  const file = readUsersFile(dir);
  if (arg === "--list") {
    const users = new Set([...configuredUsers(), ...Object.keys(file.users)]);
    for (const login of [...users].sort()) {
      const entry = file.users[login] ?? {};
      const where = entry.passwordHash ? `пароль из приложения (с ${new Date(entry.changedAt ?? 0).toISOString()})` : "пароль из .env";
      const configured = configuredUsers().includes(login) ? "" : "  [нет в APP_USERS]";
      console.log(`${login.padEnd(20)} ${where}${configured}`);
    }
    return;
  }
  if (!/^[a-z0-9_-]{1,32}$/.test(arg)) {
    console.error(`Логин «${arg}» не подходит (a-z, 0-9, «_», «-»).`);
    process.exit(1);
  }
  const had = Boolean(file.users[arg]?.passwordHash);
  writeUsersFileSync(dir, withoutPassword(file, arg, Date.now()), owner());
  console.log(
    had
      ? `Готово: у «${arg}» снова пароль из .env. Все устройства этого профиля вышли из аккаунта.`
      : `У «${arg}» пароль и так из .env. Все устройства этого профиля вышли из аккаунта.`,
  );
  if (!configuredUsers().includes(arg)) console.log(`Внимание: «${arg}» нет в APP_USERS — войти этим логином нельзя.`);
}

try {
  main();
} catch (error) {
  console.error(`Ошибка: ${error?.message || error}`);
  process.exit(1);
}
