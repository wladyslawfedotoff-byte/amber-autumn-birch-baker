import { CloudAlert, CloudOff, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useServerSyncStatus } from "@/lib/use-server-sync";

/**
 * Header indicator: invisible while everything syncs fine; shows a small cloud
 * icon when offline / failing so the user knows edits are only on this device.
 */
export function SyncIndicator({ onOpen }: { onOpen: () => void }) {
  const status = useServerSyncStatus();
  if (status.phase === "idle" || status.phase === "syncing") return null;
  const Icon = status.phase === "offline" ? CloudOff : status.phase === "unauthorized" ? LogIn : CloudAlert;
  const label =
    status.phase === "offline"
      ? status.dirty
        ? "Офлайн: изменения сохранены на устройстве и уйдут на сервер позже"
        : "Офлайн"
      : `Синхронизация: ${status.lastError ?? "ошибка"}`;
  return (
    <Button
      size="icon"
      variant="ghost"
      aria-label={label}
      title={label}
      onClick={onOpen}
      className={status.phase === "offline" ? "text-subtle" : "text-danger"}
    >
      <Icon className="size-5" />
    </Button>
  );
}
