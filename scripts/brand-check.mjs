#!/usr/bin/env node
/**
 * Brand check (CI): no names of other planner / to-do apps and no names of
 * the hosting template anywhere in the repository — code, docs, comments.
 *
 * The names themselves are not written here: the check compares a short
 * SHA-256 of every latin word (lower case) with a list of hashes, so this file
 * does not mention them either. To add a name, put the first 16 hex chars of
 * sha256(name in lower case) into BANNED.
 *
 *   node scripts/brand-check.mjs        # exit 1 and a list of places if found
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const BANNED = new Set([
  "d468473c91a87d3d",
  "282a6dc5066d4725",
  "465eebd4fa4f1648",
  "052f9393f4431345",
  "bd0971a4eb5967c2",
  "1768c21fc46884df",
  "4de4a07ad031569c",
  "155e607825187242",
  "31f61ed3e6e210c5",
  "add92b9cde2bdbf3",
  "9d3508a8484ee252",
  "4276796e138ef3e1",
]);

/**
 * Files that must keep a provider identifier for old .env files to work
 * (a model name of the very first assistant setup). Not shown in the app.
 */
export const ALLOWED_FILES = new Set(["server/lib/ai/config.ts", "server/lib/ai/ai.test.ts"]);

const BINARY = /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|otf|pdf|zip|gz|br|db|heic|mp4|mov)$/i;

export function hashWord(word) {
  return createHash("sha256").update(word.toLowerCase()).digest("hex").slice(0, 16);
}

/** [{ line, word }] of banned words in a text. */
export function findBanned(text) {
  const hits = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    for (const match of lines[i].matchAll(/[a-z0-9]+/gi)) {
      if (BANNED.has(hashWord(match[0]))) hits.push({ line: i + 1, word: match[0] });
    }
  }
  return hits;
}

function trackedFiles() {
  return execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
    .split("\0")
    .filter((name) => name && !BINARY.test(name) && name !== "package-lock.json");
}

function main() {
  const problems = [];
  for (const file of trackedFiles()) {
    if (ALLOWED_FILES.has(file)) continue;
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const hit of findBanned(text)) problems.push(`${file}:${hit.line}: запрещённое название (${hit.word.length} букв)`);
  }
  if (problems.length) {
    console.error(`Brand check: найдено ${problems.length}:\n${problems.join("\n")}`);
    process.exit(1);
  }
  console.log("Brand check: чисто.");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
