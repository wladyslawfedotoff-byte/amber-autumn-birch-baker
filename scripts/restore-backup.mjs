#!/usr/bin/env node
/**
 * Restore a «Пора» backup on the server (run inside the container):
 *
 *   docker exec pora-app node scripts/restore-backup.mjs --list
 *   docker exec pora-app node scripts/restore-backup.mjs <file> [--replace] [--dry-run]
 *
 * <file> is a name from --list (data/backups/…), a path inside the container,
 * or an exported backup from Настройки → «Резервная копия».
 *
 * What it does:
 * - saves the current data as backups/pora-…-pre-restore.json first;
 * - puts every task/list/habit/… of the backup back with a fresh stamp, so it
 *   wins against the copies phones and computers still hold (no need to clear
 *   site data on the devices: they pick it up on their next sync);
 * - clears tombstones of the restored entries;
 * - by default keeps entries that are newer than the backup (created after it);
 *   with --replace they are deleted everywhere (tombstoned) as well;
 * - bumps the revision (with several profiles: every profile's revision); the
 *   running server notices the change by itself;
 * - writes into data/pora.db (one transaction) since 1.12.0, or into
 *   data/pora.json while the server still uses the JSON files;
 * - in-app passwords are not part of it (backups/users-….json next to the copy
 *   is kept for reference); reset one with scripts/reset-password.mjs.
 *
 * Needs Node ≥ 22.18 (imports src/lib/sync/merge.ts and server/lib/db directly).
 */
import { promises as fs, mkdirSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { basename, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const { COLLECTIONS, emptyData, normalizeData, restoreDocument } = await import(join(here, "../src/lib/sync/merge.ts"));
const { afterRestore, normalizeUserStates } = await import(join(here, "../src/lib/sync/world.ts"));
const { runAsDataOwner } = await import(join(here, "data-owner.mjs"));

const BACKUP_NAME = /^pora-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z-r(\d+)(?:-[a-z-]+)?\.json$/;

function usage(code = 0) {
  const text = [
    "Восстановление резервной копии «Пора» / restore a backup",
    "",
    "  node scripts/restore-backup.mjs --list",
    "  node scripts/restore-backup.mjs <файл> [--replace] [--dry-run]",
    "",
    "  <файл>      backups/pora-….json, backup/pora-<дата>.db или экспорт из «Настройки»",
    "  --list      список копий в $DATA_DIR/backups (новые сверху)",
    "  --replace   удалить записи, которых нет в копии (иначе они остаются)",
    "  --dry-run   только показать, что изменится",
  ].join("\n");
  (code ? console.error : console.log)(text);
  process.exit(code);
}

function dataDir() {
  return (process.env.DATA_DIR ?? "").trim() || "/data";
}

function backupTime(name) {
  const m = BACKUP_NAME.exec(name);
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], +m[7]);
}

function counts(data) {
  return COLLECTIONS.map((key) => `${key} ${data[key].length}`).join(", ");
}

function fmt(time) {
  return `${new Date(time).toISOString().replace("T", " ").slice(0, 19)} UTC`;
}

async function readDocument(file) {
  if (file.endsWith(".db")) {
    // A database copy (data/backup/pora-<date>.db): read its document read-only.
    const { openDb } = await import(join(here, "../server/lib/db/database.ts"));
    const { readStoredDoc } = await import(join(here, "../server/lib/db/doc-tables.ts"));
    const db = openDb(file, { readonly: true });
    try {
      const doc = readStoredDoc(db);
      if (!doc) throw new Error(`${file}: в копии базы нет данных`);
      return { revision: doc.revision, data: doc.data, users: doc.users ?? {} };
    } finally {
      db.close();
    }
  }
  const parsed = JSON.parse(await fs.readFile(file, "utf8"));
  // Server file/backup: { revision, updatedAt, data }; app export: the data itself.
  const raw = parsed && typeof parsed === "object" && parsed.data && typeof parsed.data === "object" ? parsed.data : parsed;
  const normalized = normalizeData(raw);
  if (!normalized.ok) throw new Error(`${file}: не похоже на копию «Пора» (${normalized.error})`);
  const users = parsed && typeof parsed === "object" ? normalizeUserStates(parsed.users) : {};
  return { revision: typeof parsed.revision === "number" ? parsed.revision : null, data: normalized.data, users };
}

