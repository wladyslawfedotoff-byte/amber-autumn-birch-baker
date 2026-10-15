import { useEffect, useRef, useState } from "react";
import { Check, Link2, MessageSquare, Paperclip, Phone, Plus, UserRound, X } from "lucide-react";
import { AttachmentLightbox, KindIcon, Thumb, sizeLabel } from "@/components/planner/objects/attachments";
import { Hint } from "@/components/ui/hint";
import { Sheet } from "@/components/ui/sheet";
import { cn } from "@/lib/cn";
import { formatTakenAt } from "@/lib/attachments/exif";
import { ACCEPT, addFiles, deleteFile, isPending, online, pendingCountFor, useUploads } from "@/lib/attachments/runtime";
import { dialable, findUrl, normalizeUrl, parseContactText, parseVcard, siteLetter, siteName } from "@/lib/objects/links";
import { usePlanner } from "@/lib/planner-store";
import type { AttachmentMeta, ProjectContact, Task } from "@/lib/planner-types";
import { useCapabilities } from "@/lib/use-capabilities";

const field = "h-11 w-full rounded-md border border-line bg-elevated px-3 text-base text-fg outline-none placeholder:text-subtle";
const chip = "flex h-12 max-w-full min-w-0 items-center gap-2 rounded-lg border border-line bg-elevated pl-1.5 pr-1 text-sm";

function Badge({ letter, tone }: { letter: string; tone?: string }) {
  return (
    <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-md text-xs font-semibold text-accent-fg", tone ?? "bg-accent")} aria-hidden="true">
      {letter}
    </span>
  );
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" aria-label={label} onClick={onClick} className="flex size-8 shrink-0 items-center justify-center rounded-full text-subtle hover:text-danger">
      <X className="size-3.5" />
    </button>
  );
}

function ContactActions({ name, phone }: { name: string; phone?: string }) {
  if (!phone) return null;
  const to = dialable(phone);
  return (
    <>
      <a href={`tel:${to}`} aria-label={`Позвонить: ${name}`} className="flex size-9 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-fg">
        <Phone className="size-4" />
      </a>
      <a href={`sms:${to}`} aria-label={`Написать: ${name}`} className="flex size-9 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-fg">
        <MessageSquare className="size-4" />
      </a>
    </>
  );
}

/** «14 окт» under a 56 px thumb; the full date and time are in the tooltip and the viewer. */
function shortDate(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" }).replace(".", "");
}

function PhotoChip({ item, onOpen, onRemove }: { item: AttachmentMeta; onOpen: () => void; onRemove: () => void }) {
  const pending = isPending(item.id);
  return (
    <li className="relative w-14 shrink-0" data-testid="object-photo">
      <button type="button" onClick={onOpen} aria-label={item.name} className="flex size-14 items-center justify-center overflow-hidden rounded-lg border border-line bg-elevated">
        <Thumb item={item} />
      </button>
      <button
        type="button"
        aria-label={`Удалить ${item.name}`}
        onClick={onRemove}
        className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full border border-line bg-surface text-subtle"
      >
        <X className="size-3" />
      </button>
      <span className="mt-0.5 block truncate text-center text-[0.6rem] leading-tight text-muted" title={item.takenAt ? formatTakenAt(item.takenAt) : item.name}>
        {pending ? "на телефоне" : item.takenAt ? shortDate(item.takenAt) : sizeLabel(item.size)}
      </span>
    </li>
  );
}

/**
 * Everything attached to a task in one compact strip: photos, files, links,
 * contacts. Empty task → only the «＋ Файл · Ссылка · Контакт» row.
 */
