/**
 * «Обновить пробег» from anywhere (1.15): the reminder strip or the task row
 * open the mileage sheet straight away — tap, type, «Сохранить».
 */
import { create } from "zustand";

type MileagePrompt = { assetId: string | null };

export const useMileagePrompt = create<MileagePrompt>(() => ({ assetId: null }));

export function openMileage(assetId: string): void {
  useMileagePrompt.setState({ assetId });
}

export function closeMileage(): void {
  useMileagePrompt.setState({ assetId: null });
}

/** Card id of a monthly mileage reminder task (`<assetId>/km`), else undefined. */
export function kmAssetOf(task: { maint?: string } | undefined): string | undefined {
  const ref = task?.maint;
  if (!ref || !ref.endsWith("/km")) return undefined;
  return ref.slice(0, -3) || undefined;
}
