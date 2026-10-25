import { useEffect } from "react";
import { Check } from "lucide-react";
import { usePainPrompt } from "@/lib/maintenance/prompt";

/** «Заметка решена · Записать в историю» after the task of a planned note was ticked. */
export function PainPromptBar({ onOpen }: { onOpen: () => void }) {
  const offer = usePainPrompt((s) => s.offer);
  const clear = usePainPrompt((s) => s.clear);
  const accept = usePainPrompt((s) => s.accept);
  useEffect(() => {
    if (!offer) return;
    const timer = window.setTimeout(clear, 12_000);
    return () => window.clearTimeout(timer);
  }, [offer, clear]);
  if (!offer) return null;
  return (
    <div role="status" className="pointer-events-none absolute inset-x-0 bottom-[9rem] z-30 flex justify-center px-4 md:bottom-20">
      <div className="card-lift pointer-events-auto flex w-full max-w-md min-w-0 items-center gap-3 rounded-xl bg-fg px-4 py-2 text-sm text-surface">
        <Check className="size-4 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1">Заметка решена. Записать в историю?</span>
        <button
          type="button"
          className="h-9 shrink-0 rounded-md px-2 font-medium underline-offset-2 hover:underline"
          onClick={() => {
            accept();
            onOpen();
          }}
        >
          Записать
        </button>
        <button type="button" className="h-9 shrink-0 rounded-md px-1 text-surface/70" onClick={clear} aria-label="Закрыть">
          ✕
        </button>
      </div>
    </div>
  );
}
