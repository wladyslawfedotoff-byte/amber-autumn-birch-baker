#!/usr/bin/env node
/**
 * Export data/pora.db back to the JSON files of 1.11 (for a rollback to the
 * previous image that keeps the edits made with 1.12):
 *
 *   docker exec pora-app node scripts/export-json.mjs            → data/export-json-<дата-время>/
 *   docker exec pora-app node scripts/export-json.mjs --to /data/my-folder
 *
 * Safe while the server runs (one read transaction). Nothing in data/ is
 * changed; the files are written into a new folder. What to do with them:
 * docs/SYNOLOGY.md → «Откат на 1.11».
 *
 * Needs Node ≥ 22.18 (imports server/lib/db/*.ts directly), like the image has.
 */
import { existsSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runAsDataOwner } from "./data-owner.mjs";

const here = fileURLToPath(new URL(".", import.meta.url));
const dir = (process.env.DATA_DIR ?? "").trim() || "/data";

function usage(code) {
  (code ? console.error : console.log)(
    ["Экспорт pora.db в JSON-файлы 1.11 / export the database to the 1.11 JSON files", "", "  node scripts/export-json.mjs [--to <папка>]"].join("\n"),
  );
  process.exit(code);
}

function stamp(time) {
  const d = new Date(time);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) usage(0);
  let target = join(dir, `export-json-${stamp(Date.now())}`);
  const at = args.indexOf("--to");
  if (at >= 0) {
    const value = args[at + 1];
    if (!value) usage(1);
    target = isAbsolute(value) ? value : resolve(value);
  } else if (args.length) {
    usage(1);
  }
  if (existsSync(target)) throw new Error(`папка ${target} уже есть — укажите другую (--to)`);
  runAsDataOwner(dir);
  const { openForScript } = await import(join(here, "../server/lib/db/offline.ts"));
  const { exportJson } = await import(join(here, "../server/lib/db/export.ts"));
  const storage = openForScript(dir);
  if (storage.mode !== "sqlite") throw new Error(`в ${dir} нет рабочей pora.db — данные и так в JSON-файлах`);
  try {
    const result = exportJson(storage.db, target);
    console.log(`Готово: ${target}`);
    for (const file of result.files) console.log(`  ${file}`);
    console.log(`Ревизия: ${result.revision ?? "—"}. Как откатиться на 1.11 с этими файлами — docs/SYNOLOGY.md, «Откат на 1.11».`);
  } finally {
    storage.db.close();
  }
}

try {
  await main();
} catch (error) {
  console.error(`Ошибка: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
