import assert from "node:assert/strict";
import test from "node:test";
import { gunzipSync, brotliDecompressSync } from "node:zlib";
import { compressResponse, pickEncoding } from "./compress.ts";

const big = JSON.stringify({ data: "задача ".repeat(2000) });
const req = (enc: string, method = "GET") => new Request("http://x/api/sync", { method, headers: { "accept-encoding": enc } });
const res = (body: string, type = "application/json") => new Response(body, { headers: { "content-type": type } });

test("pickEncoding prefers br, honours q=0", () => {
  assert.equal(pickEncoding("gzip, deflate, br"), "br");
  assert.equal(pickEncoding("gzip"), "gzip");
  assert.equal(pickEncoding("br;q=0, gzip"), "gzip");
  assert.equal(pickEncoding("identity"), null);
  assert.equal(pickEncoding(null), null);
});

test("JSON is compressed and decodes back", async () => {
  const br = await compressResponse(req("br"), res(big));
  assert.equal(br.headers.get("content-encoding"), "br");
  assert.equal(brotliDecompressSync(Buffer.from(await br.arrayBuffer())).toString(), big);
  const gz = await compressResponse(req("gzip"), res(big));
  assert.equal(gunzipSync(Buffer.from(await gz.arrayBuffer())).toString(), big);
  assert.match(gz.headers.get("vary") ?? "", /accept-encoding/);
});

test("small bodies, events, images, HEAD and 304 stay as they are", async () => {
  assert.equal((await compressResponse(req("br"), res("{}"))).headers.get("content-encoding"), null);
  assert.equal((await compressResponse(req("br"), res(big, "text/event-stream"))).headers.get("content-encoding"), null);
  assert.equal((await compressResponse(req("br"), res(big, "image/png"))).headers.get("content-encoding"), null);
  assert.equal((await compressResponse(req("br", "HEAD"), res(big))).headers.get("content-encoding"), null);
  const notModified = new Response(null, { status: 304 });
  assert.equal(await compressResponse(req("br"), notModified), notModified);
});

test("HTML streams through gzip", async () => {
  const page = "<!doctype html><p>" + "Пора ".repeat(1000);
  const out = await compressResponse(req("br, gzip"), res(page, "text/html; charset=utf-8"));
  assert.equal(out.headers.get("content-encoding"), "gzip");
  assert.equal(gunzipSync(Buffer.from(await out.arrayBuffer())).toString(), page);
});
