/**
 * gzip / brotli for dynamic answers (1.15): API JSON, HTML pages, the manifest.
 * Static files under /assets are compressed at build time (nitro
 * `compressPublicAssets`). Streams that must not be buffered (server-sent
 * events) and small bodies are left as they are.
 */
import { brotliCompressSync, constants, gzipSync } from "node:zlib";

const COMPRESSIBLE = /^(application\/(json|javascript|manifest\+json|xml)|text\/(?!event-stream)|image\/svg\+xml)/i;
const MIN_BYTES = 1024;

export function pickEncoding(accept: string | null): "br" | "gzip" | null {
  const value = (accept ?? "").toLowerCase();
  if (/(^|[\s,])br($|[\s,;])/.test(value) && !/br;\s*q=0(\.0*)?($|[\s,])/.test(value)) return "br";
  if (/(^|[\s,])gzip($|[\s,;])/.test(value) && !/gzip;\s*q=0(\.0*)?($|[\s,])/.test(value)) return "gzip";
  return null;
}

export async function compressResponse(request: Request, response: Response): Promise<Response> {
  if (request.method === "HEAD" || !response.body) return response;
  if (response.status < 200 || response.status === 204 || response.status === 206 || response.status === 304) return response;
  if (response.headers.has("content-encoding")) return response;
  const type = response.headers.get("content-type") ?? "";
  if (!COMPRESSIBLE.test(type)) return response;
  const encoding = pickEncoding(request.headers.get("accept-encoding"));
  if (!encoding) return response;
  const headers = new Headers(response.headers);
  headers.append("vary", "accept-encoding");
  if (/^text\/html/i.test(type) && typeof CompressionStream !== "undefined") {
    // Pages stream: gzip on the fly instead of buffering the whole page.
    headers.set("content-encoding", "gzip");
    headers.delete("content-length");
    return new Response(response.body.pipeThrough(new CompressionStream("gzip")), { status: response.status, statusText: response.statusText, headers });
  }
  const raw = Buffer.from(await response.arrayBuffer());
  if (raw.length < MIN_BYTES) return new Response(raw, { status: response.status, statusText: response.statusText, headers: response.headers });
  const packed =
    encoding === "br"
      ? brotliCompressSync(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: 5, [constants.BROTLI_PARAM_SIZE_HINT]: raw.length } })
      : gzipSync(raw, { level: 6 });
  headers.set("content-encoding", encoding);
  headers.set("content-length", String(packed.length));
  return new Response(packed, { status: response.status, statusText: response.statusText, headers });
}
