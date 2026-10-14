/**
 * Client-side image shrink before upload. Photos from the phone camera are
 * often 5–12 MB; we keep a long edge of 1920 px and JPEG quality ~0.82 so a
 * typical shot lands under 1 MB without an extra library.
 *
 * HEIC/HEIF: where the browser can decode them (Safari/iOS) they become JPEG
 * here; otherwise the file is sent as HEIC and the server converts it.
 */
const MAX_EDGE = 1920;
const QUALITY = 0.82;

export type CompressResult = { blob: Blob; name: string; mime: string };
export type CompressOptions = { maxEdge?: number; quality?: number };

export function isHeic(mime: string, name: string): boolean {
  return mime === "image/heic" || mime === "image/heif" || /\.hei[cf]$/i.test(name);
}

function canDraw(mime: string): boolean {
  return mime === "image/jpeg" || mime === "image/png" || mime === "image/webp" || mime === "image/gif";
}

export function renameJpeg(name: string): string {
  return name.replace(/\.(png|webp|gif|heic|heif)$/i, ".jpg") || "photo.jpg";
}

export async function compressImage(file: File, options: CompressOptions = {}): Promise<CompressResult> {
  const maxEdge = options.maxEdge ?? MAX_EDGE;
  const quality = options.quality ?? QUALITY;
  const name = file.name || "файл";
  const mime = (file.type || "application/octet-stream").toLowerCase();
  const heic = isHeic(mime, name);
  try {
    if (!heic && !canDraw(mime)) return { blob: file, name, mime };
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(file);
    } catch {
      return { blob: file, name, mime: heic ? "image/heic" : mime };
    }
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    if (scale >= 1 && file.size < 900_000 && mime === "image/jpeg") {
      bitmap.close();
      return { blob: file, name, mime };
    }
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return { blob: file, name, mime: heic ? "image/heic" : mime };
    }
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (!blob) return { blob: file, name, mime: heic ? "image/heic" : mime };
    return { blob, name: renameJpeg(name), mime: "image/jpeg" };
  } catch {
    return { blob: file, name, mime: heic ? "image/heic" : mime };
  }
}
