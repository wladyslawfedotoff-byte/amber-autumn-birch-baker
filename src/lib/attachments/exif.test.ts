import assert from "node:assert/strict";
import test from "node:test";
import { formatTakenAt, parseExifDate, readTakenAt } from "./exif.ts";

test("parseExifDate", () => {
  assert.equal(parseExifDate("2024:03:15 14:30:00"), Date.UTC(2024, 2, 15, 14, 30, 0));
  assert.equal(parseExifDate("bad"), null);
});

/** Minimal JPEG with an APP1 Exif IFD containing DateTimeOriginal. */
function jpegWithExif(date: string): Uint8Array {
  const enc = new TextEncoder();
  const ascii = enc.encode(date + "\0");
  // TIFF little-endian: header + IFD0 (1 entry → ExifIFD) + ExifIFD (1 entry → DateTimeOriginal)
  const tiff = new Uint8Array(8 + 2 + 12 + 4 + 2 + 12 + 4 + ascii.length);
  const v = new DataView(tiff.buffer);
  tiff[0] = 0x49;
  tiff[1] = 0x49;
  v.setUint16(2, 42, true);
  v.setUint32(4, 8, true); // IFD0 at 8
  v.setUint16(8, 1, true);
  v.setUint16(10, 0x8769, true); // ExifIFD pointer
  v.setUint16(12, 4, true);
  v.setUint32(14, 1, true);
  v.setUint32(18, 8 + 2 + 12 + 4, true); // → ExifIFD
  v.setUint32(22, 0, true); // next IFD
  const exifIfd = 8 + 2 + 12 + 4;
  v.setUint16(exifIfd, 1, true);
  v.setUint16(exifIfd + 2, 0x9003, true);
  v.setUint16(exifIfd + 4, 2, true);
  v.setUint32(exifIfd + 6, ascii.length, true);
  const strOff = exifIfd + 2 + 12 + 4;
  v.setUint32(exifIfd + 10, strOff, true);
  tiff.set(ascii, strOff);

  const app1Body = new Uint8Array(6 + tiff.length);
  app1Body.set(enc.encode("Exif\0\0"), 0);
  app1Body.set(tiff, 6);
  const size = app1Body.length + 2;
  const out = new Uint8Array(2 + 2 + 2 + app1Body.length + 2);
  out[0] = 0xff;
  out[1] = 0xd8;
  out[2] = 0xff;
  out[3] = 0xe1;
  out[4] = (size >> 8) & 0xff;
  out[5] = size & 0xff;
  out.set(app1Body, 6);
  out[out.length - 2] = 0xff;
  out[out.length - 1] = 0xd9;
  return out;
}

test("readTakenAt from JPEG EXIF", () => {
  const bytes = jpegWithExif("2024:03:15 14:30:00");
  assert.equal(readTakenAt(bytes), Date.UTC(2024, 2, 15, 14, 30, 0));
  assert.equal(readTakenAt(new Uint8Array([0xff, 0xd8, 0xff, 0xd9])), null);
  assert.ok(formatTakenAt(Date.UTC(2024, 2, 15, 14, 30, 0)).includes("2024"));
});
