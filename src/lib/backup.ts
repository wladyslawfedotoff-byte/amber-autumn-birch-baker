/** Manual backup file («Резервная копия»): export the planner, add entries back from a file. */
import { importBackupData, localData } from "@/lib/server-sync";
import { todayIso } from "@/lib/dates";

export async function saveBackup(): Promise<"saved" | "cancelled"> {
  const name = `pora-${todayIso()}.json`;
  const body = JSON.stringify({ ...localData(), exportedAt: new Date().toISOString() }, null, 1);
  const candidates = [new File([body], name, { type: "application/json" }), new File([body], name, { type: "text/plain" })];
  const file = candidates.find((item) => typeof navigator.canShare === "function" && navigator.canShare({ files: [item] })) ?? null;
  if (file && typeof navigator.share === "function") {
    try {
      await navigator.share({ files: [file], title: "Пора" });
      return "saved";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
    }
  }
  const url = URL.createObjectURL(new File([body], name, { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return "saved";
}

/** Returns the number of added entries, or null when the file is not a «Пора» backup. */
export async function addFromBackup(file: File): Promise<number | null> {
  const text = await file.text();
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  return importBackupData(raw);
}
