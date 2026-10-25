import { useRef, type PointerEvent as ReactPointerEvent } from "react";
import { haptic } from "@/lib/haptics";

/** Distance (px) or flick speed (px/ms) that dismisses a sheet. */
const CLOSE_AT = 110;
const FLICK = 0.6;

/**
 * Swipe-down-to-close for bottom sheets (iOS style). Attach `onPointerDown`
 * to the grabber / header area and `panelRef` to the panel. The panel follows
 * the finger via a direct style write (no re-render per frame); a short pull
 * springs back, a long pull or a flick closes. Buttons inside the header keep
 * working: the drag starts only after the finger moved down 6px.
 */
export function useSheetDrag(onClose: () => void) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  function onPointerDown(event: ReactPointerEvent<HTMLElement>) {
    if (event.button !== 0 || event.pointerType === "mouse") return;
    if ((event.target as HTMLElement).closest("input, textarea, select")) return;
    const panel = panelRef.current;
    if (!panel) return;
    const startY = event.clientY;
    const startX = event.clientX;
    let dy = 0;
    let lastT = performance.now();
    let lastY = startY;
    let speed = 0;
    let active = false;
    const move = (ev: PointerEvent) => {
      const my = ev.clientY - startY;
      if (!active) {
        if (Math.abs(ev.clientX - startX) > Math.abs(my) || my < 6) return;
        active = true;
        panel.style.transition = "none";
      }
      dy = Math.max(0, my);
      const now = performance.now();
      speed = (ev.clientY - lastY) / Math.max(1, now - lastT);
      lastT = now;
      lastY = ev.clientY;
      panel.style.transform = `translateY(${dy}px)`;
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      if (!active) return;
      // The click after a drag must not hit a header button.
      const swallow = (ev: Event) => {
        ev.stopPropagation();
        ev.preventDefault();
      };
      window.addEventListener("click", swallow, { capture: true, once: true });
      window.setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 350);
      panel.style.transition = "transform 220ms cubic-bezier(0.22, 1, 0.36, 1)";
      if (dy > CLOSE_AT || speed > FLICK) {
        panel.style.transform = "translateY(100%)";
        haptic("select");
        window.setTimeout(onClose, 180);
      } else {
        panel.style.transform = "";
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  }
  return { panelRef, onPointerDown };
}
