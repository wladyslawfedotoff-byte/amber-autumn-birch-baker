import { useSyncExternalStore } from "react";

/**
 * Optional server features and the signed-in profile, from GET /api/me
 * (authenticated). Cached in localStorage so the name shows offline too.
 */
export type ProfileUser = { login: string; name: string };
export type Capabilities = {
  assistant: boolean;
  /** Signed-in login ("" until known / no server). */
  login: string;
  name: string;
  /** Several profiles on the server: sharing, «Общие», assigning. */
  multiUser: boolean;
  /** Everybody one can share with (multiUser only). */
  users: ProfileUser[];
  /** The password was changed in the app (users.json) rather than in .env. */
  passwordInApp: boolean;
  /** Owner of items without `owner` (data from before profiles; APP_OWNER). */
  dataOwner: string;
};

const CACHE_KEY = "pora-profile";
const NONE: Capabilities = { assistant: false, login: "", name: "", multiUser: false, users: [], passwordInApp: false, dataOwner: "" };
let current: Capabilities = NONE;
let started = false;
let hydrated = false;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((listener) => listener());
}

function parse(body: unknown): Capabilities | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const users = Array.isArray(b.users)
    ? b.users
        .filter((u): u is { login: string; name?: unknown } => Boolean(u) && typeof (u as { login?: unknown }).login === "string")
        .map((u) => ({ login: u.login, name: typeof u.name === "string" && u.name ? u.name : u.login }))
    : [];
  return {
    assistant: b.assistant === true,
    login: typeof b.login === "string" ? b.login : "",
    name: typeof b.name === "string" ? b.name : "",
    multiUser: b.multiUser === true,
    users,
    passwordInApp: b.passwordInApp === true,
    dataOwner: typeof b.dataOwner === "string" ? b.dataOwner : "",
  };
}

function hydrate(): void {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  try {
    const cached = parse(JSON.parse(window.localStorage.getItem(CACHE_KEY) ?? "null"));
    if (cached) current = cached;
  } catch {
    // ignore
  }
}

export function reloadProfile(): void {
  started = false;
  load();
}

function load(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  void fetch("/api/me", { credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } })
    .then((response) => (response.ok ? response.json() : null))
    .then((body: unknown) => {
      const next = parse(body);
      if (!next) return;
      current = next;
      try {
        window.localStorage.setItem(CACHE_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      emit();
    })
    .catch(() => {
      // offline: keep the cached profile; retry on the next page load
      started = false;
    });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  hydrate();
  load();
  return () => {
    listeners.delete(listener);
  };
}

export function useCapabilities(): Capabilities {
  return useSyncExternalStore(
    subscribe,
    () => {
      hydrate();
      return current;
    },
    () => NONE,
  );
}

export const useProfile = useCapabilities;

/** Current login outside React (store actions): "" when unknown. */
export function currentLogin(): string {
  hydrate();
  return current.login;
}

/** Display name for a login («Пользователь 2» instead of "user2"). */
export function displayName(login: string | null | undefined, profile: Capabilities = current): string {
  if (!login) return "";
  return profile.users.find((user) => user.login === login)?.name ?? login;
}

/** Forget the cached profile (logout). */
export function clearProfile(): void {
  current = NONE;
  try {
    window.localStorage.removeItem(CACHE_KEY);
  } catch {
    // ignore
  }
  emit();
}