export function TaskObjects({ task, projectContacts }: { task: Task; projectContacts: ProjectContact[] }) {
  const input = useRef<HTMLInputElement>(null);
  const { attachMaxBytes } = useCapabilities();
  const uploads = useUploads();
  const removeTaskLink = usePlanner((s) => s.removeTaskLink);
  const removeTaskContact = usePlanner((s) => s.removeTaskContact);
  const updateTask = usePlanner((s) => s.updateTask);
  const [lightbox, setLightbox] = useState<AttachmentMeta | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sheet, setSheet] = useState<"link" | "contact" | null>(null);
  const files = task.attachments ?? [];
  const photos = files.filter((f) => f.mime.startsWith("image/"));
  const docs = files.filter((f) => !f.mime.startsWith("image/"));
  // Synced data is re-checked before it becomes an href (another device could send anything).
  const links = (task.links ?? []).flatMap((l) => {
    const url = typeof l.url === "string" ? normalizeUrl(l.url) : null;
    return url ? [{ ...l, url }] : [];
  });
  const contacts = task.contacts ?? [];
  const linked = task.contactId ? projectContacts.find((c) => c.id === task.contactId) : undefined;
  const pendingHere = pendingCountFor(uploads.queue, "task", task.id);
  const any = files.length + links.length + contacts.length + (linked ? 1 : 0) > 0;
  const target = { kind: "task" as const, id: task.id };

  const pick = async (list: FileList | null) => {
    if (!list?.length) return;
    const result = await addFiles(list, target, attachMaxBytes);
    if (result.rejected.length) setNotice(result.rejected.map((r) => `${r.name}: ${r.reason}`).join(" · "));
    else if (result.added.length && !online()) setNotice("Без сети: файл сохранён на телефоне и уйдёт, когда появится связь.");
    else setNotice(null);
    if (input.current) input.current.value = "";
  };

  return (
    <section className="mt-3" aria-label="Файлы, ссылки и контакты" data-testid="task-objects">
      {any ? (
        <ul className="flex flex-wrap items-start gap-2" data-testid="object-strip">
          {photos.map((item) => (
            <PhotoChip key={item.id} item={item} onOpen={() => setLightbox(item)} onRemove={() => void deleteFile(target, item.id)} />
          ))}
          {docs.map((item) => (
            <li key={item.id} className={cn(chip, "w-[calc(50%-0.25rem)]")} data-testid="object-file">
              <button type="button" onClick={() => setLightbox(item)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-surface">
                  <KindIcon mime={item.mime} />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-fg">{item.name}</span>
                  <span className="block text-[0.7rem] text-subtle">{isPending(item.id) ? "на телефоне" : sizeLabel(item.size)}</span>
                </span>
              </button>
              <RemoveButton label={`Удалить ${item.name}`} onClick={() => void deleteFile(target, item.id)} />
            </li>
          ))}
          {links.map((link) => (
            <li key={link.id} className={cn(chip, "w-full")} data-testid="object-link">
              <a href={link.url} target="_blank" rel="noopener noreferrer" className="flex min-w-0 flex-1 items-center gap-2">
                <Badge letter={siteLetter(link.url)} />
                <span className="min-w-0">
                  <span className="block truncate text-fg">{link.title || siteName(link.url)}</span>
                  <span className="block truncate text-[0.7rem] text-subtle">{siteName(link.url)} ↗</span>
                </span>
              </a>
              <RemoveButton label={`Удалить ссылку ${link.title || siteName(link.url)}`} onClick={() => removeTaskLink(task.id, link.id)} />
            </li>
          ))}
          {linked ? (
            <li className={cn(chip, "w-full")} data-testid="object-contact">
              <Badge letter={(linked.name[0] ?? "?").toUpperCase()} tone="bg-muted" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-fg">{linked.name}</span>
                <span className="block truncate text-[0.7rem] text-subtle">{[linked.role, linked.phone].filter(Boolean).join(" · ") || "из проекта"}</span>
              </span>
              <ContactActions name={linked.name} phone={linked.phone} />
              <RemoveButton label={`Убрать ${linked.name}`} onClick={() => updateTask(task.id, { contactId: null })} />
            </li>
          ) : null}
          {contacts.map((c) => (
            <li key={c.id} className={cn(chip, "w-full")} data-testid="object-contact">
              <Badge letter={(c.name[0] ?? "?").toUpperCase()} tone="bg-muted" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-fg">{c.name}</span>
                {c.phone ? <span className="block truncate text-[0.7rem] text-subtle">{c.phone}</span> : null}
              </span>
              <ContactActions name={c.name} phone={c.phone} />
              <RemoveButton label={`Удалить ${c.name}`} onClick={() => removeTaskContact(task.id, c.id)} />
            </li>
          ))}
        </ul>
      ) : null}
      <input ref={input} type="file" accept={ACCEPT} multiple className="sr-only" aria-label="Добавить файл" onChange={(event) => void pick(event.target.files)} />
      <div className={cn("flex items-center rounded-lg border border-dashed border-line text-sm text-muted", any && "mt-2")} data-testid="object-add">
        <Plus className="ml-2.5 size-4 shrink-0 text-accent" aria-hidden="true" />
        <button type="button" className="h-10 px-1.5" onClick={() => input.current?.click()}>
          Файл
        </button>
        <span aria-hidden="true">·</span>
        <button type="button" className="h-10 px-1.5" onClick={() => setSheet("link")}>
          Ссылка
        </button>
        <span aria-hidden="true">·</span>
        <button type="button" className="h-10 px-1.5" onClick={() => setSheet("contact")}>
          Контакт
        </button>
        {pendingHere ? (
          <span className="ml-auto pr-1 text-xs text-warn" data-testid="attach-pending">
            ждут: {pendingHere}
          </span>
        ) : (
          <span className="ml-auto pr-0.5">
            <Hint label="Что можно прикрепить">
              Фото (камера или галерея, HEIC станет JPEG), PDF, документы и таблицы; ссылка открывается в новой вкладке; у контакта — «Позвонить» и «Написать». Без сети всё
              сохраняется на телефоне и уйдёт позже.
            </Hint>
          </span>
        )}
      </div>
      {notice ? <p className="mt-1 text-xs text-muted">{notice}</p> : null}
      {lightbox ? <AttachmentLightbox item={lightbox} onClose={() => setLightbox(null)} /> : null}
      <LinkSheet open={sheet === "link"} taskId={task.id} onClose={() => setSheet(null)} />
      <ContactSheet
        open={sheet === "contact"}
        task={task}
        projectContacts={projectContacts.filter((c) => c.id !== task.contactId)}
        onClose={() => setSheet(null)}
      />
    </section>
  );
}

