import { useState } from "react";
import { ChevronRight, Plus } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { FieldLabel } from "@/components/ui/hint";
import { cn } from "@/lib/cn";
import { formatShortDay, todayIso } from "@/lib/dates";
import { fuelStats, liters, ownership, rub1, sortFills, spendTotal } from "@/lib/maintenance/fuel";
import { cleanNumber } from "@/lib/maintenance/ops";
import { groupKm } from "@/lib/maintenance/rules";
import { money } from "@/lib/maintenance/stats";
import { usePlanner } from "@/lib/planner-store";
import type { Asset, FuelFill } from "@/lib/planner-types";
import { field, smallLabel } from "./shared";

import { SPEND_COLORS } from "./form-helpers";

export function SpendBar({ spend }: { spend: { fuel: number; service: number; ins: number } }) {
  const total = spendTotal(spend) || 1;
  return (
    <div className="flex h-2 overflow-hidden rounded-full bg-line" aria-hidden="true">
      {(["fuel", "service", "ins"] as const).map((k) => (spend[k] > 0 ? <i key={k} className="block h-full" style={{ width: `${(spend[k] / total) * 100}%`, background: SPEND_COLORS[k] }} /> : null))}
    </div>
  );
}

export function SpendLegend({ spend }: { spend: { fuel: number; service: number; ins: number } }) {
  const items = [
    ["fuel", "Топливо"],
    ["service", "Обслуживание"],
    ["ins", "Страховка и налог"],
  ] as const;
  return (
    <ul className="mt-2 space-y-1 text-[0.8125rem]">
      {items.map(([k, name]) => (
        <li key={k} className="flex items-center gap-2">
          <i className="size-2.5 shrink-0 rounded-sm" style={{ background: SPEND_COLORS[k] }} aria-hidden="true" />
          <span className="flex-1 text-muted">{name}</span>
          <span className="font-semibold tabular-nums">{money(spend[k])}</span>
        </li>
      ))}
    </ul>
  );
}

function Tile({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="min-w-0 flex-1 rounded-xl bg-elevated px-3 py-2">
      <p className="truncate text-[0.6875rem] text-muted">{label}</p>
      <p className="text-[1.0625rem] leading-tight font-bold tabular-nums">
        {value}
        <span className="ml-1 text-[0.6875rem] font-medium text-subtle">{unit}</span>
      </p>
    </div>
  );
}

const fmt1 = (n: number) => n.toLocaleString("ru-RU", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).replace(/\u00a0|\u202f/g, " ");

function fillLine(f: FuelFill): string {
  return [`${formatShortDay(f.date)}${f.date.slice(0, 4) !== String(new Date().getFullYear()) ? ` ${f.date.slice(0, 4)}` : ""}`, f.km != null ? `${groupKm(f.km)} км` : null, f.liters > 0 && f.sum > 0 ? `${fmt1(f.sum / f.liters)} ₽/л` : null, f.full === false ? "частично" : null].filter(Boolean).join(" · ");
}

