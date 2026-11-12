import { useCallback, useEffect, useState } from "react";
import { Bot, ChevronDown, Copy } from "lucide-react";
import { InlineHint } from "@/components/ui/hint";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/kit";
import { cn } from "@/lib/cn";

/** «Помощники» (1.25): keys for bots that add tasks (API /api/helper/*, docs/HELPER-API.md). */
export type HelperKeyItem = { id: string; name: string; createdAt: number; lastUsedAt: number | null };
type AuditEntry = { at: number; action: "create" | "update" | "complete" | "reopen" | "comment" | "denied"; taskId: string | null; summary: string };

const ACTIONS: Record<AuditEntry["action"], string> = {
  create: "создал",
  update: "изменил",
  complete: "отметил выполненной",
  reopen: "вернул в работу",
  comment: "оставил отчёт",
  denied: "отказано",
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers: { accept: "application/json", ...(init?.body ? { "content-type": "application/json" } : {}) },
  });
  const body = (await res.json().catch(() => ({}))) as T & { message?: string };
  if (!res.ok) throw new Error(body.message || "Сервер не ответил.");
  return body;
}

/** Helper keys of the signed-in profile; null while loading or offline. */
export function useHelperKeys(): { keys: HelperKeyItem[] | null; reload: () => void; error: string } {
  const [keys, setKeys] = useState<HelperKeyItem[] | null>(null);
  const [error, setError] = useState("");
  const reload = useCallback(() => {
    api<{ items: HelperKeyItem[] }>("/api/helper-keys").then(
      (body) => {
        setKeys(body.items);
        setError("");
      },
      (e: Error) => setError(e.message),
    );
  }, []);
  useEffect(reload, [reload]);
  return { keys, reload, error };
}

export function helperKeysLabel(keys: HelperKeyItem[] | null): string | undefined {
  if (!keys) return undefined;
  if (!keys.length) return "Нет ключей";
  return `${keys.length} ${keys.length === 1 ? "ключ" : keys.length < 5 ? "ключа" : "ключей"}`;
}

function when(at: number | null, never = "ещё не использовался"): string {
  if (!at) return never;
  const d = new Date(at);
  const time = d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  return new Date().toDateString() === d.toDateString() ? `сегодня ${time}` : `${d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" })} ${time}`;
}

function KeyLog({ id }: { id: string }) {
  const [items, setItems] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api<{ items: AuditEntry[] }>(`/api/helper-keys/${id}/log`).then(
      (body) => setItems(body.items),
      (e: Error) => setError(e.message),
    );
  }, [id]);
  if (error) return <p className="px-3 pb-2 text-caption text-danger">{error}</p>;
  if (!items) return <p className="px-3 pb-2 text-caption text-secondary-label">Загрузка…</p>;
  if (!items.length) return <p className="px-3 pb-2 text-caption text-secondary-label">Действий пока нет.</p>;
  return (
    <ol className="max-h-72 overflow-y-auto px-3 pb-2" aria-label="Журнал действий" data-testid="helper-log">
      {items.map((entry, i) => (
        <li key={`${entry.at}-${i}`} className="border-t border-separator py-1.5 first:border-t-0">
          <p className="text-caption text-secondary-label">
            {when(entry.at)} · <span className={entry.action === "denied" ? "text-danger" : "text-label"}>{ACTIONS[entry.action] ?? entry.action}</span>
          </p>
          {entry.summary ? <p className="truncate text-sm text-label">{entry.summary}</p> : null}
        </li>
      ))}
    </ol>
  );
}

