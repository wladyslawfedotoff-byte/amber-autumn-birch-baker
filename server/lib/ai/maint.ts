/**
 * «Обслуживание» for «Помощник»: compact context lines, the tools that
 * propose cards (create item, service-log entry, rule, mileage) and a
 * model-free answer for «что пора менять». Writes are proposals only —
 * the user confirms them in the app, exactly like tasks.
 */
import type { Proposal, ProposalItem, RuleDraft } from "../../../src/lib/assistant/types.ts";
import type { AssetKind } from "../../../src/lib/planner-types.ts";
import { cleanNumber, isKind, kindLabel, summarize } from "../../../src/lib/maintenance/ops.ts";
import { groupKm, isIso, ruleLine, stateText, type MaintRule } from "../../../src/lib/maintenance/rules.ts";
import type { ToolSpec } from "./provider.ts";
import type { ToolContext } from "./tools.ts";

type Args = Record<string, unknown>;

export type AssetLite = {
  id: string;
  name: string;
  kind: AssetKind;
  plate?: string;
  km: number | null;
  kmAt: string | null;
  soonDays?: number;
  soonKm?: number;
  rules: MaintRule[];
  log: { id: string; title: string; date: string; km?: number | null; ruleIds?: string[] }[];
  pains: { id: string; text: string; solvedAt?: number | null }[];
};

const rec = (v: unknown): Args => (v && typeof v === "object" ? (v as Args) : {});
const str = (v: unknown, max = 120) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Visible, not deleted cards in the shape the rules code wants. */
export function assetsOf(ctx: ToolContext): AssetLite[] {
  const list = Array.isArray(ctx.data.assets) ? ctx.data.assets : [];
  return list.flatMap((raw) => {
    const e = rec(raw);
    if (typeof e.id !== "string" || typeof e.name !== "string" || e.deleted) return [];
    const rules = (Array.isArray(e.rules) ? e.rules : []).flatMap((r): MaintRule[] => {
      const x = rec(r);
      return typeof x.id === "string" && typeof x.title === "string" && !x.deleted ? [x as unknown as MaintRule] : [];
    });
    const log = (Array.isArray(e.log) ? e.log : []).flatMap((r) => {
      const x = rec(r);
      return typeof x.id === "string" && typeof x.title === "string" && typeof x.date === "string" && !x.deleted ? [x as unknown as AssetLite["log"][number]] : [];
    });
    const pains = (Array.isArray(e.pains) ? e.pains : []).flatMap((r) => {
      const x = rec(r);
      return typeof x.id === "string" && typeof x.text === "string" && !x.deleted ? [x as unknown as AssetLite["pains"][number]] : [];
    });
    return [
      {
        id: e.id,
        name: e.name,
        kind: isKind(e.kind) ? e.kind : "other",
        ...(typeof e.plate === "string" && e.plate ? { plate: e.plate } : {}),
        km: typeof e.km === "number" ? e.km : null,
        kmAt: typeof e.kmAt === "string" ? e.kmAt : null,
        ...(typeof e.soonDays === "number" ? { soonDays: e.soonDays } : {}),
        ...(typeof e.soonKm === "number" ? { soonKm: e.soonKm } : {}),
        rules,
        log,
        pains,
      },
    ];
  });
}

/** Short ids for the model (a1, a2…), like t1 for tasks. */
function ids(assets: AssetLite[]) {
  return { short: new Map(assets.map((a, i) => [a.id, `a${i + 1}`])), real: new Map(assets.map((a, i) => [`a${i + 1}`, a.id])) };
}

/** A card by its short id, real id or (part of) its name. */
export function findAsset(assets: AssetLite[], ref: unknown): AssetLite | null {
  const key = str(ref, 80).replace(/^\[|\]$/g, "");
  if (!key) return null;
  const { real } = ids(assets);
  const direct = real.get(key) ?? key;
  const byId = assets.find((a) => a.id === direct);
  if (byId) return byId;
  const lower = key.toLowerCase().replace(/ё/g, "е");
  const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е");
  const exact = assets.filter((a) => norm(a.name) === lower);
  if (exact.length === 1) return exact[0]!;
  const part = assets.filter((a) => norm(a.name).includes(lower) || (a.plate && norm(a.plate) === lower));
  return part.length === 1 ? part[0]! : null;
}

function stateOf(asset: AssetLite, today: string) {
  return summarize(
    { ...asset, notes: "", readings: [], createdAt: 0, updatedAt: 0 } as unknown as Parameters<typeof summarize>[0],
    today,
  );
}

