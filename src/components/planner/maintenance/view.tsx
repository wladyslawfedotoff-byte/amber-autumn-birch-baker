import { useState } from "react";
import { BarChart3, ChevronRight, Plus, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Empty } from "@/components/planner/empty-state";
import { Fab } from "@/components/planner/quick-composer";
import { todayIso } from "@/lib/dates";
import { groupKm, stateText } from "@/lib/maintenance/rules";
import { sortAssets, type AssetSummary } from "@/lib/maintenance/ops";
import { usePlanner } from "@/lib/planner-store";
import type { Asset } from "@/lib/planner-types";
import { AssetCardView } from "./card";
import { NewAssetSheet } from "./sheets";
import { Badge, KindIcon, subtitle } from "./shared";
import { StatsView } from "./stats";

function lineOf(asset: Asset, summary: AssetSummary): string {
  const lead = summary.lead;
  if (!lead) {
    if (!asset.rules.length) return asset.kind === "car" && asset.km != null ? `${groupKm(asset.km)} км · правил пока нет` : "Правил пока нет — откройте и добавьте";
    return "Все правила выполнены";
  }
  const text = `${lead.rule.title} — ${stateText(lead.rule, lead.state)}`;
  return asset.kind === "car" && asset.km != null && lead.state.status === "ok" ? `${groupKm(asset.km)} км · ${text}` : text;
}

function Row({ asset, summary, onOpen }: { asset: Asset; summary: AssetSummary; onOpen: () => void }) {
  const hasRule = summary.lead !== null;
  return (
    <li>
      <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 rounded-xl bg-elevated px-3 py-2.5 text-left">
        <KindIcon kind={asset.kind} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[0.9375rem] font-semibold">{asset.name}</span>
          <span className="block truncate text-xs text-accent">{subtitle(asset)}</span>
          <span className="block truncate text-xs text-subtle">{lineOf(asset, summary)}</span>
        </span>
        {summary.openPains > 0 ? <TriangleAlert className="size-4 shrink-0 text-warn" aria-label={`Что болит: ${summary.openPains}`} /> : null}
        {hasRule ? <Badge status={summary.status} /> : <ChevronRight className="size-4 shrink-0 text-subtle" aria-hidden="true" />}
      </button>
    </li>
  );
}

export function MaintenanceView() {
  const assets = usePlanner((s) => s.assets) ?? [];
  const [openId, setOpenId] = useState<string | null>(null);
  const [stats, setStats] = useState(false);
  const [creating, setCreating] = useState(false);
  const asset = assets.find((a) => a.id === openId) ?? null;

  if (stats) return <StatsView assets={assets} onBack={() => setStats(false)} />;
  if (asset) return <AssetCardView asset={asset} onBack={() => setOpenId(null)} onStats={() => setStats(true)} />;

  const sorted = sortAssets(assets, todayIso());
  const attention = sorted.filter((x) => x.summary.status !== "ok");
  const fine = sorted.filter((x) => x.summary.status === "ok");
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
          <Empty title="Пока ничего нет" hint="Добавьте карточку — Автомобиль, Техника, Расходник или Другое. Пора напомнит, когда пора менять или обслуживать." />
          <ul className="mx-auto max-w-sm space-y-1 px-4 text-[0.8125rem] text-muted">
            <li className="rounded-lg border border-dashed border-line px-3 py-2">Легковая — масло каждые 10 000 км или 12 мес.</li>
            <li className="rounded-lg border border-dashed border-line px-3 py-2">Фильтр воды — менять раз в 6 мес.</li>
            <li className="rounded-lg border border-dashed border-line px-3 py-2">Пылесос — фильтр раз в год</li>
          </ul>
        </>
      ) : (
        <>
          {attention.length ? (
            <section aria-label="Нужно внимание">
              <p className="mb-1 px-1 text-xs font-medium text-subtle">Нужно внимание</p>
              <ul className="space-y-1.5">
                {attention.map((x) => (
                  <Row key={x.asset.id} asset={x.asset} summary={x.summary} onOpen={() => setOpenId(x.asset.id)} />
                ))}
              </ul>
            </section>
          ) : null}
          {fine.length ? (
            <section aria-label="Всё в порядке" className={attention.length ? "mt-4" : ""}>
              <p className="mb-1 px-1 text-xs font-medium text-subtle">{attention.length ? "Всё в порядке" : "Карточки"}</p>
              <ul className="space-y-1.5">
                {fine.map((x) => (
                  <Row key={x.asset.id} asset={x.asset} summary={x.summary} onOpen={() => setOpenId(x.asset.id)} />
                ))}
              </ul>
            </section>
          ) : null}
          <button type="button" onClick={() => setStats(true)} className="mt-3 flex h-11 items-center gap-1.5 px-1 text-[0.8125rem] font-medium text-accent md:hidden">
            <BarChart3 className="size-4" aria-hidden="true" /> Статистика: км по месяцам и расходы
          </button>
        </>
      )}
      <Fab label="Новая карточка" onClick={() => setCreating(true)} />
      <NewAssetSheet open={creating} onClose={() => setCreating(false)} onCreated={setOpenId} />
    </div>
  );
}
