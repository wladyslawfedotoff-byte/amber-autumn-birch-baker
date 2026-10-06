import { useEffect, useState } from "react";
import { getServerSyncStatus, subscribeServerSync, type ServerSyncStatus } from "@/lib/server-sync";

export function useServerSyncStatus(): ServerSyncStatus {
  const [status, setStatus] = useState<ServerSyncStatus>(getServerSyncStatus);
  useEffect(() => {
    setStatus(getServerSyncStatus());
    return subscribeServerSync(() => setStatus(getServerSyncStatus()));
  }, []);
  return status;
}

export function phaseLabel(status: ServerSyncStatus): { text: string; tone: "ok" | "muted" | "danger" } {
  switch (status.phase) {
    case "syncing":
      return { text: "Синхронизация…", tone: "muted" };
    case "offline":
      return { text: "Офлайн", tone: "muted" };
    case "unauthorized":
      return { text: "Нужно войти", tone: "danger" };
    case "error":
    case "unavailable":
      return { text: "Ошибка", tone: "danger" };
    default:
      return status.lastSyncAt ? { text: "Онлайн", tone: "ok" } : { text: "Подключение…", tone: "muted" };
  }
}