async function list(dir) {
  const backups = join(dir, "backups");
  let names = [];
  try {
    names = await fs.readdir(backups);
  } catch {
    console.log(`Папки ${backups} нет — копий пока не было.`);
    return;
  }
  const rows = names
    .map((name) => ({ name, time: backupTime(name) }))
    .filter((row) => row.time !== null)
    .sort((a, b) => b.time - a.time);
  if (!rows.length) {
    console.log(`В ${backups} нет копий.`);
    return;
  }
  for (const row of rows) {
    let info = "";
    try {
      const doc = await readDocument(join(backups, row.name));
      info = counts(doc.data);
    } catch (error) {
      info = `не читается: ${error.message}`;
    }
    console.log(`${row.name}\n    ${fmt(row.time)} · ${info}`);
  }
  console.log(`\nВсего: ${rows.length}. Восстановить: node scripts/restore-backup.mjs <имя файла>`);
  try {
    const snapshots = (await fs.readdir(join(dir, "backup"))).filter((name) => /^pora-.*\.db$/.test(name)).sort().reverse();
    if (snapshots.length) {
      console.log(`\nКопии базы целиком (data/backup, для отката всей базы — docs/SYNOLOGY.md): ${snapshots.join(", ")}`);
    }
  } catch {
    // no database copies yet
  }
}

