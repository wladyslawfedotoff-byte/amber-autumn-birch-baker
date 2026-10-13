import { useEffect, useState } from "react";
import { useServerSyncStatus } from "@/lib/use-server-sync";

/** Connected to the server right now (browser says online and the last sync reached it). */
export function useOnline(): boolean {
  const status = useServerSyncStatus();
  const [browserOnline, setBrowserOnline] = useState(true);
  useEffect(() => {
    const update = () => setBrowserOnline(navigator.onLine !== false);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return browserOnline && !status.offline && status.phase !== "offline";
}
