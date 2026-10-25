import { useState } from "react";
import { ChevronLeft } from "lucide-react";
import { FieldLabel } from "@/components/ui/hint";
import { cn } from "@/lib/cn";
import { todayIso } from "@/lib/dates";
import { groupKm } from "@/lib/maintenance/rules";
import { fuelStats, ownership, spendSplit, spendTotal } from "@/lib/maintenance/fuel";
import { kmPerMonth, money } from "@/lib/maintenance/stats";
import type { Asset } from "@/lib/planner-types";
import { SpendBar, SpendLegend } from "./fuel-ui";
import { SPEND_COLORS } from "./form-helpers";
import { MONTHS_FULL, MONTHS_SHORT, Seg } from "./shared";
import { TechStats } from "./tech-stats";


function KmChart({ asset, currentMonth }: { asset: Asset; currentMonth: string }) {
  const months = kmPerMonth(asset.readings ?? []).slice(-8);
  if (!months.length) return <p className="rounded-xl bg-elevated px-3 py-3 text-[0.8125rem] text-muted">Нужно хотя бы два обновления пробега в разные месяцы — тогда появится график.</p>;
  const max = Math.max(1, ...months.map((m) => m.km));
  const last = months[months.length - 1]!;
  const prev = months[months.length - 2];
  const running = last.month === currentMonth;
  const delta = !running && prev && !prev.estimated && !last.estimated && prev.km > 0 ? Math.round(((last.km - prev.km) / prev.km) * 100) : null;
  const span = Math.max(...months.filter((m) => m.estimated).map((m) => m.spanMonths), 0);
  const name = (m: string) => MONTHS_FULL[Number(m.slice(5)) - 1]!;
  return (
    <>
      <div className="rounded-xl bg-elevated px-3 pt-2 pb-3">
        <div className="flex h-[7.5rem] items-end gap-2" role="img" aria-label={`Километры по месяцам: ${months.map((m) => `${name(m.month)} ${m.estimated ? "≈ " : ""}${m.km}`).join(", ")}`}>
          {months.map((m) => (
            <div key={m.month} className="flex h-full min-w-0 flex-1 flex-col justify-end text-center text-[0.625rem] text-subtle" title={`${name(m.month)}: ${m.estimated ? "≈ " : ""}${groupKm(m.km)} км${m.spanMonths > 1 ? ` (за ${m.spanMonths} мес.)` : ""}`}>
              <span className="mb-1 tabular-nums">{groupKm(m.km)}</span>
              <i
                className={cn("block rounded-t", m.estimated ? "border border-line" : "bg-accent")}
                style={{
                  height: `${Math.max(4, Math.round((m.km / max) * 72))}px`,
                  ...(m.estimated ? { backgroundImage: "repeating-linear-gradient(45deg, var(--line) 0 4px, transparent 4px 8px)" } : {}),
                }}
              />
              <span className="mt-1">{MONTHS_SHORT[Number(m.month.slice(5)) - 1]}</span>
            </div>
          ))}
        </div>
        {span > 1 ? <p className="mt-2 text-xs text-muted">Штрих — в эти месяцы пробег не обновляли: цифра — среднее за {span} мес. между двумя обновлениями.</p> : span === 1 ? <p className="mt-2 text-xs text-muted">Штрих — в этом месяце пробег не обновляли, цифра примерная.</p> : null}
      </div>
      <div className="mt-2 flex items-center gap-3 rounded-xl bg-elevated px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted">{name(last.month)}{running ? " · месяц ещё идёт" : last.spanMonths > 1 ? ` · за ${last.spanMonths} мес.` : ""}</p>
          <p className="text-[0.9375rem] font-semibold tabular-nums">{last.estimated ? "≈ " : ""}{groupKm(last.km)} км</p>
        </div>
        {delta !== null && prev ? <span className={cn("rounded-full px-2 py-1 text-[0.6875rem] font-semibold", delta > 0 ? "bg-warn/15 text-warn" : "bg-ok/15 text-ok")}>{delta > 0 ? "+" : ""}{delta}% к прошлому месяцу</span> : null}
      </div>
    </>
  );
}

