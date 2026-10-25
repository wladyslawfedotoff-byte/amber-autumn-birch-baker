import { FieldLabel } from "@/components/ui/hint";
import { formatShortDay, todayIso } from "@/lib/dates";
import { money, spendByYear } from "@/lib/maintenance/stats";
import { techSummary, type WarrantyRow } from "@/lib/maintenance/warranty";
import type { Asset } from "@/lib/planner-types";
import { WarrBadge } from "./shared";

const day = (iso: string) => `${formatShortDay(iso)} ${iso.slice(0, 4)}`;

function Rows({ title, rows, hint }: { title: string; rows: WarrantyRow[]; hint?: string }) {
  if (!rows.length) return null;
  return (
    <section className="mt-4" aria-label={title}>
      <FieldLabel hint={hint} className="mb-1">
        {title} · {rows.length}
      </FieldLabel>
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={`${r.assetId}-${r.subject.id}`} className="flex items-center gap-2 rounded-card bg-card px-3 py-2">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-body font-semibold">{r.subject.part ? r.subject.part.name : r.assetName}</span>
              <span className="block truncate text-xs text-subtle">{[r.subject.part ? r.assetName : null, r.state.until ? `до ${day(r.state.until)}` : null].filter(Boolean).join(" · ")}</span>
            </span>
            <WarrBadge state={r.state} short />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Tech only: warranties, money put in, age. Cars, fuel and mileage never show up here. */
export function TechStats({ assets }: { assets: Asset[] }) {
  const s = techSummary(assets, todayIso());
  if (!assets.length) return <p className="rounded-card bg-card px-3 py-3 text-[0.8125rem] text-muted">Добавьте технику — здесь появятся гарантии, вложенные деньги и возраст. Например: «Домашний ПК», компонент «Видеокарта, 58 900 ₽, гарантия 36 мес.».</p>;
  const maxYear = Math.max(1, ...s.byYear.map(([, v]) => v));
  const service = Object.entries(spendByYear(assets.flatMap((a) => a.log))).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  const sorted = [...s.items].sort((a, b) => b.invested - a.invested).filter((i) => i.invested > 0 || i.age);
  return (
    <>
      {s.soon.length || s.active.length || s.expired.length ? null : <p className="rounded-card bg-card px-3 py-3 text-[0.8125rem] text-muted">Гарантий пока нет. Укажите срок в карточке или в компоненте — здесь будет обзор: что скоро закончится, что действует.</p>}
      <Rows title="Скоро закончатся" rows={s.soon} />
      <Rows title="Действует" rows={s.active} />
      <Rows title="Закончилась" rows={s.expired} />
      <section className="mt-5" aria-label="Вложено">
        <FieldLabel hint="Цены карточек и компонентов по году покупки. Без даты покупки компонент считается в год покупки самой техники." className="mb-1">
          Вложено в технику
        </FieldLabel>
        {s.invested > 0 ? (
          <div className="rounded-card bg-card px-4 py-3">
            <p className="text-[1.5rem] leading-tight font-bold tabular-nums">{money(s.invested)}</p>
            <ul className="mt-2 space-y-2">
              {s.byYear.map(([y, v]) => (
                <li key={y} className="flex items-center gap-2 text-[0.8125rem]">
                  <span className="w-9 shrink-0 text-muted">{y}</span>
                  <span className="h-[7px] flex-1 overflow-hidden rounded-full bg-line" aria-hidden="true">
                    <i className="block h-full rounded-full bg-accent" style={{ width: `${Math.max(2, Math.round((v / maxYear) * 100))}%` }} />
                  </span>
                  <span className="w-24 shrink-0 text-right font-semibold tabular-nums">{money(v)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="rounded-card bg-card px-3 py-3 text-[0.8125rem] text-muted">Укажите цену и дату покупки — появятся суммы по годам.</p>
        )}
      </section>
      {sorted.length ? (
        <section className="mt-5" aria-label="Возраст">
          <FieldLabel hint="Возраст — от самой ранней покупки в карточке. «≈ в год» — вложенное, делённое на возраст (не меньше года)." className="mb-1">
            Возраст и цена владения
          </FieldLabel>
          <ul className="space-y-2">
            {sorted.map((i) => (
              <li key={i.asset.id} className="flex items-center gap-2 rounded-card bg-card px-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body font-semibold">{i.asset.name}</span>
                  <span className="block truncate text-xs text-subtle">{[i.age, i.perYear ? `≈ ${money(Math.round(i.perYear))} в год` : null].filter(Boolean).join(" · ") || "без даты покупки"}</span>
                </span>
                {i.invested > 0 ? <span className="shrink-0 text-body font-semibold tabular-nums">{money(i.invested)}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {service.length ? (
        <p className="mt-4 flex items-baseline gap-2 px-1 text-[0.8125rem] text-muted">
          <span>Обслуживание (записи с ценой)</span>
          <span className="ml-auto text-right tabular-nums">{service.slice(0, 3).map(([y, v]) => `${y}: ${money(v)}`).join(" · ")}</span>
        </p>
      ) : null}
    </>
  );
}