async function statOrNull(file) {
  try {
    return await fs.stat(file);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function sameStat(a, b) {
  if (!a || !b) return a === b;
  return a.size === b.size && a.mtimeMs === b.mtimeMs && a.ino === b.ino;
}

async function resolveSource(dir, arg) {
  const candidates = isAbsolute(arg) ? [arg] : [join(dir, "backups", arg), join(dir, "backup", arg), resolve(arg)];
  for (const file of candidates) {
    if (await statOrNull(file)) return file;
  }
  throw new Error(`Файл не найден: ${arg} (искали: ${candidates.join(", ")}). Список: --list`);
}

/** 1.12+: the document lives in pora.db — restore inside one write transaction. */
async function restoreDb(dir, storage, backup, source, { replace, dryRun }) {
  const { DocTables, readStoredDoc } = await import(join(here, "../server/lib/db/doc-tables.ts"));
  const { serializeStoredDoc } = await import(join(here, "../server/lib/db/legacy.ts"));
  const db = storage.db;
  const docs = new DocTables();
  const run = db.transaction(() => {
    const stored = readStoredDoc(db);
    const current = stored ?? { revision: 0, updatedAt: 0, data: emptyData() };
    const now = Date.now();
    const data = restoreDocument(current.data, backup.data, { now, replace });
    console.log(`Копия:   ${basename(source)} — ${counts(backup.data)}`);
    console.log(`Сейчас:  ревизия ${current.revision} — ${counts(current.data)} (pora.db)`);
    console.log(`Станет:  ревизия ${current.revision + 1} — ${counts(data)}${replace ? " (--replace: лишнее удаляется)" : ""}`);
    if (dryRun) return null;
    let safety = null;
    if (stored) {
      mkdirSync(join(dir, "backups"), { recursive: true });
      const stamp = new Date(now).toISOString().replace(/[:.]/g, "-");
      safety = join(dir, "backups", `pora-${stamp}-r${current.revision}-pre-restore.json`);
      writeFileSync(safety, serializeStoredDoc(stored), { flag: "wx", mode: 0o600 });
    }
    const users = current.users && Object.keys(current.users).length ? afterRestore(current.users, data) : null;
    const next = { revision: current.revision + 1, updatedAt: now, data, ...(users ? { users } : {}) };
    docs.prime(stored);
    docs.save(db, next, stored ? stored.revision : null);
    return { safety, revision: next.revision };
  });
  const result = run.immediate();
  if (!result) {
    console.log("--dry-run: ничего не изменено.");
    return;
  }
  if (result.safety) console.log(`Текущие данные сохранены: backups/${basename(result.safety)}`);
  console.log(`Готово: ревизия ${result.revision}. Устройства получат данные при следующей синхронизации (до ~15 с, или «Синхронизировать сейчас»).`);
}

async function restore(dir, source, options) {
  const backup = await readDocument(source);
  const { openForScript } = await import(join(here, "../server/lib/db/offline.ts"));
  const storage = openForScript(dir);
  if (storage.mode === "sqlite") {
    try {
      await restoreDb(dir, storage, backup, source, options);
    } finally {
      storage.db.close();
    }
    return;
  }
  await restoreJson(dir, source, backup, options);
}

async function restoreJson(dir, source, backup, { replace, dryRun }) {
  const file = join(dir, "pora.json");
  for (let attempt = 0; attempt < 3; attempt++) {
    const before = await statOrNull(file);
    const current = before ? await readDocument(file) : { revision: 0, data: emptyData(), users: {} };
    const currentRevision = current.revision ?? 0;
    const now = Date.now();
    const data = restoreDocument(current.data, backup.data, { now, replace });
    console.log(`Копия:   ${basename(source)} — ${counts(backup.data)}`);
    console.log(`Сейчас:  ревизия ${currentRevision} — ${counts(current.data)}`);
    console.log(`Станет:  ревизия ${currentRevision + 1} — ${counts(data)}${replace ? " (--replace: лишнее удаляется)" : ""}`);
    if (dryRun) {
      console.log("--dry-run: ничего не изменено.");
      return;
    }
    const owner = before ?? (await fs.stat(dir));
    if (before) {
      await fs.mkdir(join(dir, "backups"), { recursive: true });
      const stamp = new Date(now).toISOString().replace(/[:.]/g, "-");
      const safety = join(dir, "backups", `pora-${stamp}-r${currentRevision}-pre-restore.json`);
      // Not fs.copyFile: with the container's reduced capabilities it fails
      // with EPERM for root on files owned by the app user.
      await fs.writeFile(safety, await fs.readFile(file), { flag: "wx", mode: 0o600 });
      await fs.chown(safety, owner.uid, owner.gid).catch(() => undefined);
      console.log(`Текущие данные сохранены: backups/${basename(safety)}`);
    }
    // Several profiles: every profile's view moves on; restored entries are no longer tombstoned there.
    const hasUsers = Object.keys(current.users).length > 0;
    const doc = hasUsers
      ? { v: 2, revision: currentRevision + 1, updatedAt: now, data, users: afterRestore(current.users, data) }
      : { revision: currentRevision + 1, updatedAt: now, data };
    const tmp = `${file}.tmp-restore-${randomBytes(4).toString("hex")}`;
    try {
      const handle = await fs.open(tmp, "wx", 0o600);
      try {
        await handle.writeFile(JSON.stringify(doc));
        await handle.sync();
      } finally {
        await handle.close();
      }
      await fs.chown(tmp, owner.uid, owner.gid).catch(() => undefined);
      // The server may have saved meanwhile: start over with its newer file.
      if (!sameStat(before, await statOrNull(file))) {
        await fs.unlink(tmp);
        console.log("Файл изменился во время восстановления — повторяю…");
        continue;
      }
      await fs.rename(tmp, file);
    } catch (error) {
      await fs.unlink(tmp).catch(() => undefined);
      throw error;
    }
    console.log(`Готово: ревизия ${doc.revision}. Устройства получат данные при следующей синхронизации (до ~15 с, или «Синхронизировать сейчас»).`);
    return;
  }
  throw new Error("Сервер постоянно меняет файл — попробуйте ещё раз, когда никто не редактирует задачи.");
}

const args = process.argv.slice(2);
if (!args.length || args.includes("--help") || args.includes("-h")) usage(args.length ? 0 : 1);
const dir = dataDir();
runAsDataOwner(dir);
try {
  if (args.includes("--list")) {
    await list(dir);
  } else {
    const positional = args.filter((arg) => !arg.startsWith("--"));
    const unknown = args.filter((arg) => arg.startsWith("--") && !["--replace", "--dry-run"].includes(arg));
    if (positional.length !== 1 || unknown.length) usage(1);
    const source = await resolveSource(dir, positional[0]);
    await restore(dir, source, { replace: args.includes("--replace"), dryRun: args.includes("--dry-run") });
  }
} catch (error) {
  console.error(`Ошибка: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
