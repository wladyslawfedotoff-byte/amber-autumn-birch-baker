import { Users, UserCheck } from "lucide-react";
import { cn } from "@/lib/cn";
import { usePlanner } from "@/lib/planner-store";
import type { Task, TaskList } from "@/lib/planner-types";
import { isSharedTask, ownerOf } from "@/lib/queries";
import { displayName, useProfile, type Capabilities } from "@/lib/use-capabilities";

function others(profile: Capabilities, exclude: string[]): { login: string; name: string }[] {
  return profile.users.filter((user) => !exclude.includes(user.login));
}

/** Short line for a task row: «от Пользователя 1», «→ Пользователь 2», «вместе с Пользователем 2», «выполнил(а) Пользователь 2». */
export function ShareBadges({ task }: { task: Task }) {
  const profile = useProfile();
  const lists = usePlanner((s) => s.lists);
  if (!profile.multiUser || !profile.login) return null;
  const me = profile.login;
  const owner = ownerOf(task, profile.dataOwner || me);
  const parts: string[] = [];
  if (owner !== me) parts.push(`от ${displayName(owner, profile)}`);
  if (task.assignee) parts.push(task.assignee === me ? "назначено вам" : `→ ${displayName(task.assignee, profile)}`);
  const members = (task.members ?? []).filter((login) => login !== me && login !== owner);
  if (members.length && !task.assignee) parts.push(`вместе с: ${members.map((login) => displayName(login, profile)).join(", ")}`);
  if (!parts.length && isSharedTask(task, lists, me, profile.dataOwner || me)) parts.push("общий список");
  if (task.completedBy && task.completedBy !== me && (task.done || task.repeat)) {
    parts.push(`${task.done ? "выполнил(а)" : "отметил(а)"} ${displayName(task.completedBy, profile)}`);
  }
  if (!parts.length) return null;
  return (
    <span className="inline-flex items-center gap-1 text-accent">
      <Users className="size-3" aria-hidden="true" />
      {parts.join(" · ")}
    </span>
  );
}

function Chip({ on, label, onClick, hint }: { on: boolean; label: string; onClick: () => void; hint?: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      title={hint}
      onClick={onClick}
      className={cn(
        "flex h-10 items-center gap-1 rounded-full border px-3 text-sm",
        on ? "border-accent bg-accent text-accent-fg" : "border-line text-muted hover:text-fg",
      )}
    >
      {label}
    </button>
  );
}

/** «Совместная» + «Назначить» in the task detail. */
export function TaskShareControls({ task }: { task: Task }) {
  const profile = useProfile();
  const setTaskMembers = usePlanner((s) => s.setTaskMembers);
  const assignTask = usePlanner((s) => s.assignTask);
  const lists = usePlanner((s) => s.lists);
  if (!profile.multiUser || !profile.login) return null;
  const me = profile.login;
  const owner = ownerOf(task, profile.dataOwner || me);
  const members = task.members ?? [];
  const people = others(profile, [owner]);
  const list = task.listId ? lists.find((l) => l.id === task.listId) : null;
  const viaList = list && (list.members ?? []).length > 0;
  return (
    <section className="mt-6" aria-labelledby="share-title">
      <p id="share-title" className="flex items-center gap-1 text-sm font-medium text-fg">
        <Users className="size-4" aria-hidden="true" /> Совместная
      </p>
      <p className="mt-1 text-xs text-muted">
        {owner === me ? "Ваша задача." : `Задача ${displayName(owner, profile)} — вы её участник.`} Отметьте, кто ещё её видит и может менять. Изменения и
        «выполнено» видны всем участникам.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {people.length === 0 ? <span className="text-xs text-subtle">Больше профилей нет — их добавляют в .env на сервере.</span> : null}
        {people.map((user) => {
          const on = members.includes(user.login);
          return (
            <Chip
              key={user.login}
              on={on}
              label={user.login === me ? "Я" : user.name}
              hint={on ? "Нажмите, чтобы убрать" : "Нажмите, чтобы поделиться"}
              onClick={() => setTaskMembers(task.id, on ? members.filter((login) => login !== user.login) : [...members, user.login])}
            />
          );
        })}
      </div>
      {viaList ? (
        <p className="mt-2 text-xs text-muted">Ещё её видят все, с кем вы делитесь списком «{list!.name}».</p>
      ) : null}
      <p className="mt-4 flex items-center gap-1 text-sm font-medium text-fg">
        <UserCheck className="size-4" aria-hidden="true" /> Назначить
      </p>
      <p className="mt-1 text-xs text-muted">Кто должен сделать. Человек увидит задачу у себя — в «Общих» и в «Сегодня», если есть дата.</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Chip on={!task.assignee} label="Никому" onClick={() => assignTask(task.id, null)} />
        {profile.users.map((user) => (
          <Chip
            key={user.login}
            on={task.assignee === user.login}
            label={user.login === me ? "Мне" : user.name}
            onClick={() => assignTask(task.id, user.login)}
          />
        ))}
      </div>
    </section>
  );
}

/** Share a whole list (in the list's header). */
export function ListShareBar({ list }: { list: TaskList }) {
  const profile = useProfile();
  const setListMembers = usePlanner((s) => s.setListMembers);
  if (!profile.multiUser || !profile.login) return null;
  const me = profile.login;
  const owner = ownerOf(list, profile.dataOwner || me);
  const members = list.members ?? [];
  const people = others(profile, [owner]);
  if (!people.length) return null;
  return (
    <div className="mt-3 rounded-xl border border-line p-3">
      <p className="flex items-center gap-1 text-sm text-fg">
        <Users className="size-4" aria-hidden="true" />
        {owner === me ? "Поделиться списком" : `Список ${displayName(owner, profile)}`}
      </p>
      <p className="mt-1 text-xs text-muted">
        {owner === me
          ? "Все задачи списка (и новые тоже) увидят и смогут отмечать выбранные люди. Например, «Покупки» на двоих."
          : "Вы видите этот список, потому что с вами им поделились. «Удалить список» уберёт его только у вас."}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {people.map((user) => {
          const on = members.includes(user.login);
          return (
            <Chip
              key={user.login}
              on={on}
              label={user.login === me ? "Я" : user.name}
              onClick={() => setListMembers(list.id, on ? members.filter((login) => login !== user.login) : [...members, user.login])}
            />
          );
        })}
      </div>
    </div>
  );
}
