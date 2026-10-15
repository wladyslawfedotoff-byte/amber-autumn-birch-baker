/**
 * «Обслуживание»: every change of a card as a pure function (the store only
 * wires them in), so rules of the domain are tested without a browser.
 */
import type { RuleDraft } from "../assistant/types.ts";
import type { Asset, AssetKind, KmReading, PainNote, ServiceEntry } from "../planner-types.ts";
import { NAME_MAX, cleanPhone, cleanTitle, normalizeUrl } from "../objects/links.ts";
import { DEFAULT_SOON_DAYS, DEFAULT_SOON_KM, addDays, isIso, ruleState, worst, type MaintRule, type RuleState, type Status } from "./rules.ts";
import { limitsOf, painRef, painTaskId, parsePainRef } from "./plan.ts";
export { painRef, painTaskId, parsePainRef };

export const KINDS: { id: AssetKind; label: string; icon: string }[] = [
  { id: "car", label: "Автомобиль", icon: "car" },
  { id: "device", label: "Техника", icon: "plug" },
  { id: "consumable", label: "Расходник", icon: "droplets" },
  { id: "other", label: "Другое", icon: "wrench" },
];

export const kindLabel = (kind: AssetKind) => KINDS.find((k) => k.id === kind)?.label ?? "Другое";

const MAX_KM = 10_000_000;
const MAX_COST = 100_000_000;

export function isKind(value: unknown): value is AssetKind {
  return value === "car" || value === "device" || value === "consumable" || value === "other";
}

/** A whole number in 0…max, or undefined (blank, negative, NaN, text). */
export function cleanNumber(value: unknown, max = MAX_KM): number | undefined {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value.replace(/\s/g, "").replace(",", ".")) : NaN;
  return Number.isFinite(n) && n >= 0 && n <= max ? Math.round(n * 100) / 100 : undefined;
}

export function cleanCost(value: unknown): number | undefined {
  const n = cleanNumber(value, MAX_COST);
  return n === undefined ? undefined : n;
}

const text = (value: unknown, max: number) => cleanTitle(typeof value === "string" ? value : "").slice(0, max);
/** Free text with line breaks kept and other control characters dropped. */
const multiline = (value: unknown, max: number) =>
  typeof value === "string"
    ? [...value].filter((ch) => ch === "\n" || ch === "\t" || ch.charCodeAt(0) >= 32).join("").trim().slice(0, max)
    : "";

export type AssetInput = {
  name: string;
  kind: AssetKind;
  plate?: string;
  model?: string;
  boughtAt?: string | null;
  km?: number | string | null;
  notes?: string;
};

export function createAsset(input: AssetInput, id: string, now: number, today: string): Asset | null {
  const name = text(input.name, NAME_MAX);
  if (!name) return null;
  const kind = isKind(input.kind) ? input.kind : "other";
  const km = kind === "car" ? cleanNumber(input.km) : undefined;
  const asset: Asset = { id, name, kind, notes: multiline(input.notes, 2000), rules: [], log: [], pains: [], readings: [], createdAt: now };
  if (kind === "car") {
    const plate = text(input.plate, 20).toUpperCase();
    if (plate) asset.plate = plate;
    if (km !== undefined) {
      asset.km = km;
      asset.kmAt = today;
      asset.readings = [{ id: `${id}-r0`, date: today, km }];
    }
  }
  const model = text(input.model, 120);
  if (model && kind !== "car") asset.model = model;
  if (input.boughtAt && isIso(input.boughtAt) && kind !== "car") asset.boughtAt = input.boughtAt;
  return asset;
}

