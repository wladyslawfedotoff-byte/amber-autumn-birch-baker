/**
 * What a file really is, from its bytes (and the extension as a hint for
 * plain text). Returns a canonical MIME type or null for anything we do not
 * accept: executables, scripts, archives, macro-enabled Office files.
 */
import { inflateRawSync } from "node:zlib";

export const MIME = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  pdf: "application/pdf",
  doc: "application/msword",
  xls: "application/vnd.ms-excel",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  rtf: "application/rtf",
  csv: "text/csv",
  txt: "text/plain",
} as const;

export const ALLOWED_TYPES: ReadonlySet<string> = new Set(Object.values(MIME));

/** Shown inline in the browser; everything else is served as a download. */
export function isInline(mime: string): boolean {
  return mime.startsWith("image/") || mime === MIME.pdf;
}

function ext(name: string): string {
  const match = /\.([a-z0-9]{1,8})$/i.exec(name.trim());
  return match ? match[1]!.toLowerCase() : "";
}

const at = (b: Uint8Array, offset: number, sig: number[]) => sig.every((byte, i) => b[offset + i] === byte);
const ascii = (b: Uint8Array, offset: number, text: string) => at(b, offset, [...text].map((c) => c.charCodeAt(0)));

const u16 = (b: Uint8Array, o: number) => b[o]! | (b[o + 1]! << 8);
const u32 = (b: Uint8Array, o: number) => (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;

type ZipEntry = { name: string; method: number; compSize: number; localOffset: number };

/** Central directory of a ZIP (no ZIP64). Null when it is not a sane ZIP. */
export function zipEntries(b: Uint8Array): ZipEntry[] | null {
  if (!at(b, 0, [0x50, 0x4b, 0x03, 0x04])) return null;
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65_535); i--) {
    if (at(b, i, [0x50, 0x4b, 0x05, 0x06])) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const count = u16(b, eocd + 10);
  let p = u32(b, eocd + 16);
  if (count > 5000 || p >= b.length) return null;
  const out: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (p + 46 > b.length || !at(b, p, [0x50, 0x4b, 0x01, 0x02])) return null;
    const method = u16(b, p + 10);
    const compSize = u32(b, p + 20);
    const nameLen = u16(b, p + 28);
    const extraLen = u16(b, p + 30);
    const commentLen = u16(b, p + 32);
    const localOffset = u32(b, p + 42);
    const name = new TextDecoder().decode(b.subarray(p + 46, p + 46 + nameLen));
    out.push({ name, method, compSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const MAX_INFLATE = 2 * 1024 * 1024;

/** Content of a small entry (stored or deflated), or null. */
export function zipRead(b: Uint8Array, entry: ZipEntry): Uint8Array | null {
  const o = entry.localOffset;
  if (o + 30 > b.length || !at(b, o, [0x50, 0x4b, 0x03, 0x04])) return null;
  const start = o + 30 + u16(b, o + 26) + u16(b, o + 28);
  const data = b.subarray(start, start + entry.compSize);
  if (entry.method === 0) return data;
  if (entry.method !== 8) return null;
  try {
    return new Uint8Array(inflateRawSync(data, { maxOutputLength: MAX_INFLATE }));
  } catch {
    return null;
  }
}

function officeZip(b: Uint8Array): string | null {
  const entries = zipEntries(b);
  if (!entries) return null;
  const names = new Set(entries.map((e) => e.name));
  // OpenDocument: first entry «mimetype», stored, with the type inside.
  const first = entries[0];
  if (first?.name === "mimetype") {
    const raw = zipRead(b, first);
    const type = raw ? new TextDecoder().decode(raw).trim() : "";
    if (names.has("Basic/script-lc.xml") || [...names].some((n) => n.startsWith("Basic/") || n.startsWith("Scripts/"))) return null;
    if (type === MIME.odt) return MIME.odt;
    if (type === MIME.ods) return MIME.ods;
    return null;
  }
  const types = entries.find((e) => e.name === "[Content_Types].xml");
  if (!types) return null;
  if ([...names].some((n) => /vbaProject\.bin$/i.test(n) || /activeX/i.test(n))) return null;
  const xml = zipRead(b, types);
  const text = xml ? new TextDecoder().decode(xml) : "";
  if (!text || /macroEnabled/i.test(text)) return null;
  if (text.includes("wordprocessingml.document.main+xml") && names.has("word/document.xml")) return MIME.docx;
  if (text.includes("spreadsheetml.sheet.main+xml") && names.has("xl/workbook.xml")) return MIME.xlsx;
  return null;
}

function plainText(b: Uint8Array): boolean {
  if (b.length === 0) return true;
  if (b.includes(0)) return false;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(b.subarray(0, 64 * 1024).length === b.length ? b : b.subarray(0, 64 * 1024 - 4));
    // Not a script/markup page in disguise.
    const head = text.slice(0, 512).trimStart().toLowerCase();
    if (head.startsWith("<!doctype") || head.startsWith("<html") || head.startsWith("<script") || head.startsWith("<?xml") || head.startsWith("<svg")) return false;
    if (head.startsWith("#!")) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Canonical MIME for an accepted file, or null. `name` decides only between
 * plain-text flavours (csv / txt) and which Office family is expected.
 */
export function detectType(bytes: Uint8Array, name: string): string | null {
  const e = ext(name);
  if (["docm", "xlsm", "dotm", "xltm", "pptm", "exe", "js", "sh", "bat", "cmd", "html", "htm", "svg", "zip", "rar", "7z"].includes(e)) return null;
  if (at(bytes, 0, [0xff, 0xd8, 0xff])) return MIME.jpeg;
  if (at(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return MIME.png;
  if (ascii(bytes, 0, "RIFF") && ascii(bytes, 8, "WEBP")) return MIME.webp;
  if (ascii(bytes, 4, "ftyp")) {
    const brand = new TextDecoder().decode(bytes.subarray(8, 12));
    if (["heic", "heix", "hevc", "hevx"].includes(brand)) return MIME.heic;
    if (["mif1", "msf1", "heif"].includes(brand)) return MIME.heif;
    return null; // mp4/mov etc.
  }
  if (ascii(bytes, 0, "%PDF-")) return MIME.pdf;
  if (at(bytes, 0, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    if (e === "doc") return MIME.doc;
    if (e === "xls") return MIME.xls;
    return null; // msi, msg and other compound files
  }
  if (at(bytes, 0, [0x50, 0x4b, 0x03, 0x04])) {
    const type = officeZip(bytes);
    if (!type) return null;
    const wanted: Record<string, string> = { docx: MIME.docx, xlsx: MIME.xlsx, odt: MIME.odt, ods: MIME.ods };
    return !wanted[e] || wanted[e] === type ? type : null;
  }
  if (ascii(bytes, 0, "{\\rtf")) return e === "rtf" || e === "" || e === "doc" ? MIME.rtf : null;
  if ((e === "csv" || e === "txt") && plainText(bytes)) return e === "csv" ? MIME.csv : MIME.txt;
  return null;
}
