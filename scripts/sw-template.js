/* «Пора» service worker. Built from scripts/sw-template.js by scripts/sw-plugin.mjs. */
const VERSION = "__VERSION__";
const PRECACHE = ["__PRECACHE__"];
const SHELL_CACHE = `pora-shell-${VERSION}`;
const RUNTIME_CACHE = "pora-runtime";
/** The last good app page (no user data in it: data lives on the device). */
const SHELL_URL = "/__app-shell";
const NAV_TIMEOUT_MS = 4000;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // Hashed build files: fetched once per version.
      await Promise.all(
        PRECACHE.map((url) =>
          fetch(url, { cache: "no-cache", credentials: "same-origin" })
            .then((response) => (response.ok ? cache.put(url, response) : undefined))
            .catch(() => undefined),
        ),
      );
      // The page itself; works only while signed in (a redirect to /login is not cached).
      await fetch("/", { credentials: "same-origin", cache: "no-cache" })
        .then((response) => (isAppPage(response) ? cache.put(SHELL_URL, response) : undefined))
        .catch(() => undefined);
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key.startsWith("pora-shell-") && key !== SHELL_CACHE).map((key) => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "skip-waiting") self.skipWaiting();
  // «Выйти»: forget the cached page and runtime files.
  if (data.type === "forget") {
    event.waitUntil(
      Promise.all([caches.open(SHELL_CACHE).then((cache) => cache.delete(SHELL_URL)), caches.delete(RUNTIME_CACHE)]),
    );
  }
});

function isAppPage(response) {
  return (
    response &&
    response.ok &&
    response.status === 200 &&
    !response.redirected &&
    (response.headers.get("content-type") || "").includes("text/html")
  );
}

async function navigate(event) {
  const cache = await caches.open(SHELL_CACHE);
  const url = new URL(event.request.url);
  const network = fetch(event.request).then(async (response) => {
    if (url.pathname === "/") {
      if (isAppPage(response)) await cache.put(SHELL_URL, response.clone());
      // Signed out on the server (redirect to /login): the saved page goes too.
      else if (response.redirected || response.status === 401) await cache.delete(SHELL_URL);
    }
    return response;
  });
  // 1.17 «мгновенный старт»: the main page opens from the saved copy at once
  // (it holds no user data, and every file it needs is in this same cache);
  // the fresh page is fetched in the background for the next start.
  if (url.pathname === "/") {
    const instant = await cache.match(SHELL_URL);
    if (instant) {
      event.waitUntil(network.catch(() => undefined));
      return instant;
    }
  }
  // A weak signal can hang for a long time: after a few seconds the saved page is shown.
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), NAV_TIMEOUT_MS));
  try {
    const first = await Promise.race([network, timeout]);
    if (first) return first;
  } catch {
    // offline: fall through to the saved page
  }
  const saved = url.pathname === "/login" ? null : await cache.match(SHELL_URL);
  if (saved) {
    event.waitUntil(network.catch(() => undefined));
    return saved;
  }
  return network.catch(
    () =>
      new Response(
        '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Пора</title><body style="font:16px system-ui;padding:2rem;text-align:center"><p>Нет сети.</p><p>Откройте «Пору», когда появится связь, — после первого входа она будет открываться и без интернета.</p></body>',
        { status: 503, headers: { "content-type": "text/html; charset=utf-8" } },
      ),
  );
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = (await cache.match(request)) || (await caches.match(request));
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok && response.type === "basic") await cache.put(request, response.clone());
  return response;
}

async function staleWhileRevalidate(request, crossOrigin = false) {
  const cache = await caches.open(RUNTIME_CACHE);
  const hit = await cache.match(request);
  const network = fetch(request)
    .then(async (response) => {
      const keep = crossOrigin ? response.ok || response.type === "opaque" : response.ok && response.type === "basic";
      if (keep) await cache.put(request, response.clone());
      return response;
    })
    .catch(() => undefined);
  // Nothing saved and no network: an empty «unavailable» answer (the page falls back to system fonts / no icon).
  return hit || (await network) || new Response("", { status: 504, statusText: "Offline" });
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    // Web fonts and their stylesheet: kept so the app looks the same offline.
    if (request.destination === "font" || request.destination === "style") event.respondWith(staleWhileRevalidate(request, true));
    return;
  }
  // Data, sign-in and anything per user never come from a cache.
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/_serverFn") || url.pathname === "/login" || url.pathname === "/sw.js") return;
  if (request.mode === "navigate") {
    event.respondWith(navigate(event));
    return;
  }
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(cacheFirst(request, SHELL_CACHE));
    return;
  }
  if (url.pathname.startsWith("/icons/") || /^\/(favicon\.(svg|ico)|apple-touch-icon\.png|manifest\.webmanifest)$/.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request));
  }
});

/* ---- reminders (Web Push) ---------------------------------------------- */

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Пора", body: event.data ? event.data.text() : "" };
  }
  const title = typeof data.title === "string" && data.title ? data.title : "Пора";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof data.body === "string" ? data.body : "",
      tag: typeof data.tag === "string" ? data.tag : undefined,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: typeof data.url === "string" && data.url.startsWith("/") ? data.url : "/", taskId: data.taskId || null },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";
  const taskId = event.notification.data && event.notification.data.taskId;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        await client.focus();
        if (taskId) client.postMessage({ type: "open-task", taskId });
        return;
      }
      await self.clients.openWindow(target);
    })(),
  );
});
