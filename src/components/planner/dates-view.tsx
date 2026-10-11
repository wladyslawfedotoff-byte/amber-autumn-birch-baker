import { useState } from "react";
import { Check, ChevronDown, ChevronRight, ExternalLink, Plus, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MilestoneShareBar } from "@/components/planner/sharing";
import { cn } from "@/lib/cn";
import { formatLong, todayIso } from "@/lib/dates";
import { usePlanner } from "@/lib/planner-store";
import type { Milestone, MilestoneItemKind, MilestoneKind } from "@/lib/planner-types";
import { ITEM_KINDS, LEAD_OPTIONS, daysLeftLabel, leadLabel, upcoming } from "@/lib/special-dates";

const KINDS: { id: MilestoneKind; label: string; icon: string }[] = [
  { id: "birthday", label: "День рождения", icon: "🎂" },
  { id: "anniversary", label: "Годовщина", icon: "💍" },
  { id: "holiday", label: "Праздник", icon: "🎉" },
  { id: "other", label: "Другое", icon: "★" },
];

const field = "h-11 rounded-md border border-line bg-surface px-3 text-sm text-fg outline-none placeholder:text-subtle";

function kindIcon(kind: MilestoneKind): string {
  return KINDS.find((item) => item.id === kind)?.icon ?? "★";
}

