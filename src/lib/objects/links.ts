/**
 * Task links and contacts: pure helpers (URL check, site label, phone and
 * vCard parsing). No DOM, no network — shared by the UI, the store and tests.
 */

export const LINK_MAX = 2000;
export const TITLE_MAX = 200;
export const NAME_MAX = 120;
export const PHONE_MAX = 40;

/** Only http(s) links are kept; returns the normalized href or null. Bare «site.ru/…» gets https://. */
export function normalizeUrl(raw: string): string | null {
  let text = raw.trim();
  if (!text || text.length > LINK_MAX || /\s/.test(text)) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(text)) {
    if (!/^[^/?#]+\.[a-z\u0400-\u04ff]{2,}([/?#:]|$)/i.test(text)) return null;
    text = `https://${text}`;
  }
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!url.hostname || url.username || url.password) return null;
  return url.href;
}

/** First URL found in pasted text (clipboard often holds «Title https://…»). */
export function findUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s<>"']+/i);
  return match ? normalizeUrl(match[0].replace(/[).,;!?»]+$/, "")) : normalizeUrl(text);
}

/** «docs.example.ru» without «www.»; punycode is shown as the browser gives it. */
export function siteName(href: string): string {
  try {
    return new URL(href).hostname.replace(/^www\./, "");
  } catch {
    return href;
  }
}

/** Letter for the site badge: first letter of the main domain part. */
export function siteLetter(href: string): string {
  const host = siteName(href).split(".");
  const main = host.length > 1 ? host[host.length - 2]! : host[0]!;
  return (main[0] ?? "?").toUpperCase();
}

export function cleanTitle(raw: string | undefined | null): string {
  // eslint-disable-next-line no-control-regex -- strip control characters on purpose
  return (raw ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, TITLE_MAX);
}

/** Keep digits, «+» and the usual separators; null when there are fewer than 3 digits. */
export function cleanPhone(raw: string | undefined | null): string | null {
  const text = (raw ?? "").replace(/[^\d+()\-\s]/g, "").replace(/\s+/g, " ").trim().slice(0, PHONE_MAX);
  return (text.match(/\d/g)?.length ?? 0) >= 3 ? text : null;
}

/** For tel:/sms: — digits and a leading «+» only. */
export function dialable(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, "");
  return digits.startsWith("+") ? `+${digits.slice(1).replace(/\+/g, "")}` : digits.replace(/\+/g, "");
}

export type ParsedContact = { name: string; phone: string | null };

const VCARD_MAX = 64 * 1024;

/**
 * Minimal vCard 2.1/3.0/4.0 reader: FN (or N), first TEL. Only the first
 * card is read. Unfolds lines, decodes escapes and QUOTED-PRINTABLE UTF-8.
 * Everything else (photos, notes, URLs) is ignored, so nothing from the file
 * ends up as markup or a link.
 */
export function parseVcard(text: string): ParsedContact | null {
  if (!text || text.length > VCARD_MAX || !/BEGIN:VCARD/i.test(text)) return null;
  const card = text.slice(text.search(/BEGIN:VCARD/i)).split(/END:VCARD/i)[0]!;
  const lines = card.replace(/\r\n?/g, "\n").replace(/\n[ \t]/g, "").replace(/=\n/g, "").split("\n");
  let fn = "";
  let n = "";
  let tel: string | null = null;
  for (const line of lines) {
    const at = line.indexOf(":");
    if (at < 0) continue;
    const head = line.slice(0, at).toUpperCase();
    const prop = head.split(";")[0]!.replace(/^ITEM\d+\./, "");
    let value = line.slice(at + 1);
    if (head.includes("QUOTED-PRINTABLE")) value = decodeQp(value);
    value = value.replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1");
    if (prop === "FN" && !fn) fn = value;
    else if (prop === "N" && !n) n = value.split(";").slice(0, 3).reverse().filter(Boolean).join(" ");
    else if (prop === "TEL" && !tel) tel = cleanPhone(value.replace(/^tel:/i, ""));
  }
  const name = cleanTitle(fn || n).slice(0, NAME_MAX);
  if (!name && !tel) return null;
  return { name: name || tel || "", phone: tel };
}

function decodeQp(value: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < value.length; i++) {
    const hex = value.slice(i + 1, i + 3);
    if (value[i] === "=" && /^[0-9A-F]{2}$/i.test(hex)) {
      bytes.push(parseInt(hex, 16));
      i += 2;
    } else bytes.push(value.charCodeAt(i) & 0xff);
  }
  try {
    return new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(bytes));
  } catch {
    return value;
  }
}

/** Pasted text → contact: a vCard, or «Имя +7 900 …», or just a number. */
export function parseContactText(text: string): ParsedContact | null {
  const card = parseVcard(text);
  if (card) return card;
  const trimmed = text.trim().slice(0, 300);
  const phoneMatch = trimmed.match(/\+?\d[\d()\-\s]{4,}\d/);
  const phone = phoneMatch ? cleanPhone(phoneMatch[0]) : null;
  if (!phone) return null;
  const name = cleanTitle(trimmed.replace(phoneMatch![0], "").replace(/[:,;—–-]+\s*$/, "")).slice(0, NAME_MAX);
  return { name, phone };
}
