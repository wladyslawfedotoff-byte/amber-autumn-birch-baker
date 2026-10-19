#!/usr/bin/env node
/**
 * Reset a password changed in the app («Профиль» → «Сменить пароль»):
 *
 *   docker exec pora-app node scripts/reset-password.mjs --list
 *   docker exec pora-app node scripts/reset-password.mjs <login>
 *
 * Removes the in-app password of <login> (table `users` of data/pora.db since
 * 1.12.0; data/users.json before / with the JSON fallback), so the password
 * from .env (USER_<LOGIN>_PASSWORD(_HASH), or APP_PASSWORD with one profile /
 * for APP_OWNER) works again, and signs that user out on every device.
 * The running server notices the change by itself; no restart needed.
 *
 * Needs Node ≥ 22.18 (imports server/lib/db/*.ts directly), like the image has.
 */
import { statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runAsDataOwner } from "./data-owner.mjs";
import { readUsersFile, withoutPassword, writeUsersFileSync } from "./users-file.mjs";

const dir = (process.env.DATA_DIR ?? "").trim() || "/data";
const here = fileURLToPath(new URL(".", import.meta.url));

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

/** pora.db when the server uses it, else users.json (1.11 / JSON fallback). */
async function usersStore() {
  runAsDataOwner(dir);
  const { openForScript } = await import(join(here, "../server/lib/db/offline.ts"));
  const storage = openForScript(dir);
  if (storage.mode === "sqlite") {
    const { readUsers, writeUsers } = await import(join(here, "../server/lib/db/records.ts"));
    const db = storage.db;
    return {
      read: () => readUsers(db),
      /** @param {(file: any) => any} change */
      update: (change) => db.transaction(() => writeUsers(db, change(readUsers(db)))).immediate(),
      close: () => db.close(),
    };
  }
  return {
    read: () => readUsersFile(dir),
    /** @param {(file: any) => any} change */
    update: (change) => writeUsersFileSync(dir, change(readUsersFile(dir)), owner()),
    close: () => undefined,
  };
}

async function main() {
  const arg = (process.argv[2] ?? "").trim();
  if (!arg || arg === "--help" || arg === "-h") {
    console.error("Сброс пароля, изменённого в приложении / reset an in-app password\n");
    console.error("  node scripts/reset-password.mjs --list      профили и у кого пароль задан в приложении");
    console.error("  node scripts/reset-password.mjs <логин>     вернуть пароль из .env и выйти на всех устройствах");
    process.exit(arg ? 0 : 1);
  }
  const store = await usersStore();
  try {
    await run(arg, store);
  } finally {
    store.close();
  }
}

/** @param {string} arg @param {{ read: () => any, update: (change: (file: any) => any) => void }} store */
async function run(arg, store) {
  const file = store.read();
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
  store.update((current) => withoutPassword(current, arg, Date.now()));
  console.log(
    had
      ? `Готово: у «${arg}» снова пароль из .env. Все устройства этого профиля вышли из аккаунта.`
      : `У «${arg}» пароль и так из .env. Все устройства этого профиля вышли из аккаунта.`,
  );
  if (!configuredUsers().includes(arg)) console.log(`Внимание: «${arg}» нет в APP_USERS — войти этим логином нельзя.`);
}

try {
  await main();
} catch (error) {
  console.error(`Ошибка: ${error?.message || error}`);
  process.exit(1);
}
