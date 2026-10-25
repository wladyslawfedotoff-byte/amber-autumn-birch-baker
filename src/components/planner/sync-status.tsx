import { useEffect, useState, useSyncExternalStore } from "react";
import { Check, CloudAlert, CloudOff, LogIn, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { applyUpdate, subscribeUpdate, updateReady } from "@/lib/offline/sw-client";
import { useServerSyncStatus } from "@/lib/use-server-sync";
import { pendingLabel } from "@/lib/offline/labels";
import { useUploads } from "@/lib/attachments/runtime";

/**
 * Header indicator for sync errors: the old cloud icon (opens «Подключение»).
 * Offline state, «Синхронизировано» and «Обновить» are the pill below.
 */
export function SyncIndicator({ onOpen }: { onOpen: () => void }) {
  const status = useServerSyncStatus();
  const failing = status.phase === "error" || status.phase === "unavailable" || status.phase === "unauthorized";
  return failing ? (
    <Button
      size="icon"
      variant="ghost"
      aria-label={`Синхронизация: ${status.lastError ?? "ошибка"}`}
      title={`Синхронизация: ${status.lastError ?? "ошибка"}`}
      onClick={onOpen}
      className="text-danger"
    >
      {status.phase === "unauthorized" ? <LogIn className="size-5" /> : <CloudAlert className="size-5" />}
    </Button>
  ) : null;
}

/** The pill row under the header (takes room only while it is shown). */
export function SyncPill() {
  const status = useServerSyncStatus();
  const uploads = useUploads();
  const update = useSyncExternalStore(subscribeUpdate, updateReady, () => false);
  const [hint, setHint] = useState(false);
  const offline = status.offline || status.phase === "offline";
  const pendingFiles = uploads.queue.items.length;
  const pendingTotal = status.pending + pendingFiles;

  useEffect(() => {
    if (!offline) setHint(false);
  }, [offline]);

  let pill: React.ReactNode = null;
  if (offline) {
    pill = (
      <div className="flex flex-col items-center">
        <div role="status" className="flex h-7 items-center gap-2 rounded-full bg-elevated pr-1 pl-3 text-xs text-muted shadow-sm" data-testid="offline-pill">
          <CloudOff className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="whitespace-nowrap">
            Нет сети{pendingTotal > 0 ? ` · ${pendingLabel(pendingTotal)}` : ""}
          </span>
          <button
            type="button"
            aria-expanded={hint}
            aria-label="Что это значит"
            onClick={() => setHint((open) => !open)}
            className={cn("flex size-6 items-center justify-center rounded-full", hint ? "text-accent" : "text-subtle")}
          >
            <span aria-hidden="true" className="flex size-4 items-center justify-center rounded-full border border-current text-[0.625rem] leading-none font-semibold">
              ?
            </span>
          </button>
        </div>
        {hint ? (
          <p className="mt-1 max-w-[17rem] rounded-xl bg-elevated px-3 py-2 text-center text-xs leading-snug text-muted shadow-sm">
            Всё, что вы делаете без сети, сохраняется на этом устройстве и само уйдёт на сервер, когда связь появится. Фото и файлы тоже ждут отправки. Помощник работает только при подключении.
          </p>
        ) : null}
      </div>
    );
  } else if (status.justSynced) {
    pill = (
      <div role="status" className="flex h-7 items-center gap-2 rounded-full bg-elevated px-3 text-xs text-ok shadow-sm" data-testid="synced-pill">
        <Check className="size-3.5" aria-hidden="true" />
        Синхронизировано
      </div>
    );
  } else if (pendingFiles > 0) {
    pill = (
      <div role="status" className="flex h-7 items-center gap-2 rounded-full bg-elevated px-3 text-xs text-warn shadow-sm" data-testid="upload-pending-pill">
        Ждут отправки · {pendingFiles}
      </div>
    );
  } else if (update) {
    pill = (
      <button type="button" onClick={applyUpdate} className="flex h-7 items-center gap-2 rounded-full bg-elevated px-3 text-xs text-accent shadow-sm">
        <RefreshCw className="size-3.5" aria-hidden="true" />
        Новая версия · Обновить
      </button>
    );
  }

  return pill ? <div className="flex justify-center pt-1">{pill}</div> : null;
}
