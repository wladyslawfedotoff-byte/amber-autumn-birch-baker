import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanPhone, dialable, findUrl, normalizeUrl, parseContactText, parseVcard, siteLetter, siteName } from "./links.ts";

test("normalizeUrl keeps only http(s)", () => {
  assert.equal(normalizeUrl("https://example.ru/a?b=1"), "https://example.ru/a?b=1");
  assert.equal(normalizeUrl("example.ru/smeta"), "https://example.ru/smeta");
  assert.equal(normalizeUrl("javascript:alert(1)"), null);
  assert.equal(normalizeUrl("data:text/html,x"), null);
  assert.equal(normalizeUrl("file:///etc/passwd"), null);
  assert.equal(normalizeUrl("https://user:pw@example.ru"), null);
  assert.equal(normalizeUrl("просто текст"), null);
  assert.equal(normalizeUrl(""), null);
});

test("findUrl picks the link out of shared text", () => {
  assert.equal(findUrl("Смета https://docs.example.ru/x)."), "https://docs.example.ru/x");
  assert.equal(findUrl("нет ссылки"), null);
});

test("site name and letter", () => {
  assert.equal(siteName("https://www.docs.example.ru/a"), "docs.example.ru");
  assert.equal(siteLetter("https://docs.example.ru/a"), "E");
});

test("phones", () => {
  assert.equal(cleanPhone("+7 (900) 000-00-00"), "+7 (900) 000-00-00");
  assert.equal(cleanPhone("12"), null);
  assert.equal(dialable("+7 (900) 000-00-00"), "+79000000000");
});

test("vCard 3.0 and quoted-printable 2.1", () => {
  const v3 = "BEGIN:VCARD\r\nVERSION:3.0\r\nN:;Прораб;;;\r\nFN:Прораб\r\nTEL;type=CELL:+7 900 111-22-33\r\nEND:VCARD\r\n";
  assert.deepEqual(parseVcard(v3), { name: "Прораб", phone: "+7 900 111-22-33" });
  const v21 = "BEGIN:VCARD\nVERSION:2.1\nFN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:=D0=A1=D0=B0=D0=BD=D1=82=D0=B5=D1=85=D0=BD=D0=B8=D0=BA\nTEL:89001112233\nEND:VCARD";
  assert.deepEqual(parseVcard(v21), { name: "Сантехник", phone: "89001112233" });
  assert.equal(parseVcard("hello"), null);
  assert.equal(parseVcard("BEGIN:VCARD\nNOTE:<script>\nEND:VCARD"), null);
});

test("pasted name + number", () => {
  assert.deepEqual(parseContactText("Сантехник: +7 900 111-22-33"), { name: "Сантехник", phone: "+7 900 111-22-33" });
  assert.deepEqual(parseContactText("+79001112233"), { name: "", phone: "+79001112233" });
  assert.equal(parseContactText("без номера"), null);
});
