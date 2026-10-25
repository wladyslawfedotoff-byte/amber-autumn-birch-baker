import { useState } from "react";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { FieldLabel } from "@/components/ui/hint";
import { cn } from "@/lib/cn";
import { formatShortDay, todayIso } from "@/lib/dates";
import { cleanNumber, painTaskId } from "@/lib/maintenance/ops";
import { groupKm } from "@/lib/maintenance/rules";
import { usePlanner } from "@/lib/planner-store";
import type { Asset, PainNote } from "@/lib/planner-types";
import { deleteFile } from "@/lib/attachments/runtime";
import { AssetObjects } from "./objects";
import { field, smallLabel } from "./shared";

type Mode = "date" | "days" | "km";

/** «запланировано на 20 окт» / «запланировано при 90 000 км» (empty when not planned). */
export function planText(pain: PainNote): string {
  if (pain.planDate) return `запланировано на ${formatShortDay(pain.planDate)} ${pain.planDate.slice(0, 4)}`;
  if (pain.planKm) return `запланировано при ${groupKm(pain.planKm)} км`;
  return "";
}

/** One note: its text, «что сделать», the plan (a date, N days or a mileage → a Pora task) and «решено». */
export function PainSheet({ asset, painId, onClose, onOpenTask }: { asset: Asset; painId: string; onClose: () => void; onOpenTask?: (taskId: string) => void }) {
  const pain = asset.pains.find((p) => p.id === painId);
  const update = usePlanner((s) => s.updateAssetPain);
  const plan = usePlanner((s) => s.planAssetPain);
  const unplan = usePlanner((s) => s.unplanAssetPain);
  const solve = usePlanner((s) => s.setAssetPainSolved);
  const remove = usePlanner((s) => s.deleteAssetPain);
  const task = usePlanner((s) => s.tasks.find((t) => t.id === painTaskId(painId)));
  const car = asset.kind === "car";
  const [text, setText] = useState(pain?.text ?? "");
  const [todo, setTodo] = useState(pain?.todo ?? "");
  const [mode, setMode] = useState<Mode>(pain?.planKm ? "km" : "date");
  const [date, setDate] = useState(pain?.planDate ?? "");
  const [days, setDays] = useState("");
  const [km, setKm] = useState(pain?.planKm ? String(pain.planKm) : "");
  const [changing, setChanging] = useState(false);
  const [confirm, setConfirm] = useState(false);
  if (!pain) return null;
  const planned = Boolean(pain.planDate || pain.planKm);
  const form = !planned || changing;
  const value = mode === "date" ? Boolean(date) : mode === "days" ? days.trim() !== "" && cleanNumber(days, 3650) !== undefined : cleanNumber(km) !== undefined && Number(km) > 0;
  const okText = text.trim().length > 0;
  const dropNote = async () => {
    for (const f of (asset.attachments ?? []).filter((a) => a.entryId === pain.id)) await deleteFile({ kind: "asset", id: asset.id }, f.id);
    remove(asset.id, pain.id);
    onClose();
  };
  const save = () => {
    if (!okText) return false;
    return update(asset.id, pain.id, text, todo);
  };
  const schedule = () => {
    if (!value || !save()) return;
    if (plan(asset.id, pain.id, mode === "date" ? { date } : mode === "days" ? { days } : { km })) setChanging(false);
  };
  const tab = (id: Mode, label: string) => (
    <button key={id} type="button" role="tab" aria-selected={mode === id} onClick={() => setMode(id)} className={cn("h-9 flex-1 rounded-lg text-[0.8125rem] font-medium", mode === id ? "bg-surface text-fg shadow-sm" : "text-muted")}>
      {label}
    </button>
  );
  return (
    <Sheet open title="Что болит" onClose={onClose} action={{ label: "Готово", onClick: () => { if (save()) onClose(); }, disabled: !okText }}>
      <div className="space-y-2">
        <label className="block">
          <span className={smallLabel}>Что болит</span>
          <textarea value={text} onChange={(e) => setText(e.target.value)} aria-label="Текст заметки" rows={2} maxLength={500} className={cn(field, "h-auto py-2.5")} />
        </label>
        <label className="block">
          <span className={smallLabel}>Что сделать</span>
          <input value={todo} onChange={(e) => setTodo(e.target.value)} aria-label="Что сделать" maxLength={500} placeholder="Например: заменить передние стойки" className={field} />
        </label>

        <AssetObjects asset={asset} parentId={pain.id} label="Фото, файлы и ссылки заметки" />

        <div className="rounded-xl bg-elevated p-3">
          <FieldLabel hint="Пора создаст обычную задачу с напоминанием: на дату, через N дней или когда пробег подойдёт к нужному (как «скоро» у правил). Отметите задачу — заметка станет решённой, и Пора предложит записать работу в историю.">Запланировать</FieldLabel>
          {planned && !changing ? (
            <div className="mt-1">
              <p className="text-[0.9375rem]">
                {planText(pain)}
                {task && !task.done ? (
                  <>
                    {" · "}
                    <button type="button" className="font-medium text-accent underline underline-offset-2" onClick={() => { onClose(); onOpenTask?.(task.id); }}>
                      открыть задачу
                    </button>
                  </>
                ) : null}
              </p>
              {pain.planKm && !task ? <p className="mt-0.5 text-xs text-muted">Задача появится, когда пробег подойдёт ближе чем на {groupKm(asset.soonKm ?? 500)} км.</p> : null}
              {task?.done ? <p className="mt-0.5 text-xs text-muted">Задача выполнена.</p> : null}
              {!task && pain.planDate && pain.taskMade ? <p className="mt-0.5 text-xs text-muted">Задачу удалили — запланируйте заново, если нужна.</p> : null}
              <div className="mt-1 flex gap-2">
                <Button variant="soft" onClick={() => setChanging(true)}>Изменить срок</Button>
                <Button variant="soft" className="text-danger" onClick={() => unplan(asset.id, pain.id)}>Снять план</Button>
              </div>
            </div>
          ) : null}
          {form ? (
            <div className="mt-1 space-y-2">
              <div role="tablist" aria-label="Срок" className="flex gap-1 rounded-xl bg-line/40 p-1">
                {tab("date", "Дата")}
                {tab("days", "Через N дней")}
                {car ? tab("km", "При пробеге") : null}
              </div>
              {mode === "date" ? (
                <input type="date" aria-label="Дата" value={date} min={todayIso()} onChange={(e) => setDate(e.target.value)} className={cn(field, "text-left")} />
              ) : mode === "days" ? (
                <input inputMode="numeric" aria-label="Через сколько дней" value={days} onChange={(e) => setDays(e.target.value)} placeholder="Например: 14" className={field} />
              ) : (
                <input inputMode="numeric" aria-label="Пробег, км" value={km} onChange={(e) => setKm(e.target.value)} placeholder={asset.km ? `Сейчас ${groupKm(asset.km)} км` : "Например: 90 000"} className={field} />
              )}
              <Button variant="primary" className="w-full" disabled={!value || !okText} onClick={schedule}>
                Запланировать
              </Button>
            </div>
          ) : null}
        </div>

        <div className="flex gap-2 pt-2">
          {pain.solvedAt ? (
            <Button variant="soft" className="flex-1" onClick={() => solve(asset.id, pain.id, false)}>Вернуть в «Что болит»</Button>
          ) : (
            <Button variant="soft" className="flex-1" onClick={() => { solve(asset.id, pain.id, true); onClose(); }}>Решено</Button>
          )}
          {confirm ? (
            <Button variant="destructive" onClick={() => void dropNote()}>Удалить?</Button>
          ) : (
            <Button variant="soft" className="text-danger" onClick={() => setConfirm(true)}>Удалить</Button>
          )}
        </div>
      </div>
    </Sheet>
  );
}
