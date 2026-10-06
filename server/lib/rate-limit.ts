/**
 * Login throttling: at most 5 failed attempts per client IP per 15 minutes,
 * plus a global brake (every failure anywhere slows the next answer down, and
 * 50 failures in 15 minutes lock logins for everyone until the window drains)
 * so a botnet rotating IPs cannot brute-force the single password.
 */
export const WINDOW_MS = 15 * 60 * 1000;
export const MAX_PER_IP = 5;
export const MAX_GLOBAL = 50;
const MAX_TRACKED_IPS = 10_000;

export type LimitVerdict = { allowed: true } | { allowed: false; retryAfterSec: number; scope: "ip" | "global" };

export class LoginLimiter {
  private byIp = new Map<string, number[]>();
  private global: number[] = [];

  private recent(list: number[], now: number): number[] {
    const from = now - WINDOW_MS;
    let index = 0;
    while (index < list.length && list[index]! <= from) index++;
    return index === 0 ? list : list.slice(index);
  }

  check(ip: string, now = Date.now()): LimitVerdict {
    this.global = this.recent(this.global, now);
    if (this.global.length >= MAX_GLOBAL) {
      return { allowed: false, scope: "global", retryAfterSec: Math.ceil((this.global[0]! + WINDOW_MS - now) / 1000) };
    }
    const list = this.recent(this.byIp.get(ip) ?? [], now);
    if (list.length) this.byIp.set(ip, list);
    else this.byIp.delete(ip);
    if (list.length >= MAX_PER_IP) {
      return { allowed: false, scope: "ip", retryAfterSec: Math.ceil((list[0]! + WINDOW_MS - now) / 1000) };
    }
    return { allowed: true };
  }

  /** Record a failure; returns how long to stall the response (ms). */
  fail(ip: string, now = Date.now()): number {
    const list = this.recent(this.byIp.get(ip) ?? [], now);
    list.push(now);
    this.byIp.set(ip, list);
    this.global = this.recent(this.global, now);
    this.global.push(now);
    if (this.byIp.size > MAX_TRACKED_IPS) {
      const oldest = this.byIp.keys().next().value;
      if (oldest !== undefined) this.byIp.delete(oldest);
    }
    return Math.min(3000, 200 * this.global.length);
  }

  success(ip: string): void {
    this.byIp.delete(ip);
  }

  failuresFor(ip: string, now = Date.now()): number {
    return this.recent(this.byIp.get(ip) ?? [], now).length;
  }
}
