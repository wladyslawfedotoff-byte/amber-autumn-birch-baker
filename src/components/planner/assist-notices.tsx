import { Sparkles } from "lucide-react";
import type { AssistantNotice } from "@/lib/assistant/types";

function hm(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Top of the bell panel: answers to questions that were put off («Отложить»). */
export function AssistantNoticeList({ notices, onOpen }: { notices: AssistantNotice[]; onOpen: (notice: AssistantNotice) => void }) {
  if (!notices.length) return null;
  return (
    <>
      <p className="px-1 text-[0.6875rem] font-semibold uppercase tracking-wide text-subtle">Помощник</p>
      <ul className="mt-1 mb-2 rounded-card bg-card px-2">
        {notices.map((n) => (
          <li key={n.id} className="border-b border-line last:border-b-0">
            <button type="button" onClick={() => onOpen(n)} className="flex w-full items-center gap-2 py-2 text-left">
              <Sparkles className="size-4 shrink-0 text-accent" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-fg">{n.text}</span>
                <span className="block truncate text-xs text-subtle">
                  {hm(n.at)} · {n.title}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
