import { useCallback, useEffect, useState } from "react";
import { Copy, Smartphone } from "lucide-react";
import { InlineHint } from "@/components/ui/hint";
import { syncServerNow } from "@/lib/server-sync";

/** «Быстрое добавление»: device keys for the phone shortcut «В Пору» (POST /api/quick-add). */
export type QuickDevice = { id: string; name: string; createdAt: number; lastUsedAt: number | null };

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

/** Devices of the signed-in profile; null while loading or offline. */
export function useQuickDevices(): { devices: QuickDevice[] | null; reload: () => void; error: string } {
  const [devices, setDevices] = useState<QuickDevice[] | null>(null);
  const [error, setError] = useState("");
  const reload = useCallback(() => {
    api<{ items: QuickDevice[] }>("/api/quick-tokens").then(
      (body) => {
        setDevices(body.items);
        setError("");
      },
      (e: Error) => setError(e.message),
    );
  }, []);
  useEffect(reload, [reload]);
  return { devices, reload, error };
}

export function devicesLabel(devices: QuickDevice[] | null): string | undefined {
  if (!devices) return undefined;
  return devices.length ? `${devices.length} ${devices.length === 1 ? "устройство" : devices.length < 5 ? "устройства" : "устройств"}` : "Нет устройств";
}

function usedLabel(at: number | null): string {
  if (!at) return "ещё не использовался";
  const d = new Date(at);
  const today = new Date().toDateString() === d.toDateString();
  const time = d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  return today ? `сегодня ${time}` : d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" }) + ` ${time}`;
}

export function QuickAddSection({ onChange }: { onChange?: () => void }) {
  const { devices, reload, error } = useQuickDevices();
  const [fresh, setFresh] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const endpoint = typeof window === "undefined" ? "/api/quick-add" : `${window.location.origin}/api/quick-add`;
  const changed = () => {
    reload();
    onChange?.();
  };

  const create = async () => {
    setBusy(true);
    setNote("");
    try {
      const n = (devices?.length ?? 0) + 1;
      const body = await api<{ token: string }>("/api/quick-tokens", { method: "POST", body: JSON.stringify({ name: n === 1 ? "iPhone" : `iPhone ${n}` }) });
      setFresh(body.token);
      changed();
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const revoke = async (id: string) => {
    try {
      await api(`/api/quick-tokens/${id}`, { method: "DELETE" });
      changed();
    } catch (e) {
      setNote((e as Error).message);
    }
  };
  const test = async () => {
    setBusy(true);
    try {
      await api("/api/quick-add", { method: "POST", body: JSON.stringify({ text: "Проверка быстрого добавления" }) });
      await syncServerNow();
      setNote("Во «Входящих» появилась задача «Проверка быстрого добавления».");
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const copy = (value: string, done: string) => {
    void navigator.clipboard?.writeText(value).then(
      () => setNote(done),
      () => setNote("Не удалось скопировать — выделите и скопируйте вручную."),
    );
  };

  return (
    <section aria-label="Быстрое добавление">
      <div className="text-sm text-muted">
        Из любого приложения iPhone: «Поделиться» → «В Пору». Текст, ссылка или фото попадут во «Входящие».{" "}
        <InlineHint label="Как это работает">
          У каждого устройства свой ключ. Ключ умеет только добавлять во «Входящие» и ничего не читает. Потеряли телефон — «Отозвать». Смена пароля и «Выйти на всех устройствах» отзывают все ключи.
        </InlineHint>
      </div>

      {devices?.length ? (
        <ul className="card-lift mt-3 menu-card overflow-hidden rounded-card">
          {devices.map((d) => (
            <li key={d.id} className="flex min-h-12 items-center gap-3 px-3">
              <Smartphone className="size-4 shrink-0 text-muted" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body">{d.name}</span>
                <span className="block truncate text-xs text-subtle">{usedLabel(d.lastUsedAt)}</span>
              </span>
              <button type="button" onClick={() => void revoke(d.id)} className="h-9 px-2 text-sm text-danger">
                Отозвать
              </button>
            </li>
          ))}
        </ul>
      ) : devices ? (
        <p className="mt-3 text-xs text-subtle">Устройств пока нет.</p>
      ) : null}
      {error ? <p className="mt-2 text-xs text-danger">{error}</p> : null}

      {fresh ? (
        <div className="mt-3 rounded-2xl border border-accent/40 bg-accent/5 p-3">
          <p className="text-xs text-muted">Ключ показывается один раз — сразу вставьте его в команду.</p>
          <p className="mt-1 font-mono text-sm break-all select-all">{fresh}</p>
          <button type="button" onClick={() => copy(fresh, "Ключ скопирован.")} className="mt-2 flex h-9 items-center gap-2 rounded-card bg-card px-3 text-sm">
            <Copy className="size-4" aria-hidden="true" /> Скопировать ключ
          </button>
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={() => void create()} className="h-11 rounded-xl bg-accent px-4 text-sm text-accent-fg disabled:opacity-50">
          Новый ключ
        </button>
        <button type="button" disabled={busy} onClick={() => void test()} className="h-11 rounded-xl px-4 text-sm text-fg disabled:opacity-40">
          Проверить
        </button>
      </div>
      {note ? <p className="mt-2 text-xs text-muted">{note}</p> : null}

      <p className="mt-4 text-xs font-medium text-subtle uppercase">Команда «В Пору» на iPhone</p>
      <ol className="mt-1 list-decimal space-y-1 pl-5 text-[0.8125rem] text-muted">
        <li>«Быстрые команды» → «＋», имя «В Пору». В «i» включите «Показывать в меню Поделиться».</li>
        <li>
          Действие «Получить содержимое URL»: адрес{" "}
          <button type="button" onClick={() => copy(endpoint, "Адрес скопирован.")} className="font-mono text-fg underline decoration-dotted break-all">
            {endpoint}
          </button>
          , метод POST.
        </li>
        <li>Заголовок Authorization: «Bearer » и ключ (через пробел).</li>
        <li>Тело «Форма»: поле text — «Ввод быстрой команды»; для фото — поле file типа «Файл».</li>
        <li>Действие «Показать уведомление»: «Добавлено в Пору».</li>
      </ol>
    </section>
  );
}
