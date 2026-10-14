/**
 * Capture time from a photo: EXIF DateTimeOriginal (JPEG APP1), else null.
 * No third-party library — only the tags we need for a caption.
 */
const enc = new TextEncoder();
const TAG_DATETIME_ORIGINAL = 0x9003;
const TAG_DATETIME = 0x0132;

function readU16(view: DataView, offset: number, le: boolean): number {
  return view.getUint16(offset, le);
}
function readU32(view: DataView, offset: number, le: boolean): number {
  return view.getUint32(offset, le);
}

/** "YYYY:MM:DD HH:MM:SS" → ms, or null. */
export function parseExifDate(raw: string): number | null {
  const match = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(raw.trim());
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match;
  const ms = Date.UTC(+y!, +mo! - 1, +d!, +h!, +mi!, +s!);
  return Number.isFinite(ms) ? ms : null;
}

function asciiAt(bytes: Uint8Array, offset: number, length: number): string {
  return new TextDecoder("ascii").decode(bytes.subarray(offset, offset + length)).replace(/\0+$/, "");
}

function readTiffDate(bytes: Uint8Array, tiffStart: number): number | null {
  if (tiffStart + 8 > bytes.length) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const endian = asciiAt(bytes, tiffStart, 2);
  if (endian !== "II" && endian !== "MM") return null;
  const le = endian === "II";
  if (readU16(view, tiffStart + 2, le) !== 42) return null;
  let ifd = tiffStart + readU32(view, tiffStart + 4, le);
  let original: number | null = null;
  let plain: number | null = null;
  for (let depth = 0; depth < 4 && ifd + 2 <= bytes.length; depth++) {
    const count = readU16(view, ifd, le);
    let exifPtr: number | null = null;
    for (let i = 0; i < count; i++) {
      const entry = ifd + 2 + i * 12;
      if (entry + 12 > bytes.length) break;
      const tag = readU16(view, entry, le);
      const type = readU16(view, entry + 2, le);
      const num = readU32(view, entry + 4, le);
      const valueOff = entry + 8;
      const payload =
        type === 2 && num <= 4
          ? valueOff
          : tiffStart + readU32(view, valueOff, le);
      if (tag === 0x8769 && type === 4) {
        exifPtr = tiffStart + readU32(view, valueOff, le);
      }
      if ((tag === TAG_DATETIME_ORIGINAL || tag === TAG_DATETIME) && type === 2 && num >= 19 && payload + 19 <= bytes.length) {
        const parsed = parseExifDate(asciiAt(bytes, payload, num));
        if (tag === TAG_DATETIME_ORIGINAL) original = parsed;
        else plain = parsed;
      }
    }
    ifd = exifPtr ?? 0;
    if (!ifd) break;
  }
  return original ?? plain;
}

/** JPEG: find APP1 Exif and read DateTimeOriginal. */
function fromJpeg(bytes: Uint8Array): number | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i + 4 < bytes.length) {
    if (bytes[i] !== 0xff) break;
    const marker = bytes[i + 1]!;
    if (marker === 0xd9 || marker === 0xda) break;
    const size = (bytes[i + 2]! << 8) | bytes[i + 3]!;
    if (size < 2 || i + 2 + size > bytes.length) break;
    if (marker === 0xe1) {
      const start = i + 4;
      if (asciiAt(bytes, start, 4) === "Exif" && bytes[start + 4] === 0 && bytes[start + 5] === 0) {
        return readTiffDate(bytes, start + 6);
      }
    }
    i += 2 + size;
  }
  return null;
}

/** HEIC/any: scan for an embedded Exif box (common in iPhone HEIC). */
function fromEmbeddedExif(bytes: Uint8Array): number | null {
  const needle = enc.encode("Exif\0\0");
  for (let i = 0; i + needle.length + 8 < bytes.length; i++) {
    let ok = true;
    for (let j = 0; j < needle.length; j++) {
      if (bytes[i + j] !== needle[j]) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    const at = readTiffDate(bytes, i + needle.length);
    if (at !== null) return at;
  }
  return null;
}

/** Capture time in ms, or null when the file has no usable EXIF date. */
export function readTakenAt(bytes: Uint8Array): number | null {
  return fromJpeg(bytes) ?? fromEmbeddedExif(bytes);
}

/** ru-RU day + time for captions (Europe/Moscow wall clock of the stored instant). */
export function formatTakenAt(ms: number): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ms));
}
