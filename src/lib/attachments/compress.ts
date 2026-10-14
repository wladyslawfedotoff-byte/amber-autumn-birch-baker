/**
 * Client-side image shrink before upload. Photos from the phone camera are
 * often 5–12 MB; we keep a long edge of 1920 px and JPEG quality ~0.82 so a
 * typical shot lands under 1 MB without an extra library.
 */
const MAX_EDGE = 1920;
const QUALITY = 0.82;

export type CompressResult = { blob: Blob; name: string; mime: string };

function isImage(mime: string): boolean {
  return mime.startsWith("image/") && mime !== "image/svg+xml";
}

/** HEIC/HEIF cannot be drawn to canvas in most browsers — leave as-is. */
function canDraw(mime: string): boolean {
  return mime === "image/jpeg" || mime === "image/png" || mime === "image/webp" || mime === "image/gif";
}

function renameJpeg(name: string): string {
  return name.replace(/\.(png|webp|gif|heic|heif)$/i, ".jpg") || "photo.jpg";
}

export async function compressImage(file: File, maxEdge = MAX_EDGE, quality = QUALITY): Promise<CompressResult> {
  try {
  const mime = (file.type || "application/octet-stream").toLowerCase();
  if (!isImage(mime) || !canDraw(mime)) {
    return { blob: file, name: file.name || "файл", mime };
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return { blob: file, name: file.name || "файл", mime };
  }
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  if (scale >= 1 && file.size < 900_000 && mime === "image/jpeg") {
    bitmap.close();
    return { blob: file, name: file.name || "photo.jpg", mime };
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    return { blob: file, name: file.name || "файл", mime };
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  if (!blob) return { blob: file, name: file.name || "файл", mime };
  return { blob, name: renameJpeg(file.name || "photo.jpg"), mime: "image/jpeg" };
  } catch {
    return { blob: file, name: file.name || "файл", mime: (file.type || "application/octet-stream").toLowerCase() };
  }
}
