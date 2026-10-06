#!/usr/bin/env node
/**
 * Print a scrypt password hash for «Пора».
 *
 *   node scripts/hash-password.mjs            # asks for the password (hidden), prints the hash
 *   node scripts/hash-password.mjs zhena      # prints a ready line: USER_ZHENA_PASSWORD_HASH=scrypt:…
 *   echo -n 'пароль' | node scripts/hash-password.mjs [login]
 *
 * Inside the running container:
 *   docker exec -it pora-app node scripts/hash-password.mjs zhena
 *
 * One profile: paste the hash into APP_PASSWORD_HASH and remove APP_PASSWORD.
 * Several profiles: paste the printed USER_…_PASSWORD_HASH line into .env.
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
  const login = (process.argv[2] ?? "").trim();
  if (login === "--help" || login === "-h") {
    console.error("Использование: node scripts/hash-password.mjs [логин]   (логин: a-z, 0-9, _ и -)");
    process.exit(0);
  }
  if (login && !/^[a-z0-9_-]{1,32}$/.test(login)) {
    console.error(`Логин «${login}» не подходит: только строчные латинские буквы, цифры, «_» и «-» (до 32 символов), например vlad.`);
    process.exit(1);
  }
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
  const length = [...password].length;
  if (length < 12) {
    console.error("Пароль должен быть не короче 12 символов (рекомендуется фраза из 16+ символов).");
    process.exit(1);
  }
  if (length < 16) console.error("Предупреждение: короче 16 символов. Лучше фраза из нескольких слов.");
  const hash = hashPassword(password);
  if (login) {
    process.stdout.write(`USER_${login.toUpperCase().replace(/-/g, "_")}_PASSWORD_HASH=${hash}\n`);
  } else {
    process.stdout.write(`${hash}\n`);
  }
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
