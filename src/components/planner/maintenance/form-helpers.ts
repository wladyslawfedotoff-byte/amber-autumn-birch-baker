/** Form helpers for the «Гарантия» picker (kept apart from the components for fast refresh). */
export type WarrMode = "months" | "until" | "none";

export function warrModeOf(s: { warrantyMonths?: number | null; warrantyUntil?: string | null }): WarrMode {
  return s.warrantyUntil ? "until" : s.warrantyMonths ? "months" : "none";
}

export function warrInput(mode: WarrMode, months: string, until: string): { warrantyMonths: string | null; warrantyUntil: string | null } {
  return { warrantyMonths: mode === "months" ? months : null, warrantyUntil: mode === "until" ? until || null : null };
}

/** Colours of fuel / maintenance / insurance in the money bars. */
export const SPEND_COLORS = { fuel: "var(--accent)", service: "var(--warn)", ins: "var(--subtle)" } as const;
