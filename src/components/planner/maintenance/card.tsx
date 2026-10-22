import { useEffect, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Check, Paperclip, Pencil, Plus, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FieldLabel } from "@/components/ui/hint";
import { AssetObjects } from "./objects";
import { cn } from "@/lib/cn";
import { formatShortDay, todayIso } from "@/lib/dates";
import { kindLabel, summarize } from "@/lib/maintenance/ops";
import { groupKm, ruleLine, stateText, type MaintRule } from "@/lib/maintenance/rules";
import { kmPerMonth, money, spendByYear } from "@/lib/maintenance/stats";
import { usePlanner } from "@/lib/planner-store";
import type { Asset, ServiceEntry } from "@/lib/planner-types";
import { FuelBlock, OwnershipBlock } from "./fuel-ui";
import { PainSheet, planText } from "./pains";
import { TechBlock } from "./tech-ui";
import { Badge, Bar, MONTHS_FULL, field, progressOf } from "./shared";
import { EditAssetSheet, EntrySheet, MileageSheet, RuleSheet, ServiceSheet } from "./sheets";

const FOLDS_KEY = "pora-card-folds";

/** Open / folded sections of a card, remembered on this device (UI state, not synced). */
function useFold(id: string | undefined, initial: boolean): [boolean, () => void] {
  const [open, setOpen] = useState<boolean>(() => {
    if (!id || typeof window === "undefined") return initial;
    try {
      const saved = (JSON.parse(window.localStorage.getItem(FOLDS_KEY) ?? "{}") as Record<string, boolean>)[id];
      return typeof saved === "boolean" ? saved : initial;
    } catch {
      return initial;
    }
  });
  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (!id) return;
    try {
      const all = JSON.parse(window.localStorage.getItem(FOLDS_KEY) ?? "{}") as Record<string, boolean>;
      all[id] = next;
      window.localStorage.setItem(FOLDS_KEY, JSON.stringify(all));
    } catch {
      /* private mode: just not remembered */
    }
  };
  return [open, toggle];
}

type Fold = { id: string; open: boolean; summary?: string };

function Section({ title, hint, action, fold, children }: { title: string; hint?: string; action?: { label: string; onClick: () => void }; fold?: Fold; children: React.ReactNode }) {
  const [open, toggle] = useFold(fold?.id, fold?.open ?? true);
  return (
    <section className="mt-4">
      <div className="flex items-center">
        {fold ? (
          <button type="button" onClick={toggle} aria-expanded={open} aria-label={`${title}: ${open ? "свернуть" : "развернуть"}`} className="-my-2 -ml-1 flex h-11 items-center pl-1 text-subtle">
            <ChevronDown className={cn("size-4 transition-transform", !open && "-rotate-90")} aria-hidden="true" />
          </button>
        ) : null}
        <FieldLabel hint={hint} className="flex-1">
          {title}
          {fold && !open && fold.summary ? <span className="ml-1.5 font-normal normal-case text-subtle">· {fold.summary}</span> : null}
        </FieldLabel>
        {action ? (
          <button type="button" onClick={() => { if (!open) toggle(); action.onClick(); }} className="-my-2 flex h-11 items-center gap-1 px-1 text-[0.8125rem] font-medium text-accent">
            <Plus className="size-3.5" aria-hidden="true" />
            {action.label}
          </button>
        ) : null}
      </div>
      {open ? children : null}
    </section>
  );
}

/** A block with its own heading (fuel, ownership): folded to one row, opened in place. */
function FoldBlock({ id, title, summary, children }: { id: string; title: string; summary: string; children: React.ReactNode }) {
  const [open, toggle] = useFold(id, false);
  if (!open)
    return (
      <button type="button" onClick={toggle} aria-expanded={false} className="mt-3 flex h-11 w-full items-center gap-1 rounded-xl bg-elevated px-3 text-left text-[0.8125rem]">
        <ChevronRight className="size-4 shrink-0 text-subtle" aria-hidden="true" />
        <span className="font-medium text-fg">{title}</span>
        <span className="ml-auto truncate text-muted tabular-nums">{summary}</span>
      </button>
    );
  return (
    <div>
      {children}
      <button type="button" onClick={toggle} aria-expanded className="mt-1 flex h-9 items-center gap-1 px-1 text-xs text-subtle">
        <ChevronDown className="size-3.5" aria-hidden="true" /> Свернуть «{title}»
      </button>
    </div>
  );
}

