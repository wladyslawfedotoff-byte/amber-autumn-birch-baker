import { useEffect, useRef, useState } from "react";
import { File as FileIcon, FileSpreadsheet, FileText, Image as ImageIcon, Paperclip, Trash2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FieldLabel } from "@/components/ui/hint";
import { cn } from "@/lib/cn";
import type { AttachmentMeta } from "@/lib/planner-types";
import {
  ACCEPT,
  addFiles,
  deleteFile,
  fileKind,
  fileUrl,
  isPending,
  localPreview,
  online,
  pendingCountFor,
  photoStampOn,
  readText,
  setPhotoStamp,
  useUploads,
} from "@/lib/attachments/runtime";
import { formatTakenAt } from "@/lib/attachments/exif";
import { usePlanner } from "@/lib/planner-store";
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
  return <KindIcon mime={item.mime} />;
}

function KindIcon({ mime }: { mime: string }) {
  const kind = fileKind(mime);
  const cls = "size-6 text-muted";
  if (kind === "image") return <ImageIcon className={cls} />;
  if (kind === "sheet") return <FileSpreadsheet className={cls} />;
  if (kind === "pdf" || kind === "text") return <FileText className={cls} />;
  return <FileIcon className={cls} />;
}

function TextPreview({ item }: { item: AttachmentMeta }) {
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let gone = false;
    readText(item.id)
      .then((value) => !gone && setText(value))
      .catch(() => !gone && setFailed(true));
    return () => {
      gone = true;
    };
  }, [item.id]);
  if (failed) return <p className="rounded-lg bg-surface px-4 py-3 text-fg">Не удалось открыть файл.</p>;
  if (text === null) return <div className="size-40 animate-pulse rounded-lg bg-elevated" />;
  return (
    <pre className="max-h-[75vh] w-[min(90vw,48rem)] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-surface p-4 text-left text-sm text-fg" aria-label={item.name}>
      {text}
    </pre>
  );
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
  const [stamp, setStamp] = useState(() => photoStampOn());
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
          <FieldLabel hint="Фото с камеры или из галереи (в том числе HEIC с iPhone — на сервере станет JPEG), PDF, сканы, документы и таблицы. Дата съёмки из EXIF показывается под фото. Без сети файл сначала остаётся на телефоне.">
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
                    {item.takenAt ? formatTakenAt(item.takenAt) : item.name}
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
        <button
          type="button"
          className={cn("rounded-md px-2 py-1.5 text-xs", stamp ? "bg-accent/15 text-accent" : "text-muted")}
          aria-pressed={stamp}
          title="На новых фото в правом нижнем углу будет дата съёмки"
          onClick={() => {
            const next = !stamp;
            setPhotoStamp(next);
            setStamp(next);
          }}
        >
          {stamp ? "Дата на фото: вкл" : "Дата на фото"}
        </button>
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
              <div className="flex flex-col items-center gap-3">
                {fileKind(lightbox.mime) === "text" ? <TextPreview item={lightbox} /> : <p className="max-w-[80vw] truncate rounded-lg bg-surface px-4 py-2 text-fg">{lightbox.name}</p>}
                {isPending(lightbox.id) ? (
                  <span className="text-sm text-white/80">Ещё не отправлен — откроется после отправки.</span>
                ) : (
                  <a href={fileUrl(lightbox.id)} download={lightbox.name} className="rounded-lg bg-accent px-4 py-2 font-medium text-accent-fg" target="_blank" rel="noreferrer">
                    Открыть
                  </a>
                )}
              </div>
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
  return (
    <div className="relative">
      <img src={src} alt={item.name} className="max-h-[80vh] max-w-full rounded-lg object-contain" />
      {item.takenAt ? (
        <span className="pointer-events-none absolute bottom-2 right-2 rounded bg-black/55 px-2 py-0.5 text-[0.7rem] font-medium text-amber-200">
          {formatTakenAt(item.takenAt)}
        </span>
      ) : null}
    </div>
  );
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
  const takenAt = usePlanner((s) => s.tasks.find((task) => task.id === parentId)?.attachments?.find((a) => a.id === attachId)?.takenAt);
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
      {takenAt ? <span className="max-w-[4.5rem] truncate text-center text-[0.55rem] leading-tight text-muted">{formatTakenAt(takenAt)}</span> : null}
      {attachId ? (
        <button type="button" className="text-[0.65rem] text-danger" onClick={() => onSet(null)}>
          убрать
        </button>
      ) : null}
      {zoom && src ? (
        <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-2 bg-black/70 p-4" role="dialog" aria-modal="true" aria-label={`Фото «${label}»`} onClick={() => setZoom(false)}>
          <div className="relative" onClick={(event) => event.stopPropagation()}>
            <img src={src} alt={`Фото «${label}»`} className="max-h-[80vh] max-w-full rounded-lg object-contain" />
            {takenAt ? <span className="absolute bottom-2 right-2 rounded bg-black/55 px-2 py-0.5 text-[0.7rem] font-medium text-amber-200">{formatTakenAt(takenAt)}</span> : null}
          </div>
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
