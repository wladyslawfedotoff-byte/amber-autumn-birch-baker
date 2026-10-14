import assert from "node:assert/strict";
import test from "node:test";
import { heicToJpeg, jpegName } from "./heic.ts";

test("jpegName", () => {
  assert.equal(jpegName("photo.HEIC"), "photo.jpg");
  assert.equal(jpegName("a.heif"), "a.jpg");
  assert.equal(jpegName("x"), "x.jpg");
});

test("heicToJpeg uses converter and falls back", async () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const ok = await heicToJpeg(new Uint8Array([1, 2, 3]), "a.heic", async () => jpeg);
  assert.equal(ok.converted, true);
  assert.equal(ok.mime, "image/jpeg");
  assert.equal(ok.name, "a.jpg");
  assert.deepEqual(ok.bytes, jpeg);
  const fail = await heicToJpeg(new Uint8Array([1]), "b.heic", async () => {
    throw new Error("no");
  });
  assert.equal(fail.converted, false);
  assert.equal(fail.name, "b.heic");
});
