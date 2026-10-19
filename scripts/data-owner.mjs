/**
 * `docker exec` runs scripts as root. Files a script creates in DATA_DIR
 * (pora.db-wal/-shm, users.json, backups) must stay writable for the server,
 * which runs as the owner of the data folder (PUID/PGID): switch to that user
 * first. No-op when not root or when the folder itself belongs to root.
 */
import { statSync } from "node:fs";

/** @param {string} dir */
export function runAsDataOwner(dir) {
  if (typeof process.getuid !== "function" || process.getuid() !== 0) return;
  let st;
  try {
    st = statSync(dir);
  } catch {
    return;
  }
  if (st.uid === 0) return;
  try {
    process.setgroups?.([st.gid]);
    process.setgid?.(st.gid);
    process.setuid?.(st.uid);
  } catch (error) {
    console.error(`Внимание: не удалось переключиться на владельца ${dir} (${st.uid}:${st.gid}): ${error instanceof Error ? error.message : error}`);
  }
}
