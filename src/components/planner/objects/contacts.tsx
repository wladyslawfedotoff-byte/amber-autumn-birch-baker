import { useState } from "react";
import { Mail, MessageSquare, Phone, Plus, Trash2, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FieldLabel } from "@/components/ui/hint";
import { usePlanner } from "@/lib/planner-store";
import type { ProjectContact } from "@/lib/planner-types";

const field = "h-11 w-full rounded-md border border-separator bg-card px-3 text-base text-label outline-none placeholder:text-tertiary-label";

export function ContactsBlock({ projectId, contacts }: { projectId: string; contacts: ProjectContact[] }) {
  const [editing, setEditing] = useState<string | null>(null);
  const addContact = usePlanner((s) => s.addContact);
  const updateContact = usePlanner((s) => s.updateContact);
  const deleteContact = usePlanner((s) => s.deleteContact);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");

  const save = () => {
    const id = addContact(projectId, { name, role, phone, email, note });
    if (!id) return;
    setName("");
    setRole("");
    setPhone("");
    setEmail("");
    setNote("");
    setOpen(false);
  };

  return (
    <section className="mt-4" aria-labelledby={`contacts-${projectId}`} data-testid="project-contacts">
      <div id={`contacts-${projectId}`}>
        <FieldLabel hint="Люди на объекте: заказчик, поставщик, прораб. Нажмите на телефон — позвонить, на конверт — написать.">
          Контакты
        </FieldLabel>
      </div>
      <ul className="mt-2 space-y-2">
        {contacts.map((contact) => (
          <li key={contact.id} className="rounded-card bg-card p-3">
            <div className="flex items-start gap-2">
              <UserRound className="mt-1 size-4 shrink-0 text-secondary-label" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                {editing === contact.id ? (
                  <>
                    <input
                      value={contact.name}
                      aria-label="Имя"
                      onChange={(event) => updateContact(projectId, contact.id, { name: event.target.value })}
                      className="w-full bg-transparent text-base font-medium text-label outline-none"
                    />
                    <input
                      value={contact.role ?? ""}
                      aria-label="Роль"
                      placeholder="Роль: заказчик, поставщик…"
                      onChange={(event) => updateContact(projectId, contact.id, { role: event.target.value })}
                      className="mt-1 w-full bg-transparent text-base text-secondary-label outline-none placeholder:text-tertiary-label"
                    />
                  </>
                ) : (
                  <>
                    <p className="truncate text-sm font-medium text-label">{contact.name}</p>
                    {contact.role ? <p className="truncate text-xs text-secondary-label">{contact.role}</p> : null}
                  </>
                )}
                {contact.note ? <p className="mt-1 text-xs text-secondary-label">{contact.note}</p> : null}
              </div>
              <Button size="icon" variant="ghost" aria-label={`Удалить ${contact.name}`} onClick={() => deleteContact(projectId, contact.id)}>
                <Trash2 className="size-4" />
              </Button>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {contact.phone ? (
                <>
                  <a href={`tel:${contact.phone.replace(/\s/g, "")}`} className="inline-flex h-9 items-center gap-2 rounded-full border border-separator px-3 text-sm text-label">
                    <Phone className="size-3.5" aria-hidden="true" />
                    {contact.phone}
                  </a>
                  <a href={`sms:${contact.phone.replace(/\s/g, "")}`} className="inline-flex h-9 items-center gap-2 rounded-full border border-separator px-3 text-sm text-label" aria-label={`Сообщение ${contact.name}`}>
                    <MessageSquare className="size-3.5" aria-hidden="true" />
                    SMS
                  </a>
                </>
              ) : null}
              {contact.email ? (
                <a href={`mailto:${contact.email}`} className="inline-flex h-9 items-center gap-2 rounded-full border border-separator px-3 text-sm text-label">
                  <Mail className="size-3.5" aria-hidden="true" />
                  {contact.email}
                </a>
              ) : null}
            </div>
            <button type="button" className="mt-1 text-xs text-secondary-label underline-offset-2 hover:underline" onClick={() => setEditing(editing === contact.id ? null : contact.id)}>
              {editing === contact.id ? "Готово" : "Изменить"}
            </button>
            {editing === contact.id ? (
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <input
                value={contact.phone ?? ""}
                aria-label="Телефон"
                placeholder="+7 …"
                inputMode="tel"
                onChange={(event) => updateContact(projectId, contact.id, { phone: event.target.value })}
                className={field}
              />
              <input
                value={contact.email ?? ""}
                aria-label="Почта"
                placeholder="user@example.com"
                inputMode="email"
                onChange={(event) => updateContact(projectId, contact.id, { email: event.target.value })}
                className={field}
              />
            </div>
            ) : null}
          </li>
        ))}
      </ul>
      {open ? (
        <form
          className="mt-2 space-y-2 rounded-card bg-card p-3"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Имя — например, Пользователь 1" aria-label="Имя" className={field} required />
          <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Роль" aria-label="Роль" className={field} />
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Телефон" aria-label="Телефон" inputMode="tel" className={field} />
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Почта" aria-label="Почта" inputMode="email" className={field} />
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Заметка" aria-label="Заметка" className={field} />
          <div className="flex gap-2">
            <Button type="submit" variant="primary" size="sm" disabled={!name.trim()}>
              Готово
            </Button>
            <Button type="button" variant="soft" size="sm" onClick={() => setOpen(false)}>
              Отменить
            </Button>
          </div>
        </form>
      ) : (
        <Button type="button" variant="soft" size="sm" className="mt-2" onClick={() => setOpen(true)}>
          <Plus className="size-4" aria-hidden="true" />
          Добавить контакт
        </Button>
      )}
    </section>
  );
}
