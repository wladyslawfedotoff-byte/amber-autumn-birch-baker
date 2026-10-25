import { useCallback, useEffect, useState } from "react";
import { BarChart3, ChevronRight, Plus, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Empty } from "@/components/planner/empty-state";
import { Fab } from "@/components/planner/quick-composer";
import { todayIso } from "@/lib/dates";
import { groupKm, stateText } from "@/lib/maintenance/rules";
import { sortAssets, type AssetSummary } from "@/lib/maintenance/ops";
import { usePainPrompt } from "@/lib/maintenance/prompt";
import { usePlanner } from "@/lib/planner-store";
import type { Asset } from "@/lib/planner-types";
import { AssetCardView } from "./card";
import { NewAssetSheet } from "./sheets";
import { leadWarranty, warrantyText } from "@/lib/maintenance/warranty";
import { Badge, KindIcon, WarrBadge, subtitle } from "./shared";
import { StatsView } from "./stats";
import { nearestByCard } from "@/lib/maintenance/nearest";
import { honestDue } from "@/lib/maintenance/honest-due";
import { shortMaintTitle } from "@/lib/maintenance/short-title";
import { cn } from "@/lib/cn";
import type { Task } from "@/lib/planner-types";

/** «Ближайшее»: open auto tasks by card, nearest first — one line each. */
function Nearest({ tasks, assets, onOpenTask, onOpenCard }: { tasks: Task[]; assets: Asset[]; onOpenTask?: (taskId: string) => void; onOpenCard: (assetId: string) => void }) {
  const today = todayIso();
  const groups = nearestByCard(tasks, assets);
  if (!groups.length) return null;
  return (
    <section aria-label="Ближайшее" className="mb-4" data-testid="maint-nearest">
      <p className="mb-1 px-1 text-xs font-medium text-subtle">Ближайшее</p>
      <div className="overflow-hidden rounded-xl bg-elevated">
        {groups.map(({ asset, tasks: items }) => (
          <div key={asset.id} className="border-b border-line/60 px-3 py-2 last:border-0">
            <p className="flex items-center gap-2 text-[0.6875rem] font-semibold uppercase text-subtle">
              <button type="button" onClick={() => onOpenCard(asset.id)} className="flex min-h-7 min-w-0 items-center gap-2 uppercase">
              <KindIcon kind={asset.kind} className="size-4 rounded-none border-0 bg-transparent [&_svg]:size-3.5" />
              <span className="truncate">{asset.name}</span>
              </button>
            </p>
            <ul>
              {items.map((task) => {
                const due = honestDue(task, assets, today);
                return (
                  <li key={task.id}>
                    <button type="button" onClick={() => onOpenTask?.(task.id)} className="flex h-9 w-full items-center gap-2 text-left text-sm">
                      <span className="min-w-0 flex-1 truncate text-fg">{shortMaintTitle(task, assets)}</span>
                      <span className={cn("shrink-0 text-xs tabular-nums", due.tone === "danger" ? "text-danger" : due.tone === "accent" ? "text-accent" : "text-muted")}>
                        {due.text}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

function lineOf(asset: Asset, summary: AssetSummary): string {
  const lead = summary.lead;
  if (!lead) {
    const w = asset.kind === "car" ? null : leadWarranty(asset, todayIso());
    if (w) return `${w.subject.part ? `${w.subject.part.name}: ` : "Гарантия: "}${warrantyText(w.state)}`;
    if (!asset.rules.length) return asset.kind === "car" && asset.km != null ? `${groupKm(asset.km)} км · правил пока нет` : "Правил пока нет — откройте и добавьте";
    return "Все правила выполнены";
  }
  const text = `${lead.rule.title} — ${stateText(lead.rule, lead.state)}`;
  return asset.kind === "car" && asset.km != null && lead.state.status === "ok" ? `${groupKm(asset.km)} км · ${text}` : text;
}

function Row({ asset, summary, onOpen }: { asset: Asset; summary: AssetSummary; onOpen: () => void }) {
  const hasRule = summary.lead !== null;
  const warr = asset.kind === "car" || (hasRule && summary.status !== "ok") ? null : leadWarranty(asset, todayIso());
  return (
    <li>
      <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 rounded-xl bg-elevated px-3 py-2 text-left">
        <KindIcon kind={asset.kind} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[0.9375rem] font-semibold">{asset.name}</span>
          <span className="block truncate text-xs text-accent">{subtitle(asset)}</span>
          <span className="block truncate text-xs text-subtle">{lineOf(asset, summary)}</span>
        </span>
        {summary.openPains > 0 ? <TriangleAlert className="size-4 shrink-0 text-warn" aria-label={`Что болит: ${summary.openPains}`} /> : null}
        {hasRule && !warr ? <Badge status={summary.status} /> : warr ? <WarrBadge state={warr.state} short /> : <ChevronRight className="size-4 shrink-0 text-subtle" aria-hidden="true" />}
      </button>
    </li>
  );
}

export function MaintenanceView({ onOpenTask }: { onOpenTask?: (taskId: string) => void }) {
  const assets = usePlanner((s) => s.assets) ?? [];
  const tasks = usePlanner((s) => s.tasks);
  const [openId, setOpenId] = useState<string | null>(null);
  const [stats, setStats] = useState(false);
  const [creating, setCreating] = useState(false);
  const asset = assets.find((a) => a.id === openId) ?? null;
  const prompt = usePainPrompt((s) => s.open);
  const consume = usePainPrompt((s) => s.consume);
  const [start, setStart] = useState<{ assetId: string; title: string } | null>(null);
  useEffect(() => {
    if (!prompt) return;
    setStats(false);
    setOpenId(prompt.assetId);
    setStart({ assetId: prompt.assetId, title: prompt.title });
    consume();
  }, [prompt, consume]);
  const started = useCallback(() => setStart(null), []);

  if (stats) return <StatsView assets={assets} onBack={() => setStats(false)} />;
  if (asset) return <AssetCardView asset={asset} onBack={() => setOpenId(null)} onStats={() => setStats(true)} onOpenTask={onOpenTask} startService={start?.assetId === asset.id ? start : null} onStarted={started} />;

  const sorted = sortAssets(assets, todayIso());
  // Two worlds: cars, and tech (a third group only for consumables and other things).
  const groups = [
    { id: "car", title: "Авто", items: sorted.filter((x) => x.asset.kind === "car") },
    { id: "device", title: "Техника", items: sorted.filter((x) => x.asset.kind === "device") },
    { id: "rest", title: "Расходники и другое", items: sorted.filter((x) => x.asset.kind === "consumable" || x.asset.kind === "other") },
  ].filter((g) => g.items.length);
  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="mb-2 hidden justify-end gap-2 md:flex">
        {assets.length ? (
          <Button variant="soft" size="sm" onClick={() => setStats(true)}>
            <BarChart3 className="size-4" /> Статистика
          </Button>
        ) : null}
        <Button variant="soft" size="sm" onClick={() => setCreating(true)}>
          <Plus className="size-4" /> Новая карточка
        </Button>
      </div>
      {assets.length === 0 ? (
        <>
          <Empty title="Пока ничего нет" hint="Добавьте карточку — Автомобиль (пробег, заправки, расходы), Техника (гарантии, чеки, компоненты), Расходник или Другое. Пора напомнит, когда пора менять, обслуживать или проверить гарантию." />
          <ul className="mx-auto max-w-sm space-y-1 px-4 text-[0.8125rem] text-muted">
            <li className="rounded-lg border border-dashed border-line px-3 py-2">Легковая — масло каждые 10 000 км или 12 мес.</li>
            <li className="rounded-lg border border-dashed border-line px-3 py-2">Фильтр воды — менять раз в 6 мес.</li>
            <li className="rounded-lg border border-dashed border-line px-3 py-2">Домашний ПК — видеокарта, гарантия 36 мес.</li>
          </ul>
        </>
      ) : (
        <>
          <Nearest tasks={tasks} assets={assets} onOpenTask={onOpenTask} onOpenCard={setOpenId} />
          {groups.map((g, i) => (
            <section key={g.id} aria-label={g.title} className={i ? "mt-4" : ""}>
              <p className="mb-1 flex items-baseline gap-2 px-1 text-xs font-medium text-subtle">
                {g.title}
                <span className="font-normal">{g.items.length}</span>
              </p>
              <ul className="space-y-2">
                {g.items.map((x) => (
                  <Row key={x.asset.id} asset={x.asset} summary={x.summary} onOpen={() => setOpenId(x.asset.id)} />
                ))}
              </ul>
            </section>
          ))}
          <button type="button" onClick={() => setStats(true)} className="mt-3 flex h-11 items-center gap-2 px-1 text-[0.8125rem] font-medium text-accent md:hidden">
            <BarChart3 className="size-4" aria-hidden="true" /> Статистика: авто и техника
          </button>
        </>
      )}
      <Fab label="Новая карточка" onClick={() => setCreating(true)} />
      <NewAssetSheet open={creating} onClose={() => setCreating(false)} onCreated={setOpenId} />
    </div>
  );
}
