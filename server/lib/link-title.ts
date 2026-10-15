/**
 * «Ссылка»: page title as an optional suggestion. The server fetches a page
 * the user pasted, so it must never become a way into the home network:
 * - http/https only, ports 80/443 (+ 8080/8443), no credentials in the URL;
 * - every hop (redirects too, max 3) resolves DNS once and connects to that
 *   exact checked address (no second lookup → no DNS rebinding);
 * - loopback, private, link-local, CGNAT, multicast, reserved, IPv4-mapped
 *   IPv6 of those, ULA and site-local are refused;
 * - 5 s total, first 256 KB of the body only, HTML only, no cookies sent.
 */
import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";

export const TITLE_TIMEOUT_MS = 5000;
export const TITLE_MAX_BYTES = 256 * 1024;
const MAX_REDIRECTS = 3;
const PORTS = new Set(["", "80", "443", "8080", "8443"]);

function v4Blocked(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p as [number, number, number, number];
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && (p[2] === 0 || p[2] === 2)) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && p[2] === 100) ||
    (a === 203 && b === 0 && p[2] === 113)
  );
}

/** True for any address the server must not connect to on a user's behalf. */
export function isBlockedIp(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return v4Blocked(ip);
  if (kind !== 6) return true;
  const low = ip.toLowerCase().split("%")[0]!;
  const mapped = low.match(/^(?:0*:)*:?ffff:(\d+\.\d+\.\d+\.\d+)$/) ?? low.match(/^::(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return v4Blocked(mapped[1]!);
  const hexMapped = low.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hexMapped) {
    const hi = parseInt(hexMapped[1]!, 16);
    const lo = parseInt(hexMapped[2]!, 16);
    return v4Blocked(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  if (low === "::" || low === "::1") return true;
  const first = parseInt(low.split(":")[0] || "0", 16);
  return (
    (first & 0xfe00) === 0xfc00 || // ULA fc00::/7
    (first & 0xffc0) === 0xfe80 || // link-local
    (first & 0xffc0) === 0xfec0 || // site-local
    (first & 0xff00) === 0xff00 || // multicast
    first === 0x2001 && parseInt(low.split(":")[1] || "0", 16) === 0x0db8 || // documentation
    first === 0x0064 || // NAT64 64:ff9b::/96 may reach IPv4 internals
    first === 0x2002 || // 6to4 embeds IPv4
    first === 0
  );
}

export type TitleLookup = (host: string) => Promise<{ address: string; family: number }[]>;

const defaultLookup: TitleLookup = (host) => dnsLookup(host, { all: true, verbatim: true });

/** Resolve and check every address; returns the first one or throws. */
export async function safeAddress(host: string, lookup: TitleLookup = defaultLookup): Promise<{ address: string; family: number }> {
  const bare = host.replace(/^\[|\]$/g, "");
  if (isIP(bare)) {
    if (isBlockedIp(bare)) throw new Error("blocked");
    return { address: bare, family: isIP(bare) };
  }
  if (!bare || bare === "localhost" || /\.(localhost|local|internal|lan|home|arpa)$/i.test(bare) || !bare.includes(".")) throw new Error("blocked");
  const all = await lookup(bare);
  if (!all.length || all.some((a) => isBlockedIp(a.address))) throw new Error("blocked");
  return all[0]!;
}

export function checkUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password || !PORTS.has(url.port)) return null;
  return url;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", laquo: "«", raquo: "»", mdash: "—", ndash: "–", hellip: "…" };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, code: string) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 31 && n < 0x110000 ? String.fromCodePoint(n) : " ";
    }
    return ENTITIES[code.toLowerCase()] ?? all;
  });
}

/** og:title, else <title>; plain text, max 200 chars. */
export function extractTitle(html: string): string | null {
  const og =
    html.match(/<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']{1,400})["']/i) ??
    html.match(/<meta[^>]+content=["']([^"']{1,400})["'][^>]*property=["']og:title["']/i);
  const tag = html.match(/<title[^>]*>([\s\S]{1,600}?)<\/title>/i);
  const raw = og?.[1] ?? tag?.[1];
  if (!raw) return null;
  // eslint-disable-next-line no-control-regex -- strip control characters on purpose
  const text = decodeEntities(raw.replace(/<[^>]*>/g, " ")).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
  return text || null;
}

function charsetOf(type: string, head: Uint8Array): string {
  const fromHeader = type.match(/charset=["']?([\w-]+)/i)?.[1];
  const sniff = new TextDecoder("latin1").decode(head.subarray(0, 2048)).match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1];
  const name = (fromHeader ?? sniff ?? "utf-8").toLowerCase();
  try {
    new TextDecoder(name);
    return name;
  } catch {
    return "utf-8";
  }
}

type Hop = { status: number; location: string | null; type: string; body: Uint8Array };

function fetchOnce(url: URL, address: { address: string; family: number }, signal: AbortSignal): Promise<Hop> {
  return new Promise((resolve, reject) => {
    const doRequest = url.protocol === "https:" ? httpsRequest : httpRequest;
    const req = doRequest(
      url,
      {
        method: "GET",
        signal,
        headers: { "user-agent": "Pora-link-title/1.0", accept: "text/html,application/xhtml+xml;q=0.9", "accept-encoding": "identity" },
        // Connect to the address we already checked: no second DNS answer.
        lookup: (_host, options, callback) => {
          if ((options as { all?: boolean }).all) (callback as unknown as (e: null, a: { address: string; family: number }[]) => void)(null, [address]);
          else callback(null, address.address, address.family);
        },
      },
      (res: IncomingMessage) => {
        const status = res.statusCode ?? 0;
        const type = String(res.headers["content-type"] ?? "");
        const location = typeof res.headers.location === "string" ? res.headers.location : null;
        if (status >= 300 && status < 400) {
          res.destroy();
          resolve({ status, location, type, body: new Uint8Array() });
          return;
        }
        if (status !== 200 || !/text\/html|application\/xhtml/i.test(type)) {
          res.destroy();
          resolve({ status, location: null, type, body: new Uint8Array() });
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          const room = TITLE_MAX_BYTES - size;
          chunks.push(chunk.subarray(0, Math.max(0, room)));
          size += chunk.length;
          if (size >= TITLE_MAX_BYTES) {
            res.destroy();
            resolve({ status, location: null, type, body: new Uint8Array(Buffer.concat(chunks)) });
          }
        });
        res.on("end", () => resolve({ status, location: null, type, body: new Uint8Array(Buffer.concat(chunks)) }));
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.end();
  });
}

export type FetchTitle = (url: URL, address: { address: string; family: number }, signal: AbortSignal) => Promise<Hop>;

/** Title of a public page, or null (blocked, not HTML, timeout, no title). Never throws. */
export async function fetchTitle(
  raw: string,
  deps: { lookup?: TitleLookup; fetchHop?: FetchTitle; timeoutMs?: number } = {},
): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? TITLE_TIMEOUT_MS);
  try {
    let url = checkUrl(raw);
    for (let hop = 0; url && hop <= MAX_REDIRECTS; hop++) {
      const address = await safeAddress(url.hostname, deps.lookup);
      const res = await (deps.fetchHop ?? fetchOnce)(url, address, controller.signal);
      if (res.status >= 300 && res.status < 400) {
        url = res.location ? checkUrl(new URL(res.location, url).href) : null;
        continue;
      }
      if (!res.body.length) return null;
      return extractTitle(new TextDecoder(charsetOf(res.type, res.body)).decode(res.body));
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