/** «Сводка» of a car: mileage, the nearest thing to do, this year's spend — one glance. */
function CarSummary({ asset, lead, onMileage }: { asset: Asset; lead: { title: string; text: string; status: string } | null; onMileage: () => void }) {
  const year = todayIso().slice(0, 4);
  const service = spendByYear(asset.log)[year] ?? 0;
  const fuel = (asset.fuel ?? []).filter((f) => f.date.startsWith(year)).reduce((n, f) => n + (f.sum ?? 0), 0);
  return (
    <section aria-label="Сводка" className="mt-3 grid grid-cols-3 divide-x divide-line/60 rounded-xl bg-elevated" data-testid="car-summary">
      <button type="button" onClick={onMileage} className="min-w-0 px-2.5 py-2 text-left">
        <span className="block text-[0.6875rem] text-muted">Пробег</span>
        <span className="block truncate text-[0.9375rem] font-semibold tabular-nums">{asset.km != null ? `${groupKm(asset.km)} км` : "указать"}</span>
        <span className="block truncate text-[0.6875rem] text-subtle">{asset.kmAt ? formatShortDay(asset.kmAt) : "—"}</span>
      </button>
      <div className="min-w-0 px-2.5 py-2">
        <span className="block text-[0.6875rem] text-muted">Ближайшее</span>
        <span className="block truncate text-[0.9375rem] font-semibold">{lead ? lead.title : "—"}</span>
        <span className={cn("block truncate text-[0.6875rem]", lead?.status === "overdue" ? "text-danger" : lead?.status === "soon" ? "text-warn" : "text-subtle")}>{lead ? lead.text : "всё сделано"}</span>
      </div>
      <div className="min-w-0 px-2.5 py-2">
        <span className="block text-[0.6875rem] text-muted">Расходы {year}</span>
        <span className="block truncate text-[0.9375rem] font-semibold tabular-nums">{money(service + fuel)}</span>
        <span className="block truncate text-[0.6875rem] text-subtle">топливо {money(fuel)}</span>
      </div>
    </section>
  );
}

