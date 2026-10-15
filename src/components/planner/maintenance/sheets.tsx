import { useMemo, useRef, useState } from "react";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { FieldLabel, InlineHint } from "@/components/ui/hint";
import { AttachmentsBlock } from "@/components/planner/objects/attachments";
import { AssetShareBar } from "@/components/planner/sharing";
import { deleteFile } from "@/lib/attachments/runtime";
import { cn } from "@/lib/cn";
import { formatShortDay, todayIso } from "@/lib/dates";
import { KINDS, cleanNumber, guessRules, kindLabel } from "@/lib/maintenance/ops";
import { groupKm, ruleLine, type MaintRule } from "@/lib/maintenance/rules";
import { money } from "@/lib/maintenance/stats";
import { usePlanner } from "@/lib/planner-store";
import type { Asset, AssetKind, ServiceEntry } from "@/lib/planner-types";
import { MONTHS_FULL, field, newId, smallLabel } from "./shared";

function DateField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block min-w-0 flex-1">
      <span className={smallLabel}>{label}</span>
      <input type="date" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className={cn(field, "min-w-0 text-left")} />
    </label>
  );
}

function Num({ label, value, onChange, placeholder, suffix }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; suffix?: string }) {
  return (
    <label className="block min-w-0 flex-1">
      <span className={smallLabel}>{label}</span>
      <span className="relative block">
        <input inputMode="decimal" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={cn(field, suffix && "pr-10")} />
        {suffix ? <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-subtle">{suffix}</span> : null}
      </span>
    </label>
  );
}

const useAsset = (id: string): Asset | undefined => usePlanner((s) => (s.assets ?? []).find((a) => a.id === id));

/* ---- new card ---------------------------------------------------------------- */

export function NewAssetSheet({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const addAsset = usePlanner((s) => s.addAsset);
  const addRule = usePlanner((s) => s.addAssetRule);
  const [kind, setKind] = useState<AssetKind>("car");
  const [name, setName] = useState("");
  const [plate, setPlate] = useState("");
  const [km, setKm] = useState("");
  const [model, setModel] = useState("");
  const [boughtAt, setBoughtAt] = useState("");
  const [months, setMonths] = useState("");
  const [lastAt, setLastAt] = useState("");
  const [notes, setNotes] = useState("");
  const ok = name.trim().length > 0;
  const example = { car: "Легковая", device: "Пылесос", consumable: "Фильтр воды", other: "Газовый котёл" }[kind];
  const save = () => {
    if (!ok) return;
    const id = addAsset({ name, kind, plate, km, model, boughtAt: boughtAt || null, notes });
    if (!id) return;
    if (kind === "consumable" && cleanNumber(months)) addRule(id, { title: "Замена", everyMonths: months, lastDoneAt: lastAt || null });
    setName("");
    setPlate("");
    setKm("");
    setModel("");
    setBoughtAt("");
    setMonths("");
    setLastAt("");
    setNotes("");
    onClose();
    onCreated(id);
  };
  return (
    <Sheet open={open} title="Новая карточка" onClose={onClose} action={{ label: "Создать", onClick: save, disabled: !ok }}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <div role="radiogroup" aria-label="Что это" className="flex flex-wrap gap-1.5 pb-2">
          {KINDS.map((k) => (
            <button
              key={k.id}
              type="button"
              role="radio"
              aria-checked={kind === k.id}
              onClick={() => setKind(k.id)}
              className={cn("h-9 rounded-full border px-3.5 text-[0.8125rem]", kind === k.id ? "border-accent bg-accent text-accent-fg" : "border-line text-muted")}
            >
              {k.label}
            </button>
          ))}
        </div>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={`Название — например, ${example}`} aria-label="Название" maxLength={80} className={field} />
        <div className="mt-2 space-y-2">
          {kind === "car" ? (
            <div className="flex gap-2">
              <input value={plate} onChange={(e) => setPlate(e.target.value)} placeholder="Номер" aria-label="Номер" maxLength={20} className={cn(field, "min-w-0 flex-1")} />
              <input inputMode="numeric" value={km} onChange={(e) => setKm(e.target.value)} placeholder="Пробег, км" aria-label="Пробег, км" className={cn(field, "min-w-0 flex-1")} />
            </div>
          ) : null}
          {kind === "device" || kind === "other" ? (
            <div className="flex gap-2">
              <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="Модель" aria-label="Модель" maxLength={120} className={cn(field, "min-w-0 flex-1")} />
              <input type="date" value={boughtAt} onChange={(e) => setBoughtAt(e.target.value)} aria-label="Дата покупки" className={cn(field, "min-w-0 flex-1 text-left")} />
            </div>
          ) : null}
          {kind === "consumable" ? (
            <div className="flex gap-2">
              <Num label="Менять раз в" value={months} onChange={setMonths} placeholder="6" suffix="мес." />
              <DateField label="Заменён" value={lastAt} onChange={setLastAt} />
            </div>
          ) : null}
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Заметка" aria-label="Заметка" rows={2} maxLength={2000} className={cn(field, "h-auto py-2.5")} />
        </div>
        <InlineHint label="Что куда писать" className="mt-1">
          Автомобиль — номер и пробег, правила «каждые N км или N мес.». Техника — модель и дата покупки. Расходник — «менять раз в N мес.» и дата последней замены: Пора напомнит заранее. Правила и историю можно добавить в карточке.
        </InlineHint>
      </form>
    </Sheet>
  );
}

/* ---- edit card -------------------------------------------------------------- */

export function EditAssetSheet({ assetId, onClose, onDeleted }: { assetId: string; onClose: () => void; onDeleted: () => void }) {
  const asset = useAsset(assetId);
  const update = usePlanner((s) => s.updateAsset);
  const remove = usePlanner((s) => s.deleteAsset);
  const [confirm, setConfirm] = useState(false);
  if (!asset) return null;
  return (
    <Sheet open title={`${kindLabel(asset.kind)}: настройки`} onClose={onClose}>
      <div className="space-y-2">
        <label className="block">
          <span className={smallLabel}>Название</span>
          <input defaultValue={asset.name} onChange={(e) => update(asset.id, { name: e.target.value })} maxLength={80} className={field} />
        </label>
        {asset.kind === "car" ? (
          <label className="block">
            <span className={smallLabel}>Номер</span>
            <input defaultValue={asset.plate ?? ""} onChange={(e) => update(asset.id, { plate: e.target.value })} maxLength={20} className={field} />
          </label>
        ) : (
          <div className="flex gap-2">
            <label className="block min-w-0 flex-1">
              <span className={smallLabel}>Модель</span>
              <input defaultValue={asset.model ?? ""} onChange={(e) => update(asset.id, { model: e.target.value })} maxLength={120} className={field} />
            </label>
            <label className="block min-w-0 flex-1">
              <span className={smallLabel}>Куплено</span>
              <input type="date" defaultValue={asset.boughtAt ?? ""} onChange={(e) => update(asset.id, { boughtAt: e.target.value || null })} className={cn(field, "text-left")} />
            </label>
          </div>
        )}
        <label className="block">
          <span className={smallLabel}>Заметка</span>
          <textarea defaultValue={asset.notes} onChange={(e) => update(asset.id, { notes: e.target.value })} rows={3} maxLength={2000} className={cn(field, "h-auto py-2.5")} />
        </label>
        <div>
          <FieldLabel hint="За сколько до срока карточка станет «скоро» и Пора создаст задачу-напоминание. Считается по тому, что наступит раньше: дни до даты или километры до пробега.">Когда считать «скоро»</FieldLabel>
          <div className="mt-1 flex gap-2">
            <Num label="За, дней" value={String(asset.soonDays ?? 14)} onChange={(v) => update(asset.id, { soonDays: Number(v) || 14 })} suffix="дн." />
            {asset.kind === "car" ? <Num label="За, км" value={String(asset.soonKm ?? 500)} onChange={(v) => update(asset.id, { soonKm: Number(v) || 500 })} suffix="км" /> : null}
          </div>
        </div>
        <AssetShareBar asset={asset} />
        <div className="pt-3">
          {confirm ? (
            <div className="flex gap-2">
              <Button variant="soft" className="flex-1" onClick={() => setConfirm(false)}>
                Отмена
              </Button>
              <Button
                variant="destructive"
                className="flex-1"
                onClick={() => {
                  remove(asset.id);
                  onClose();
                  onDeleted();
                }}
              >
                Удалить со всей историей
              </Button>
            </div>
          ) : (
            <Button variant="soft" className="w-full text-danger" onClick={() => setConfirm(true)}>
              Удалить карточку
            </Button>
          )}
        </div>
      </div>
    </Sheet>
  );
}

/* ---- mileage ------------------------------------------------------------------ */

export function MileageSheet({ assetId, onClose }: { assetId: string; onClose: () => void }) {
  const asset = useAsset(assetId);
  const setKm = usePlanner((s) => s.setAssetKm);
  const [value, setValue] = useState("");
  if (!asset) return null;
  const n = cleanNumber(value);
  const lower = n !== undefined && typeof asset.km === "number" && n < asset.km;
  const save = () => {
    if (n === undefined || !setKm(asset.id, n)) return;
    onClose();
  };
  return (
    <Sheet open title="Пробег" onClose={onClose} action={{ label: "Сохранить", onClick: save, disabled: n === undefined }}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <input autoFocus inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} placeholder={asset.km ? `Сейчас ${groupKm(asset.km)} км` : "Показание одометра, км"} aria-label="Пробег, км" className={field} />
        {lower ? <p className="mt-2 px-1 text-xs text-warn">Меньше прежнего ({groupKm(asset.km as number)} км). Если это опечатка — поправьте.</p> : null}
        <p className="mt-2 px-1 text-xs text-muted">Одно значение в день. По обновлениям Пора считает «км в месяц» и срок правил «каждые N км».</p>
      </form>
    </Sheet>
  );
}

/* ---- rule --------------------------------------------------------------------- */

export function RuleSheet({
  assetId,
  rule,
  onClose,
  onDone,
}: {
  assetId: string;
  rule: MaintRule | null;
  onClose: () => void;
  onDone: (rule: MaintRule) => void;
}) {
  const asset = useAsset(assetId);
  const add = usePlanner((s) => s.addAssetRule);
  const edit = usePlanner((s) => s.updateAssetRule);
  const remove = usePlanner((s) => s.deleteAssetRule);
  const [title, setTitle] = useState(rule?.title ?? "");
  const [everyKm, setEveryKm] = useState(rule?.everyKm ? String(rule.everyKm) : "");
  const [everyMonths, setEveryMonths] = useState(rule?.everyMonths ? String(rule.everyMonths) : "");
  const [fixed, setFixed] = useState(Boolean(rule?.fixedMonth));
  const [month, setMonth] = useState(rule?.fixedMonth ?? 12);
  const [day, setDay] = useState(rule?.fixedDay ? String(rule.fixedDay) : "");
  const [year, setYear] = useState(rule?.fixedYear ? String(rule.fixedYear) : "");
  const [lastAt, setLastAt] = useState("");
  const [lastKm, setLastKm] = useState("");
  const [confirm, setConfirm] = useState(false);
  if (!asset) return null;
  const car = asset.kind === "car";
  const input = {
    title,
    everyKm: car ? everyKm : null,
    everyMonths,
    fixedMonth: fixed ? month : null,
    fixedDay: fixed ? day : null,
    fixedYear: fixed ? year : null,
    lastDoneAt: lastAt || null,
    lastDoneKm: lastKm,
  };
  const ok = title.trim().length > 0 && Boolean((car && cleanNumber(everyKm)) || cleanNumber(everyMonths) || fixed);
  const save = () => {
    if (!ok) return;
    if (rule) edit(asset.id, rule.id, input);
    else add(asset.id, input);
    onClose();
  };
  return (
    <Sheet open title={rule ? "Правило" : "Новое правило"} onClose={onClose} action={{ label: rule ? "Сохранить" : "Добавить", onClick: save, disabled: !ok }}>
      <div className="space-y-2">
        <input autoFocus={!rule} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={car ? "Что делать — например, замена масла" : "Что делать — например, заменить фильтр"} aria-label="Что делать" maxLength={120} className={field} />
        <FieldLabel hint="Можно один срок или несколько сразу — тогда сработает тот, что наступит раньше. Например: каждые 10 000 км или 12 мес.">Когда</FieldLabel>
        <div className="flex gap-2">
          {car ? <Num label="Каждые" value={everyKm} onChange={setEveryKm} placeholder="10 000" suffix="км" /> : null}
          <Num label={car ? "или каждые" : "Каждые"} value={everyMonths} onChange={setEveryMonths} placeholder="12" suffix="мес." />
        </div>
        <label className="flex min-h-11 items-center gap-3 rounded-xl bg-elevated px-3 text-[0.9375rem]">
          <span className="flex-1">В конкретную дату</span>
          <input type="checkbox" role="switch" checked={fixed} onChange={(e) => setFixed(e.target.checked)} className="ios-switch shrink-0" aria-label="В конкретную дату" />
        </label>
        {fixed ? (
          <div className="rounded-xl bg-elevated p-3">
            <div className="flex gap-2">
              <label className="block min-w-0 flex-[2]">
                <span className={smallLabel}>Месяц</span>
                <select value={month} onChange={(e) => setMonth(Number(e.target.value))} aria-label="Месяц" className={cn(field, "bg-surface")}>
                  {MONTHS_FULL.map((m, i) => (
                    <option key={m} value={i + 1}>
                      {m}
                    </option>
                  ))}
                </select>
              </label>
              <Num label="Число" value={day} onChange={setDay} placeholder="любое" />
              <Num label="Год" value={year} onChange={setYear} placeholder="каждый" />
            </div>
            <p className="mt-2 text-xs text-muted">Без числа — «скоро» с 1-го числа месяца, срок до его конца. Без года повторяется каждый год, с годом — один раз.</p>
          </div>
        ) : null}
        {!rule ? (
          <>
            <FieldLabel hint="Если уже делали — укажите, когда и при каком пробеге: срок посчитается от этого. Тогда же появится запись в истории.">Когда делали в последний раз</FieldLabel>
            <div className="flex gap-2">
              <DateField label="Дата" value={lastAt} onChange={setLastAt} />
              {car ? <Num label="Пробег" value={lastKm} onChange={setLastKm} placeholder="км" /> : null}
            </div>
          </>
        ) : (
          <div className="flex gap-2 pt-2">
            <Button
              variant="primary"
              className="flex-1"
              onClick={() => {
                onClose();
                onDone(rule);
              }}
            >
              Сделано — записать
            </Button>
            {confirm ? (
              <Button
                variant="destructive"
                onClick={() => {
                  remove(asset.id, rule.id);
                  onClose();
                }}
              >
                Удалить?
              </Button>
            ) : (
              <Button variant="soft" className="text-danger" onClick={() => setConfirm(true)}>
                Удалить
              </Button>
            )}
          </div>
        )}
      </div>
    </Sheet>
  );
}

/* ---- log entry ---------------------------------------------------------------- */

export function ServiceSheet({ assetId, preset, onClose }: { assetId: string; preset: { title: string; ruleIds: string[] } | null; onClose: () => void }) {
  const asset = useAsset(assetId);
  const add = usePlanner((s) => s.addAssetService);
  const id = useRef(newId()).current;
  const [title, setTitle] = useState(preset?.title ?? "");
  const [date, setDate] = useState(todayIso());
  const [km, setKm] = useState("");
  const [cost, setCost] = useState("");
  const [place, setPlace] = useState("");
  const [note, setNote] = useState("");
  const [picked, setPicked] = useState<string[] | null>(preset ? preset.ruleIds : null);
  const files = useMemo(() => (asset?.attachments ?? []).filter((a) => a.entryId === id), [asset?.attachments, id]);
  if (!asset) return null;
  const guess = picked ?? guessRules(asset, title);
  const ok = title.trim().length > 0;
  const discard = () => {
    // The files were added before the entry existed: a cancelled entry must not leave them behind.
    for (const f of files) void deleteFile({ kind: "asset", id: asset.id }, f.id);
    onClose();
  };
  const save = () => {
    if (!ok) return;
    add(asset.id, { id, title, date, km, cost, place, note, ruleIds: guess });
    onClose();
  };
  return (
    <Sheet open title="Запись в историю" onClose={discard} action={{ label: "Сохранить", onClick: save, disabled: !ok }}>
      <div className="space-y-2">
        <input autoFocus={!preset} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={asset.kind === "car" ? "Что сделано — например, замена масла" : "Что сделано — например, заменён фильтр"} aria-label="Что сделано" maxLength={160} className={field} />
        <div className="flex gap-2">
          <DateField label="Дата" value={date} onChange={setDate} />
          {asset.kind === "car" ? <Num label="Пробег, км" value={km} onChange={setKm} placeholder={asset.km ? groupKm(asset.km) : "км"} /> : null}
        </div>
        <div className="flex gap-2">
          <Num label="Стоимость" value={cost} onChange={setCost} placeholder="0" suffix="₽" />
          <label className="block min-w-0 flex-1">
            <span className={smallLabel}>Где</span>
            <input value={place} onChange={(e) => setPlace(e.target.value)} placeholder="Сервис, магазин" maxLength={120} aria-label="Где" className={field} />
          </label>
        </div>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Заметка" aria-label="Заметка" rows={2} maxLength={1000} className={cn(field, "h-auto py-2.5")} />
        <AttachmentsBlock kind="asset" parentId={asset.id} entryId={id} items={files} label="Фото чека, файлы" />
        {asset.rules.length ? (
          <div className="rounded-xl bg-elevated px-3 py-2">
            <FieldLabel hint="Отмеченные правила начнут отсчёт от этой записи: срок «следующего раза» сдвинется, а напоминание по ним закроется.">Отсчитывать заново</FieldLabel>
            <ul className="mt-1">
              {asset.rules.map((r) => {
                const on = guess.includes(r.id);
                return (
                  <li key={r.id}>
                    <label className="flex min-h-11 items-center gap-2.5 py-1 text-[0.9375rem]">
                      <input type="checkbox" checked={on} onChange={() => setPicked(on ? guess.filter((x) => x !== r.id) : [...guess, r.id])} className="size-5 shrink-0 accent-[var(--accent)]" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{r.title}</span>
                        <span className="block truncate text-xs text-subtle">{ruleLine(r)}</span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}

export function EntrySheet({ assetId, entry, onClose }: { assetId: string; entry: ServiceEntry; onClose: () => void }) {
  const asset = useAsset(assetId);
  const removeEntry = usePlanner((s) => s.deleteAssetEntry);
  const [confirm, setConfirm] = useState(false);
  if (!asset) return null;
  const files = (asset.attachments ?? []).filter((a) => a.entryId === entry.id);
  const names = (entry.ruleIds ?? []).map((id) => asset.rules.find((r) => r.id === id)?.title).filter(Boolean);
  const remove = async () => {
    for (const f of files) await deleteFile({ kind: "asset", id: asset.id }, f.id);
    removeEntry(asset.id, entry.id);
    onClose();
  };
  return (
    <Sheet open title={entry.title} onClose={onClose}>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-xl bg-elevated p-3 text-[0.9375rem]">
        <dt className="text-muted">Дата</dt>
        <dd>{formatShortDay(entry.date)} {entry.date.slice(0, 4)}</dd>
        {entry.km != null ? (<><dt className="text-muted">Пробег</dt><dd>{groupKm(entry.km)} км</dd></>) : null}
        {entry.cost ? (<><dt className="text-muted">Стоимость</dt><dd>{money(entry.cost)}</dd></>) : null}
        {entry.place ? (<><dt className="text-muted">Где</dt><dd>{entry.place}</dd></>) : null}
        {names.length ? (<><dt className="text-muted">Правила</dt><dd>{names.join(", ")}</dd></>) : null}
        {entry.note ? (<><dt className="text-muted">Заметка</dt><dd className="whitespace-pre-wrap break-words">{entry.note}</dd></>) : null}
      </dl>
      <AttachmentsBlock kind="asset" parentId={asset.id} entryId={entry.id} items={files} label="Чеки и файлы записи" />
      <div className="pt-4">
        {confirm ? (
          <div className="flex gap-2">
            <Button variant="soft" className="flex-1" onClick={() => setConfirm(false)}>Отмена</Button>
            <Button variant="destructive" className="flex-1" onClick={() => void remove()}>Удалить запись</Button>
          </div>
        ) : (
          <Button variant="soft" className="w-full text-danger" onClick={() => setConfirm(true)}>Удалить запись</Button>
        )}
        <p className="mt-2 px-1 text-xs text-muted">Если запись сбрасывала правило, срок вернётся к предыдущему разу.</p>
      </div>
    </Sheet>
  );
}