/** Fields of a card the user may edit directly. Anything out of range is dropped, not clamped silently. */
export function patchAsset(asset: Asset, patch: Partial<Pick<Asset, "name" | "plate" | "model" | "boughtAt" | "notes" | "soonDays" | "soonKm" | "kmRemind">>): Asset {
  const next = { ...asset };
  if (patch.name !== undefined && text(patch.name, NAME_MAX)) next.name = text(patch.name, NAME_MAX);
  if (patch.plate !== undefined) next.plate = text(patch.plate, 20).toUpperCase();
  if (patch.model !== undefined) next.model = text(patch.model, 120);
  if (patch.boughtAt !== undefined) next.boughtAt = patch.boughtAt && isIso(patch.boughtAt) ? patch.boughtAt : null;
  if (patch.notes !== undefined) next.notes = multiline(patch.notes, 2000);
  if (patch.soonDays !== undefined) {
    const n = cleanNumber(patch.soonDays, 365);
    next.soonDays = n === undefined ? DEFAULT_SOON_DAYS : Math.max(1, Math.round(n));
  }
  if (patch.soonKm !== undefined) {
    const n = cleanNumber(patch.soonKm, 100_000);
    next.soonKm = n === undefined ? DEFAULT_SOON_KM : Math.max(1, Math.round(n));
  }
  if (patch.kmRemind !== undefined) next.kmRemind = patch.kmRemind === true;
  return next;
}

/** Mileage «now». One reading per day (the last one wins); rules that never had a base start counting from here. */
export function setMileage(asset: Asset, kmRaw: number | string, today: string, readingId: string): Asset | null {
  const km = cleanNumber(kmRaw);
  if (km === undefined || asset.kind !== "car") return null;
  const readings = [...(asset.readings ?? []).filter((r) => r.date !== today), { id: readingId, date: today, km }];
  const rules = (asset.rules ?? []).map((r) => (r.sinceKm == null && r.lastDoneKm == null ? { ...r, sinceKm: km } : r));
  return { ...asset, km, kmAt: today, readings, rules };
}

export type RuleInput = {
  title: string;
  everyKm?: number | string | null;
  everyMonths?: number | string | null;
  fixedMonth?: number | null;
  fixedDay?: number | string | null;
  fixedYear?: number | string | null;
  lastDoneAt?: string | null;
  lastDoneKm?: number | string | null;
};

/** Returns the rule (and the history entry for «last time», if given) or null when nothing makes it due. */
export function buildRule(asset: Asset, input: RuleInput, ids: { rule: string; entry: string }, today: string): { rule: MaintRule; entry: ServiceEntry | null } | null {
  const title = text(input.title, 120);
  if (!title) return null;
  const everyKm = asset.kind === "car" ? cleanNumber(input.everyKm, 1_000_000) : undefined;
  const everyMonths = cleanNumber(input.everyMonths, 600);
  const month = typeof input.fixedMonth === "number" && input.fixedMonth >= 1 && input.fixedMonth <= 12 ? Math.floor(input.fixedMonth) : undefined;
  const day = month ? cleanNumber(input.fixedDay, 31) : undefined;
  const year = month ? cleanNumber(input.fixedYear, 2200) : undefined;
  if (!everyKm && !everyMonths && !month) return null;
  const rule: MaintRule = { id: ids.rule, title, since: today, sinceKm: asset.km ?? null };
  if (everyKm) rule.everyKm = Math.round(everyKm);
  if (everyMonths) rule.everyMonths = Math.max(1, Math.round(everyMonths));
  if (month) {
    rule.fixedMonth = month;
    if (day) rule.fixedDay = Math.max(1, Math.round(day));
    if (year) rule.fixedYear = Math.round(year);
  }
  const doneAt = input.lastDoneAt && isIso(input.lastDoneAt) ? input.lastDoneAt : null;
  const doneKm = asset.kind === "car" ? cleanNumber(input.lastDoneKm) : undefined;
  let entry: ServiceEntry | null = null;
  if (doneAt || doneKm !== undefined) {
    entry = { id: ids.entry, title, date: doneAt ?? today, ...(doneKm !== undefined ? { km: doneKm } : {}), ruleIds: [rule.id] };
    rule.lastDoneAt = entry.date;
    rule.lastDoneKm = doneKm ?? null;
  }
  return { rule, entry };
}

export type ServiceInput = { /** Preallocated so files can be attached before saving. */ id?: string; title: string; date: string; km?: number | string | null; cost?: number | string | null; place?: string; note?: string; ruleIds?: string[] };

