import { useMemo, useRef, useState } from "react";
import { ChevronRight, Paperclip, Plus } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { FieldLabel } from "@/components/ui/hint";
import { cn } from "@/lib/cn";
import { formatShortDay, todayIso } from "@/lib/dates";
import { deleteFile } from "@/lib/attachments/runtime";
import { money } from "@/lib/maintenance/stats";
import { ageText, DEFAULT_WARN_DAYS, totalInvested, warrantyState, warrantyUntil } from "@/lib/maintenance/warranty";
import { usePlanner } from "@/lib/planner-store";
import type { Asset, TechPart } from "@/lib/planner-types";
import { AssetObjects } from "./objects";
import { Seg, WarrBadge, field, newId, smallLabel } from "./shared";
import { warrInput, warrModeOf, type WarrMode } from "./form-helpers";

const day = (iso: string) => `${formatShortDay(iso)} ${iso.slice(0, 4)}`;

/** «Гарантия»: N months from the purchase, until a date, or none. */
export function WarrantyPicker({ mode, months, until, boughtAt, onChange }: { mode: WarrMode; months: string; until: string; boughtAt: string; onChange: (v: { mode: WarrMode; months: string; until: string }) => void }) {
  const end = warrantyUntil({ boughtAt: boughtAt || null, warrantyMonths: mode === "months" ? Number(months.replace(",", ".")) || null : null, warrantyUntil: mode === "until" ? until || null : null });
  return (
    <div>
      <FieldLabel hint="Срок можно задать числом месяцев от даты покупки или конкретной датой — как написано в гарантийном талоне. За месяц до конца Пора создаст задачу-напоминание.">Гарантия</FieldLabel>
      <Seg
        label="Срок гарантии"
        value={mode}
        onChange={(m) => onChange({ mode: m, months, until })}
        options={[
          { id: "months", label: "Месяцев" },
          { id: "until", label: "До даты" },
          { id: "none", label: "Нет" },
        ]}
      />
      {mode === "months" ? (
        <div className="mt-1.5 flex items-center gap-2">
          <input inputMode="numeric" aria-label="Гарантия, месяцев" value={months} onChange={(e) => onChange({ mode, months: e.target.value, until })} placeholder="36" className={cn(field, "w-24 flex-none")} />
          <span className="text-xs text-muted">{end ? `до ${day(end)}` : boughtAt ? "мес." : "мес. — укажите дату покупки"}</span>
        </div>
      ) : null}
      {mode === "until" ? <input type="date" aria-label="Гарантия до" value={until} onChange={(e) => onChange({ mode, months, until: e.target.value })} className={cn(field, "mt-1.5 text-left")} /> : null}
    </div>
  );
}

const PART_NAMES = ["Процессор", "Видеокарта", "Память", "Диск", "Материнская плата", "Блок питания", "Кулер", "Корпус"];

