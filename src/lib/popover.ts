/**
 * Popovers and menus (1.15.1): only one open at a time, and every one closes on
 * a tap anywhere outside it (touch included, whatever sits on top), on Escape
 * and when the screen changes.
 */
import { useEffect, useRef, type RefObject } from "react";
import { create } from "zustand";

type PopoverStore = { id: string | null };

export const usePopoverStore = create<PopoverStore>(() => ({ id: null }));

/** Open/close a named popover; opening one closes the rest. */
export function setPopover(id: string, open: boolean): void {
  const cur = usePopoverStore.getState().id;
  if (open) {
    if (cur !== id) usePopoverStore.setState({ id });
  } else if (cur === id) usePopoverStore.setState({ id: null });
}

export function closeAllPopovers(): void {
  if (usePopoverStore.getState().id !== null) usePopoverStore.setState({ id: null });
}

/** `[open, setOpen]` for a named popover, shared through the store. */
export function usePopover(id: string): [boolean, (open: boolean) => void] {
  const open = usePopoverStore((s) => s.id === id);
  return [open, (next: boolean) => setPopover(id, next)];
}

/** True when `target` is inside any of the given elements. */
export function isInside(target: EventTarget | null, roots: readonly (Element | null | undefined)[]): boolean {
  if (!target || typeof (target as Node).nodeType !== "number") return false;
  return roots.some((root) => !!root && root.contains(target as Node));
}

/**
 * Close on a pointer press outside `refs` (capture phase on the document, so a
 * toolbar drawn above the backdrop cannot swallow the tap), and on Escape.
 */
export function useDismiss(open: boolean, close: () => void, refs: readonly RefObject<Element | null>[]): void {
  const closeRef = useRef(close);
  closeRef.current = close;
  const refsRef = useRef(refs);
  refsRef.current = refs;
  useEffect(() => {
    if (!open) return;
    const onDown = (event: Event) => {
      if (isInside(event.target, refsRef.current.map((r) => r.current))) return;
      closeRef.current();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current();
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
}
