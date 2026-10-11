import { useEffect } from "react";
import { keyboardFrame, revealDelta } from "@/lib/viewport";

function editable(node: Element | null): node is HTMLElement {
  if (!(node instanceof HTMLElement)) return false;
  if (node.isContentEditable) return true;
  if (node instanceof HTMLTextAreaElement || node instanceof HTMLSelectElement) return true;
  return node instanceof HTMLInputElement && !["checkbox", "radio", "button", "submit", "range", "file", "color"].includes(node.type);
}

function scrollParent(node: HTMLElement): HTMLElement | null {
  let current = node.parentElement;
  while (current && current !== document.body) {
    const style = getComputedStyle(current);
    if ((style.overflowY === "auto" || style.overflowY === "scroll") && current.scrollHeight > current.clientHeight) return current;
    current = current.parentElement;
  }
  return null;
}

/** Scroll the focused field into view inside its own scroll box (never the page). */
function revealFocused() {
  const field = document.activeElement;
  if (!editable(field)) return;
  const box = scrollParent(field);
  if (!box) return;
  const delta = revealDelta(field.getBoundingClientRect(), box.getBoundingClientRect());
  if (delta !== 0) box.scrollTop += delta;
}

/**
 * Keeps `--app-h` / `--vv-top` and `html.kb-open` in step with the visual
 * viewport, undoes the page scroll iOS leaves after the keyboard closes and
 * keeps the focused field visible above the keyboard.
 */
export function useViewportFrame() {
  useEffect(() => {
    const root = document.documentElement;
    const vv = window.visualViewport;
    let raf = 0;
    let wasKeyboard = false;
    let lastKey = "";

    const apply = () => {
      raf = 0;
      const frame = keyboardFrame({
        innerHeight: window.innerHeight,
        vvHeight: vv?.height ?? window.innerHeight,
        vvTop: vv?.offsetTop ?? 0,
      });
      const key = `${frame.keyboard}:${frame.top}:${frame.height}`;
      if (key !== lastKey) {
        lastKey = key;
        root.style.setProperty("--app-h", `${frame.height}px`);
        root.style.setProperty("--vv-top", `${frame.top}px`);
        root.classList.toggle("kb-open", frame.keyboard);
      }
      if (frame.keyboard && !wasKeyboard) window.setTimeout(revealFocused, 50);
      if (!frame.keyboard && (window.scrollY !== 0 || window.scrollX !== 0)) window.scrollTo(0, 0);
      wasKeyboard = frame.keyboard;
    };
    const schedule = () => {
      if (!raf) raf = window.requestAnimationFrame(apply);
    };
    const onFocusIn = (event: FocusEvent) => {
      if (!editable(event.target as Element)) return;
      // After iOS finished its own pan / the keyboard animation.
      window.setTimeout(() => {
        schedule();
        revealFocused();
      }, 320);
    };
    const onFocusOut = () => window.setTimeout(schedule, 120);

    apply();
    vv?.addEventListener("resize", schedule);
    vv?.addEventListener("scroll", schedule);
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("orientationchange", schedule);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      vv?.removeEventListener("resize", schedule);
      vv?.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("orientationchange", schedule);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, []);
}
