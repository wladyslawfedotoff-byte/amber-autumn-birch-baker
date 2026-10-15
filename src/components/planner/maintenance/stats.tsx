import { useState } from "react";
import { ChevronLeft } from "lucide-react";
import { FieldLabel } from "@/components/ui/hint";
import { cn } from "@/lib/cn";
import { todayIso } from "@/lib/dates";
import { groupKm } from "@/lib/maintenance/rules";
import { kmPerMonth, money, spendByYear } from "@/lib/maintenance/stats";
import type { Asset } from "@/lib/planner-types";
import { MONTHS_FULL, MONTHS_SHORT } from "./shared";

const label = "mb-1 px-1 text-xs font-medium text-subtle";

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
              <span className="mb-0.5 tabular-nums">{groupKm(m.km)}</span>
              <i
                className={cn("block rounded-t", m.estimated ? "border border-line" : "bg-accent")}
                style={{
                  height: `${Math.max(4, Math.round((m.km / max) * 72))}px`,
                  ...(m.estimated ? { backgroundImage: "repeating-linear-gradient(45deg, var(--line) 0 4px, transparent 4px 8px)" } : {}),
                }}
              />
              <span className="mt-0.5">{MONTHS_SHORT[Number(m.month.slice(5)) - 1]}</span>
            </div>
          ))}
        </div>
        {span > 1 ? <p className="mt-2 text-xs text-muted">Штрих — в эти месяцы пробег не обновляли: цифра — среднее за {span} мес. между двумя обновлениями.</p> : span === 1 ? <p className="mt-2 text-xs text-muted">Штрих — в этом месяце пробег не обновляли, цифра примерная.</p> : null}
      </div>
      <div className="mt-2 flex items-center gap-3 rounded-xl bg-elevated px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted">{name(last.month)}{running ? " · месяц ещё идёт" : last.spanMonths > 1 ? ` · за ${last.spanMonths} мес.` : ""}</p>
          <p className="text-[0.9375rem] font-semibold tabular-nums">{last.estimated ? "≈ " : ""}{groupKm(last.km)} км</p>
        </div>
        {delta !== null && prev ? <span className={cn("rounded-full px-2 py-0.5 text-[0.6875rem] font-semibold", delta > 0 ? "bg-warn/15 text-warn" : "bg-ok/15 text-ok")}>{delta > 0 ? "+" : ""}{delta}% к прошлому месяцу</span> : null}
      </div>
    </>
  );
}

export function StatsView({ assets, onBack }: { assets: Asset[]; onBack: () => void }) {
  const cars = assets.filter((a) => a.kind === "car");
  const [carId, setCarId] = useState<string | null>(null);
  const car = cars.find((c) => c.id === carId) ?? cars.find((c) => (c.readings?.length ?? 0) >= 2) ?? cars[0];
  const all = assets.flatMap((a) => a.log);
  const byYear = Object.entries(spendByYear(all)).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  const maxYear = Math.max(1, ...byYear.map(([, v]) => v));
  const [year, setYear] = useState<string | null>(null);
  const picked = year && byYear.some(([y]) => y === year) ? year : byYear[0]?.[0];
  const perAsset = picked
    ? assets
        .map((a) => ({ a, v: spendByYear(a.log)[picked] ?? 0 }))
        .filter((x) => x.v > 0)
        .sort((x, y) => y.v - x.v)
    : [];
  return (
    <div className="mx-auto w-full max-w-3xl pb-10">
      <button type="button" onClick={onBack} className="-mt-1 flex h-11 items-center gap-0.5 pr-3 text-sm text-muted" aria-label="Назад">
        <ChevronLeft className="size-4" aria-hidden="true" />
        Обслуживание
      </button>
      {car ? (
        <section>
          <FieldLabel hint="Считается по обновлениям пробега. Если пробег не обновляли несколько месяцев, цифры за эти месяцы примерные — они заштрихованы и подписаны «за N мес.»." className="mb-1">
            Километры по месяцам
          </FieldLabel>
          {cars.length > 1 ? (
            <div className="flex flex-wrap gap-1.5 pb-2">
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
      ) : null}
      <section className="mt-5">
        <FieldLabel hint="Сумма по записям истории с указанной стоимостью, по году записи." className="mb-1">
          Расходы на обслуживание по годам
        </FieldLabel>
        {byYear.length ? (
          <>
            <ul className="space-y-1.5">
              {byYear.map(([y, v]) => (
                <li key={y}>
                  <button type="button" onClick={() => setYear(y)} aria-pressed={y === picked} className={cn("w-full rounded-xl bg-elevated px-3 py-2 text-left", y === picked && "ring-1 ring-accent")}>
                    <span className="flex items-baseline justify-between font-semibold">
                      <span>{y}</span>
                      <span className="tabular-nums">{money(v)}</span>
                    </span>
                    <span className="mt-1.5 block h-[5px] overflow-hidden rounded-full bg-line" aria-hidden="true">
                      <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.round((v / maxYear) * 100)}%` }} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <p className={`${label} mt-4`}>{picked} по объектам</p>
            <ul className="space-y-1.5">
              {perAsset.map(({ a, v }) => (
                <li key={a.id} className="flex items-center gap-2 rounded-xl bg-elevated px-3 py-2.5 text-[0.9375rem]">
                  <span className="min-w-0 flex-1 truncate">{a.name}</span>
                  <span className="font-semibold tabular-nums">{money(v)}</span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="rounded-xl bg-elevated px-3 py-3 text-[0.8125rem] text-muted">Укажите стоимость в записях истории — здесь появятся суммы по годам и по объектам.</p>
        )}
      </section>
    </div>
  );
}
