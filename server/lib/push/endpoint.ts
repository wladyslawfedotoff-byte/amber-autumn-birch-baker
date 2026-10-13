/**
 * A push endpoint is a URL the browser got from its push service; the server
 * POSTs to it. Only public HTTPS hosts are accepted, so a subscription cannot
 * make the server knock on the home network (NAS, router, other devices).
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

function privateV4(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number) as [number, number];
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
}

export function isPublicAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return !privateV4(ip);
  if (kind !== 6) return false;
  const v6 = ip.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6);
  if (mapped) return !privateV4(mapped[1]!);
  return !(v6 === "::" || v6 === "::1" || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6) || v6.startsWith("ff"));
}

/** Syntax check (at subscribe time): https, a DNS name, not a local-only name. */
export function plausibleEndpoint(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password) return false;
  if (isIP(host.replace(/^\[|\]$/g, ""))) return false;
  return host.includes(".") && !/\.(local|lan|home|internal|localdomain|home\.arpa)$/.test(host) && host !== "localhost";
}

/** At send time: every address the name resolves to must be public. */
export async function resolvesPublic(endpoint: string, resolve: typeof lookup = lookup): Promise<boolean> {
  try {
    const addresses = await resolve(new URL(endpoint).hostname, { all: true });
    return addresses.length > 0 && addresses.every((a) => isPublicAddress(a.address));
  } catch {
    return false;
  }
}