/** «Что-то сделано»: a log entry that resets the rules it names and moves the mileage forward. */
export function logService(asset: Asset, input: ServiceInput, ids: { entry: string; reading: string }, today: string): { asset: Asset; entry: ServiceEntry } | null {
  const title = text(input.title, 160);
  if (!title) return null;
  const date = input.date && isIso(input.date) ? input.date : today;
  const km = asset.kind === "car" ? cleanNumber(input.km) : undefined;
  const cost = cleanCost(input.cost);
  const known = new Set((asset.rules ?? []).map((r) => r.id));
  const ruleIds = [...new Set((input.ruleIds ?? []).filter((id) => known.has(id)))];
  const entry: ServiceEntry = { id: ids.entry, title, date };
  if (km !== undefined) entry.km = km;
  if (cost !== undefined && cost > 0) entry.cost = cost;
  const place = text(input.place, 120);
  if (place) entry.place = place;
  const note = multiline(input.note, 1000);
  if (note) entry.note = note;
  if (ruleIds.length) entry.ruleIds = ruleIds;
  let next: Asset = { ...asset, log: [...(asset.log ?? []), entry] };
  if (km !== undefined) {
    next.readings = [...(next.readings ?? []).filter((r) => r.date !== date), { id: ids.reading, date, km }];
    if (!next.kmAt || date >= next.kmAt) {
      next.km = km;
      next.kmAt = date;
    }
  }
  next = recomputeRules(next);
  return { asset: next, entry };
}

/** Cars: the current mileage is the newest reading (after a reading or an entry was edited or removed). */
function syncKm(asset: Asset): Asset {
  const readings = asset.readings ?? [];
  if (!readings.length) return asset;
  const latest = readings.reduce((best, r) => (r.date >= best.date ? r : best));
  return { ...asset, km: latest.km, kmAt: latest.date };
}

/**
 * Edit an entry in place: every field, the rules it resets and (cars) the mileage it recorded.
 * Cleared fields are written as explicit empty values (not removed), so that the clearing
 * wins over the old value when two devices are merged.
 */
export function updateService(asset: Asset, entryId: string, input: ServiceInput, readingId: string): { asset: Asset; entry: ServiceEntry } | null {
  const old = (asset.log ?? []).find((e) => e.id === entryId);
  const title = text(input.title, 160);
  if (!old || !title) return null;
  const date = input.date && isIso(input.date) ? input.date : old.date;
  const car = asset.kind === "car";
  const km = car ? cleanNumber(input.km) : undefined;
  const cost = cleanCost(input.cost);
  const known = new Set((asset.rules ?? []).map((r) => r.id));
  const ruleIds = input.ruleIds === undefined ? (old.ruleIds ?? []) : [...new Set(input.ruleIds.filter((id) => known.has(id)))];
  const entry: ServiceEntry = {
    ...old,
    title,
    date,
    km: km ?? null,
    cost: cost !== undefined && cost > 0 ? cost : null,
    place: text(input.place, 120),
    note: multiline(input.note, 1000),
    ruleIds,
  };
  let readings = asset.readings ?? [];
  // The reading this entry made goes away (or moves) with it.
  if (old.km != null) readings = readings.filter((r) => !(r.date === old.date && r.km === old.km));
  if (km !== undefined) readings = [...readings.filter((r) => r.date !== date), { id: readingId, date, km }];
  let next: Asset = { ...asset, log: asset.log.map((e) => (e.id === entryId ? entry : e)), readings };
  next = recomputeRules(syncKm(next));
  return { asset: next, entry };
}

/** «Last done» of every rule = the newest log entry that names it (so deleting an entry restores the earlier state). */
export function recomputeRules(asset: Asset): Asset {
  const rules = (asset.rules ?? []).map((rule) => {
    let best: ServiceEntry | null = null;
    for (const entry of asset.log ?? []) {
      if (!entry.ruleIds?.includes(rule.id)) continue;
      if (!best || entry.date >= best.date) best = entry;
    }
    const lastDoneAt = best?.date ?? null;
    const lastDoneKm = best ? (best.km ?? null) : null;
    if ((rule.lastDoneAt ?? null) === lastDoneAt && (rule.lastDoneKm ?? null) === lastDoneKm) return rule;
    // Mileage of the new «last time» unknown: count again from the next mileage entered.
    return { ...rule, lastDoneAt, lastDoneKm, ...(best && best.km == null ? { sinceKm: asset.km ?? null } : {}) };
  });
  return { ...asset, rules };
}

