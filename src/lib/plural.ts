/** Russian plural: plural(5, ["день", "дня", "дней"]) → "дней". */
export function plural(n: number, forms: readonly [string, string, string]): string {
  const abs = Math.abs(Math.trunc(n));
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

export function pluralN(n: number, forms: readonly [string, string, string]): string {
  return `${n} ${plural(n, forms)}`;
}

export const DAYS: readonly [string, string, string] = ["день", "дня", "дней"];
export const YEARS: readonly [string, string, string] = ["год", "года", "лет"];
