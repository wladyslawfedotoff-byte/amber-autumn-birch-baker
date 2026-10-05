import { useEffect, useRef, useState } from "react";
import { ACCENTS } from "@/lib/accents";
import { cn } from "@/lib/cn";
import { usePlanner } from "@/lib/planner-store";
import { getCloudStatus, readCloud, subscribeCloud, syncCloud, writeCloud, type CloudStatus } from "@/lib/cloud-sync";
import {
  allowSyncFolder,
  chooseSyncFolder,
  forgetSyncFolder,
  getSyncStatus,
  openFromFile,
  refreshSyncStatus,
  saveToFiles,
  subscribeSync,
  type SyncStatus,
} from "@/lib/sync-folder";

export function SettingsView() {
  const theme = usePlanner((s) => s.theme);
  const accent = usePlanner((s) => s.accent);
  const setTheme = usePlanner((s) => s.setTheme);
  const setAccent = usePlanner((s) => s.setAccent);
  const [cloud, setCloud] = useState<CloudStatus>(getCloudStatus);
  const [cloudUrl, setCloudUrl] = useState("");
  const [cloudUser, setCloudUser] = useState("");
  const [cloudPassword, setCloudPassword] = useState("");
  const [sync, setSync] = useState<SyncStatus>(getSyncStatus);
  const [fileNote, setFileNote] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const saved = readCloud();
    if (saved) {
      setCloudUrl(saved.url);
      setCloudUser(saved.user);
    }
    setCloud(getCloudStatus());
    return subscribeCloud(() => setCloud(getCloudStatus()));
  }, []);

  useEffect(() => {
    void refreshSyncStatus();
    return subscribeSync(() => setSync(getSyncStatus()));
  }, []);

  return (
    <div className="mx-auto max-w-md">
      <section>
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

      <section className="mt-8">
        <h2 className="font-display text-lg tracking-tight">Ваше облако</h2>
        <p className="mt-1 text-sm text-muted">
          Папка WebDAV на вашей Synology или другом своём сервере. Чужие аккаунты не используются. Пароль остаётся только на этом телефоне.
        </p>
        <form
          className="mt-3 space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            const previous = readCloud();
            const password = cloudPassword || previous?.password || "";
            if (!cloudUrl.trim() || !cloudUser.trim() || !password) {
              setCloud({ ...cloud, note: "Нужны адрес, имя и пароль." });
              return;
            }
            writeCloud({ url: cloudUrl.trim(), user: cloudUser.trim(), password });
            setCloudPassword("");
            void syncCloud(true).catch((error: unknown) => {
              setCloud(getCloudStatus());
              if (error instanceof Error) setCloud({ ...getCloudStatus(), note: error.message });
            });
          }}
        >
          <input
            value={cloudUrl}
            onChange={(event) => setCloudUrl(event.target.value)}
            placeholder="https://дом:5006/pora"
            aria-label="Адрес облака"
            autoComplete="off"
            className="card-lift h-11 w-full rounded-xl bg-elevated px-3 text-base outline-none placeholder:text-subtle"
          />
          <input
            value={cloudUser}
            onChange={(event) => setCloudUser(event.target.value)}
            placeholder="Имя"
            aria-label="Имя в облаке"
            autoComplete="username"
            className="card-lift h-11 w-full rounded-xl bg-elevated px-3 text-base outline-none placeholder:text-subtle"
          />
          <input
            value={cloudPassword}
            onChange={(event) => setCloudPassword(event.target.value)}
            type="password"
            placeholder={cloud.connected ? "Пароль сохранён" : "Пароль"}
            aria-label="Пароль облака"
            autoComplete="current-password"
            className="card-lift h-11 w-full rounded-xl bg-elevated px-3 text-base outline-none placeholder:text-subtle"
          />
          <div className="flex flex-wrap gap-2">
            <button type="submit" className="h-11 rounded-xl bg-accent px-4 text-sm text-accent-fg">
              {cloud.connected ? "Сохранить" : "Подключить"}
            </button>
            {cloud.connected ? (
              <button
                type="button"
                onClick={() => {
                  writeCloud(null);
                  setCloudPassword("");
                }}
                className="h-11 rounded-xl px-4 text-sm text-muted"
              >
                Отключить
              </button>
            ) : null}
          </div>
        </form>
        {cloud.note ? <p className="mt-2 text-xs text-muted">{cloud.note}</p> : null}
      </section>

      <section className="mt-8">
        <h2 className="font-display text-lg tracking-tight">Файл</h2>
        {sync.supported ? (
          <>
            <p className="mt-1 text-sm text-muted">
              {sync.folder
                ? `Папка «${sync.folder}». Изменения пишутся в pora.json.`
                : "Выберите папку, которую уже синхронизирует облако: Synology Drive, iCloud или Dropbox."}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {sync.folder && !sync.granted ? (
                <button type="button" onClick={() => void allowSyncFolder()} className="h-11 rounded-xl bg-accent px-4 text-sm text-accent-fg">
                  Разрешить папку
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void chooseSyncFolder().catch(() => undefined)}
                  className="h-11 rounded-xl bg-accent px-4 text-sm text-accent-fg"
                >
                  {sync.folder ? "Другая папка" : "Выбрать папку"}
                </button>
              )}
              {sync.folder ? (
                <button type="button" onClick={() => void forgetSyncFolder()} className="h-11 rounded-xl px-4 text-sm text-muted">
                  Отключить
                </button>
              ) : null}
            </div>
            <p className="mt-2 text-xs text-subtle">Если править сразу на двух устройствах, останется более позднее сохранение.</p>
          </>
        ) : (
          <>
            <p className="mt-1 text-sm text-muted">
              На iPhone нажмите «Сохранить в Файлы» и выберите папку в iCloud или «На iPhone». Тот же файл потом открывается обратно.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  void saveToFiles().then((result) => {
                    setFileNote(result === "saved" ? "Сохранено." : "Сохранение отменено.");
                  });
                }}
                className="h-11 rounded-xl bg-accent px-4 text-sm text-accent-fg"
              >
                Сохранить в Файлы
              </button>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="h-11 rounded-xl px-4 text-sm text-fg"
              >
                Открыть из Файлов
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
                void openFromFile(file).then(
                  (ok) => setFileNote(ok ? "Файл открыт." : "В файле нет задач."),
                  () => setFileNote("Файл не подошёл."),
                );
              }}
            />
            {fileNote ? <p className="mt-2 text-xs text-muted">{fileNote}</p> : null}
          </>
        )}
      </section>
    </div>
  );
}
