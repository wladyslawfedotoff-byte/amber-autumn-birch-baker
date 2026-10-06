#!/usr/bin/env node
/**
 * Print an APP_PASSWORD_HASH value for «Пора».
 *
 *   node scripts/hash-password.mjs            # asks for the password (hidden)
 *   echo -n 'пароль' | node scripts/hash-password.mjs
 *
 * Inside the running container:
 *   docker exec -it pora-app node scripts/hash-password.mjs
 *
 * Paste the printed line into APP_PASSWORD_HASH and remove APP_PASSWORD.
 */
import { hashPassword } from "./password-hash.mjs";

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");
}

function askHidden(question) {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    process.stderr.write(question);
    let value = "";
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const onData = (char) => {
      if (char === "\u0003") {
        stdin.setRawMode(false);
        reject(new Error("cancelled"));
        return;
      }
      if (char === "\r" || char === "\n" || char === "\u0004") {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.off("data", onData);
        process.stderr.write("\n");
        resolve(value);
        return;
      }
      if (char === "\u007f" || char === "\b") {
        value = value.slice(0, -1);
        return;
      }
      value += char;
    };
    stdin.on("data", onData);
  });
}

async function main() {
  let password;
  if (process.stdin.isTTY) {
    password = await askHidden("Пароль: ");
    const again = await askHidden("Ещё раз: ");
    if (password !== again) {
      console.error("Пароли не совпали.");
      process.exit(1);
    }
  } else {
    password = await readStdin();
  }
  if (password.length < 8) {
    console.error("Пароль должен быть не короче 8 символов.");
    process.exit(1);
  }
  process.stdout.write(`${hashPassword(password)}\n`);
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