export function HelperKeysSection({ onChange }: { onChange?: () => void }) {
  const { keys, reload, error } = useHelperKeys();
  const [name, setName] = useState("");
  const [fresh, setFresh] = useState<{ token: string; name: string } | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [openLog, setOpenLog] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const endpoint = typeof window === "undefined" ? "/api/helper" : `${window.location.origin}/api/helper`;
  const changed = () => {
    reload();
    onChange?.();
  };

  const create = async () => {
    setBusy(true);
    setNote("");
    try {
      const body = await api<{ token: string; item: HelperKeyItem }>("/api/helper-keys", { method: "POST", body: JSON.stringify({ name: name.trim() || "Помощник" }) });
      setFresh({ token: body.token, name: body.item.name });
      setName("");
      changed();
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const revoke = async (id: string) => {
    if (confirm !== id) {
      setConfirm(id);
      return;
    }
    setConfirm(null);
    try {
      await api(`/api/helper-keys/${id}`, { method: "DELETE" });
      if (openLog === id) setOpenLog(null);
      changed();
    } catch (e) {
      setNote((e as Error).message);
    }
  };
  const copy = (value: string, done: string) => {
    void navigator.clipboard?.writeText(value).then(
      () => setNote(done),
      () => setNote("Не удалось скопировать — выделите и скопируйте вручную."),
    );
  };

  return (
    <section aria-label="Помощники">
      <div className="text-sm text-secondary-label">
        Ключ для бота: он создаёт вам задачи во «Входящих» и видит только их.{" "}
        <InlineHint label="Как это работает">
          Бот с ключом может создать задачу, изменить свою задачу, отметить её выполненной и оставить отчёт «получилось / не получилось». Другие
          задачи, списки и проекты ему не видны, удалять он ничего не может. Каждое действие пишется в журнал (90 дней). Ключ показывается один раз;
          «Отозвать» выключает его сразу. Смена пароля и «Выйти на всех устройствах» отзывают все ключи.
        </InlineHint>
      </div>

      {keys?.length ? (
        <ul className="card-lift mt-3 menu-card overflow-hidden rounded-card" data-testid="helper-keys">
          {keys.map((k) => (
            <li key={k.id} className="border-t border-separator first:border-t-0">
              <div className="flex min-h-12 items-center gap-2 pl-3">
                <Bot className="size-4 shrink-0 text-secondary-label" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body text-label">{k.name}</span>
                  <span className="block truncate text-caption text-secondary-label">{when(k.lastUsedAt)}</span>
                </span>
                <button
                  type="button"
                  aria-expanded={openLog === k.id}
                  onClick={() => setOpenLog((cur) => (cur === k.id ? null : k.id))}
                  className="flex h-11 items-center gap-1 px-2 text-sm text-accent-ink"
                >
                  Журнал
                  <ChevronDown className={cn("size-3.5 transition-transform duration-[var(--dur-fast)]", openLog !== k.id && "-rotate-90")} aria-hidden="true" />
                </button>
                <button type="button" onClick={() => void revoke(k.id)} onBlur={() => setConfirm(null)} className="h-11 pr-3 pl-2 text-sm text-danger">
                  {confirm === k.id ? "Точно отозвать?" : "Отозвать"}
                </button>
              </div>
              {openLog === k.id ? <KeyLog id={k.id} /> : null}
            </li>
          ))}
        </ul>
      ) : keys ? (
        <p className="mt-3 text-caption text-secondary-label">Ключей пока нет.</p>
      ) : null}
      {error ? <p className="mt-2 text-caption text-danger">{error}</p> : null}

      {fresh ? (
        <div className="mt-3 rounded-card border border-accent/40 bg-accent/5 p-3" data-testid="helper-fresh-key">
          <p className="text-caption text-secondary-label">Ключ «{fresh.name}» показывается один раз. Передайте его боту через защищённое поле, не в переписке.</p>
          <p className="mt-1 font-mono text-sm break-all text-label select-all">{fresh.token}</p>
          <Button variant="secondary" size="sm" className="mt-2" onClick={() => copy(fresh.token, "Ключ скопирован.")}>
            <Copy className="size-4" aria-hidden="true" /> Скопировать ключ
          </Button>
        </div>
      ) : null}

      <form
        className="mt-3 flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <TextField label="Имя ключа" placeholder="Например, Оркестратор" value={name} maxLength={40} onChange={(event) => setName(event.target.value)} className="min-w-0 flex-1" />
        <Button type="submit" variant="primary" disabled={busy} className="shrink-0">
          Новый ключ
        </Button>
      </form>
      {note ? <p className="mt-2 text-caption text-secondary-label">{note}</p> : null}

      <p className="mt-4 text-caption font-medium text-tertiary-label uppercase">Подключение бота</p>
      <ul className="mt-1 list-disc space-y-1 pl-5 text-[0.8125rem] text-secondary-label">
        <li>
          Адрес:{" "}
          <button type="button" onClick={() => copy(endpoint, "Адрес скопирован.")} className="font-mono break-all text-label underline decoration-dotted">
            {endpoint}
          </button>{" "}
          (снаружи — адрес роутера через KeenDNS).
        </li>
        <li>Заголовок Authorization: «Bearer » и ключ.</li>
        <li>Задачи: GET и POST /tasks, PATCH /tasks/id, POST /tasks/id/complete, /reopen, /comments.</li>
      </ul>
    </section>
  );
}