export function AssetCardView({ asset, onBack, onStats, onOpenTask, startService, onStarted }: { asset: Asset; onBack: () => void; onStats: () => void; onOpenTask?: (taskId: string) => void; startService?: { title: string } | null; onStarted?: () => void }) {
  const today = todayIso();
  const summary = summarize(asset, today);
  const updateAsset = usePlanner((s) => s.updateAsset);
  const addPain = usePlanner((s) => s.addAssetPain);
  const solvePain = usePlanner((s) => s.setAssetPainSolved);
  const deletePain = usePlanner((s) => s.deleteAssetPain);
  const [editing, setEditing] = useState(false);
  const [mileage, setMileage] = useState(false);
  const [rule, setRule] = useState<MaintRule | "new" | "ins" | null>(null);
  const [service, setService] = useState<{ title: string; ruleIds: string[] } | "new" | null>(null);
  const [entry, setEntry] = useState<string | null>(null);
  // «Записать в историю» offered after the task of a planned note was ticked.
  useEffect(() => {
    if (!startService) return;
    setService({ title: startService.title, ruleIds: [] });
    onStarted?.();
  }, [startService, onStarted]);
  const [editEntry, setEditEntry] = useState<string | null>(null);
  const [painSheet, setPainSheet] = useState<string | null>(null);
  const [painText, setPainText] = useState("");
  const [painOpen, setPainOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [showSolved, setShowSolved] = useState(false);

  const car = asset.kind === "car";
  const months = car ? kmPerMonth(asset.readings ?? []) : [];
  const lastMeasured = [...months].reverse().find((m) => !m.estimated);
  const log = [...asset.log].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const shown = showAll ? log : log.slice(0, 5);
  const spend = Object.entries(spendByYear(asset.log)).sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 3);
  const open = asset.pains.filter((p) => !p.solvedAt);
  const solved = asset.pains.filter((p) => p.solvedAt);
  const insRules = summary.rules.filter((r) => r.rule.cat === "ins");
  const mainRules = summary.rules.filter((r) => r.rule.cat !== "ins");
  const sub = [asset.plate && `Номер ${asset.plate}`, asset.model, car && asset.boughtAt && `куплено ${formatShortDay(asset.boughtAt)} ${asset.boughtAt.slice(0, 4)}`].filter(Boolean).join(" · ");
  const openedEntry: ServiceEntry | undefined = entry ? asset.log.find((e) => e.id === entry) : undefined;
  const entryToEdit: ServiceEntry | undefined = editEntry ? asset.log.find((e) => e.id === editEntry) : undefined;

  const addPainNow = () => {
    if (!addPain(asset.id, painText)) return;
    setPainText("");
    setPainOpen(false);
  };

  return (
    <div className="mx-auto w-full max-w-3xl pb-10">
      <div className="-mt-1 flex items-center">
        <button type="button" onClick={onBack} className="flex h-11 items-center gap-0.5 pr-3 text-sm text-muted" aria-label="Назад к списку">
          <ChevronLeft className="size-4" aria-hidden="true" />
          {kindLabel(asset.kind)}
        </button>
        <button type="button" onClick={() => setEditing(true)} aria-label="Изменить карточку" className="ml-auto flex h-11 items-center gap-1 rounded-full px-3 text-[0.8125rem] font-medium text-accent">
          <Pencil className="size-3.5" aria-hidden="true" />
          Изменить
        </button>
      </div>
      <h2 className="text-[1.125rem] leading-tight font-semibold">{asset.name}</h2>
      {sub ? <p className="mt-0.5 text-[0.8125rem] text-muted">{sub}</p> : null}
      {asset.notes ? <p className="mt-1 text-[0.8125rem] whitespace-pre-wrap text-muted">{asset.notes}</p> : null}

      {car ? (
        <>
          <CarSummary asset={asset} lead={summary.lead ? { title: summary.lead.rule.title, text: stateText(summary.lead.rule, summary.lead.state), status: summary.lead.state.status } : null} onMileage={() => setMileage(true)} />
          <label className="mt-1 flex min-h-11 items-center gap-3 px-1 text-[0.8125rem] text-muted">
            <span className="flex-1">
              Напоминать обновить пробег
              <span className="block text-xs text-subtle">1-го числа, 10:00{lastMeasured ? ` · ${MONTHS_FULL[Number(lastMeasured.month.slice(5)) - 1]}: +${groupKm(lastMeasured.km)} км` : ""}</span>
            </span>
            <input type="checkbox" role="switch" checked={asset.kmRemind === true} onChange={(e) => updateAsset(asset.id, { kmRemind: e.target.checked })} className="ios-switch shrink-0" aria-label="Напоминать обновить пробег" />
          </label>
        </>
      ) : null}

      {car ? (
        <FoldBlock id={`${asset.id}:fuel`} title="Заправки" summary={(asset.fuel ?? []).length ? `${(asset.fuel ?? []).length} · последняя ${formatShortDay([...(asset.fuel ?? [])].sort((a, b) => (a.date < b.date ? 1 : -1))[0]!.date)}` : "пока нет"}>
          <FuelBlock asset={asset} />
        </FoldBlock>
      ) : (
        <TechBlock asset={asset} />
      )}

      <Section
        title="Что скоро"
        hint="Правило — что и когда делать: каждые N км, каждые N месяцев, в конкретную дату — или несколько условий сразу (сработает то, что раньше). Запись в историю с отметкой правила начинает отсчёт заново."
        action={{ label: "Правило", onClick: () => setRule("new") }}
      >
        {mainRules.length ? (
          <ul className="space-y-1.5">
            {mainRules.map(({ rule: r, state }) => {
              const progress = progressOf(r, state);
              return (
                <li key={r.id}>
                  <button type="button" onClick={() => setRule(r)} className="w-full rounded-xl bg-elevated px-3 py-2.5 text-left">
                    <span className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-[0.9375rem] font-semibold">{r.title}</span>
                      {state.finished ? <Badge status="ok">сделано</Badge> : <Badge status={state.status}>{stateText(r, state)}</Badge>}
                    </span>
                    <span className="mt-0.5 block text-xs text-subtle">{ruleLine(r)}</span>
                    {progress !== null && !state.finished ? <Bar value={progress} status={state.status} /> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="rounded-xl border border-dashed border-line px-3 py-3 text-[0.8125rem] text-muted">
            Правил пока нет. Например: {car ? "«замена масла — каждые 10 000 км или 12 мес.»" : "«почистить от пыли — раз в 12 мес.»"}.
          </p>
        )}
      </Section>

      {car ? (
        <Section
          title="Страховка и налоги"
          fold={{ id: `${asset.id}:ins`, open: true, summary: String(insRules.length) }}
          hint="Ежегодные платежи со сроком: ОСАГО, КАСКО, транспортный налог. Укажите обычную сумму — при записи в историю она подставится, а в итогах попадёт в «Страховка и налог», отдельно от обслуживания."
          action={{ label: "Платёж", onClick: () => setRule("ins") }}
        >
          {insRules.length ? (
            <ul className="space-y-1.5">
              {insRules.map(({ rule: r, state }) => (
                <li key={r.id}>
                  <button type="button" onClick={() => setRule(r)} className="w-full rounded-xl bg-elevated px-3 py-2.5 text-left">
                    <span className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-[0.9375rem] font-semibold">{r.title}</span>
                      {r.cost ? <span className="text-[0.8125rem] text-muted tabular-nums">{money(r.cost)}</span> : null}
                      {state.finished ? <Badge status="ok">сделано</Badge> : <Badge status={state.status}>{stateText(r, state)}</Badge>}
                    </span>
                    <span className="mt-0.5 block text-xs text-subtle">{ruleLine(r)}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-xl border border-dashed border-line px-3 py-3 text-[0.8125rem] text-muted">Платежей нет. Например: «ОСАГО — каждый год в декабре, 12 000 ₽» или «Транспортный налог — до 1 декабря».</p>
          )}
        </Section>
      ) : null}

      <Section title="Что болит" fold={car ? { id: `${asset.id}:pains`, open: open.length > 0 || painOpen, summary: open.length ? String(open.length) : "ничего" } : undefined} hint="Заметка о проблеме висит здесь, пока вы не отметите «Решено» — чтобы не забыть сказать мастеру. Можно записать, что сделать, и запланировать это задачей: на дату, через N дней или при нужном пробеге. На сроки правил не влияет." action={{ label: "Записать", onClick: () => setPainOpen(true) }}>
        {painOpen ? (
          <form
            className="mb-2 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              addPainNow();
            }}
          >
            <input autoFocus value={painText} onChange={(e) => setPainText(e.target.value)} placeholder="Например: стук спереди на кочках" aria-label="Что болит" maxLength={500} className={cn(field, "min-w-0 flex-1")} />
            <Button type="submit" variant="primary" disabled={!painText.trim()}>
              Ок
            </Button>
          </form>
        ) : null}
        {open.length ? (
          <ul className="space-y-1.5">
            {open.map((p) => (
              <li key={p.id} className="flex items-start gap-2 rounded-lg border-l-[3px] border-warn bg-elevated py-2 pr-2 pl-2.5">
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden="true" />
                <button type="button" onClick={() => setPainSheet(p.id)} aria-label={`Изменить: ${p.text}`} className="min-w-0 flex-1 text-left text-[0.9375rem]">
                  <span className="block break-words">{p.text}</span>
                  {p.todo ? <span className="block text-[0.8125rem] break-words text-muted">Сделать: {p.todo}</span> : null}
                  <span className="block text-xs text-subtle">
                    {planText(p) || `с ${formatShortDay(new Date(p.createdAt).toISOString().slice(0, 10))}`}
                  </span>
                </button>
                {planText(p) ? null : (
                  <button type="button" onClick={() => setPainSheet(p.id)} className="flex h-9 shrink-0 items-center rounded-lg px-2 text-[0.8125rem] font-medium text-accent">
                    Запланировать
                  </button>
                )}
                <button type="button" onClick={() => solvePain(asset.id, p.id, true)} className="flex h-9 shrink-0 items-center gap-1 rounded-lg px-2 text-[0.8125rem] font-medium text-accent">
                  <Check className="size-3.5" aria-hidden="true" />
                  Решено
                </button>
              </li>
            ))}
          </ul>
        ) : !painOpen ? (
          <p className="px-1 text-[0.8125rem] text-subtle">Ничего не беспокоит. Например: {car ? "«стук спереди на кочках»" : "«шумит кулер»"} — со временем можно запланировать ремонт.</p>
        ) : null}
        {solved.length ? (
          <div className="mt-1">
            <button type="button" onClick={() => setShowSolved(!showSolved)} className="h-9 px-1 text-xs text-subtle">
              Решённые: {solved.length} {showSolved ? "▴" : "▾"}
            </button>
            {showSolved ? (
              <ul className="space-y-1">
                {solved.map((p) => (
                  <li key={p.id} className="flex items-center gap-2 px-1 text-[0.8125rem] text-subtle">
                    <button type="button" onClick={() => setPainSheet(p.id)} aria-label={`Изменить: ${p.text}`} className="min-w-0 flex-1 truncate text-left line-through">
                      {p.text}
                    </button>
                    <button type="button" onClick={() => solvePain(asset.id, p.id, false)} className="h-8 px-1 text-accent">
                      Вернуть
                    </button>
                    <button type="button" onClick={() => deletePain(asset.id, p.id)} className="h-8 px-1 text-danger" aria-label={`Удалить: ${p.text}`}>
                      Удалить
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </Section>

      <Section title="История" fold={car ? { id: `${asset.id}:log`, open: false, summary: log.length ? `${log.length} · ${formatShortDay(log[0]!.date)}` : "пусто" } : undefined} hint="Что и когда делали, при каком пробеге, где и за сколько. Фото чека и документы прикрепляются к записи." action={{ label: "Запись", onClick: () => setService("new") }}>
        {log.length ? (
          <ul className="space-y-1.5">
            {shown.map((e) => {
              const files = [asset.attachments, asset.links, asset.contacts].reduce((n, list) => n + (list ?? []).filter((a) => a.entryId === e.id).length, 0);
              return (
                <li key={e.id}>
                  <button type="button" onClick={() => setEntry(e.id)} className="flex w-full items-center gap-2 rounded-xl bg-elevated px-3 py-2.5 text-left">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[0.9375rem] font-semibold">{e.title}</span>
                      <span className="block truncate text-xs text-subtle">
                        {[`${formatShortDay(e.date)}${e.date.slice(0, 4) !== String(new Date().getFullYear()) ? ` ${e.date.slice(0, 4)}` : ""}`, e.km != null ? `${groupKm(e.km)} км` : null, e.place ? `«${e.place}»` : null].filter(Boolean).join(" · ")}
                        {files ? (
                          <span className="ml-1 inline-flex items-center gap-0.5">
                            · <Paperclip className="size-3" aria-hidden="true" />
                            {files}
                          </span>
                        ) : null}
                      </span>
                    </span>
                    {e.cost ? <span className="shrink-0 text-[0.9375rem] font-semibold tabular-nums">{money(e.cost)}</span> : null}
                    <ChevronRight className="size-4 shrink-0 text-subtle" aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="rounded-xl border border-dashed border-line px-3 py-3 text-[0.8125rem] text-muted">Записей пока нет. Добавьте то, что уже делали, — например, {car ? "«замена масла, 6 400 ₽»" : "«чистка от пыли, 1 500 ₽»"} с фото чека.</p>
        )}
        {log.length > 5 ? (
          <button type="button" onClick={() => setShowAll(!showAll)} className="mt-1 h-9 px-1 text-[0.8125rem] text-accent">
            {showAll ? "Свернуть" : `Показать все (${log.length})`}
          </button>
        ) : null}
      </Section>

      {car ? (
        <FoldBlock id={`${asset.id}:own`} title="Владение" summary={`расходы по годам${spend.length ? ` · ${spend[0]![0]}: ${money(spend[0]![1])}` : ""}`}>
          <OwnershipBlock asset={asset} />
        </FoldBlock>
      ) : null}

      {!car && spend.length ? (
        <p className="mt-3 flex items-baseline gap-2 px-1 text-[0.8125rem] text-muted">
          <span>Расходы</span>
          <span className="ml-auto text-right tabular-nums">{spend.map(([y, v]) => `${y}: ${money(v)}`).join(" · ")}</span>
        </p>
      ) : null}

      <AssetObjects asset={asset} label="Файлы и ссылки карточки" />

      <div className="mt-4 flex gap-2">
        <Button variant="soft" className="flex-1" onClick={() => setService("new")}>
          <Plus className="size-4" aria-hidden="true" /> Запись
        </Button>
        {car ? (
          <Button variant="soft" className="flex-1" onClick={onStats}>
            Статистика
          </Button>
        ) : null}
      </div>

      {painSheet ? <PainSheet key={painSheet} asset={asset} painId={painSheet} onClose={() => setPainSheet(null)} onOpenTask={onOpenTask} /> : null}
      {editing ? <EditAssetSheet assetId={asset.id} onClose={() => setEditing(false)} onDeleted={onBack} /> : null}
      {mileage ? <MileageSheet assetId={asset.id} onClose={() => setMileage(false)} /> : null}
      {rule ? <RuleSheet key={typeof rule === "string" ? rule : rule.id} assetId={asset.id} rule={rule === "new" || rule === "ins" ? null : rule} insDefault={rule === "ins"} onClose={() => setRule(null)} onDone={(r) => setService({ title: r.title, ruleIds: [r.id] })} /> : null}
      {service ? <ServiceSheet assetId={asset.id} preset={service === "new" ? null : service} onClose={() => setService(null)} /> : null}
      {entryToEdit ? <ServiceSheet key={entryToEdit.id} assetId={asset.id} preset={null} editing={entryToEdit} onClose={() => setEditEntry(null)} /> : null}
      {openedEntry && !entryToEdit ? (
        <EntrySheet
          assetId={asset.id}
          entry={openedEntry}
          onClose={() => setEntry(null)}
          onEdit={() => {
            setEditEntry(openedEntry.id);
          }}
        />
      ) : null}
    </div>
  );
}
