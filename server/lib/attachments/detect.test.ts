import assert from "node:assert/strict";
import test from "node:test";
import { deflateRawSync } from "node:zlib";
import { MIME, detectType, isInline } from "./detect.ts";

/** Minimal ZIP writer (stored or deflated entries) for fixtures. */
function zip(entries: { name: string; data: string; deflate?: boolean }[]): Uint8Array {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = enc.encode(e.name);
    const raw = enc.encode(e.data);
    const body = e.deflate ? new Uint8Array(deflateRawSync(raw)) : raw;
    const method = e.deflate ? 8 : 0;
    const local = new Uint8Array(30 + name.length + body.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(8, method, true);
    lv.setUint32(18, body.length, true);
    lv.setUint32(22, raw.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(body, 30 + name.length);
    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(10, method, true);
    cv.setUint32(20, body.length, true);
    cv.setUint32(24, raw.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const cdSize = centrals.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + cdSize + 22);
  let p = 0;
  for (const part of [...locals, ...centrals, end]) {
    out.set(part, p);
    p += part.length;
  }
  return out;
}

const DOCX_TYPES = '<Types><Override ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>';
const XLSX_TYPES = '<Types><Override ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>';
const CFB = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]);
const text = (s: string) => new TextEncoder().encode(s);

test("office formats by structure", () => {
  assert.equal(detectType(zip([{ name: "[Content_Types].xml", data: DOCX_TYPES, deflate: true }, { name: "word/document.xml", data: "<w/>" }]), "смета.docx"), MIME.docx);
  assert.equal(detectType(zip([{ name: "[Content_Types].xml", data: XLSX_TYPES }, { name: "xl/workbook.xml", data: "<x/>" }]), "a.xlsx"), MIME.xlsx);
  assert.equal(detectType(zip([{ name: "mimetype", data: MIME.odt }, { name: "content.xml", data: "<x/>" }]), "a.odt"), MIME.odt);
  assert.equal(detectType(zip([{ name: "mimetype", data: MIME.ods }, { name: "content.xml", data: "<x/>" }]), "a.ods"), MIME.ods);
  assert.equal(detectType(CFB, "old.doc"), MIME.doc);
  assert.equal(detectType(CFB, "old.xls"), MIME.xls);
});

test("macros, archives, executables and scripts are refused", () => {
  const macro = zip([{ name: "[Content_Types].xml", data: DOCX_TYPES.replace("document.main", "document.macroEnabled.main") }, { name: "word/document.xml", data: "" }]);
  assert.equal(detectType(macro, "a.docx"), null);
  const vba = zip([{ name: "[Content_Types].xml", data: DOCX_TYPES }, { name: "word/document.xml", data: "" }, { name: "word/vbaProject.bin", data: "x" }]);
  assert.equal(detectType(vba, "a.docx"), null);
  assert.equal(detectType(zip([{ name: "[Content_Types].xml", data: DOCX_TYPES }, { name: "word/document.xml", data: "" }]), "a.docm"), null);
  assert.equal(detectType(zip([{ name: "readme.txt", data: "hi" }]), "a.zip"), null);
  assert.equal(detectType(zip([{ name: "readme.txt", data: "hi" }]), "a.docx"), null);
  assert.equal(detectType(zip([{ name: "[Content_Types].xml", data: XLSX_TYPES }, { name: "xl/workbook.xml", data: "" }]), "a.docx"), null); // wrong family
  assert.equal(detectType(CFB, "setup.msi"), null);
  assert.equal(detectType(text("MZ\x90\x00"), "a.exe"), null);
  assert.equal(detectType(new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03]), "a.txt"), null); // NUL byte → binary
  assert.equal(detectType(text("<html><script>x</script>"), "a.txt"), null);
  assert.equal(detectType(text("#!/bin/sh\nrm -rf /"), "a.txt"), null);
  assert.equal(detectType(text("<svg onload=x>"), "a.csv"), null);
});

test("text formats", () => {
  assert.equal(detectType(text("дата;сумма\n01.10;3500\n"), "расход.csv"), MIME.csv);
  assert.equal(detectType(text("заметка"), "note.txt"), MIME.txt);
  assert.equal(detectType(text("{\\rtf1\\ansi Hello}"), "a.rtf"), MIME.rtf);
  assert.equal(detectType(new Uint8Array([0xff, 0xfe, 0x00]), "a.txt"), null); // not UTF-8
  assert.equal(detectType(text("plain"), "noext"), null);
  assert.equal(isInline(MIME.pdf), true);
  assert.equal(isInline(MIME.docx), false);
  assert.equal(isInline(MIME.txt), false);
});
