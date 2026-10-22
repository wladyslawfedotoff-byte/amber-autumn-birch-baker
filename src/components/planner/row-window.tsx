import { useEffect, useRef, useState, type ReactNode } from "react";

/** Rows drawn at once; more come in as the list scrolls near its end (1.15). */
export const FIRST_ROWS = 40;
const MORE_ROWS = 60;
/** Approximate row height: the placeholder keeps the scroll bar honest. */
const ROW_PX = 52;

/**
 * Long task lists draw only their first rows; the rest appear before the user
 * scrolls to them (an invisible marker with a margin of about a screen).
 * Short lists render exactly as before.
 */
export function RowWindow<T>({ items, children }: { items: readonly T[]; children: (item: T) => ReactNode }) {
  const [limit, setLimit] = useState(FIRST_ROWS);
  const marker = useRef<HTMLDivElement>(null);
  const more = items.length > limit;
  useEffect(() => {
    const node = marker.current;
    if (!more || !node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setLimit((n) => n + MORE_ROWS);
      },
      { rootMargin: "800px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [more, limit]);
  return (
    <>
      {(more ? items.slice(0, limit) : items).map(children)}
      {more ? <div ref={marker} aria-hidden="true" style={{ height: Math.min(items.length - limit, MORE_ROWS) * ROW_PX }} /> : null}
    </>
  );
}