/** What hangs on a log entry or a note (files, links, contacts) goes with it. */
function dropChildren(asset: Asset, parentId: string): Pick<Asset, "attachments" | "links" | "contacts"> {
  const keep = <T extends { entryId?: string }>(list: T[] | undefined) => (list ?? []).filter((x) => x.entryId !== parentId);
  return { attachments: keep(asset.attachments), links: keep(asset.links), contacts: keep(asset.contacts) };
}

export function removeEntry(asset: Asset, entryId: string): Asset {
  return recomputeRules({ ...asset, log: (asset.log ?? []).filter((e) => e.id !== entryId), ...dropChildren(asset, entryId) });
}

export function removeRule(asset: Asset, ruleId: string): Asset {
  return {
    ...asset,
    rules: (asset.rules ?? []).filter((r) => r.id !== ruleId),
    log: (asset.log ?? []).map((e) => (e.ruleIds?.includes(ruleId) ? { ...e, ruleIds: e.ruleIds.filter((id) => id !== ruleId) } : e)),
  };
}

export function addPain(asset: Asset, textRaw: string, id: string, now: number, todoRaw?: string): Asset | null {
  const body = multiline(textRaw, 500);
  if (!body) return null;
  const pain: PainNote = { id, text: body, createdAt: now };
  const todo = multiline(todoRaw, 500);
  if (todo) pain.todo = todo;
  return { ...asset, pains: [...(asset.pains ?? []), pain] };
}

export function setPainSolved(asset: Asset, painId: string, solved: boolean, now: number): Asset {
  return { ...asset, pains: (asset.pains ?? []).map((p) => (p.id === painId ? { ...p, solvedAt: solved ? now : null } : p)) };
}

/** Links and contacts of a card (no `parentId`) or of one of its entries / notes. */
export function addAssetLinkTo(asset: Asset, parentId: string | null, id: string, urlRaw: string, titleRaw?: string): Asset | null {
  const url = normalizeUrl(urlRaw);
  if (!url) return null;
  const title = cleanTitle(titleRaw);
  const link = { id, url, ...(title ? { title } : {}), ...(parentId ? { entryId: parentId } : {}) };
  return { ...asset, links: [...(asset.links ?? []), link] };
}

export function addAssetContactTo(asset: Asset, parentId: string | null, id: string, contact: { name: string; phone?: string | null }): Asset | null {
  const phone = cleanPhone(contact.phone);
  const name = cleanTitle(contact.name).slice(0, NAME_MAX) || phone || "";
  if (!name) return null;
  const item = { id, name, ...(phone ? { phone } : {}), ...(parentId ? { entryId: parentId } : {}) };
  return { ...asset, contacts: [...(asset.contacts ?? []), item] };
}

export function updatePain(asset: Asset, painId: string, textRaw: string, todoRaw?: string): Asset | null {
  const body = multiline(textRaw, 500);
  if (!body) return null;
  // `todo` undefined = leave as is; "" = cleared (written as an explicit empty value so it wins on merge).
  return { ...asset, pains: (asset.pains ?? []).map((p) => (p.id === painId ? { ...p, text: body, ...(todoRaw !== undefined ? { todo: multiline(todoRaw, 500) } : {}) } : p)) };
}

export type PainPlanInput = { date?: string | null; days?: number | string | null; km?: number | string | null };
/**
 * «Запланировать»: a day (or «через N дней») or a mileage (cars). Returns the
 * values to store on the note, or null when the input says nothing usable.
 */
