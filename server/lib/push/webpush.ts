/**
 * Web Push without extra dependencies (node:crypto only):
 * - payload encryption «aes128gcm» (RFC 8291 + RFC 8188, one record);
 * - VAPID authorization (RFC 8292): a short-lived ES256 token signed with the
 *   server key from .env.
 * Keep this file free of Nitro imports: node --test loads it directly.
 */
import { createECDH, createCipheriv, createPrivateKey, hkdfSync, randomBytes, sign } from "node:crypto";

export type PushKeys = { p256dh: string; auth: string };
export type PushSubscriptionJson = { endpoint: string; keys: PushKeys };
export type VapidKeys = { publicKey: string; privateKey: string; contact: string };

const RECORD_SIZE = 4096;

export function b64u(buf: Uint8Array): string {
  return Buffer.from(buf).toString("base64url");
}

export function fromB64u(value: string): Buffer {
  return Buffer.from(value.replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_"), "base64url");
}

function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Buffer {
  return Buffer.from(hkdfSync("sha256", ikm, salt, info, length));
}

/** True for a P-256 public key (65 bytes, uncompressed) and a 32-byte private key. */
export function validVapidKeys(publicKey: string, privateKey: string): boolean {
  try {
    const pub = fromB64u(publicKey);
    const priv = fromB64u(privateKey);
    if (pub.length !== 65 || pub[0] !== 4 || priv.length !== 32) return false;
    const ecdh = createECDH("prime256v1");
    ecdh.setPrivateKey(priv);
    return ecdh.getPublicKey().equals(pub);
  } catch {
    return false;
  }
}

/** Private keys are 32 bytes; a key with leading zero bytes comes back shorter. */
export function pad32(key: Buffer): Buffer {
  return key.length >= 32 ? key : Buffer.concat([Buffer.alloc(32 - key.length), key]);
}

export function generateVapidKeys(): { publicKey: string; privateKey: string } {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return { publicKey: b64u(ecdh.getPublicKey()), privateKey: b64u(pad32(ecdh.getPrivateKey())) };
}

/** Encrypt `plaintext` for one subscription. `salt`/`serverKey` only for tests. */
export function encryptPayload(
  plaintext: Uint8Array,
  keys: PushKeys,
  fixed?: { salt: Buffer; serverPrivateKey: Buffer },
): Buffer {
  const uaPublic = fromB64u(keys.p256dh);
  const authSecret = fromB64u(keys.auth);
  if (uaPublic.length !== 65 || authSecret.length < 16) throw new Error("bad subscription keys");
  if (plaintext.length > RECORD_SIZE - 17 - 86) throw new Error("payload too large");
  const ecdh = createECDH("prime256v1");
  if (fixed) ecdh.setPrivateKey(fixed.serverPrivateKey);
  else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPublic);
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]);
  const ikm = hkdf(authSecret, shared, keyInfo, 32);
  const salt = fixed?.salt ?? randomBytes(16);
  const cek = hkdf(salt, ikm, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = hkdf(salt, ikm, Buffer.from("Content-Encoding: nonce\0"), 12);
  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  // 0x02 = padding delimiter of the last (and only) record.
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(plaintext), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, body]);
}

/** `Authorization` header value for a push service at `endpoint`. */
export function vapidAuthorization(endpoint: string, vapid: VapidKeys, now = Date.now()): string {
  const audience = new URL(endpoint).origin;
  const header = b64u(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64u(Buffer.from(JSON.stringify({ aud: audience, exp: Math.floor(now / 1000) + 12 * 3600, sub: vapid.contact })));
  const pub = fromB64u(vapid.publicKey);
  const key = createPrivateKey({
    key: { kty: "EC", crv: "P-256", d: b64u(fromB64u(vapid.privateKey)), x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) },
    format: "jwk",
  });
  const signature = sign("sha256", Buffer.from(`${header}.${claims}`), { key, dsaEncoding: "ieee-p1363" });
  return `vapid t=${header}.${claims}.${b64u(signature)}, k=${vapid.publicKey}`;
}

export type SendResult = { ok: true } | { ok: false; gone: boolean; status: number; retry: boolean };

/** Deliver one message. `gone` = the subscription is dead and should be removed. */
export async function sendPush(
  subscription: PushSubscriptionJson,
  payload: unknown,
  vapid: VapidKeys,
  options: { ttl?: number; topic?: string; fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<SendResult> {
  const body = encryptPayload(Buffer.from(JSON.stringify(payload)), subscription.keys);
  const headers: Record<string, string> = {
    Authorization: vapidAuthorization(subscription.endpoint, vapid),
    "Content-Encoding": "aes128gcm",
    "Content-Type": "application/octet-stream",
    TTL: String(options.ttl ?? 6 * 3600),
    Urgency: "high",
  };
  if (options.topic) headers.Topic = options.topic;
  const doFetch = options.fetchImpl ?? fetch;
  try {
    const response = await doFetch(subscription.endpoint, {
      method: "POST",
      headers,
      body: new Uint8Array(body),
      signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
    });
    if (response.status >= 200 && response.status < 300) return { ok: true };
    const gone = response.status === 404 || response.status === 410;
    return { ok: false, gone, status: response.status, retry: !gone && (response.status === 429 || response.status >= 500) };
  } catch {
    return { ok: false, gone: false, status: 0, retry: true };
  }
}
