import { useEffect, useRef, useState } from "react";
import { FileText, Image as ImageIcon, Paperclip, Trash2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FieldLabel } from "@/components/ui/hint";
import { cn } from "@/lib/cn";
import type { AttachmentMeta } from "@/lib/planner-types";
import {
  ACCEPT,
  addFiles,
  deleteFile,
  fileUrl,
  isPending,
  localPreview,
  online,
  pendingCountFor,
  useUploads,
} from "@/lib/attachments/runtime";
import { useCapabilities } from "@/lib/use-capabilities";

function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

function Thumb({ item }: { item: AttachmentMeta }) {
  const [src, setSrc] = useState<string | null>(null);
  const pending = isPending(item.id);
  useEffect(() => {
    let gone = false;
    if (item.mime.startsWith("image/")) {
      void (async () => {
        const local = pending ? await localPreview(item.id) : null;
        if (gone) return;
        setSrc(local ?? (pending ? null : fileUrl(item.id)));
      })();
    } else {
      setSrc(null);
    }
    return () => {
      gone = true;
    };
  }, [item.id, item.mime, pending]);
  if (src) return <img src={src} alt="" className="size-full object-cover" />;
  return item.mime === "application/pdf" ? <FileText className="size-6 text-muted" /> : <ImageIcon className="size-6 text-muted" />;
}

