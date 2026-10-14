/**
 * Attachment limits from the environment. Defaults keep a phone photo
 * (compressed client-side) and a short PDF comfortably under the ceiling.
 */
export const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;

export const ALLOWED_MIME = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
] as const;

export type AllowedMime = (typeof ALLOWED_MIME)[number];

export type AttachConfig = {
  maxBytes: number;
  allowed: ReadonlySet<string>;
};

export function attachConfig(env: NodeJS.ProcessEnv = process.env): AttachConfig {
  const raw = Number((env.ATTACH_MAX_MB ?? "").trim());
  const mb = Number.isFinite(raw) && raw > 0 && raw <= 200 ? raw : 25;
  return {
    maxBytes: Math.round(mb * 1024 * 1024),
    allowed: new Set(ALLOWED_MIME),
  };
}

export function isAllowedMime(mime: string, allowed: ReadonlySet<string> = attachConfig().allowed): boolean {
  const base = mime.toLowerCase().split(";")[0]!.trim();
  return allowed.has(base);
}

/** The first bytes must match the claimed type (no HTML disguised as a photo). */
export function sniffMatches(bytes: Uint8Array, mime: string): boolean {
  const base = mime.toLowerCase().split(";")[0]!.trim();
  const at = (offset: number, sig: number[]) => sig.every((byte, i) => bytes[offset + i] === byte);
  const ascii = (offset: number, text: string) => at(offset, [...text].map((c) => c.charCodeAt(0)));
  switch (base) {
    case "image/jpeg":
      return at(0, [0xff, 0xd8, 0xff]);
    case "image/png":
      return at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "image/webp":
      return ascii(0, "RIFF") && ascii(8, "WEBP");
    case "image/heic":
    case "image/heif":
      return ascii(4, "ftyp");
    case "application/pdf":
      return ascii(0, "%PDF-");
    default:
      return false;
  }
}
