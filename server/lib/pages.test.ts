import assert from "node:assert/strict";
import test from "node:test";
import { safeNext } from "./pages.ts";

test("safeNext keeps normal in-app paths", () => {
  for (const ok of ["/", "/app", "/app?view=today", "/a/b#frag", "/%D0%B7%D0%B0%D0%B4%D0%B0%D1%87%D0%B8", "/?q=a%20b"]) {
    assert.equal(safeNext(ok), ok, ok);
  }
});

test("safeNext rejects open redirects and odd input → /", () => {
  const evil = [
    "//evil.com",
    "///evil.com",
    "https://evil.com",
    "http:evil.com",
    "javascript:alert(1)",
    "evil.com",
    "/\\evil.com",
    "\\\\evil.com",
    "/\t/evil.com",
    "/\n/evil.com",
    "/ /evil.com",
    "/%09/evil.com",
    "/%0a/evil.com",
    "/%2F/evil.com",
    "/%2f%2fevil.com",
    "/%5Cevil.com",
    "/%5c%5cevil.com",
    "/%252F%252Fevil.com",
    "/%25252F%25252Fevil.com",
    "/%E0%A4%A",
    "/\u0000evil",
    "/\u2028evil",
    "/login",
    "/login?next=/x",
    "/api/sync",
    "/" + "a".repeat(600),
    "",
    null,
    undefined,
  ];
  for (const value of evil) assert.equal(safeNext(value as string | null | undefined), "/", JSON.stringify(value));
});