/** Safe external link: only http(s). */
function safeLink(value: string | null | undefined): string | null {
  if (!value) return null;
  const text = value.trim();
  const withScheme = /^https?:\/\//i.test(text) ? text : /^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(text) ? `https://${text}` : null;
  if (!withScheme) return null;
  try {
    const url = new URL(withScheme);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

export function DatesView() {
  const milestones = usePlanner((s) => s.milestones) ?? [];
  const addMilestone = usePlanner((s) => s.addMilestone);
  const today = todayIso();
  const [openId, setOpenId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [noYear, setNoYear] = useState(false);
  const [kind, setKind] = useState<MilestoneKind>("birthday");
  const [time, setTime] = useState("09:00");
  const [lead, setLead] = useState(1);
  const rows = upcoming(milestones, today);

  return (
    <div className="mx-auto max-w-2xl">
      <ul className="divide-y divide-line">
        {rows.length === 0 ? (
          <li className="py-8 text-sm text-muted">
            Памятных дат пока нет. Добавьте день рождения или годовщину ниже — укажите исходную дату (день рождения, день свадьбы), и «Пора» будет каждый
            год считать, сколько исполнится и сколько дней осталось.
          </li>
        ) : null}
        {rows.map((row) => {
          const open = openId === row.item.id;
          const items = row.item.items ?? [];
          const left = items.filter((item) => !item.done).length;
          return (
            <li key={row.item.id} className="py-3">
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpenId(open ? null : row.item.id)}
                className="flex w-full items-center gap-3 text-left"
              >
                <div className="w-16 shrink-0 text-center">
                  <p className="font-display text-2xl tabular-nums leading-none">{Math.max(0, row.days)}</p>
                  <p className="text-xs text-subtle">{row.days === 0 ? "сегодня" : "дн."}</p>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    <span aria-hidden="true">{kindIcon(row.item.kind)} </span>
                    {row.item.title}
                    {(row.item.members ?? []).length > 0 ? <Users className="ml-1 inline size-3.5 text-accent" aria-label="совместная" /> : null}
                  </p>
                  <p className="text-xs text-muted">
                    {formatLong(row.when)} · {daysLeftLabel(row.days)}
                    {row.age ? ` · ${row.age}` : ""}
                    {items.length ? ` · списки: ${left} из ${items.length}` : ""}
                  </p>
                </div>
                {open ? <ChevronDown className="size-4 text-subtle" /> : <ChevronRight className="size-4 text-subtle" />}
              </button>
              {open ? <MilestoneDetail item={row.item} onDeleted={() => setOpenId(null)} /> : null}
            </li>
          );
        })}
      </ul>

      <form
        className="mt-6 grid gap-3 rounded-lg border border-line bg-elevated p-3"
        onSubmit={(event) => {
          event.preventDefault();
          const id = addMilestone({ title, date, yearly: true, kind, remindAt: time || null, noYear, remindDays: lead });
          if (id) {
            setTitle("");
            setDate("");
            setOpenId(id);
          }
        }}
      >
        <p className="text-xs font-medium text-subtle">Новая памятная дата</p>
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Например: День рождения друга"
          aria-label="Название даты"
          className={field}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-subtle">
            {kind === "birthday" ? "Дата рождения" : kind === "anniversary" ? "Дата события (например, свадьбы)" : "Дата"}
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className={cn(field, "mt-1 w-full")} />
          </label>
          <label className="text-xs text-subtle">
            Тип
            <select value={kind} onChange={(event) => setKind(event.target.value as MilestoneKind)} className={cn(field, "mt-1 w-full")}>
              {KINDS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.icon} {item.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" checked={noYear} onChange={(event) => setNoYear(event.target.checked)} />
          Год неизвестен — выберите любой год, возраст считаться не будет
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-subtle">
            Напомнить
            <select value={lead} onChange={(event) => setLead(Number(event.target.value))} className={cn(field, "mt-1 w-full")}>
              {LEAD_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {leadLabel(n)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-subtle">
            Во сколько
            <input type="time" value={time} onChange={(event) => setTime(event.target.value)} className={cn(field, "mt-1 w-full")} />
          </label>
        </div>
        <p className="text-xs text-muted">Каждый год дата повторяется сама. 29 февраля в невисокосный год отмечается 28 февраля.</p>
        <Button type="submit" variant="primary" disabled={!title.trim() || !date}>
          Добавить дату
        </Button>
      </form>
    </div>
  );
}

function MilestoneDetail({ item, onDeleted }: { item: Milestone; onDeleted: () => void }) {
  const updateMilestone = usePlanner((s) => s.updateMilestone);
  const deleteMilestone = usePlanner((s) => s.deleteMilestone);
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="mt-3 rounded-xl bg-elevated p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-subtle sm:col-span-2">
          Название
          <input value={item.title} onChange={(event) => updateMilestone(item.id, { title: event.target.value })} className={cn(field, "mt-1 w-full")} />
        </label>
        <label className="text-xs text-subtle">
          Исходная дата
          <input
            type="date"
            value={item.date}
            onChange={(event) => event.target.value && updateMilestone(item.id, { date: event.target.value })}
            className={cn(field, "mt-1 w-full")}
          />
        </label>
        <label className="text-xs text-subtle">
          Тип
          <select value={item.kind} onChange={(event) => updateMilestone(item.id, { kind: event.target.value as MilestoneKind })} className={cn(field, "mt-1 w-full")}>
            {KINDS.map((k) => (
              <option key={k.id} value={k.id}>
                {k.icon} {k.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" checked={Boolean(item.noYear)} onChange={(event) => updateMilestone(item.id, { noYear: event.target.checked })} />
          Год неизвестен
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" checked={item.yearly} onChange={(event) => updateMilestone(item.id, { yearly: event.target.checked })} />
          Повторять каждый год
        </label>
        <label className="text-xs text-subtle">
          Напомнить
          <select
            value={item.remindDays ?? 0}
            onChange={(event) => updateMilestone(item.id, { remindDays: Number(event.target.value) })}
            className={cn(field, "mt-1 w-full")}
          >
            {LEAD_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {leadLabel(n)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-subtle">
          Во сколько (пусто — без напоминания)
          <input
            type="time"
            value={item.remindAt ?? ""}
            onChange={(event) => updateMilestone(item.id, { remindAt: event.target.value || null })}
            className={cn(field, "mt-1 w-full")}
          />
        </label>
      </div>
      <MilestoneShareBar item={item} />
      {ITEM_KINDS.map((section) => (
        <ItemSection key={section.id} item={item} kind={section.id} label={section.label} hint={section.hint} />
      ))}
      <div className="mt-4 flex justify-end">
        {confirm ? (
          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              deleteMilestone(item.id);
              onDeleted();
            }}
          >
            Удалить дату и списки
          </Button>
        ) : (
          <Button variant="ghost" size="sm" className="text-danger" onClick={() => setConfirm(true)}>
            Удалить
          </Button>
        )}
      </div>
    </div>
  );
}

function ItemSection({ item, kind, label, hint }: { item: Milestone; kind: MilestoneItemKind; label: string; hint: string }) {
  const addItem = usePlanner((s) => s.addMilestoneItem);
  const updateItem = usePlanner((s) => s.updateMilestoneItem);
  const deleteItem = usePlanner((s) => s.deleteMilestoneItem);
  const [title, setTitle] = useState("");
  const [link, setLink] = useState("");
  const [price, setPrice] = useState("");
  const rows = (item.items ?? []).filter((row) => row.kind === kind);
  const gift = kind === "gift" || kind === "buy";
  return (
    <section className="mt-4">
      <h3 className="text-xs font-medium text-subtle">
        {label} {rows.length ? <span className="tabular-nums">· {rows.filter((row) => row.done).length}/{rows.length}</span> : null}
      </h3>
      <ul>
        {rows.map((row) => {
          const href = safeLink(row.link);
          return (
            <li key={row.id} className="flex min-h-10 items-center gap-2 text-sm">
              <button
                type="button"
                aria-pressed={row.done}
                aria-label={`${row.done ? "Снять отметку" : "Отметить"}: ${row.title}`}
                onClick={() => updateItem(item.id, row.id, { done: !row.done })}
                className="flex size-10 shrink-0 items-center justify-center"
              >
                <span
                  className={cn(
                    "flex size-5 items-center justify-center rounded-full border",
                    row.done ? "border-accent bg-accent text-accent-fg" : "border-line",
                  )}
                >
                  {row.done ? <Check className="size-3" strokeWidth={3} /> : null}
                </span>
              </button>
              <span className={cn("min-w-0 flex-1 truncate", row.done ? "text-subtle line-through" : "text-fg")}>{row.title}</span>
              {row.price ? <span className="shrink-0 text-xs tabular-nums text-muted">{row.price}</span> : null}
              {href ? (
                <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="flex size-9 shrink-0 items-center justify-center text-accent" aria-label={`Ссылка: ${row.title}`}>
                  <ExternalLink className="size-4" />
                </a>
              ) : null}
              <button
                type="button"
                aria-label={`Удалить: ${row.title}`}
                onClick={() => deleteItem(item.id, row.id)}
                className="flex size-9 shrink-0 items-center justify-center text-subtle hover:text-danger"
              >
                <Trash2 className="size-4" />
              </button>
            </li>
          );
        })}
      </ul>
      <form
        className="mt-1 flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!title.trim()) return;
          addItem(item.id, kind, title, gift ? { link, price } : undefined);
          setTitle("");
          setLink("");
          setPrice("");
        }}
      >
        {gift ? null : <Plus className="size-4 shrink-0 text-subtle" aria-hidden="true" />}
        <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={hint} aria-label={`Добавить: ${label}`} className={cn(field, gift ? "w-full" : "min-w-40 flex-1")} />
        {gift ? (
          <>
            <input value={link} onChange={(event) => setLink(event.target.value)} placeholder="Ссылка (необязательно)" aria-label="Ссылка" inputMode="url" className={cn(field, "min-w-40 flex-1")} />
            <input value={price} onChange={(event) => setPrice(event.target.value)} placeholder="Цена, напр. 2 500 ₽" aria-label="Цена" className={cn(field, "w-36")} />
          </>
        ) : null}
        <Button type="submit" variant="soft" size="sm" disabled={!title.trim()}>
          Добавить
        </Button>
      </form>
    </section>
  );
}
