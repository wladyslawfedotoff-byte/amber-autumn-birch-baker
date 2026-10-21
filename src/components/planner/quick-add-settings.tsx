import { useState } from "react";
import { Copy, Download, Smartphone } from "lucide-react";
import { InlineHint } from "@/components/ui/hint";
import { usePlanner } from "@/lib/planner-store";

/**
 * «Быстрое добавление»: device keys for the iOS Shortcut «В Пору».
 * PREVIEW: the backend (POST /api/quick-add, hashed keys in SQLite) is not
 * built yet; keys here are local placeholders.
 */
type Device = { id: string; name: string; lastUsed: string };

export function QuickAddSection() {
  const addTask = usePlanner((s) => s.addTask);
  const [devices, setDevices] = useState<Device[]>([{ id: "d1", name: "iPhone", lastUsed: "сегодня 19:42" }]);
  const [fresh, setFresh] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const create = () => {
    const n = devices.length + 1;
    setDevices((cur) => [...cur, { id: `d${n}`, name: `iPhone ${n}`, lastUsed: "ещё не использовался" }]);
    setFresh(`pora_qa_${Math.random().toString(36).slice(2, 10)}…${Math.random().toString(36).slice(2, 6)}`);
  };

  return (
    <section aria-label="Быстрое добавление">
      <div className="text-sm text-muted">
        Из любого приложения iPhone: «Поделиться» → «В Пору». Текст, ссылка или фото попадут во «Входящие».{" "}
        <InlineHint label="Как это работает">Ключ умеет только добавлять во «Входящие» и ничего не читает. Для каждого устройства — свой ключ, его можно отозвать.</InlineHint>
      </div>

      <ul className="card-lift mt-3 divide-y divide-line overflow-hidden rounded-2xl bg-elevated">
        {devices.map((d) => (
          <li key={d.id} className="flex min-h-12 items-center gap-3 px-3">
            <Smartphone className="size-4 shrink-0 text-muted" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[0.9375rem]">{d.name}</span>
              <span className="block truncate text-xs text-subtle">{d.lastUsed}</span>
            </span>
            <button type="button" onClick={() => setDevices((cur) => cur.filter((x) => x.id !== d.id))} className="h-9 px-2 text-sm text-danger">
              Отозвать
            </button>
          </li>
        ))}
      </ul>

      {fresh ? (
        <div className="mt-3 rounded-2xl border border-accent/40 bg-accent/5 p-3">
          <p className="text-xs text-muted">Ключ показывается один раз — сразу вставьте его в команду.</p>
          <p className="mt-1 font-mono text-sm break-all">{fresh}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" onClick={() => setNote("Скопировано.")} className="flex h-9 items-center gap-1.5 rounded-xl bg-elevated px-3 text-sm">
              <Copy className="size-4" /> Скопировать
            </button>
            <button type="button" className="flex h-9 items-center gap-1.5 rounded-xl bg-elevated px-3 text-sm">
              <Download className="size-4" /> Установить команду
            </button>
          </div>
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={create} className="h-11 rounded-xl bg-accent px-4 text-sm text-accent-fg">
          Новый ключ
        </button>
        <button
          type="button"
          disabled={note.startsWith("Во")}
          onClick={() => {
            if (note.startsWith("Во")) return;
            addTask({ title: "Проверка «В Пору»", listId: null, due: null, via: "phone" });
            setNote("Во «Входящих» появилась пробная задача.");
          }}
          className="h-11 rounded-xl px-4 text-sm text-fg disabled:opacity-40"
        >
          Проверить
        </button>
      </div>
      {note ? <p className="mt-2 text-xs text-muted">{note}</p> : null}

      <ol className="mt-3 list-decimal space-y-1 pl-5 text-[0.8125rem] text-muted">
        <li>«Новый ключ» → «Установить команду».</li>
        <li>В «Быстрых командах» вставьте ключ.</li>
        <li>«Поделиться» в Safari, Фото, Заметках → «В Пору».</li>
      </ol>
    </section>
  );
}
