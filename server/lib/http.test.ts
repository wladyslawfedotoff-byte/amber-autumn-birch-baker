import assert from "node:assert/strict";
import test from "node:test";
import { clientIpInfo, isSameOrigin, isSecureRequest, type ServerEvent } from "./http.ts";
import { logThrottled, resetLogThrottle } from "./log.ts";
import { HSTS_VALUE, securityHeaders } from "./security.ts";

function event(url: string, headers: Record<string, string> = {}, ip?: string): ServerEvent {
  const req = new Request(url, { method: "POST", headers }) as Request & { ip?: string };
  if (ip) Object.defineProperty(req, "ip", { value: ip });
  return { url: new URL(url), req, res: { headers: new Headers() }, context: {} };
}

function withAppUrl<T>(value: string | undefined, fn: () => T): T {
  const before = process.env.APP_URL;
  if (value === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = value;
  try {
    return fn();
  } finally {
    if (before === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = before;
  }
}

test("Origin check with APP_URL: exact origin incl. port", () => {
  withAppUrl("https://pora.example.test:8443", () => {
    const at = (origin: string) => isSameOrigin(event("http://127.0.0.1:8080/api/login", { origin, host: "pora.example.test:8443" }));
    assert.equal(at("https://pora.example.test:8443"), true);
    assert.equal(at("https://pora.example.test:5001"), false, "other port on the same NAS (DSM)");
    assert.equal(at("https://pora.example.test"), false, "default port");
    assert.equal(at("http://pora.example.test:8443"), false, "scheme");
    assert.equal(at("https://evil.test:8443"), false);
    assert.equal(at("null"), false);
  });
});

test("Origin check without APP_URL (local dev): must match Host incl. port", () => {
  withAppUrl(undefined, () => {
    const at = (origin: string, host: string) => isSameOrigin(event(`http://${host}/api/login`, { origin, host }));
    assert.equal(at("http://localhost:3000", "localhost:3000"), true);
    assert.equal(at("http://localhost:3001", "localhost:3000"), false);
    assert.equal(at("http://127.0.0.1:8080", "127.0.0.1:8080"), true);
    assert.equal(at("ftp://127.0.0.1:8080", "127.0.0.1:8080"), false);
    // no Origin: curl is fine, a browser cross-site request is not
    assert.equal(isSameOrigin(event("http://localhost:3000/api/login")), true);
    assert.equal(isSameOrigin(event("http://localhost:3000/api/login", { "sec-fetch-site": "cross-site" })), false);
  });
});

test("client IP: valid X-Real-IP first, then last X-Forwarded-For, then socket", () => {
  assert.deepEqual(clientIpInfo(event("http://x/", { "x-real-ip": "203.0.113.7", "x-forwarded-for": "1.1.1.1, 198.51.100.2" })), {
    ip: "203.0.113.7",
    source: "x-real-ip",
  });
  assert.deepEqual(clientIpInfo(event("http://x/", { "x-real-ip": "not-an-ip", "x-forwarded-for": "1.1.1.1, 198.51.100.2" })), {
    ip: "198.51.100.2",
    source: "x-forwarded-for",
  });
  assert.deepEqual(clientIpInfo(event("http://x/", { "x-real-ip": "2001:db8::1" })), { ip: "2001:db8::1", source: "x-real-ip" });
  assert.deepEqual(clientIpInfo(event("http://x/", {}, "172.17.0.1")), { ip: "172.17.0.1", source: "socket" });
  assert.deepEqual(clientIpInfo(event("http://x/")), { ip: "unknown", source: "unknown" });
});

test("HSTS only on HTTPS requests", () => {
  assert.equal(securityHeaders(true)["strict-transport-security"], HSTS_VALUE);
  assert.equal(HSTS_VALUE, "max-age=31536000");
  assert.equal(securityHeaders(false)["strict-transport-security"], undefined);
  withAppUrl(undefined, () => {
    assert.equal(isSecureRequest(event("http://pora.example.test/", { "x-forwarded-proto": "https" })), true);
    assert.equal(isSecureRequest(event("http://127.0.0.1:8080/")), false);
  });
  withAppUrl("https://pora.example.test:8443", () => {
    assert.equal(isSecureRequest(event("http://pora.example.test:8443/", { host: "pora.example.test:8443" })), true);
    assert.equal(isSecureRequest(event("http://127.0.0.1:8080/", { host: "127.0.0.1:8080" })), false, "local plain-http test");
  });
});

test("throttled log lines: at most one per minute per key", () => {
  resetLogThrottle();
  const original = console.warn;
  const lines: string[] = [];
  console.warn = (line: string) => lines.push(line);
  try {
    const t = 1_000_000;
    assert.equal(logThrottled("csrf.blocked", "warn", "csrf.blocked", {}, t), true);
    for (let i = 1; i <= 50; i++) assert.equal(logThrottled("csrf.blocked", "warn", "csrf.blocked", {}, t + i), false);
    assert.equal(logThrottled("login.rate_limited:ip", "warn", "login.rate_limited", {}, t + 100), true, "separate key");
    assert.equal(logThrottled("csrf.blocked", "warn", "csrf.blocked", {}, t + 60_001), true);
    assert.equal(lines.length, 3);
    assert.match(lines[2]!, /suppressed=50/);
  } finally {
    console.warn = original;
    resetLogThrottle();
  }
});