/** Cars: fuel — consumption tiles, quick add, the list of fill-ups. */
export function FuelBlock({ asset }: { asset: Asset }) {
  const add = usePlanner((s) => s.addAssetFuel);
  const [sheet, setSheet] = useState<FuelFill | "new" | null>(null);
  const [l, setL] = useState("");
  const [sum, setSum] = useState("");
  const [km, setKm] = useState("");
  const [all, setAll] = useState(false);
  const fills = sortFills(asset.fuel ?? []).reverse();
  const stats = fuelStats(asset.fuel ?? []);
  const year = todayIso().slice(0, 4);
  const own = ownership(asset, year);
  const can = cleanNumber(l, 1000) !== undefined && Number(String(l).replace(",", ".").replace(/\s/g, "")) > 0;
  const quick = () => {
    if (!can) return;
    if (!add(asset.id, { date: todayIso(), liters: l, sum, km })) return;
    setL("");
    setSum("");
    setKm("");
  };
  const shown = all ? fills : fills.slice(0, 3);
  return (
    <section className="mt-4" aria-label="Заправки">
      <div className="flex items-center">
        <FieldLabel hint="Расход считается между двумя полными баками с пробегом: сколько литров ушло на пройденные километры. Неполная заправка не обрывает отрезок — её литры просто прибавляются. Пробег и сумму можно не указывать: тогда заправка попадёт только в расходы." className="flex-1">
          Заправки
        </FieldLabel>
        <button type="button" onClick={() => setSheet("new")} className="-my-2 flex h-11 items-center gap-1 px-1 text-[0.8125rem] font-medium text-accent">
          <Plus className="size-3.5" aria-hidden="true" />
          Заправка
        </button>
      </div>
      <div className="flex gap-2">
        <Tile label="Средний расход" value={stats.per100 !== null ? fmt1(stats.per100) : "—"} unit="л/100 км" />
        <Tile label="Топливо на км" value={stats.perKm !== null ? fmt1(stats.perKm) : "—"} unit="₽" />
        <Tile label={`Всё на км, ${year}`} value={own.perKm !== null ? fmt1(own.perKm) : "—"} unit="₽" />
      </div>
      {stats.per100 === null ? <p className="mt-2 px-1 text-xs text-muted">Расход появится после двух полных заправок с пробегом.</p> : <p className="mt-2 px-1 text-xs text-subtle">по {stats.stretches} {stats.stretches === 1 ? "отрезку" : "отрезкам"} между полными баками · {groupKm(Math.round(stats.km))} км</p>}
      <form
        className="mt-2 flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          quick();
        }}
      >
        <input inputMode="decimal" value={l} onChange={(e) => setL(e.target.value)} placeholder="литры" aria-label="Литры" className={cn(field, "min-w-0 flex-1 px-3")} />
        <input inputMode="decimal" value={sum} onChange={(e) => setSum(e.target.value)} placeholder="сумма ₽" aria-label="Сумма заправки" className={cn(field, "min-w-0 flex-1 px-3")} />
        <input inputMode="numeric" value={km} onChange={(e) => setKm(e.target.value)} placeholder={asset.km ? `${groupKm(asset.km)} км` : "пробег"} aria-label="Пробег заправки" className={cn(field, "min-w-0 flex-1 px-3")} />
        <Button type="submit" variant="primary" disabled={!can} aria-label="Добавить заправку" className="size-11 shrink-0 px-0">
          <Plus className="size-5" aria-hidden="true" />
        </Button>
      </form>
      {fills.length ? (
        <>
          <ul className="mt-2 space-y-2">
            {shown.map((f) => (
              <li key={f.id}>
                <button type="button" onClick={() => setSheet(f)} className="flex w-full items-center gap-2 rounded-xl bg-elevated px-3 py-2 text-left">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.9375rem] font-semibold tabular-nums">
                      {liters(f.liters)} л{f.sum > 0 ? <span className="ml-2 font-normal text-muted">{money(f.sum)}</span> : null}
                    </span>
                    <span className="block truncate text-xs text-subtle">{fillLine(f)}</span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-subtle" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
          {fills.length > 3 ? (
            <button type="button" onClick={() => setAll(!all)} className="mt-1 h-9 px-1 text-[0.8125rem] text-accent">
              {all ? "Свернуть" : `Все заправки (${fills.length})`}
            </button>
          ) : null}
        </>
      ) : (
        <p className="mt-2 rounded-xl border border-dashed border-line px-3 py-3 text-[0.8125rem] text-muted">Заправок пока нет. Например: «41,2 л, 2 380 ₽, пробег 84 300» — впишите выше и нажмите «＋».</p>
      )}
      {sheet ? <FuelSheet key={sheet === "new" ? "new" : sheet.id} asset={asset} fill={sheet === "new" ? null : sheet} onClose={() => setSheet(null)} /> : null}
    </section>
  );
}

