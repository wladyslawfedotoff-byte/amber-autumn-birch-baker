import { useState } from "react";
import { Check, ChevronLeft, ExternalLink, Pencil, Plus, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { Row, RowGroup, SwitchRow } from "@/components/ui/rows";
import { FieldLabel, Hint } from "@/components/ui/hint";
import { ColorPicker } from "@/components/planner/color-picker";
import { PickerInput } from "@/components/planner/picker-input";
import { MilestoneShareBar } from "@/components/planner/sharing";
import { cn } from "@/lib/cn";
import { formatLong, todayIso } from "@/lib/dates";
import { usePlanner } from "@/lib/planner-store";
import type { Milestone, MilestoneItemKind, MilestoneKind } from "@/lib/planner-types";
import { colorHex, colorLabel, type TaskColor } from "@/lib/task-colors";
import {
  ITEM_KINDS,
  KINDS,
  LEAD_OPTIONS,
  TODAY_OPTIONS,
  ageLabel,
  countLabel,
  daysLeftLabel,
  iconOf,
  kindMeta,
  leadDays,
  leadsLabel,
  shortAge,
  showsAge,
  upcoming,
  type Upcoming,
} from "@/lib/special-dates";

const ICONS = ["🎂", "💍", "🎉", "⏳", "🎄", "❤️", "👶", "🎓", "✈️", "🏠", "💼", "🐶", "🌸", "⭐", "🎁", "🏖️", "⚽", "📅"];
const input = "h-11 w-full rounded-lg border border-line bg-surface px-3 text-base text-fg outline-none placeholder:text-subtle";

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

function tint(color: string | null | undefined, kind: MilestoneKind): string {
  return colorHex(color) ?? colorHex(kindMeta(kind).color) ?? "#888";
}

function IconCircle({ item, size = "md" }: { item: Pick<Milestone, "icon" | "kind" | "color">; size?: "md" | "lg" }) {
  const hex = tint(item.color, item.kind);
  return (
    <span
      aria-hidden="true"
      className={cn("flex shrink-0 items-center justify-center rounded-full", size === "lg" ? "size-16 text-3xl" : "size-10 text-xl")}
      style={{ background: `color-mix(in srgb, ${hex} 22%, transparent)` }}
    >
      {iconOf(item)}
    </span>
  );
}

function BigCount({ days, color, size = "md" }: { days: number; color: string; size?: "md" | "lg" }) {
  const label = countLabel(days);
  const tone = label.past ? "var(--ok)" : color;
  return (
    <span className="flex shrink-0 flex-col items-end leading-none" style={{ color: tone }}>
      <span className={cn("font-semibold tabular-nums", size === "lg" ? "text-4xl" : days === 0 ? "text-base" : "text-2xl")}>{label.value}</span>
      {label.caption ? <span className="mt-1 text-[11px]">{label.caption}</span> : null}
    </span>
  );
}

type Editing = { mode: "new"; kind: MilestoneKind } | { mode: "edit"; id: string } | null;

export function DatesView() {
  const milestones = usePlanner((s) => s.milestones) ?? [];
  const today = todayIso();
  const [filter, setFilter] = useState<MilestoneKind | "all">("all");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [menu, setMenu] = useState(false);
  const rows = upcoming(milestones, today);
  const kinds = KINDS.filter((k) => k.id !== "other" || milestones.some((m) => m.kind === "other"));
  const shown = filter === "all" ? rows : rows.filter((row) => row.item.kind === filter);
  const detail = detailId ? rows.find((row) => row.item.id === detailId) : null;

  const editor = editing ? (
    <MilestoneEditor
      key={editing.mode === "edit" ? editing.id : `new-${editing.kind}`}
      editing={editing}
      onClose={() => setEditing(null)}
      onSaved={(id) => {
        setEditing(null);
        if (editing.mode === "new") setDetailId(id);
      }}
      onDeleted={() => {
        setEditing(null);
        setDetailId(null);
      }}
    />
  ) : null;

  if (detail) {
    return (
      <>
        <MilestoneDetails row={detail} today={today} onBack={() => setDetailId(null)} onEdit={() => setEditing({ mode: "edit", id: detail.item.id })} />
        {editor}
      </>
    );
  }

  return (
    <div className="mx-auto flex min-h-full max-w-2xl flex-col">
      <div className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 pb-2" role="tablist" aria-label="Фильтр по типу">
        {[{ id: "all" as const, label: "Все" }, ...kinds].map((k) => (
          <button
            key={k.id}
            type="button"
            role="tab"
            aria-selected={filter === k.id}
            onClick={() => setFilter(k.id)}
            className={cn(
              "h-8 shrink-0 rounded-full border px-3 text-sm",
              filter === k.id ? "border-accent bg-accent/10 font-medium text-accent" : "border-line bg-elevated text-muted",
            )}
          >
            {k.label}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <div className="px-2 py-10 text-center">
          <p className="text-base font-semibold">{filter === "all" ? "Памятных дат пока нет" : "Здесь пока пусто"}</p>
          <p className="mt-1 text-sm text-muted">Напомню заранее и посчитаю дни и возраст.</p>
          {filter === "all" ? (
            <ul className="mx-auto mt-3 max-w-xs space-y-1.5">
              {[
                { kind: "birthday" as const, icon: "🎂", label: "День рождения · каждый год" },
                { kind: "countdown" as const, icon: "⏳", label: "Отпуск · отсчёт дней" },
              ].map((ex) => (
                <li key={ex.kind}>
                  <button
                    type="button"
                    onClick={() => setEditing({ mode: "new", kind: ex.kind })}
                    className="flex h-10 w-full items-center gap-2 rounded-xl border border-dashed border-line px-3 text-left text-sm text-muted"
                  >
                    <span aria-hidden="true">{ex.icon}</span>
                    <span className="min-w-0 flex-1 truncate">{ex.label}</span>
                    <Plus className="size-4 shrink-0 text-accent" aria-label="Добавить" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <ul className="space-y-2">
        {shown.map((row) => (
          <li key={row.item.id}>
            <DateCard row={row} onOpen={() => setDetailId(row.item.id)} />
          </li>
        ))}
      </ul>

      <div className="flex-1" />
      <div className="pointer-events-none sticky bottom-2 mt-4 flex justify-end">
        <button
          type="button"
          aria-label="Добавить дату"
          aria-haspopup="dialog"
          onClick={() => setMenu(true)}
          className="pointer-events-auto flex size-14 items-center justify-center rounded-full bg-accent text-accent-fg shadow-lg"
        >
          <Plus className="size-7" />
        </button>
      </div>

      <Sheet open={menu} title="Новая дата" onClose={() => setMenu(false)}>
        <RowGroup className="mt-1">
          {KINDS.map((k) => (
            <Row
              key={k.id}
              icon={<span className="text-lg">{k.icon}</span>}
              label={k.label}
              value={k.id === "countdown" ? "один раз" : k.id === "other" ? "" : "каждый год"}
              onClick={() => {
                setMenu(false);
                setEditing({ mode: "new", kind: k.id });
              }}
            />
          ))}
        </RowGroup>
      </Sheet>
      {editor}
    </div>
  );
}

function DateCard({ row, onOpen }: { row: Upcoming; onOpen: () => void }) {
  const { item } = row;
  const age = shortAge(item, row.when);
  const items = item.items ?? [];
  const left = items.filter((i) => !i.done).length;
  return (
    <button type="button" onClick={onOpen} className="card-lift flex min-h-16 w-full items-center gap-3 rounded-2xl bg-elevated px-3 py-2.5 text-left">
      <IconCircle item={item} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium">
          {item.title}
          {age ? <span className="font-normal text-muted"> {age}</span> : null}
          {(item.members ?? []).length > 0 ? <Users className="ml-1 inline size-3.5 text-accent" aria-label="совместная" /> : null}
        </span>
        <span className="block truncate text-xs text-subtle">
          {formatLong(row.when)}
          {items.length ? ` · списки ${items.length - left}/${items.length}` : ""}
        </span>
      </span>
      <BigCount days={row.days} color={tint(item.color, item.kind)} />
    </button>
  );
}

function MilestoneDetails({ row, today, onBack, onEdit }: { row: Upcoming; today: string; onBack: () => void; onEdit: () => void }) {
  const { item } = row;
  const meta = kindMeta(item.kind);
  const age = ageLabel(item, row.when, today);
  return (
    <div className="mx-auto max-w-2xl pb-6">
      <div className="-mx-2 flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={onBack} className="px-2 text-accent">
          <ChevronLeft className="size-5" /> Даты
        </Button>
        <Button variant="ghost" size="sm" onClick={onEdit} className="px-3 text-accent">
          <Pencil className="size-4" /> Изменить
        </Button>
      </div>

      <section className="card-lift mt-1 flex flex-col items-center rounded-2xl bg-elevated px-4 py-5 text-center">
        <IconCircle item={item} size="lg" />
        <h2 className="mt-2 text-lg font-semibold">{item.title}</h2>
        <p className="text-xs text-subtle">{meta.label}</p>
        <div className="mt-3">
          <BigCount days={row.days} color={tint(item.color, item.kind)} size="lg" />
        </div>
        <p className="mt-3 text-sm text-muted">
          {formatLong(row.when)}
          {row.days !== 0 ? ` · ${daysLeftLabel(row.days)}` : ""}
          {age ? ` · ${age}` : ""}
        </p>
        {item.yearly && !item.noYear ? <p className="text-xs text-subtle">с {item.date.slice(0, 4)} года · каждый год</p> : null}
        {item.notes ? <p className="mt-2 text-sm whitespace-pre-line">{item.notes}</p> : null}
      </section>

      <RowGroup>
        <Row label="Напоминания" value={leadsLabel(item)} onClick={onEdit} />
        <Row
          label="В «Сегодня»"
          value={TODAY_OPTIONS.find((o) => o.value === (item.showInToday === undefined ? 0 : item.showInToday))?.label ?? `за ${item.showInToday} дн.`}
          onClick={onEdit}
        />
      </RowGroup>

      <MilestoneShareBar item={item} />

      {ITEM_KINDS.map((section) => (
        <ItemSection key={section.id} item={item} kind={section.id} label={section.label} hint={section.hint} />
      ))}
    </div>
  );
}

type Draft = {
  title: string;
  date: string;
  kind: MilestoneKind;
  icon: string | null;
  color: TaskColor | null;
  yearly: boolean;
  noYear: boolean;
  showAge: boolean;
  remindAt: string;
  reminders: number[];
  showInToday: number | null;
  notes: string;
};

function draftOf(item: Milestone | undefined, kind: MilestoneKind): Draft {
  if (item) {
    return {
      title: item.title,
      date: item.date,
      kind: item.kind,
      icon: item.icon ?? null,
      color: item.color ?? null,
      yearly: item.yearly,
      noYear: Boolean(item.noYear),
      showAge: showsAge({ ...item, noYear: false }),
      remindAt: item.remindAt ?? "",
      reminders: item.remindAt ? leadDays(item) : [0],
      showInToday: item.showInToday === undefined ? 0 : item.showInToday,
      notes: item.notes ?? "",
    };
  }
  const meta = kindMeta(kind);
  return {
    title: "",
    date: "",
    kind,
    icon: null,
    color: null,
    yearly: meta.yearly,
    noYear: false,
    showAge: meta.age,
    remindAt: "09:00",
    reminders: kind === "countdown" ? [0] : [0, 3],
    showInToday: 0,
    notes: "",
  };
}

/** Add / edit a date in a bottom sheet: icon, name, date, reminders, repeat, type, age, «Сегодня». */
function MilestoneEditor({
  editing,
  onClose,
  onSaved,
  onDeleted,
}: {
  editing: NonNullable<Editing>;
  onClose: () => void;
  onSaved: (id: string) => void;
  onDeleted: () => void;
}) {
  const item = usePlanner((s) => (editing.mode === "edit" ? s.milestones.find((m) => m.id === editing.id) : undefined));
  const addMilestone = usePlanner((s) => s.addMilestone);
  const updateMilestone = usePlanner((s) => s.updateMilestone);
  const deleteMilestone = usePlanner((s) => s.deleteMilestone);
  const [d, setD] = useState<Draft>(() => draftOf(item, editing.mode === "new" ? editing.kind : "other"));
  const [open, setOpen] = useState<string | null>(null);
  const [icons, setIcons] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const meta = kindMeta(d.kind);
  const set = (patch: Partial<Draft>) => setD((cur) => ({ ...cur, ...patch }));
  const toggle = (id: string) => setOpen((cur) => (cur === id ? null : id));
  const valid = d.title.trim() && /^\d{4}-\d{2}-\d{2}$/.test(d.date);
  const leads = d.reminders.length ? d.reminders : [0];
  const remindValue = d.remindAt ? leadsLabel({ reminders: leads, remindAt: d.remindAt }) : "Нет";

  const save = () => {
    if (!valid) return;
    const fields = {
      title: d.title.trim(),
      date: d.date,
      kind: d.kind,
      yearly: d.yearly,
      noYear: d.noYear,
      remindAt: d.remindAt || null,
      reminders: leads,
      icon: d.icon,
      color: d.color,
      showAge: d.showAge,
      showInToday: d.showInToday,
      notes: d.notes.trim(),
    };
    if (editing.mode === "edit" && item) {
      updateMilestone(item.id, fields);
      onSaved(item.id);
    } else {
      const id = addMilestone(fields);
      if (id) onSaved(id);
    }
  };

  return (
    <Sheet open title={editing.mode === "edit" ? "Изменить" : meta.label} onClose={onClose} action={{ label: editing.mode === "edit" ? "Готово" : "Добавить", onClick: save, disabled: !valid }}>
      <div className="flex flex-col items-center">
        <button type="button" aria-label="Выбрать значок" aria-expanded={icons} onClick={() => setIcons(!icons)} className="relative">
          <IconCircle item={{ icon: d.icon, kind: d.kind, color: d.color }} size="lg" />
          <span className="absolute -right-0.5 -bottom-0.5 flex size-6 items-center justify-center rounded-full bg-surface text-subtle shadow">
            <Pencil className="size-3" />
          </span>
        </button>
        {icons ? (
          <div className="mt-2 grid grid-cols-9 gap-1">
            {ICONS.map((icon) => (
              <button
                key={icon}
                type="button"
                aria-pressed={iconOf(d) === icon}
                onClick={() => {
                  set({ icon: icon === meta.icon ? null : icon });
                  setIcons(false);
                }}
                className={cn("flex size-9 items-center justify-center rounded-full text-lg", iconOf(d) === icon ? "bg-accent/15 ring-2 ring-accent" : "bg-elevated")}
              >
                {icon}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <input
        value={d.title}
        onChange={(event) => set({ title: event.target.value })}
        placeholder={meta.example}
        aria-label="Название"
        maxLength={200}
        className={cn(input, "mt-3 bg-elevated")}
      />

      <RowGroup>
        <div className="flex min-h-11 items-center gap-3 px-3">
          <span className="shrink-0 text-[15px]">{meta.dateLabel}</span>
          <PickerInput
            type="date"
            value={d.date}
            aria-label={meta.dateLabel}
            onValue={(date) => set({ date })}
            className="ml-auto h-9 w-[10.5rem] rounded-md bg-surface px-2 text-right text-base text-fg"
          />
        </div>
        <Row label="Напоминания" value={remindValue} open={open === "remind"} onClick={() => toggle("remind")}>
          <div className="flex flex-wrap gap-1.5">
            {LEAD_OPTIONS.map((n) => {
              const on = Boolean(d.remindAt) && leads.includes(n);
              return (
                <button
                  key={n}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    const next = on ? leads.filter((x) => x !== n) : [...leads, n];
                    set({ reminders: next.sort((a, b) => a - b), remindAt: d.remindAt || "09:00" });
                  }}
                  className={cn("h-9 rounded-full border px-3 text-sm", on ? "border-accent bg-accent text-accent-fg" : "border-line text-fg")}
                >
                  {n === 0 ? "в день" : `за ${n}`}
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <span className="text-sm text-muted">во сколько</span>
            <PickerInput type="time" value={d.remindAt} aria-label="Во сколько" onValue={(remindAt) => set({ remindAt })} className="h-9 w-28 rounded-md border border-line bg-surface px-2 text-base" />
            <button type="button" onClick={() => set({ remindAt: "" })} className="ml-auto h-9 px-2 text-sm text-danger">
              Без напоминания
            </button>
          </div>
          <p className="mt-1 text-xs text-muted">Можно несколько: например, «в день» и «за 3» — чтобы успеть с подарком.</p>
        </Row>
        <SwitchRow label="Каждый год" checked={d.yearly} onChange={(yearly) => set({ yearly })} />
      </RowGroup>

      <RowGroup>
        <Row label="Тип" value={meta.label} open={open === "kind"} onClick={() => toggle("kind")}>
          <div className="flex flex-wrap gap-1.5">
            {KINDS.map((k) => (
              <button
                key={k.id}
                type="button"
                aria-pressed={d.kind === k.id}
                onClick={() => set({ kind: k.id, yearly: k.yearly, showAge: k.age })}
                className={cn("h-9 rounded-full border px-3 text-sm", d.kind === k.id ? "border-accent bg-accent text-accent-fg" : "border-line text-fg")}
              >
                {k.icon} {k.label}
              </button>
            ))}
          </div>
          {d.kind === "countdown" ? <p className="mt-1 text-xs text-muted">Отсчёт до события: после даты показывает, сколько дней прошло.</p> : null}
        </Row>
        {d.yearly ? (
          <>
            <SwitchRow label="Показать возраст" checked={d.showAge && !d.noYear} onChange={(showAge) => set({ showAge, noYear: showAge ? false : d.noYear })} />
            <SwitchRow
              label={
                <>
                  Год неизвестен
                  <Hint label="Подсказка: год неизвестен">Выберите любой год — возраст считаться не будет. 29 февраля в невисокосный год отмечается 28-го.</Hint>
                </>
              }
              checked={d.noYear}
              onChange={(noYear) => set({ noYear })}
            />
          </>
        ) : null}
        <Row
          label="В «Сегодня»"
          value={TODAY_OPTIONS.find((o) => o.value === d.showInToday)?.label ?? ""}
          open={open === "today"}
          onClick={() => toggle("today")}
        >
          <div className="flex flex-wrap gap-1.5">
            {TODAY_OPTIONS.map((o) => (
              <button
                key={String(o.value)}
                type="button"
                aria-pressed={d.showInToday === o.value}
                onClick={() => set({ showInToday: o.value })}
                className={cn("h-9 rounded-full border px-3 text-sm", d.showInToday === o.value ? "border-accent bg-accent text-accent-fg" : "border-line text-fg")}
              >
                {o.label}
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs text-muted">Дата появится строкой вверху «Сегодня» — заранее, если выбрать «за 3 дня».</p>
        </Row>
        <Row
          label="Цвет"
          value={
            <span className="inline-flex items-center gap-1.5">
              <span className="size-3 rounded-full" style={{ background: tint(d.color, d.kind) }} />
              {d.color ? colorLabel(d.color) : "по типу"}
            </span>
          }
          open={open === "color"}
          onClick={() => toggle("color")}
        >
          <ColorPicker bare value={d.color} onChange={(color) => set({ color })} />
        </Row>
      </RowGroup>

      <FieldLabel className="mt-3 px-1">Заметка</FieldLabel>
      <textarea
        value={d.notes}
        rows={2}
        maxLength={2000}
        aria-label="Заметка"
        placeholder={d.kind === "birthday" ? "Например: любит книги о фотографии, размер M" : "Например: билеты, бронь, что взять"}
        onChange={(event) => set({ notes: event.target.value })}
        className={cn(input, "mt-1 h-auto bg-elevated py-2")}
      />

      {editing.mode === "edit" && item ? (
        <div className="mt-4 flex justify-center">
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
              <Trash2 className="size-4" /> Удалить
            </Button>
          )}
        </div>
      ) : null}
    </Sheet>
  );
}

function ItemSection({ item, kind, label, hint }: { item: Milestone; kind: MilestoneItemKind; label: string; hint: string }) {
  const addItem = usePlanner((s) => s.addMilestoneItem);
  const updateItem = usePlanner((s) => s.updateMilestoneItem);
  const deleteItem = usePlanner((s) => s.deleteMilestoneItem);
  const [title, setTitle] = useState("");
  const [link, setLink] = useState("");
  const [price, setPrice] = useState("");
  const [extra, setExtra] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const rows = (item.items ?? []).filter((row) => row.kind === kind);
  const shop = kind === "gift" || kind === "buy";
  return (
    <section className="mt-4">
      <h3 className="mb-1 px-1 text-xs font-medium text-subtle">
        {label} {rows.length ? <span className="tabular-nums">· {rows.filter((row) => row.done).length}/{rows.length}</span> : null}
      </h3>
      <div className="divide-y divide-line overflow-hidden rounded-xl bg-elevated">
        {rows.map((row) => {
          const href = safeLink(row.link);
          const editingRow = editId === row.id;
          return (
            <div key={row.id}>
              <div className="flex min-h-11 items-center gap-1 pr-1">
                <button
                  type="button"
                  aria-pressed={row.done}
                  aria-label={`${row.done ? "Снять отметку" : "Отметить"}: ${row.title}`}
                  onClick={() => updateItem(item.id, row.id, { done: !row.done })}
                  className="flex size-11 shrink-0 items-center justify-center"
                >
                  <span className={cn("flex size-5 items-center justify-center rounded-full border", row.done ? "border-accent bg-accent text-accent-fg" : "border-line")}>
                    {row.done ? <Check className="size-3" strokeWidth={3} /> : null}
                  </span>
                </button>
                <button
                  type="button"
                  aria-expanded={shop ? editingRow : undefined}
                  onClick={() => shop && setEditId(editingRow ? null : row.id)}
                  className={cn("min-w-0 flex-1 truncate text-left text-[15px]", row.done ? "text-subtle line-through" : "text-fg")}
                >
                  {row.title}
                </button>
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
              </div>
              {editingRow ? (
                <div className="grid gap-2 px-3 pb-3">
                  <input
                    defaultValue={row.link ?? ""}
                    placeholder="Ссылка на магазин"
                    aria-label={`Ссылка: ${row.title}`}
                    inputMode="url"
                    onBlur={(event) => updateItem(item.id, row.id, { link: event.target.value.trim() || null })}
                    className={input}
                  />
                  <input
                    defaultValue={row.price ?? ""}
                    placeholder="Цена, например 2 500 ₽"
                    aria-label={`Цена: ${row.title}`}
                    onBlur={(event) => updateItem(item.id, row.id, { price: event.target.value.trim() || null })}
                    className={input}
                  />
                </div>
              ) : null}
            </div>
          );
        })}
        <form
          className="px-3 py-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            if (!title.trim()) return;
            addItem(item.id, kind, title, shop ? { link, price } : undefined);
            setTitle("");
            setLink("");
            setPrice("");
            setExtra(false);
          }}
        >
          <div className="flex items-center gap-2">
            <Plus className="size-4 shrink-0 text-subtle" aria-hidden="true" />
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={hint}
              aria-label={`Добавить: ${label}`}
              className="h-9 min-w-0 flex-1 bg-transparent text-base text-fg outline-none placeholder:text-subtle"
            />
            {shop && title.trim() && !extra ? (
              <button type="button" onClick={() => setExtra(true)} className="h-9 shrink-0 px-1 text-xs text-accent">
                + ссылка, цена
              </button>
            ) : null}
            {title.trim() ? (
              <button type="submit" className="h-8 shrink-0 rounded-full bg-accent px-3 text-sm text-accent-fg">
                Добавить
              </button>
            ) : null}
          </div>
          {shop && extra ? (
            <div className="mt-1 grid gap-2 pb-1.5">
              <input value={link} onChange={(event) => setLink(event.target.value)} placeholder="Ссылка (необязательно)" aria-label="Ссылка" inputMode="url" className={input} />
              <input value={price} onChange={(event) => setPrice(event.target.value)} placeholder="Цена, например 2 500 ₽" aria-label="Цена" className={input} />
            </div>
          ) : null}
        </form>
      </div>
    </section>
  );
}