const fmt1 = (n: number) => n.toLocaleString("ru-RU", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).replace(/\u00a0|\u202f/g, " ");

function monthsBack(n: number, from: string): string[] {
  const out: string[] = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  for (let i = 0; i < n; i++) {
    out.unshift(`${y}-${String(m).padStart(2, "0")}`);
    m--;
    if (m === 0) {
      m = 12;
      y--;
    }
  }
  return out;
}

/** Cars only: money per month and per year (fuel / maintenance / insurance), consumption and ₽ per km. */
function CarMoney({ car }: { car: Asset }) {
  const { byMonth, byYear } = spendSplit(car);
  const years = Object.keys(byYear).sort().reverse();
  const [year, setYear] = useState<string | null>(null);
  const picked = year && years.includes(year) ? year : years[0];
  if (!picked) {
    return (
      <section className="mt-5">
        <FieldLabel className="mb-1">Расходы на машину</FieldLabel>
        <p className="rounded-xl bg-elevated px-3 py-3 text-[0.8125rem] text-muted">Добавьте заправки и стоимость записей истории — здесь появятся расходы по месяцам и годам, расход топлива и ₽ на км.</p>
      </section>
    );
  }
  const months = monthsBack(8, todayIso().slice(0, 7));
  const maxMonth = Math.max(1, ...months.map((m) => spendTotal(byMonth[m] ?? { fuel: 0, service: 0, ins: 0 })));
  const own = ownership(car, picked);
  const fuel = fuelStats(car.fuel ?? [], { from: `${picked}-01-01`, to: `${picked}-12-31` });
  const maxYear = Math.max(1, ...years.map((y) => spendTotal(byYear[y]!)));
  return (
    <>
      <section className="mt-5">
        <FieldLabel hint="Топливо — по заправкам, обслуживание и страховка/налоги — по записям истории с суммой. Каждая запись считается в месяц своей даты." className="mb-1">
          Расходы по месяцам
        </FieldLabel>
        <div className="rounded-xl bg-elevated px-3 pt-2 pb-3">
          <div className="flex h-[7.5rem] items-end gap-2" role="img" aria-label={`Расходы по месяцам: ${months.map((m) => `${MONTHS_FULL[Number(m.slice(5)) - 1]} ${money(spendTotal(byMonth[m] ?? { fuel: 0, service: 0, ins: 0 }))}`).join(", ")}`}>
            {months.map((m) => {
              const row = byMonth[m] ?? { fuel: 0, service: 0, ins: 0 };
              const total = spendTotal(row);
              const h = Math.round((total / maxMonth) * 84);
              return (
                <div key={m} className="flex h-full min-w-0 flex-1 flex-col justify-end text-center text-[0.625rem] text-subtle">
                  <span className="mb-1 truncate tabular-nums">{total ? (Math.round(total / 100) / 10).toLocaleString("ru-RU") : ""}</span>
                  <div className="flex flex-col-reverse overflow-hidden rounded-t" style={{ height: `${total ? Math.max(4, h) : 0}px` }}>
                    {(["fuel", "service", "ins"] as const).map((k) => (row[k] > 0 ? <i key={k} className="block w-full" style={{ height: `${(row[k] / total) * 100}%`, background: SPEND_COLORS[k] }} /> : null))}
                  </div>
                  <span className="mt-1">{MONTHS_SHORT[Number(m.slice(5)) - 1]}</span>
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-muted">Цифры над столбиками — тысячи ₽.</p>
        </div>
      </section>
      <section className="mt-5">
        <FieldLabel hint="Итог года — всё, что потрачено на машину. ₽ на км — итог, делённый на километры за год по обновлениям пробега." className="mb-1">
          Расходы по годам
        </FieldLabel>
        <ul className="space-y-2">
          {years.map((y) => {
            const sp = byYear[y]!;
            const o = ownership(car, y);
            return (
              <li key={y}>
                <button type="button" onClick={() => setYear(y)} aria-pressed={y === picked} className={cn("w-full rounded-xl bg-elevated px-3 py-2 text-left", y === picked && "ring-1 ring-accent")}>
                  <span className="flex items-baseline justify-between font-semibold">
                    <span>{y}</span>
                    <span className="tabular-nums">{money(spendTotal(sp))}</span>
                  </span>
                  <span className="mt-2 block" style={{ width: `${Math.round((spendTotal(sp) / maxYear) * 100)}%` }}>
                    <SpendBar spend={sp} />
                  </span>
                  <span className="mt-1 block text-xs text-subtle">{o.perKm !== null ? `≈ ${fmt1(o.perKm)} ₽ на км · ${groupKm(o.km)} км` : "км за год неизвестны"}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="mt-2 rounded-xl bg-elevated px-3 py-2">
          <p className="text-xs font-medium text-subtle">{picked}: из чего состоит</p>
          <SpendLegend spend={own.spend} />
          <div className="mt-2 flex gap-4 border-t border-line pt-2 text-[0.8125rem]">
            <span className="text-muted">
              Расход <b className="font-semibold text-fg tabular-nums">{fuel.per100 !== null ? `${fmt1(fuel.per100)} л/100 км` : "—"}</b>
            </span>
            <span className="text-muted">
              Топливо на км <b className="font-semibold text-fg tabular-nums">{fuel.perKm !== null ? `${fmt1(fuel.perKm)} ₽` : "—"}</b>
            </span>
          </div>
        </div>
      </section>
    </>
  );
}

function AutoStats({ cars }: { cars: Asset[] }) {
  const [carId, setCarId] = useState<string | null>(null);
  const car = cars.find((c) => c.id === carId) ?? cars.find((c) => (c.readings?.length ?? 0) >= 2) ?? cars[0];
  if (!car) return <p className="rounded-xl bg-elevated px-3 py-3 text-[0.8125rem] text-muted">Добавьте автомобиль — здесь появятся километры по месяцам, расход топлива и расходы на машину.</p>;
  return (
    <>
      <section>
        <FieldLabel hint="Считается по обновлениям пробега. Если пробег не обновляли несколько месяцев, цифры за эти месяцы примерные — они заштрихованы и подписаны «за N мес.»." className="mb-1">
          Километры по месяцам
        </FieldLabel>
        {cars.length > 1 ? (
          <div className="flex flex-wrap gap-2 pb-2">
            {cars.map((c) => (
              <button key={c.id} type="button" aria-pressed={c.id === car.id} onClick={() => setCarId(c.id)} className={cn("h-8 rounded-full border px-3 text-[0.8125rem]", c.id === car.id ? "border-accent bg-accent text-accent-fg" : "border-line text-muted")}>
                {c.name}
              </button>
            ))}
          </div>
        ) : (
          <p className="px-1 pb-1 text-[0.8125rem] text-muted">{car.name}</p>
        )}
        <KmChart asset={car} currentMonth={todayIso().slice(0, 7)} />
      </section>
      <CarMoney car={car} />
    </>
  );
}

export function StatsView({ assets, onBack }: { assets: Asset[]; onBack: () => void }) {
  const cars = assets.filter((a) => a.kind === "car");
  const tech = assets.filter((a) => a.kind !== "car");
  const [tab, setTab] = useState<"auto" | "tech">(cars.length || !tech.length ? "auto" : "tech");
  return (
    <div className="mx-auto w-full max-w-3xl pb-10">
      <button type="button" onClick={onBack} className="-mt-1 flex h-11 items-center gap-1 pr-3 text-sm text-muted" aria-label="Назад">
        <ChevronLeft className="size-4" aria-hidden="true" />
        Обслуживание
      </button>
      <div className="mb-3">
        <Seg
          label="Раздел статистики"
          value={tab}
          onChange={setTab}
          options={[
            { id: "auto", label: "Авто" },
            { id: "tech", label: "Техника" },
          ]}
        />
      </div>
      {tab === "auto" ? <AutoStats cars={cars} /> : <TechStats assets={tech} />}
    </div>
  );
}