/** Tech cards: the item's own purchase facts, then its components. */
export function TechBlock({ asset }: { asset: Asset }) {
  const today = todayIso();
  const [sheet, setSheet] = useState<TechPart | "new" | null>(null);
  const soon = asset.warnDays ?? DEFAULT_WARN_DAYS;
  const own = warrantyState(asset, today, soon);
  const parts = asset.parts ?? [];
  const invested = totalInvested(asset);
  const hasFacts = asset.boughtAt || asset.price || own.status !== "none" || asset.serial;
  const age = ageText(asset.boughtAt, today);
  return (
    <>
      {hasFacts ? (
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-xl bg-elevated p-3 text-[0.9375rem]" aria-label="Покупка и гарантия">
          {asset.boughtAt ? (
            <>
              <dt className="text-muted">Куплено</dt>
              <dd>
                {day(asset.boughtAt)}
                {age ? <span className="text-xs text-subtle"> · {age}</span> : null}
              </dd>
            </>
          ) : null}
          {asset.price ? (
            <>
              <dt className="text-muted">Цена</dt>
              <dd className="tabular-nums">{money(asset.price)}</dd>
            </>
          ) : null}
          <dt className="text-muted">Гарантия</dt>
          <dd>
            <WarrBadge state={own} />
          </dd>
          {asset.serial ? (
            <>
              <dt className="text-muted">Серийный №</dt>
              <dd className="break-all">{asset.serial}</dd>
            </>
          ) : null}
        </dl>
      ) : null}

      <section className="mt-4" aria-label="Компоненты">
        <div className="flex items-center">
          <FieldLabel hint="Для компьютера и другой сборной техники: у каждой детали своя дата покупки, цена, гарантия и чек. Простой технике (пылесос, монитор) компоненты не нужны — достаточно самой карточки." className="flex-1">
            Компоненты
          </FieldLabel>
          <button type="button" onClick={() => setSheet("new")} className="-my-2 flex h-11 items-center gap-1 px-1 text-[0.8125rem] font-medium text-accent">
            <Plus className="size-3.5" aria-hidden="true" />
            Компонент
          </button>
        </div>
        {parts.length ? (
          <>
            <ul className="space-y-1.5">
              {parts.map((p) => {
                const st = warrantyState({ boughtAt: p.boughtAt ?? asset.boughtAt, ...p }, today, soon);
                const files = [asset.attachments, asset.links, asset.contacts].reduce((n, list) => n + (list ?? []).filter((a) => a.entryId === p.id).length, 0);
                return (
                  <li key={p.id}>
                    <button type="button" onClick={() => setSheet(p)} className="flex w-full items-center gap-2 rounded-xl bg-elevated px-3 py-2.5 text-left">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[0.9375rem] font-semibold">{p.name}</span>
                        <span className="block truncate text-xs text-subtle">
                          {[p.boughtAt ? day(p.boughtAt) : null, p.price ? money(p.price) : null].filter(Boolean).join(" · ") || "без даты и цены"}
                          {files ? (
                            <span className="ml-1 inline-flex items-center gap-0.5">
                              · <Paperclip className="size-3" aria-hidden="true" />
                              {files}
                            </span>
                          ) : null}
                        </span>
                      </span>
                      <WarrBadge state={st} short />
                      <ChevronRight className="size-4 shrink-0 text-subtle" aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ul>
            {invested > 0 ? <p className="mt-1.5 px-1 text-xs text-muted">Вложено всего: {money(invested)}</p> : null}
          </>
        ) : (
          <p className="rounded-xl border border-dashed border-line px-3 py-3 text-[0.8125rem] text-muted">Компонентов нет — для простой техники так и надо. Для компьютера добавьте, например, «Видеокарта, 58 900 ₽, гарантия 36 мес.» и фото чека.</p>
        )}
      </section>
      {sheet ? <PartSheet key={sheet === "new" ? "new" : sheet.id} asset={asset} part={sheet === "new" ? null : sheet} onClose={() => setSheet(null)} /> : null}
    </>
  );
}

export function PartSheet({ asset, part, onClose }: { asset: Asset; part: TechPart | null; onClose: () => void }) {
  const add = usePlanner((s) => s.addAssetPart);
  const update = usePlanner((s) => s.updateAssetPart);
  const remove = usePlanner((s) => s.deleteAssetPart);
  const addAsset = usePlanner((s) => s.addAsset);
  const discardChildren = usePlanner((s) => s.discardAssetChildren);
  const fresh = useRef(newId()).current;
  const id = part?.id ?? fresh;
  const [kind, setKind] = useState<"part" | "item">("part");
  const [name, setName] = useState(part?.name ?? "");
  const [boughtAt, setBoughtAt] = useState(part?.boughtAt ?? "");
  const [price, setPrice] = useState(part?.price ? String(part.price) : "");
  const [warr, setWarr] = useState<{ mode: WarrMode; months: string; until: string }>({ mode: part ? warrModeOf(part) : "months", months: part?.warrantyMonths ? String(part.warrantyMonths) : "", until: part?.warrantyUntil ?? "" });
  const [more, setMore] = useState(Boolean(part?.serial));
  const [serial, setSerial] = useState(part?.serial ?? "");
  const [confirm, setConfirm] = useState(false);
  const files = useMemo(() => (asset.attachments ?? []).filter((a) => a.entryId === id), [asset.attachments, id]);
  const ok = name.trim().length > 0;
  const discard = () => {
    if (!part) {
      for (const f of files) void deleteFile({ kind: "asset", id: asset.id }, f.id);
      discardChildren(asset.id, id);
    }
    onClose();
  };
  const save = () => {
    if (!ok) return;
    const fields = { name, boughtAt: boughtAt || null, price, serial, ...warrInput(warr.mode, warr.months, warr.until) };
    if (part) {
      if (!update(asset.id, part.id, fields)) return;
    } else if (kind === "item") {
      // A separate item, not a component: its own card in the list.
      if (!addAsset({ name, kind: "device", boughtAt: boughtAt || null, price, serial, ...warrInput(warr.mode, warr.months, warr.until) })) return;
    } else if (!add(asset.id, { id, ...fields })) return;
    onClose();
  };
  const sep = !part && kind === "item";
  return (
    <Sheet open title={part ? "Компонент: изменить" : "Новый компонент"} onClose={discard} action={{ label: "Готово", onClick: save, disabled: !ok }}>
      <div className="space-y-2">
        {!part ? (
          <Seg
            label="Что добавить"
            value={kind}
            onChange={setKind}
            options={[
              { id: "part", label: "Компонент ПК" },
              { id: "item", label: "Отдельная техника" },
            ]}
          />
        ) : null}
        <input autoFocus={!part} value={name} onChange={(e) => setName(e.target.value)} placeholder={sep ? "Название — например, Монитор" : "Название — например, Видеокарта"} aria-label="Название" maxLength={80} className={field} />
        {!part && !sep ? (
          <div className="flex flex-wrap gap-1.5" aria-label="Быстрый выбор">
            {PART_NAMES.filter((n) => !(asset.parts ?? []).some((p) => p.name === n)).map((n) => (
              <button key={n} type="button" onClick={() => setName(n)} className={cn("h-8 rounded-full border px-3 text-[0.8125rem]", name === n ? "border-accent bg-accent text-accent-fg" : "border-line text-muted")}>
                {n}
              </button>
            ))}
          </div>
        ) : null}
        <div className="flex gap-2">
          <label className="block min-w-0 flex-1">
            <span className={smallLabel}>Куплено</span>
            <input type="date" aria-label="Дата покупки" value={boughtAt} onChange={(e) => setBoughtAt(e.target.value)} className={cn(field, "min-w-0 text-left")} />
          </label>
          <label className="block min-w-0 flex-1">
            <span className={smallLabel}>Цена, ₽</span>
            <input inputMode="decimal" aria-label="Цена, ₽" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="необязательно" className={field} />
          </label>
        </div>
        <WarrantyPicker {...warr} boughtAt={boughtAt || asset.boughtAt || ""} onChange={setWarr} />
        {more ? (
          <label className="block">
            <span className={smallLabel}>Серийный номер</span>
            <input value={serial} onChange={(e) => setSerial(e.target.value)} aria-label="Серийный номер" maxLength={80} className={field} />
          </label>
        ) : (
          <button type="button" onClick={() => setMore(true)} className="h-9 px-1 text-[0.8125rem] text-accent">
            Ещё: серийный номер
          </button>
        )}
        {sep ? (
          <p className="px-1 text-xs text-muted">Появится отдельной карточкой в «Технике». Чек и гарантийный талон прикрепите там.</p>
        ) : (
          <AssetObjects asset={asset} parentId={id} label="Чек, гарантийный талон, ссылка" />
        )}
        {part ? (
          <div className="pt-2">
            {confirm ? (
              <div className="flex gap-2">
                <Button variant="soft" className="flex-1" onClick={() => setConfirm(false)}>
                  Отменить
                </Button>
                <Button
                  variant="destructive"
                  className="flex-1"
                  onClick={async () => {
                    for (const f of files) await deleteFile({ kind: "asset", id: asset.id }, f.id);
                    remove(asset.id, part.id);
                    onClose();
                  }}
                >
                  Удалить компонент
                </Button>
              </div>
            ) : (
              <Button variant="soft" className="w-full text-danger" onClick={() => setConfirm(true)}>
                Удалить компонент
              </Button>
            )}
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}

