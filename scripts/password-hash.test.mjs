import assert from "node:assert/strict";
import test from "node:test";
import { hashPassword, parsePasswordHash, verifyPasswordHash } from "./password-hash.mjs";

test("hash round-trips and rejects a wrong password", () => {
  const encoded = hashPassword("правильный пароль", { N: 1024 });
  assert.match(encoded, /^scrypt:1024:8:1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/);
  assert.equal(encoded.includes("$"), false);
  assert.equal(verifyPasswordHash("правильный пароль", encoded), true);
  assert.equal(verifyPasswordHash("неправильный", encoded), false);
});

test("two hashes of the same password use different salts", () => {
  assert.notEqual(hashPassword("secret-pass", { N: 1024 }), hashPassword("secret-pass", { N: 1024 }));
});

test("malformed hashes never verify", () => {
  assert.equal(parsePasswordHash("plain"), null);
  assert.equal(parsePasswordHash("scrypt:1000:8:1:abc:def"), null);
  assert.equal(verifyPasswordHash("x", "scrypt:1024:8:1::"), false);
  assert.equal(verifyPasswordHash("x", ""), false);
});
