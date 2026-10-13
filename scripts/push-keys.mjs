#!/usr/bin/env node
/**
 * New key pair for reminders on the phone (Web Push, VAPID). Prints two lines
 * for .env. Run once; changing the keys later turns notifications off on every
 * device until they are enabled again.
 *
 *   node scripts/push-keys.mjs
 *   sudo docker exec pora-app node scripts/push-keys.mjs
 */
import { createECDH } from "node:crypto";

const ecdh = createECDH("prime256v1");
ecdh.generateKeys();
console.log(`PUSH_VAPID_PUBLIC_KEY=${ecdh.getPublicKey().toString("base64url")}`);
console.log(`PUSH_VAPID_PRIVATE_KEY=${Buffer.concat([Buffer.alloc(32), ecdh.getPrivateKey()]).subarray(-32).toString("base64url")}`);
