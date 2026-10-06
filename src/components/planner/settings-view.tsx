import { useRef, useState } from "react";
import { ACCENTS } from "@/lib/accents";
import { addFromBackup, saveBackup } from "@/lib/backup";
import { cn } from "@/lib/cn";
import { usePlanner } from "@/lib/planner-store";
import { dismissLegacyNote, logout, syncServerNow } from "@/lib/server-sync";
import { phaseLabel, useServerSyncStatus } from "@/lib/use-server-sync";

function formatSyncTime(stamp: number | null): string {
  if (!stamp) return "ещё не было";
  const date = new Date(stamp);
  const time = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(date);
  const sameDay = new Date().toDateString() === date.toDateString();
  if (sameDay) return `сегодня в ${time}`;
  const day = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" }).format(date);
  return `${day} в ${time}`;
}

function ConnectionSection() {
  const status = useServerSyncStatus();
  const [busy, setBusy] = useState(false);
  const label = phaseLabel(status);
  return (
    <section>
      <h2 className="font-display text-lg tracking-tight">Подключение</h2>
      <p className="mt-1 text-sm text-muted">Задачи хранятся на вашем сервере и на этом устройстве.</p>
      <div className="card-lift mt-3 rounded-xl bg-elevated p-4 text-sm">
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className={cn(
              "size-2.5 rounded-full",
              label.tone === "ok" ? "bg-ok" : label.tone === "danger" ? "bg-danger" : "bg-subtle",
            )}
          />
          <span className="font-medium">{label.text}</span>
        </div>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-muted">
          <dt>Последняя синхронизация</dt>
          <dd className="text-right text-fg tabular-nums">{formatSyncTime(status.lastSyncAt)}</dd>
          <dt>Версия на сервере</dt>
          <dd className="text-right text-fg tabular-nums">{status.revision ?? "—"}</dd>
          <dt>Неотправленные изменения</dt>
          <dd className={cn("text-right", status.dirty ? "text-warn" : "text-fg")}>{status.dirty ? "есть" : "нет"}</dd>
        </dl>
        {status.lastError ? <p className="mt-3 text-xs text-danger">{status.lastError}</p> : null}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void syncServerNow().finally(() => setBusy(false));
          }}
          className="h-11 rounded-xl bg-accent px-4 text-sm text-accent-fg disabled:opacity-60"
        >
          {busy ? "Синхронизация…" : "Синхронизировать сейчас"}
        </button>
        <button type="button" onClick={() => void logout()} className="h-11 rounded-xl px-4 text-sm text-muted">
          Выйти
        </button>
      </div>
      {status.legacyNote ? (
        <p className="mt-3 text-xs text-muted">
          {status.legacyNote}{" "}
          <button type="button" onClick={dismissLegacyNote} className="text-fg underline underline-offset-2">
            Понятно
          </button>
        </p>
      ) : null}
    </section>
  );
}

function BackupSection() {
  const [note, setNote] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <section className="mt-8">
      <h2 className="font-display text-lg tracking-tight">Резервная копия</h2>
      <p className="mt-1 text-sm text-muted">
        Файл со всеми задачами, списками, привычками и проектами. Из копии добавляется только то, чего сейчас нет, — текущие задачи не
        перезаписываются.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            void saveBackup().then((result) => setNote(result === "saved" ? "Копия сохранена." : "Сохранение отменено."));
          }}
          className="h-11 rounded-xl bg-accent px-4 text-sm text-accent-fg"
        >
          Сохранить копию
        </button>
        <button type="button" onClick={() => fileRef.current?.click()} className="h-11 rounded-xl px-4 text-sm text-fg">
          Добавить из копии
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json,text/plain"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          void addFromBackup(file).then(
            (added) => {
              if (added === null) setNote("Это не файл копии «Пора».");
              else if (added === 0) setNote("Всё из копии уже есть.");
              else setNote(`Добавлено записей: ${added}.`);
            },
            () => setNote("Файл не подошёл."),
          );
        }}
      />
      {note ? <p className="mt-2 text-xs text-muted">{note}</p> : null}
    </section>
  );
}

export function SettingsView() {
  const theme = usePlanner((s) => s.theme);
  const accent = usePlanner((s) => s.accent);
  const setTheme = usePlanner((s) => s.setTheme);
  const setAccent = usePlanner((s) => s.setAccent);

  return (
    <div className="mx-auto max-w-md pb-8">
      <ConnectionSection />

      <section className="mt-8">
        <h2 className="font-display text-lg tracking-tight">Оформление</h2>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            aria-pressed={theme === "light"}
            onClick={() => setTheme("light")}
            className={cn(
              "h-11 rounded-xl text-sm",
              theme === "light" ? "bg-accent text-accent-fg" : "card-lift bg-elevated text-fg",
            )}
          >
            Светлая
          </button>
          <button
            type="button"
            aria-pressed={theme === "dark"}
            onClick={() => setTheme("dark")}
            className={cn(
              "h-11 rounded-xl text-sm",
              theme === "dark" ? "bg-accent text-accent-fg" : "card-lift bg-elevated text-fg",
            )}
          >
            Тёмная
          </button>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="font-display text-lg tracking-tight">Цвет</h2>
        <p className="mt-1 text-sm text-muted">Кнопки, выбранный день и отметки.</p>
        <div className="mt-4 grid grid-cols-4 gap-3">
          {ACCENTS.map((item) => {
            const on = accent === item.id;
            return (
              <button
                key={item.id}
                type="button"
                aria-pressed={on}
                aria-label={item.name}
                onClick={() => setAccent(item.id)}
                className="flex flex-col items-center gap-2"
              >
                <span
                  className={cn(
                    "size-11 rounded-full",
                    item.swatch,
                    on ? "ring-2 ring-fg ring-offset-2 ring-offset-bg" : "",
                  )}
                />
                <span className={cn("text-xs", on ? "text-fg" : "text-muted")}>{item.name}</span>
              </button>
            );
          })}
        </div>
      </section>

      <BackupSection />
    </div>
  );
}
