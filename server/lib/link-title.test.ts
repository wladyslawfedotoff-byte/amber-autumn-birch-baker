import { test } from "node:test";
import assert from "node:assert/strict";
import { checkUrl, extractTitle, fetchTitle, isBlockedIp, safeAddress } from "./link-title.ts";

test("blocks private, loopback, link-local and mapped addresses", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.10", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "::", "fe80::1", "fd00::1", "::ffff:192.168.1.1", "::ffff:7f00:1", "64:ff9b::a00:1", "2002:c0a8:101::1"])
    assert.equal(isBlockedIp(ip), true, ip);
  for (const ip of ["93.184.216.34", "8.8.8.8", "2606:4700::1111"]) assert.equal(isBlockedIp(ip), false, ip);
  assert.equal(isBlockedIp("not-an-ip"), true);
});

test("checkUrl: http(s), plain ports, no credentials", () => {
  assert.ok(checkUrl("https://example.ru/a"));
  assert.equal(checkUrl("ftp://example.ru"), null);
  assert.equal(checkUrl("http://example.ru:22/"), null);
  assert.equal(checkUrl("https://a:b@example.ru"), null);
});

test("safeAddress refuses names that resolve inside", async () => {
  await assert.rejects(safeAddress("localhost"));
  await assert.rejects(safeAddress("nas.local"));
  await assert.rejects(safeAddress("[::1]"));
  await assert.rejects(safeAddress("evil.example", async () => [{ address: "93.184.216.34", family: 4 }, { address: "10.0.0.5", family: 4 }]));
  assert.deepEqual(await safeAddress("ok.example", async () => [{ address: "93.184.216.34", family: 4 }]), { address: "93.184.216.34", family: 4 });
});

test("extractTitle prefers og:title and decodes entities", () => {
  assert.equal(extractTitle('<meta property="og:title" content="Смета &laquo;стены&raquo;"><title>x</title>'), "Смета «стены»");
  assert.equal(extractTitle("<title>\n  Приёмка &amp; акт </title>"), "Приёмка & акт");
  assert.equal(extractTitle("<p>no title</p>"), null);
});

const html = (title: string) => ({ status: 200, location: null, type: "text/html; charset=utf-8", body: new TextEncoder().encode(`<title>${title}</title>`) });
const pub = async () => [{ address: "93.184.216.34", family: 4 }];

test("fetchTitle follows a public redirect", async () => {
  const hops: string[] = [];
  const title = await fetchTitle("https://a.example/x", {
    lookup: pub,
    fetchHop: async (url) => {
      hops.push(url.href);
      return url.hostname === "a.example" ? { status: 301, location: "https://b.example/y", type: "", body: new Uint8Array() } : html("Готово");
    },
  });
  assert.equal(title, "Готово");
  assert.deepEqual(hops, ["https://a.example/x", "https://b.example/y"]);
});

test("fetchTitle stops at a redirect into the home network", async () => {
  let reached = false;
  const title = await fetchTitle("https://a.example/", {
    lookup: async (host) => (host === "a.example" ? pub() : [{ address: "192.168.1.2", family: 4 }]),
    fetchHop: async (url) => {
      if (url.hostname !== "a.example") reached = true;
      return { status: 302, location: "http://router.example/admin", type: "", body: new Uint8Array() };
    },
  });
  assert.equal(title, null);
  assert.equal(reached, false);
  assert.equal(await fetchTitle("http://127.0.0.1/", { fetchHop: async () => html("x") }), null);
});

test("fetchTitle gives up after too many redirects and on errors", async () => {
  const loop = await fetchTitle("https://a.example/", { lookup: pub, fetchHop: async () => ({ status: 302, location: "/again", type: "", body: new Uint8Array() }) });
  assert.equal(loop, null);
  assert.equal(await fetchTitle("https://a.example/", { lookup: pub, fetchHop: async () => { throw new Error("boom"); } }), null);
});