export function resolvePainPlan(asset: Asset, input: PainPlanInput, today: string): { planDate: string | null; planKm: number | null } | null {
  if (input.date && isIso(input.date)) return { planDate: input.date < today ? today : input.date, planKm: null };
  const days = cleanNumber(input.days, 3650);
  if (days !== undefined && input.days !== null && input.days !== undefined && input.days !== "") return { planDate: addDays(today, Math.round(days)), planKm: null };
  const km = cleanNumber(input.km);
  if (asset.kind === "car" && km !== undefined && km > 0 && input.km !== null && input.km !== "") return { planDate: null, planKm: km };
  return null;
}

/** Correct a mileage reading (e.g. a typo in an earlier month). */
export function updateReading(asset: Asset, readingId: string, kmRaw: number | string): Asset | null {
  const km = cleanNumber(kmRaw);
  if (km === undefined || !(asset.readings ?? []).some((r) => r.id === readingId)) return null;
  return syncKm({ ...asset, readings: asset.readings.map((r) => (r.id === readingId ? { ...r, km } : r)) });
}

export function removeReading(asset: Asset, readingId: string): Asset {
  return syncKm({ ...asset, readings: (asset.readings ?? []).filter((r) => r.id !== readingId) });
}

export function removePain(asset: Asset, painId: string): Asset {
  return { ...asset, pains: (asset.pains ?? []).filter((p) => p.id !== painId), ...dropChildren(asset, painId) };
}

/* ---- summary for lists ----------------------------------------------------- */

export type AssetSummary = {
  status: Status;
  urgency: number;
  rules: { rule: MaintRule; state: RuleState }[];
  /** The rule that decides the badge (most urgent), if any. */
  lead: { rule: MaintRule; state: RuleState } | null;
  openPains: number;
};

export function summarize(asset: Asset, today: string): AssetSummary {
  const limits = limitsOf(asset);
  const km = typeof asset.km === "number" ? asset.km : null;
  const rules = (asset.rules ?? []).map((rule) => ({ rule, state: ruleState(rule, { today, km }, limits) }));
  let status: Status = "ok";
  for (const r of rules) status = worst(status, r.state.status);
  const sorted = [...rules].sort((a, b) => a.state.urgency - b.state.urgency);
  const lead = sorted.find((r) => !r.state.finished) ?? null;
  return {
    status,
    urgency: lead ? lead.state.urgency : 99_999,
    rules: sorted,
    lead,
    openPains: (asset.pains ?? []).filter((p) => !p.solvedAt).length,
  };
}

const RANK: Record<Status, number> = { overdue: 0, soon: 1, ok: 2 };

/** Overdue first, then soon, then the rest; within a group the nearest deadline first. */
export function sortAssets(assets: Asset[], today: string): { asset: Asset; summary: AssetSummary }[] {
  return assets
    .map((asset) => ({ asset, summary: summarize(asset, today) }))
    .sort((a, b) => RANK[a.summary.status] - RANK[b.summary.status] || a.summary.urgency - b.summary.urgency || a.asset.name.localeCompare(b.asset.name, "ru"));
}

/** Best guess which rules a log entry is about: title words found in the rule title (or vice versa). */
export function guessRules(asset: Asset, title: string): string[] {
  const words = title
    .toLowerCase()
    .split(/[^a-zа-яё0-9]+/)
    .filter((w) => w.length >= 4)
    .map((w) => w.slice(0, Math.max(4, w.length - 2)));
  if (!words.length) return [];
  return (asset.rules ?? [])
    .filter((r) => {
      const t = r.title.toLowerCase();
      return words.some((w) => t.includes(w));
    })
    .map((r) => r.id);
}

export type { KmReading };

/** An assistant's rule proposal as a rule, to print its «каждые …» line. */
export function draftRule(d: RuleDraft): MaintRule {
  return {
    id: "draft",
    title: d.title,
    since: "",
    sinceKm: null,
    ...(d.everyKm ? { everyKm: d.everyKm } : {}),
    ...(d.everyMonths ? { everyMonths: d.everyMonths } : {}),
    ...(d.fixedMonth ? { fixedMonth: d.fixedMonth, ...(d.fixedDay ? { fixedDay: d.fixedDay } : {}), ...(d.fixedYear ? { fixedYear: d.fixedYear } : {}) } : {}),
  };
}