/** Lines for the prompt: «a1 Легковая (авто, 84300 км): Замена масла — через 4 200 км; Колодки — ок». */
export function maintContext(ctx: ToolContext): string {
  const assets = assetsOf(ctx);
  if (!assets.length) return "Карточек обслуживания нет.";
  const { short } = ids(assets);
  return [
    "Обслуживание:",
    ...assets.slice(0, 15).map((a) => {
      const s = stateOf(a, ctx.today);
      const rules = s.rules.slice(0, 6).map(({ rule, state }) => `${rule.title} — ${state.status === "ok" ? "ок" : stateText(rule, state)}`);
      const head = `${short.get(a.id)} ${a.name} (${kindLabel(a.kind).toLowerCase()}${a.km != null ? `, ${a.km} км` : ""})`;
      return `${head}${rules.length ? `: ${rules.join("; ")}` : ""}${s.openPains ? `; болит: ${s.openPains}` : ""}`;
    }),
  ].join("\n");
}

/** «Что пора менять?» without a model. */
export function maintAnswer(ctx: ToolContext): { text: string } {
  const assets = assetsOf(ctx);
  if (!assets.length) return { text: "Карточек обслуживания пока нет. Откройте «Обслуживание» и добавьте автомобиль, технику или расходник." };
  const rows = assets.flatMap((a) => stateOf(a, ctx.today).rules.filter((r) => !r.state.finished && r.state.status !== "ok").map((r) => ({ a, ...r })));
  rows.sort((x, y) => (x.state.status === y.state.status ? x.state.urgency - y.state.urgency : x.state.status === "overdue" ? -1 : 1));
  if (!rows.length) return { text: "Всё в порядке: просроченного и «скоро» по обслуживанию нет." };
  return {
    text: ["По обслуживанию нужно внимание:", "", ...rows.slice(0, 20).map((r) => `- **${r.a.name}:** ${r.rule.title} — ${stateText(r.rule, r.state)}`)].join("\n"),
  };
}

/* ---- tools --------------------------------------------------------------- */

const s = { type: "string" };
const ruleProps = {
  title: s,
  every_km: { type: "integer" },
  every_months: { type: "integer" },
  month: { type: "integer", description: "1-12, фиксированная дата" },
  day: { type: "integer" },
  year: { type: "integer", description: "без года — каждый год" },
  last_date: s,
  last_km: { type: "integer" },
};
const fn = (name: string, description: string, properties: Record<string, unknown>, required: string[]): ToolSpec => ({ type: "function", function: { name, description, parameters: { type: "object", properties, required } } });

export const MAINT_SPECS: ToolSpec[] = [
  fn(
    "create_asset",
    "Новая карточка обслуживания (авто, техника, расходник) → карточка.",
    { assets: { type: "array", items: { type: "object", properties: { name: s, kind: { type: "string", enum: ["car", "device", "consumable", "other"] }, plate: s, model: s, km: { type: "integer" }, rules: { type: "array", items: { type: "object", properties: ruleProps, required: ["title"] } } }, required: ["name", "kind"] } } },
    ["assets"],
  ),
  fn(
    "add_service",
    "Запись в историю обслуживания (заодно обновит пробег и срок правила) → карточка.",
    { entries: { type: "array", items: { type: "object", properties: { asset: s, title: s, date: s, km: { type: "integer" }, cost: { type: "number" }, place: s, note: s, rule: { type: "string", description: "название правила, которое сбросить" } }, required: ["asset", "title"] } } },
    ["entries"],
  ),
  fn("create_rule", "Правило обслуживания (каждые N км / N мес. / в дату) → карточка.", { rules: { type: "array", items: { type: "object", properties: { asset: s, ...ruleProps }, required: ["asset", "title"] } } }, ["rules"]),
  fn("set_mileage", "Новый пробег автомобиля → карточка.", { asset: s, km: { type: "integer" } }, ["asset", "km"]),
];

export const MAINT_WRITE = new Set(["create_asset", "add_service", "create_rule", "set_mileage"]);

function draft(raw: unknown, car: boolean): RuleDraft | null {
  const r = rec(raw);
  const title = str(r.title, 120);
  if (!title) return null;
  const everyKm = car ? cleanNumber(r.every_km, 1_000_000) : undefined;
  const everyMonths = cleanNumber(r.every_months, 600);
  const month = Number(r.month);
  const fixedMonth = Number.isInteger(month) && month >= 1 && month <= 12 ? month : undefined;
  if (!everyKm && !everyMonths && !fixedMonth) return null;
  const day = fixedMonth ? cleanNumber(r.day, 31) : undefined;
  const year = fixedMonth ? cleanNumber(r.year, 2200) : undefined;
  const lastAt = str(r.last_date, 10);
  const lastKm = car ? cleanNumber(r.last_km) : undefined;
  return {
    title,
    ...(everyKm ? { everyKm: Math.round(everyKm) } : {}),
    ...(everyMonths ? { everyMonths: Math.round(everyMonths) } : {}),
    ...(fixedMonth ? { fixedMonth, ...(day ? { fixedDay: Math.round(day) } : {}), ...(year ? { fixedYear: Math.round(year) } : {}) } : {}),
    ...(isIso(lastAt) ? { lastDoneAt: lastAt } : {}),
    ...(lastKm !== undefined ? { lastDoneKm: lastKm } : {}),
  };
}

