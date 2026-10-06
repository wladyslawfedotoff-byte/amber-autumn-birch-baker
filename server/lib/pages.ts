/** Self-contained server-rendered pages (no JS needed — works in the iOS Home Screen app). */
import { escapeHtml } from "./http.ts";

const STYLE = `
:root{--bg:#e8e4db;--surface:#f6f4ef;--elevated:#fffcf7;--fg:#1c1d1a;--muted:#5c5f59;--subtle:#8a8d86;--line:#ddd8ce;--accent:#243e4a;--accent-fg:#f4f2eb;--danger:#8d3b3b;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#121310;--surface:#191a17;--elevated:#22231f;--fg:#f3f1ea;--muted:#c2c4bc;--subtle:#9a9d95;--line:#34362f;--accent:#d7e0da;--accent-fg:#141614;--danger:#e7b0b0;color-scheme:dark}}
*{box-sizing:border-box}
html,body{margin:0;min-height:100%;background:var(--bg);color:var(--fg);font-family:"IBM Plex Sans",ui-sans-serif,system-ui,-apple-system,sans-serif;line-height:1.5;-webkit-font-smoothing:antialiased;-webkit-text-size-adjust:100%}
main{min-height:100vh;min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:max(24px,env(safe-area-inset-top)) 20px max(24px,env(safe-area-inset-bottom))}
.card{width:100%;max-width:360px;background:var(--surface);border-radius:24px;padding:32px 24px;box-shadow:0 0 0 1px color-mix(in oklab,var(--fg) 8%,transparent),0 12px 32px -18px color-mix(in oklab,var(--fg) 30%,transparent)}
h1{font-family:"Newsreader",Georgia,"Times New Roman",serif;font-weight:600;font-size:40px;letter-spacing:-0.02em;line-height:1.1;margin:0 0 4px}
p{margin:0;color:var(--muted);font-size:15px}
label{display:block;margin:24px 0 6px;font-size:14px;color:var(--muted)}
input{width:100%;height:48px;border:0;border-radius:14px;background:var(--elevated);color:var(--fg);padding:0 14px;font:inherit;font-size:17px;outline:none;box-shadow:0 0 0 1px color-mix(in oklab,var(--fg) 10%,transparent)}
input:focus{box-shadow:0 0 0 2px color-mix(in oklab,var(--accent) 75%,transparent)}
button{margin-top:16px;width:100%;height:48px;border:0;border-radius:14px;background:var(--accent);color:var(--accent-fg);font:inherit;font-size:16px;font-weight:500;cursor:pointer}
.error{margin-top:14px;color:var(--danger);font-size:14px}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;background:var(--elevated);padding:2px 6px;border-radius:6px}
ol{padding-left:20px;color:var(--muted);font-size:14px}
li{margin:6px 0}
`;

function shell(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Пора">
<meta name="theme-color" content="#e8e4db">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="manifest" href="/__grok/manifest.webmanifest">
<link rel="apple-touch-icon" href="/__grok/icon-180.png">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500&family=Newsreader:opsz,wght@6..72,600&display=swap">
<style>${STYLE}</style>
</head>
<body>
<main>${body}</main>
</body>
</html>`;
}

export const LOGIN_ERRORS: Record<string, string> = {
  wrong: "Неверный пароль.",
  rate: "Слишком много попыток. Подождите несколько минут и попробуйте снова.",
  origin: "Запрос пришёл не с этого сайта. Обновите страницу и попробуйте ещё раз.",
  empty: "Введите пароль.",
  expired: "Сессия закончилась. Войдите снова.",
};

/** Only allow same-site relative paths as the post-login destination. */
export function safeNext(value: string | null | undefined): string {
  const next = String(value ?? "");
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\") || next.startsWith("/api/") || next.startsWith("/login")) {
    return "/";
  }
  return next.slice(0, 500);
}

export function loginPage(options: { error?: string | null; next?: string | null }): string {
  const message = options.error ? LOGIN_ERRORS[options.error] ?? LOGIN_ERRORS.wrong : "";
  const next = safeNext(options.next);
  return shell(
    "Вход — Пора",
    `<form class="card" method="post" action="/api/login" autocomplete="on">
  <h1>Пора</h1>
  <p>Задачи, календарь и привычки.</p>
  <input type="hidden" name="next" value="${escapeHtml(next)}">
  <input type="text" name="username" value="pora" autocomplete="username" hidden aria-hidden="true" tabindex="-1">
  <label for="password">Пароль</label>
  <input id="password" name="password" type="password" autocomplete="current-password" required autofocus enterkeyhint="go">
  ${message ? `<p class="error" role="alert">${escapeHtml(message)}</p>` : ""}
  <button type="submit">Войти</button>
</form>`,
  );
}

export function notConfiguredPage(reason: string): string {
  return shell(
    "Пора — нужен пароль",
    `<div class="card">
  <h1>Пора</h1>
  <p>Приложение закрыто: на сервере не задан пароль для входа.</p>
  <ol>
    <li>Откройте Container Manager → «Проект» → проект «Пора» → «Изменить».</li>
    <li>В разделе <code>environment</code> добавьте строку <code>APP_PASSWORD: "ваш-надёжный-пароль"</code> (не короче 8 символов).</li>
    <li>Сохраните и перезапустите проект.</li>
  </ol>
  <p style="margin-top:12px;font-size:13px">Вместо открытого пароля можно указать <code>APP_PASSWORD_HASH</code> — его печатает <code>node scripts/hash-password.mjs</code>.</p>
  <p style="margin-top:12px;font-size:12px;color:var(--subtle)">Причина: ${escapeHtml(reason)}</p>
</div>`,
  );
}

export function errorPage(): string {
  return shell(
    "Пора — ошибка",
    `<div class="card"><h1>Пора</h1><p>На сервере что-то сломалось. Обновите страницу через минуту. Подробности — в журнале контейнера.</p></div>`,
  );
}
