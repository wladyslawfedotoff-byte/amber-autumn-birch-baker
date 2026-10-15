import { create } from "zustand";

/**
 * After the task of a planned «что болит» note is ticked: «Решено · Записать в историю».
 * Not persisted, not synced. `open` is set when the user taps the offer: the
 * maintenance screen picks it up and opens the entry form.
 */
export type PainPrompt = { assetId: string; painId: string; title: string };

export const usePainPrompt = create<{
  offer: PainPrompt | null;
  open: PainPrompt | null;
  show: (offer: PainPrompt) => void;
  clear: () => void;
  accept: () => void;
  consume: () => void;
}>()((set, get) => ({
  offer: null,
  open: null,
  show: (offer) => set({ offer }),
  clear: () => set({ offer: null }),
  accept: () => set({ open: get().offer, offer: null }),
  consume: () => set({ open: null }),
}));