type Out = { content: string; proposal: Proposal | null };

/** Runs a maintenance tool; null = not one of ours. */
export function runMaintTool(name: string, args: Args, ctx: ToolContext): Out | null {
  if (!MAINT_WRITE.has(name)) return null;
  const assets = assetsOf(ctx);
  const arr = (v: unknown, max: number) => (Array.isArray(v) ? v.slice(0, max) : []);
  const fail = (error: string): Out => ({ content: JSON.stringify({ error }), proposal: null });
  const propose = (title: string, items: ProposalItem[], note: string): Out => {
    if (!items.length) return fail("Нечего предложить: проверьте карточку (id a1… или название) и поля.");
    const proposal: Proposal = { id: ctx.newId(), title, items, status: "pending" };
    return { content: JSON.stringify({ ok: true, proposal: proposal.id, note: `${note} Показано пользователю, применится после «Применить».` }), proposal };
  };
  switch (name) {
    case "create_asset": {
      const items: ProposalItem[] = arr(args.assets, 5).flatMap((raw) => {
        const r = rec(raw);
        const nm = str(r.name, 80);
        if (!nm) return [];
        const kind: AssetKind = isKind(r.kind) ? r.kind : "other";
        const km = kind === "car" ? cleanNumber(r.km) : undefined;
        return [{ op: "asset" as const, key: ctx.newId(), name: nm, kind, plate: str(r.plate, 20) || null, model: str(r.model, 120) || null, km: km ?? null, rules: arr(r.rules, 8).flatMap((x) => draft(x, kind === "car") ?? []) }];
      });
      return propose(`Создать карточку (${items.length})?`, items, "Предложена карточка.");
    }
    case "add_service": {
      const items: ProposalItem[] = arr(args.entries, 10).flatMap((raw) => {
        const r = rec(raw);
        const asset = findAsset(assets, r.asset);
        const title = str(r.title, 160);
        if (!asset || !title) return [];
        const date = isIso(str(r.date, 10)) ? str(r.date, 10) : ctx.today;
        const wanted = str(r.rule, 120).toLowerCase();
        // A short or vague name must not reset every rule that happens to contain it.
        const rules = wanted.length >= 3 ? asset.rules.filter((x) => x.title.toLowerCase().includes(wanted) || wanted.includes(x.title.toLowerCase())) : [];
        const km = asset.kind === "car" ? cleanNumber(r.km) : undefined;
        const cost = cleanNumber(r.cost, 100_000_000);
        return [
          {
            op: "service" as const,
            key: ctx.newId(),
            assetId: asset.id,
            assetName: asset.name,
            title,
            date,
            km: km ?? null,
            cost: cost ?? null,
            place: str(r.place, 120),
            note: str(r.note, 1000),
            ruleIds: rules.map((x) => x.id),
            ruleNames: rules.map((x) => x.title),
          },
        ];
      });
      return propose(`Добавить запись в историю (${items.length})?`, items, "Предложена запись.");
    }
    case "create_rule": {
      const items: ProposalItem[] = arr(args.rules, 10).flatMap((raw) => {
        const asset = findAsset(assets, rec(raw).asset);
        const rule = asset ? draft(raw, asset.kind === "car") : null;
        return asset && rule ? [{ op: "rule" as const, key: ctx.newId(), assetId: asset.id, assetName: asset.name, rule }] : [];
      });
      return propose(`Добавить правило (${items.length})?`, items, "Предложено правило.");
    }
    case "set_mileage": {
      const asset = findAsset(assets, args.asset);
      const km = cleanNumber(args.km);
      if (!asset || asset.kind !== "car" || km === undefined) return fail("Нужна карточка автомобиля и пробег числом.");
      return propose(`Обновить пробег: ${asset.name}?`, [{ op: "mileage", key: ctx.newId(), assetId: asset.id, assetName: asset.name, km, was: asset.km }], "Предложен пробег.");
    }
  }
  return null;
}

export { groupKm, ruleLine };