export function FuelSheet({ asset, fill, onClose }: { asset: Asset; fill: FuelFill | null; onClose: () => void }) {
  const add = usePlanner((s) => s.addAssetFuel);
  const update = usePlanner((s) => s.updateAssetFuel);
  const remove = usePlanner((s) => s.deleteAssetFuel);
  const [date, setDate] = useState(fill?.date ?? todayIso());
  const [l, setL] = useState(fill ? String(fill.liters).replace(".", ",") : "");
  const [sum, setSum] = useState(fill?.sum ? String(fill.sum).replace(".", ",") : "");
  const [km, setKm] = useState(fill?.km != null ? String(fill.km) : "");
  const [full, setFull] = useState(fill?.full !== false);
  const [place, setPlace] = useState(fill?.place ?? "");
  const [confirm, setConfirm] = useState(false);
  const num = (v: string) => Number(v.replace(",", ".").replace(/\s/g, ""));
  const lit = num(l);
  const ok = Number.isFinite(lit) && lit > 0;
  const price = ok && num(sum) > 0 ? num(sum) / lit : null;
  const save = () => {
    if (!ok) return;
    const input = { date, liters: l, sum, km, full, place };
    if (fill ? update(asset.id, fill.id, input) : add(asset.id, input)) onClose();
  };
  return (
    <Sheet open title={fill ? "Заправка: изменить" : "Заправка"} onClose={onClose} action={{ label: "Готово", onClick: save, disabled: !ok }}>
      <div className="space-y-2">
        <div className="flex gap-2">
          <label className="block min-w-0 flex-1">
            <span className={smallLabel}>Дата</span>
            <input type="date" aria-label="Дата" value={date} onChange={(e) => setDate(e.target.value)} className={cn(field, "min-w-0 text-left")} />
          </label>
          <label className="block min-w-0 flex-1">
            <span className={smallLabel}>Пробег, км</span>
            <input inputMode="numeric" aria-label="Пробег, км" value={km} onChange={(e) => setKm(e.target.value)} placeholder={asset.km ? groupKm(asset.km) : "необязательно"} className={field} />
          </label>
        </div>
        <div className="flex gap-2">
          <label className="block min-w-0 flex-1">
            <span className={smallLabel}>Литры</span>
            <input autoFocus={!fill} inputMode="decimal" aria-label="Литры" value={l} onChange={(e) => setL(e.target.value)} placeholder="41,2" className={field} />
          </label>
          <label className="block min-w-0 flex-1">
            <span className={smallLabel}>Сумма, ₽</span>
            <input inputMode="decimal" aria-label="Сумма, ₽" value={sum} onChange={(e) => setSum(e.target.value)} placeholder="2 380" className={field} />
          </label>
        </div>
        {price !== null ? <p className="px-1 text-xs text-muted">≈ {rub1(price)} за литр</p> : null}
        <label className="flex min-h-11 items-center gap-3 rounded-xl bg-elevated px-3 text-[0.9375rem]">
          <span className="flex-1">
            Полный бак
            <span className="block text-xs text-subtle">снимите галочку, если долили не до отсечки</span>
          </span>
          <input type="checkbox" checked={full} onChange={(e) => setFull(e.target.checked)} aria-label="Полный бак" className="size-5 shrink-0 accent-[var(--accent)]" />
        </label>
        <input value={place} onChange={(e) => setPlace(e.target.value)} placeholder="Где — необязательно" aria-label="Где заправка" maxLength={120} className={field} />
        {fill ? (
          <div className="pt-2">
            {confirm ? (
              <div className="flex gap-2">
                <Button variant="soft" className="flex-1" onClick={() => setConfirm(false)}>
                  Отменить
                </Button>
                <Button
                  variant="destructive"
                  className="flex-1"
                  onClick={() => {
                    remove(asset.id, fill.id);
                    onClose();
                  }}
                >
                  Удалить заправку
                </Button>
              </div>
            ) : (
              <Button variant="soft" className="w-full text-danger" onClick={() => setConfirm(true)}>
                Удалить заправку
              </Button>
            )}
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}

/** «Всего на машину в 2026»: the whole cost of ownership of a year. */
export function OwnershipBlock({ asset }: { asset: Asset }) {
  const years = [...new Set([...(asset.fuel ?? []).map((f) => f.date.slice(0, 4)), ...asset.log.filter((e) => e.cost).map((e) => e.date.slice(0, 4)), todayIso().slice(0, 4)])].sort().reverse();
  const [year, setYear] = useState(years[0]!);
  const own = ownership(asset, year);
  if (own.total <= 0) return null;
  return (
    <section className="mt-4 rounded-xl bg-elevated px-4 py-3" aria-label="Всего на машину">
      <div className="flex items-center gap-2">
        <FieldLabel hint="Топливо + обслуживание + страховка и налоги за год. ₽ на км — всё это, делённое на пройденные за год километры по обновлениям пробега." className="flex-1">
          Всего на машину
        </FieldLabel>
        {years.length > 1 ? (
          <select value={year} onChange={(e) => setYear(e.target.value)} aria-label="Год" className="h-8 rounded-lg bg-surface px-2 text-[0.8125rem]">
            {years.map((y) => (
              <option key={y}>{y}</option>
            ))}
          </select>
        ) : (
          <span className="text-xs text-subtle">{year}</span>
        )}
      </div>
      <p className="mt-1 text-[1.5rem] leading-tight font-bold tabular-nums">{money(own.total)}</p>
      <p className="mb-2 text-xs text-subtle">{own.perKm !== null ? `≈ ${fmt1(own.perKm)} ₽ на км · ${groupKm(own.km)} км за год` : "₽ на км появится, когда будут обновления пробега за этот год"}</p>
      <SpendBar spend={own.spend} />
      <SpendLegend spend={own.spend} />
    </section>
  );
}