/** Clipboard → URL when allowed; silently nothing on denial / unsupported. */
async function clipboardUrl(): Promise<string | null> {
  try {
    if (typeof navigator === "undefined" || !navigator.clipboard?.readText) return null;
    const text = await navigator.clipboard.readText();
    return text ? findUrl(text) : null;
  } catch {
    return null;
  }
}

async function suggestTitle(url: string, signal: AbortSignal): Promise<string | null> {
  if (!online()) return null;
  try {
    const res = await fetch(`/api/link-title?url=${encodeURIComponent(url)}`, { credentials: "same-origin", signal });
    if (!res.ok) return null;
    const body = (await res.json()) as { title?: unknown };
    return typeof body.title === "string" && body.title ? body.title : null;
  } catch {
    return null;
  }
}

export function LinkSheet({ open, taskId, onClose }: { open: boolean; taskId: string; onClose: () => void }) {
  const addTaskLink = usePlanner((s) => s.addTaskLink);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [suggested, setSuggested] = useState<string | null>(null);
  const href = normalizeUrl(url);
  useEffect(() => {
    if (!open) return;
    setUrl("");
    setTitle("");
    setSuggested(null);
    let gone = false;
    void clipboardUrl().then((found) => {
      if (!gone && found) setUrl((now) => now || found);
    });
    return () => {
      gone = true;
    };
  }, [open]);
  useEffect(() => {
    setSuggested(null);
    if (!href) return;
    const controller = new AbortController();
    const timer = setTimeout(() => void suggestTitle(href, controller.signal).then((t) => !controller.signal.aborted && setSuggested(t)), 400);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [href]);
  const save = () => {
    if (!href) return;
    if (addTaskLink(taskId, href, title)) onClose();
  };
  return (
    <Sheet open={open} title="Ссылка" onClose={onClose} action={{ label: "Добавить", onClick: save, disabled: !href }}>
      <form
        className="space-y-2 pb-2"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <input
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          onPaste={(event) => {
            const found = findUrl(event.clipboardData.getData("text"));
            if (found) {
              event.preventDefault();
              setUrl(found);
            }
          }}
          placeholder="Вставьте адрес — https://…"
          aria-label="Адрес ссылки"
          inputMode="url"
          autoCapitalize="off"
          autoCorrect="off"
          className={field}
          autoFocus
        />
        {url && !href ? <p className="text-xs text-warn">Нужен адрес http:// или https://</p> : null}
        <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Название (необязательно)" aria-label="Название ссылки" className={field} />
        {suggested && suggested !== title ? (
          <button type="button" onClick={() => setTitle(suggested)} className="flex w-full items-center gap-1.5 truncate text-left text-xs text-accent" data-testid="title-suggestion">
            <Link2 className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{suggested}</span>
          </button>
        ) : null}
        <button type="submit" className="sr-only" tabIndex={-1} aria-hidden="true" disabled={!href}>
          Добавить
        </button>
      </form>
    </Sheet>
  );
}

export function ContactSheet({
  open,
  task,
  projectContacts,
  onClose,
}: {
  open: boolean;
  task: Task;
  projectContacts: ProjectContact[];
  onClose: () => void;
}) {
  const addTaskContact = usePlanner((s) => s.addTaskContact);
  const updateTask = usePlanner((s) => s.updateTask);
  const card = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setName("");
    setPhone("");
    setNotice(null);
  }, [open]);
  const fill = (parsed: { name: string; phone: string | null } | null) => {
    if (!parsed) {
      setNotice("Не нашёл имени или номера.");
      return;
    }
    setNotice(null);
    if (parsed.name) setName(parsed.name);
    if (parsed.phone) setPhone(parsed.phone);
  };
  const readCard = async (file: File | undefined) => {
    if (card.current) card.current.value = "";
    if (!file) return;
    if (file.size > 64 * 1024) return setNotice("Карточка слишком большая.");
    fill(parseVcard(await file.text()));
  };
  const save = () => {
    if (addTaskContact(task.id, { name, phone })) onClose();
  };
  const canSave = Boolean(name.trim() || phone.trim());
  return (
    <Sheet open={open} title="Контакт" onClose={onClose} action={{ label: "Добавить", onClick: save, disabled: !canSave }}>
      <div className="space-y-2 pb-2">
        {projectContacts.length ? (
          <div data-testid="project-contact-pick">
            <p className="mb-1 text-xs text-subtle">Из проекта</p>
            <div className="flex flex-wrap gap-1.5">
              {projectContacts.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    if (task.contactId) addTaskContact(task.id, { name: c.name, phone: c.phone });
                    else updateTask(task.id, { contactId: c.id });
                    onClose();
                  }}
                  className="inline-flex h-9 max-w-full items-center gap-1.5 rounded-full border border-line bg-elevated px-3 text-sm text-fg"
                >
                  <UserRound className="size-3.5 shrink-0 text-muted" aria-hidden="true" />
                  <span className="truncate">{c.name}</span>
                  {c.role ? <span className="truncate text-xs text-muted">· {c.role}</span> : null}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            onPaste={(event) => {
              const text = event.clipboardData.getData("text");
              const parsed = parseContactText(text);
              if (parsed?.phone) {
                event.preventDefault();
                fill(parsed);
              }
            }}
            placeholder="Имя — например, Прораб"
            aria-label="Имя"
            className={field}
          />
          <input
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            onPaste={(event) => {
              const parsed = parseContactText(event.clipboardData.getData("text"));
              if (parsed) {
                event.preventDefault();
                fill(parsed);
              }
            }}
            placeholder="Телефон — можно вставить"
            aria-label="Телефон"
            inputMode="tel"
            className={field}
          />
          <button type="submit" className="sr-only" tabIndex={-1} aria-hidden="true" disabled={!canSave}>
            Добавить
          </button>
        </form>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => card.current?.click()} className="inline-flex h-9 items-center gap-1.5 rounded-full px-1 text-sm text-accent">
            <Paperclip className="size-4" aria-hidden="true" />
            Из карточки .vcf
          </button>
          <Hint label="Как перенести контакт с iPhone">
            В «Контактах» откройте человека → «Поделиться контактом» → «Сохранить в Файлы», затем здесь «Из карточки .vcf». Можно и просто скопировать номер и вставить в поле.
          </Hint>
        </div>
        <input ref={card} type="file" accept=".vcf,text/vcard,text/x-vcard" className="sr-only" aria-label="Карточка контакта" onChange={(event) => void readCard(event.target.files?.[0])} />
        {notice ? <p className="text-xs text-warn">{notice}</p> : null}
        {canSave ? (
          <p className="flex items-center gap-1 text-xs text-muted">
            <Check className="size-3.5" aria-hidden="true" />
            {name.trim() || phone.trim()}
            {name.trim() && phone.trim() ? ` · ${phone.trim()}` : ""}
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}