export function AttachmentsBlock({
  kind,
  parentId,
  items,
}: {
  kind: "task" | "project";
  parentId: string;
  items: AttachmentMeta[];
}) {
  const input = useRef<HTMLInputElement>(null);
  const { attachMaxBytes } = useCapabilities();
  const uploads = useUploads();
  const [lightbox, setLightbox] = useState<AttachmentMeta | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const pendingHere = pendingCountFor(uploads.queue, kind, parentId);

  const pick = async (list: FileList | null) => {
    if (!list?.length) return;
    const result = await addFiles(list, { kind, id: parentId }, attachMaxBytes);
    if (result.rejected.length) setNotice(result.rejected.map((r) => `${r.name}: ${r.reason}`).join(" · "));
    else if (result.added.length && !online()) setNotice("Без сети: файл сохранён на телефоне и уйдёт, когда появится связь.");
    else setNotice(null);
    if (input.current) input.current.value = "";
  };

  return (
    <section className="mt-3" aria-labelledby={`attach-${parentId}`}>
      <div className="flex items-center gap-2">
        <div id={`attach-${parentId}`}>
          <FieldLabel hint="Фото с камеры или из галереи, PDF и сканы. Хранятся на вашем сервере. Без сети файл сначала остаётся на телефоне.">
            Вложения
          </FieldLabel>
        </div>
        {pendingHere ? (
          <span className="ml-auto text-xs text-warn" data-testid="attach-pending">
            Ждут отправки: {pendingHere}
          </span>
        ) : null}
      </div>
      {items.length ? (
        <ul className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {items.map((item) => {
            const pending = isPending(item.id);
            return (
              <li key={item.id} className="relative">
                <button
                  type="button"
                  onClick={() => setLightbox(item)}
                  className="flex aspect-square w-full flex-col items-center justify-center overflow-hidden rounded-lg border border-line bg-elevated"
                  aria-label={item.name}
                >
                  <Thumb item={item} />
                </button>
                <div className="mt-0.5 flex items-start gap-1">
                  <span className="min-w-0 flex-1 truncate text-[0.65rem] text-muted" title={item.name}>
                    {pending ? "на телефоне · " : ""}
                    {item.name}
                  </span>
                  <button
                    type="button"
                    aria-label={`Удалить ${item.name}`}
                    className="shrink-0 text-subtle hover:text-danger"
                    onClick={() => void deleteFile({ kind, id: parentId }, item.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
                <span className="text-[0.6rem] text-subtle">{sizeLabel(item.size)}</span>
              </li>
            );
          })}
        </ul>
      ) : null}
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        multiple
        className="sr-only"
        aria-label="Добавить вложение"
        onChange={(event) => void pick(event.target.files)}
      />
      <div className="mt-2 flex flex-wrap gap-2">
        <Button type="button" variant="soft" size="sm" onClick={() => input.current?.click()}>
          <Paperclip className="size-4" aria-hidden="true" />
          Добавить
        </Button>
        <Button
          type="button"
          variant="soft"
          size="sm"
          onClick={() => {
            if (!input.current) return;
            input.current.setAttribute("capture", "environment");
            input.current.click();
            input.current.removeAttribute("capture");
          }}
        >
          <Upload className="size-4" aria-hidden="true" />
          Камера
        </Button>
      </div>
      {notice ? <p className="mt-1 text-xs text-muted">{notice}</p> : null}

      {lightbox ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={lightbox.name}
          onClick={() => setLightbox(null)}
        >
          <button type="button" className="absolute right-3 top-3 rounded-full bg-black/40 p-2 text-white" aria-label="Закрыть" onClick={() => setLightbox(null)}>
            <X className="size-5" />
          </button>
          <div className="max-h-full max-w-full" onClick={(event) => event.stopPropagation()}>
            {lightbox.mime.startsWith("image/") ? (
              <LightboxImage item={lightbox} />
            ) : (
              <a href={isPending(lightbox.id) ? undefined : fileUrl(lightbox.id)} className="rounded-lg bg-surface px-4 py-3 text-fg" target="_blank" rel="noreferrer">
                Открыть {lightbox.name}
              </a>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function LightboxImage({ item }: { item: AttachmentMeta }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let gone = false;
    void (async () => {
      const local = isPending(item.id) ? await localPreview(item.id) : null;
      if (!gone) setSrc(local ?? fileUrl(item.id));
    })();
    return () => {
      gone = true;
    };
  }, [item.id]);
  if (!src) return <div className="size-40 animate-pulse rounded-lg bg-elevated" />;
  return <img src={src} alt={item.name} className="max-h-[80vh] max-w-full rounded-lg object-contain" />;
}

/** Tiny chip used next to a checklist row for «до» / «после». */
export function PhotoSlot({
  label,
  attachId,
  parentId,
  subId: _subId,
  onSet,
}: {
  label: string;
  attachId?: string | null;
  parentId: string;
  subId: string;
  onSet: (id: string | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const { attachMaxBytes } = useCapabilities();
  const [src, setSrc] = useState<string | null>(null);
  const [zoom, setZoom] = useState(false);
  useEffect(() => {
    let gone = false;
    if (!attachId) {
      setSrc(null);
      return;
    }
    void (async () => {
      const local = isPending(attachId) ? await localPreview(attachId) : null;
      if (!gone) setSrc(local ?? fileUrl(attachId));
    })();
    return () => {
      gone = true;
    };
  }, [attachId]);

  return (
    <div className="flex flex-col items-center gap-0.5">
      <button
        type="button"
        aria-label={attachId ? `${label}: открыть` : `Добавить фото «${label}»`}
        onClick={() => {
          if (attachId) setZoom(true);
          else input.current?.click();
        }}
        className={cn(
          "flex size-11 items-center justify-center overflow-hidden rounded-md border border-dashed border-line bg-elevated text-[0.65rem] text-muted",
          attachId && "border-solid",
        )}
      >
        {src ? <img src={src} alt="" className="size-full object-cover" /> : label}
      </button>
      {attachId ? (
        <button type="button" className="text-[0.65rem] text-danger" onClick={() => onSet(null)}>
          убрать
        </button>
      ) : null}
      {zoom && src ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-label={`Фото «${label}»`} onClick={() => setZoom(false)}>
          <img src={src} alt={`Фото «${label}»`} className="max-h-[80vh] max-w-full rounded-lg object-contain" />
        </div>
      ) : null}
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          void addFiles([file], { kind: "task", id: parentId }, attachMaxBytes).then((result) => {
            const first = result.added[0];
            if (first) onSet(first.id);
          });
          event.target.value = "";
        }}
      />
    </div>
  );
}
