/**
 * Server-side HEIC/HEIF → JPEG for phones/browsers that could not convert
 * before upload. Pure JS/WASM decoder (no native deps in the image).
 * On any failure the original HEIC is kept (download still works).
 */
import { MIME } from "./detect.ts";

const MAX_PIXELS = 50_000_000;

export type Converted = { bytes: Uint8Array; mime: string; name: string; converted: boolean; error?: string };

export function jpegName(name: string): string {
  return /\.hei[cf]$/i.test(name) ? name.replace(/\.hei[cf]$/i, ".jpg") : `${name}.jpg`;
}

export async function heicToJpeg(
  bytes: Uint8Array,
  name: string,
  convert?: (input: { buffer: Uint8Array; format: "JPEG"; quality: number }) => Promise<ArrayBuffer | Uint8Array>,
): Promise<Converted> {
  try {
    const run =
      convert ??
      ((await import("heic-convert")).default as unknown as (input: { buffer: Uint8Array; format: "JPEG"; quality: number }) => Promise<ArrayBuffer>);
    const out = await run({ buffer: bytes, format: "JPEG", quality: 0.85 });
    const jpeg = out instanceof Uint8Array ? out : new Uint8Array(out);
    if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error("not_jpeg");
    return { bytes: jpeg, mime: MIME.jpeg, name: jpegName(name), converted: true };
  } catch (error) {
    return { bytes, mime: "", name, converted: false, error: error instanceof Error ? error.message.slice(0, 200) : "convert_failed" };
  }
}

export { MAX_PIXELS };
