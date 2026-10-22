import { NAME_MAX, cleanPhone, cleanTitle, normalizeUrl } from "@/lib/objects/links";
import { addPain, buildRule, createAsset, logService, patchAsset, removeEntry, painTaskId, parsePainRef, addAssetContactTo, addFill, addPart, removeFill, removePart, updateFill, updatePart, addAssetLinkTo, removePain, resolvePainPlan, removeReading, updatePain, updateReading, updateService, removeRule, setMileage, setPainSolved } from "@/lib/maintenance/ops";
import { kmTaskId, openTasksFor, painTask, planIsEmpty, planMaintenance } from "@/lib/maintenance/plan";
import { usePainPrompt } from "@/lib/maintenance/prompt";
import { create } from "zustand";
import { placeItem } from "@/lib/reorder";
import { createJSONStorage, persist } from "zustand/middleware";
import { plannerStorage } from "@/lib/offline/device-store";
import { syncNow } from "@/lib/sync/clock";
import { emptyTombstones } from "@/lib/sync/merge";
import { safeDependsOn, wouldCycle } from "@/lib/task-deps";
import { cleanDates, firstChosenDate, todayIso } from "@/lib/dates";
import { currentLogin } from "@/lib/use-capabilities";
import { parseQuick } from "@/lib/quick-add";
import { normalizeLead } from "@/lib/reminders";
import { stageRange } from "@/lib/stage-range";
import { clearDate, clearTime, duplicateTask as duplicateTaskData, listInNotes, splitLines } from "@/lib/task-tools";
import { isAccent } from "@/lib/accents";
import { normalizeCalendarMode, normalizeDrawerTab, normalizeHidden, migrateNav, normalizeTabs, togglePin } from "@/lib/ui-prefs";
import { sectionOf, sortHabits, tapDay, withEntry } from "@/lib/habit-plan";
import { normalizeArchiveDays, restoreFromArchive, toggleTaskDone, undoRepeatTick } from "@/lib/task-done";
import type { Habit, AttachmentMeta, Asset, Project, ProjectContact, ProjectStage, Task } from "@/lib/planner-types";
import { breakFor, freshFocus, type PlannerState } from "@/lib/planner/state";
import { fillRemindAt, fillTasks, memoryStorage, seed, uid } from "@/lib/planner/defaults";
import { stamped, stampPatch } from "@/lib/planner/stamp";

export { breakFor, freshFocus, stampPatch };
export type { PlannerState };

function cleanContact(input: Partial<Omit<ProjectContact, "id">>): Partial<Omit<ProjectContact, "id">> {
  const out: Partial<Omit<ProjectContact, "id">> = {};
  const field = (value: string | undefined, max: number) => (value === undefined ? undefined : value.trim().slice(0, max));
  if (input.role !== undefined) out.role = field(input.role, 80);
  if (input.phone !== undefined) out.phone = field(input.phone, 40)!.replace(/[^\d+()\-\s]/g, "");
  if (input.email !== undefined) out.email = field(input.email, 160);
  if (input.note !== undefined) out.note = field(input.note, 500);
  return out;
}

function pick<T extends object, K extends keyof T>(obj: T, keys: K[]): Pick<T, K> {
  const out = {} as Pick<T, K>;
  for (const key of keys) out[key] = obj[key];
  return out;
}

export const usePlanner = create<PlannerState>()(
  persist(
    stamped((set, get) => ({
      ...seed(),
      addTask: (input) => {
        const parsed = parseQuick(input.title);
        const title = parsed.title.trim();
        const id = uid();
        if (!title) return id;
        const timed = parsed.startAt != null;
        const task: Task = {
          id,
          title,
          notes: input.notes ?? "",
          listId: input.listId,
          done: false,
          priority: input.priority ?? 0,
          due: parsed.due ?? input.due,
          tags: input.tags ?? [],
          subtasks: [],
          createdAt: Date.now(),
          completedAt: null,
          important: input.important ?? false,
          urgent: input.urgent ?? false,
          remindAt: timed ? parsed.startAt : (input.remindAt ?? null),
          startAt: timed ? parsed.startAt : (input.startAt ?? null),
          endAt: timed ? parsed.endAt : (input.endAt ?? null),
        };
        const lead = get().remindLeadDefault;
        if (task.remindAt && lead) task.remindLead = lead;
        const final = input.noDate ? clearDate(task) : input.noTime ? clearTime(task) : task;
        set((s) => ({ tasks: [final, ...s.tasks] }));
        return id;
      },
      updateTask: (id, patch) =>
        set((s) => ({
          tasks: s.tasks.map((t) => {
            if (t.id !== id) return t;
            const next = { ...t, ...patch };
            // A new reminder gets the default «заранее» of this device.
            if (patch.remindAt && !t.remindAt && patch.remindLead === undefined && s.remindLeadDefault) next.remindLead = s.remindLeadDefault;
            return next;
          }),
        })),
      toggleTask: (id) => {
        const before = get().tasks.find((t) => t.id === id);
        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.id === id ? toggleTaskDone(t, { me: currentLogin() || null, today: todayIso(), now: syncNow() }) : t,
          ),
        }));
        // The task of a planned «что болит» note: ticking it solves the note (and offers a history entry).
        const ref = parsePainRef(before?.maint);
        const after = get().tasks.find((t) => t.id === id);
        if (!ref || !before || !after || before.done === after.done) return;
        const asset = (get().assets ?? []).find((a) => a.id === ref.assetId);
        const pain = asset?.pains.find((p) => p.id === ref.painId);
        if (!asset || !pain) return;
        const solvedAt = after.done ? pain.solvedAt || Date.now() : null;
        set((s) => ({ assets: (s.assets ?? []).map((a) => (a.id === asset.id ? setPainSolved(a, pain.id, !!solvedAt, solvedAt || 0) : a)) }));
        if (after.done) usePainPrompt.getState().show({ assetId: asset.id, painId: pain.id, title: (pain.todo || pain.text).slice(0, 160) });
        else usePainPrompt.getState().clear();
      },
      clearTaskTime: (id) => set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? clearTime(t) : t)) })),
      clearTaskDate: (id) => set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? clearDate(t) : t)) })),
      undoRepeat: (id) => set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? undoRepeatTick(t) : t)) })),
      restoreTask: (id) => set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? restoreFromArchive(t) : t)) })),
      deleteTasks: (ids) => {
        const gone = new Set(ids);
        set((s) => ({ tasks: s.tasks.filter((t) => !gone.has(t.id)) }));
      },
      setArchiveDays: (days) => set({ archiveDays: normalizeArchiveDays(days) }),
      setScheduleDays: (days) => set({ scheduleDays: [1, 2, 3, 5, 7].includes(days) ? days : 1 }),
      setDoneFolded: (folded) => set({ doneFolded: folded }),
      setMilestoneMembers: (id, members) =>
        set((s) => ({
          milestones: s.milestones.map((m) => (m.id === id ? { ...m, members: [...new Set(members)] } : m)),
        })),
      addMilestoneItem: (id, kind, title, extra) => {
        const titles = splitLines(title);
        if (!titles.length) return;
        set((s) => ({
          milestones: s.milestones.map((m) =>
            m.id === id
              ? {
                  ...m,
                  items: [
                    ...(m.items ?? []),
                    ...titles.map((clean) => ({
                      id: uid(),
                      kind,
                      title: clean,
                      done: false,
                      link: extra?.link?.trim() || null,
                      price: extra?.price?.trim() || null,
                    })),
                  ],
                }
              : m,
          ),
        }));
      },
      updateMilestoneItem: (id, itemId, patch) =>
        set((s) => ({
          milestones: s.milestones.map((m) =>
            m.id === id ? { ...m, items: (m.items ?? []).map((item) => (item.id === itemId ? { ...item, ...patch } : item)) } : m,
          ),
        })),
      deleteMilestoneItem: (id, itemId) =>
        set((s) => ({
          milestones: s.milestones.map((m) => (m.id === id ? { ...m, items: (m.items ?? []).filter((item) => item.id !== itemId) } : m)),
        })),
      setRepeatDates: (id, dates) =>
        set((s) => ({
          tasks: s.tasks.map((t) => {
            if (t.id !== id) return t;
            const clean = cleanDates(dates);
            const due = firstChosenDate(clean, todayIso());
            const reopen = t.done && due !== null && due >= todayIso();
            return { ...t, repeat: "dates", repeatDates: clean, due, ...(reopen ? { done: false, completedAt: null } : {}) };
          }),
        })),
      setTaskMembers: (id, members) =>
        set((s) => ({
          tasks: s.tasks.map((t) => (t.id === id ? { ...t, members: [...new Set(members)] } : t)),
        })),
      assignTask: (id, login) =>
        set((s) => ({
          tasks: s.tasks.map((t) => (t.id === id ? { ...t, assignee: login } : t)),
        })),
      setListMembers: (id, members) =>
        set((s) => ({
          lists: s.lists.map((l) => (l.id === id ? { ...l, members: [...new Set(members)] } : l)),
        })),
      deleteTask: (id) =>
        set((s) => ({
          tasks: s.tasks.filter((t) => t.id !== id).map((t) => (t.dependsOn === id ? { ...t, dependsOn: null } : t)),
        })),
      addSubtask: (taskId, title) => {
        const titles = splitLines(title);
        if (!titles.length) return;
        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.id === taskId
              ? {
                  ...t,
                  subtasks: [...(t.subtasks ?? []), ...titles.map((clean) => ({ id: uid(), title: clean, done: false }))],
                }
              : t,
          ),
        }));
      },
      duplicateTask: (id, due) => {
        const original = get().tasks.find((t) => t.id === id);
        if (!original) return null;
        const copy = duplicateTaskData(original, { id: uid(), newSubId: uid, now: Date.now(), due });
        set((s) => {
          const at = s.tasks.findIndex((t) => t.id === id);
          const tasks = [...s.tasks];
          tasks.splice(at < 0 ? 0 : at + 1, 0, copy);
          return { tasks };
        });
        return copy.id;
      },
      notesToSubtasks: (taskId) => {
        const task = get().tasks.find((t) => t.id === taskId);
        if (!task) return 0;
        const { items, rest } = listInNotes(task.notes);
        if (!items.length) return 0;
        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.id === taskId
              ? { ...t, notes: rest, subtasks: [...(t.subtasks ?? []), ...items.map((title) => ({ id: uid(), title, done: false }))] }
              : t,
          ),
        }));
        return items.length;
      },
      toggleSubtask: (taskId, subId) =>
        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.id === taskId
              ? {
                  ...t,
                  subtasks: (t.subtasks ?? []).map((sub) =>
                    sub.id === subId ? { ...sub, done: !sub.done } : sub,
                  ),
                }
              : t,
          ),
        })),
      deleteSubtask: (taskId, subId) =>
        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.id === taskId
              ? { ...t, subtasks: (t.subtasks ?? []).filter((sub) => sub.id !== subId) }
              : t,
          ),
        })),
      moveSubtask: (taskId, subId, delta) =>
        set((s) => ({
          tasks: s.tasks.map((t) => {
            if (t.id !== taskId) return t;
            const subs = [...(t.subtasks ?? [])];
            const from = subs.findIndex((sub) => sub.id === subId);
            const to = from + delta;
            if (from < 0 || to < 0 || to >= subs.length) return t;
            [subs[from], subs[to]] = [subs[to]!, subs[from]!];
            return { ...t, subtasks: subs };
          }),
        })),
      placeSubtask: (taskId, subId, toIndex) =>
        set((s) => ({
          tasks: s.tasks.map((t) => (t.id === taskId ? { ...t, subtasks: placeItem(t.subtasks ?? [], subId, toIndex) } : t)),
        })),
      addTaskLink: (taskId, url, title) => {
        const href = normalizeUrl(url);
        if (!href) return null;
        const id = uid();
        const clean = cleanTitle(title);
        set((s) => ({
          tasks: s.tasks.map((t) => (t.id === taskId ? { ...t, links: [...(t.links ?? []), clean ? { id, url: href, title: clean } : { id, url: href }] } : t)),
        }));
        return id;
      },
      removeTaskLink: (taskId, linkId) =>
        set((s) => ({ tasks: s.tasks.map((t) => (t.id === taskId ? { ...t, links: (t.links ?? []).filter((l) => l.id !== linkId) } : t)) })),
      addTaskContact: (taskId, contact) => {
        const phone = cleanPhone(contact.phone);
        const name = cleanTitle(contact.name).slice(0, NAME_MAX) || phone || "";
        if (!name) return null;
        const id = uid();
        set((s) => ({
          tasks: s.tasks.map((t) => (t.id === taskId ? { ...t, contacts: [...(t.contacts ?? []), phone ? { id, name, phone } : { id, name }] } : t)),
        }));
        return id;
      },
      removeTaskContact: (taskId, contactId) =>
        set((s) => ({ tasks: s.tasks.map((t) => (t.id === taskId ? { ...t, contacts: (t.contacts ?? []).filter((c) => c.id !== contactId) } : t)) })),
      setTaskDependsOn: (taskId, dependsOn) => {
        const tasks = get().tasks;
        if (dependsOn && wouldCycle(taskId, dependsOn, tasks)) return false;
        const safe = safeDependsOn(taskId, dependsOn, tasks);
        set((s) => ({ tasks: s.tasks.map((t) => (t.id === taskId ? { ...t, dependsOn: safe } : t)) }));
        return true;
      },
      addAttachment: (kind, parentId, meta) =>
        set((s) => {
          const add = <T extends { id: string; attachments?: AttachmentMeta[] }>(item: T): T =>
            item.id === parentId && !(item.attachments ?? []).some((a) => a.id === meta.id)
              ? { ...item, attachments: [...(item.attachments ?? []), meta] }
              : item;
          return kind === "task" ? { tasks: s.tasks.map(add) } : kind === "asset" ? { assets: (s.assets ?? []).map(add) } : { projects: (s.projects ?? []).map(add) };
        }),
      patchAttachment: (kind, parentId, attachId, patch) =>
        set((s) => {
          const edit = <T extends { id: string; attachments?: AttachmentMeta[] }>(item: T): T =>
            item.id === parentId && item.attachments?.some((a) => a.id === attachId)
              ? { ...item, attachments: item.attachments.map((a) => (a.id === attachId ? { ...a, ...patch, updatedAt: Date.now() } : a)) }
              : item;
          return kind === "task" ? { tasks: s.tasks.map(edit) } : kind === "asset" ? { assets: (s.assets ?? []).map(edit) } : { projects: (s.projects ?? []).map(edit) };
        }),
      removeAttachment: (kind, parentId, attachId) =>
        set((s) => {
          const drop = <T extends { id: string; attachments?: AttachmentMeta[] }>(item: T): T =>
            item.id === parentId ? { ...item, attachments: (item.attachments ?? []).filter((a) => a.id !== attachId) } : item;
          if (kind === "project") return { projects: (s.projects ?? []).map(drop) };
          if (kind === "asset") return { assets: (s.assets ?? []).map(drop) };
          return {
            tasks: s.tasks.map((t) => {
              if (t.id !== parentId) return t;
              const next = drop(t);
              return {
                ...next,
                beforeId: next.beforeId === attachId ? null : next.beforeId,
                afterId: next.afterId === attachId ? null : next.afterId,
                subtasks: (next.subtasks ?? []).map((sub) =>
                  sub.beforeId === attachId || sub.afterId === attachId
                    ? { ...sub, beforeId: sub.beforeId === attachId ? null : sub.beforeId, afterId: sub.afterId === attachId ? null : sub.afterId }
                    : sub,
                ),
              };
            }),
          };
        }),
      addContact: (projectId, contact) => {
        const name = contact.name.trim().slice(0, 120);
        if (!name) return null;
        const id = uid();
        set((s) => ({
          projects: (s.projects ?? []).map((p) =>
            p.id === projectId ? { ...p, contacts: [...(p.contacts ?? []), { ...cleanContact(contact), name, id }] } : p,
          ),
        }));
        return id;
      },
      updateContact: (projectId, contactId, patch) =>
        set((s) => ({
          projects: (s.projects ?? []).map((p) =>
            p.id === projectId
              ? {
                  ...p,
                  contacts: (p.contacts ?? []).map((c) =>
                    c.id === contactId ? { ...c, ...cleanContact(patch), name: (patch.name ?? c.name).trim().slice(0, 120) || c.name } : c,
                  ),
                }
              : p,
          ),
        })),
      deleteContact: (projectId, contactId) =>
        set((s) => ({
          projects: (s.projects ?? []).map((p) =>
            p.id === projectId ? { ...p, contacts: (p.contacts ?? []).filter((c) => c.id !== contactId) } : p,
          ),
          tasks: s.tasks.map((t) => (t.contactId === contactId ? { ...t, contactId: null } : t)),
        })),
      addAsset: (input) => {
        const asset = createAsset(input, uid(), Date.now(), todayIso());
        if (!asset) return null;
        const me = currentLogin();
        set((s) => ({ assets: [...(s.assets ?? []), me ? { ...asset, owner: me } : asset] }));
        return asset.id;
      },
      updateAsset: (id, patch) => {
        set((s) => ({ assets: (s.assets ?? []).map((a) => (a.id === id ? patchAsset(a, patch) : a)) }));
        // Switching the monthly reminder off drops the ones not done yet.
        if (patch.kmRemind === false) {
          const gone = new Set(openTasksFor(get().tasks, `${id}/km`));
          if (gone.size) set((s) => ({ tasks: s.tasks.filter((t) => !gone.has(t.id)) }));
        }
        get().syncMaintenance();
      },
      deleteAsset: (id) => {
        const gone = new Set(openTasksFor(get().tasks, `${id}/`));
        set((s) => ({ assets: (s.assets ?? []).filter((a) => a.id !== id), tasks: gone.size ? s.tasks.filter((t) => !gone.has(t.id)) : s.tasks }));
      },
      setAssetKm: (id, km) => {
        const today = todayIso();
        const found = (get().assets ?? []).find((a) => a.id === id);
        const next = found ? setMileage(found, km, today, uid()) : null;
        if (!next) return false;
        const done = new Set([kmTaskId(id, today.slice(0, 7))]);
        set((s) => ({
          assets: (s.assets ?? []).map((a) => (a.id === id ? next : a)),
          tasks: s.tasks.map((t) => (done.has(t.id) && !t.done ? { ...t, done: true, completedAt: syncNow() } : t)),
        }));
        get().syncMaintenance();
        return true;
      },
      addAssetRule: (assetId, input) => {
        const found = (get().assets ?? []).find((a) => a.id === assetId);
        const built = found ? buildRule(found, input, { rule: uid(), entry: uid() }, todayIso()) : null;
        if (!found || !built) return null;
        let next: Asset = { ...found, rules: [...(found.rules ?? []), built.rule] };
        if (built.entry) next = { ...next, log: [...(found.log ?? []), built.entry] };
        set((s) => ({ assets: (s.assets ?? []).map((a) => (a.id === assetId ? next : a)) }));
        get().syncMaintenance();
        return built.rule.id;
      },
      updateAssetRule: (assetId, ruleId, input) => {
        const found = (get().assets ?? []).find((a) => a.id === assetId);
        const old = found?.rules.find((r) => r.id === ruleId);
        const built = found && old ? buildRule(found, input, { rule: ruleId, entry: uid() }, old.since) : null;
        if (!found || !old || !built) return false;
        // Keep the history of the rule; «last time» is derived from the log.
        const rule = { ...built.rule, since: old.since, sinceKm: old.sinceKm ?? built.rule.sinceKm, lastDoneAt: old.lastDoneAt ?? null, lastDoneKm: old.lastDoneKm ?? null, ...(old.notified ? { notified: old.notified } : {}) };
        if (!rule.everyKm) delete rule.everyKm;
        const next = { ...found, rules: found.rules.map((r) => (r.id === ruleId ? rule : r)) };
        set((s) => ({ assets: (s.assets ?? []).map((a) => (a.id === assetId ? next : a)) }));
        get().syncMaintenance();
        return true;
      },
      deleteAssetRule: (assetId, ruleId) => {
        const gone = new Set(openTasksFor(get().tasks, `${assetId}/${ruleId}`));
        set((s) => ({
          assets: (s.assets ?? []).map((a) => (a.id === assetId ? removeRule(a, ruleId) : a)),
          tasks: gone.size ? s.tasks.filter((t) => !gone.has(t.id)) : s.tasks,
        }));
      },
      addAssetService: (assetId, input) => {
        const found = (get().assets ?? []).find((a) => a.id === assetId);
        const done = found ? logService(found, input, { entry: input.id && /^[\w-]{6,64}$/.test(input.id) ? input.id : uid(), reading: uid() }, todayIso()) : null;
        if (!found || !done) return null;
        const close = new Set((done.entry.ruleIds ?? []).flatMap((ruleId) => openTasksFor(get().tasks, `${assetId}/${ruleId}`)));
        set((s) => ({
          assets: (s.assets ?? []).map((a) => (a.id === assetId ? done.asset : a)),
          tasks: close.size ? s.tasks.map((t) => (close.has(t.id) ? { ...t, done: true, completedAt: syncNow() } : t)) : s.tasks,
        }));
        get().syncMaintenance();
        return done.entry.id;
      },
      addAssetLink: (assetId, parentId, url, title) => {
        const found = (get().assets ?? []).find((a) => a.id === assetId);
        const next = found ? addAssetLinkTo(found, parentId, uid(), url, title) : null;
        if (!next) return false;
        set((s) => ({ assets: (s.assets ?? []).map((a) => (a.id === assetId ? next : a)) }));
        return true;
      },
      removeAssetLink: (assetId, linkId) =>
        set((s) => ({ assets: (s.assets ?? []).map((a) => (a.id === assetId ? { ...a, links: (a.links ?? []).filter((l) => l.id !== linkId) } : a)) })),
      addAssetContact: (assetId, parentId, contact) => {
        const found = (get().assets ?? []).find((a) => a.id === assetId);
        const next = found ? addAssetContactTo(found, parentId, uid(), contact) : null;
        if (!next) return false;
        set((s) => ({ assets: (s.assets ?? []).map((a) => (a.id === assetId ? next : a)) }));
        return true;
      },
      removeAssetContact: (assetId, contactId) =>
        set((s) => ({ assets: (s.assets ?? []).map((a) => (a.id === assetId ? { ...a, contacts: (a.contacts ?? []).filter((c) => c.id !== contactId) } : a)) })),
      discardAssetChildren: (assetId, parentId) =>
        set((s) => ({
          assets: (s.assets ?? []).map((a) =>
            a.id === assetId ? { ...a, links: (a.links ?? []).filter((l) => l.entryId !== parentId), contacts: (a.contacts ?? []).filter((c) => c.entryId !== parentId) } : a,
          ),
        })),
      addAssetFuel: (assetId, input) => {
        const found = (get().assets ?? []).find((a) => a.id === assetId);
        const done = found ? addFill(found, input, { fill: input.id && /^[\w-]{6,64}$/.test(input.id) ? input.id : uid(), reading: uid() }, todayIso()) : null;
        if (!done) return null;
        set((s) => ({ assets: (s.assets ?? []).map((a) => (a.id === assetId ? done.asset : a)) }));
        get().syncMaintenance();
        return done.fill.id;
      },
      updateAssetFuel: (assetId, fillId, input) => {
        const found = (get().assets ?? []).find((a) => a.id === assetId);
        const done = found ? updateFill(found, fillId, input, uid(), todayIso()) : null;
        if (!done) return false;
        set((s) => ({ assets: (s.assets ?? []).map((a) => (a.id === assetId ? done.asset : a)) }));
        get().syncMaintenance();
        return true;
      },
      deleteAssetFuel: (assetId, fillId) => {
        set((s) => ({ assets: (s.assets ?? []).map((a) => (a.id === assetId ? removeFill(a, fillId) : a)) }));
        get().syncMaintenance();
      },
      addAssetPart: (assetId, input) => {
        const found = (get().assets ?? []).find((a) => a.id === assetId);
        const done = found ? addPart(found, input, input.id && /^[\w-]{6,64}$/.test(input.id) ? input.id : uid()) : null;
        if (!done) return null;
        set((s) => ({ assets: (s.assets ?? []).map((a) => (a.id === assetId ? done.asset : a)) }));
        get().syncMaintenance();
        return done.part.id;
      },
      updateAssetPart: (assetId, partId, input) => {
        const found = (get().assets ?? []).find((a) => a.id === assetId);
        const next = found ? updatePart(found, partId, input) : null;
        if (!next) return false;
        set((s) => ({ assets: (s.assets ?? []).map((a) => (a.id === assetId ? next : a)) }));
        get().syncMaintenance();
        return true;
      },
      deleteAssetPart: (assetId, partId) => {
        const gone = new Set(openTasksFor(get().tasks, `${assetId}/warr:${partId}`));
        set((s) => ({
          assets: (s.assets ?? []).map((a) => (a.id === assetId ? removePart(a, partId) : a)),
          tasks: gone.size ? s.tasks.filter((t) => !gone.has(t.id)) : s.tasks,
        }));
      },
      updateAssetEntry: (assetId, entryId, input) => {
        const found = (get().assets ?? []).find((a) => a.id === assetId);
        const done = found ? updateService(found, entryId, input, uid()) : null;
        if (!found || !done) return false;
        // Rules this entry now resets: their open reminder is done.
        const before = new Set(found.log.find((e) => e.id === entryId)?.ruleIds ?? []);
        const close = new Set((done.entry.ruleIds ?? []).filter((r) => !before.has(r)).flatMap((ruleId) => openTasksFor(get().tasks, `${assetId}/${ruleId}`)));
        set((s) => ({
          assets: (s.assets ?? []).map((a) => (a.id === assetId ? done.asset : a)),
          tasks: close.size ? s.tasks.map((t) => (close.has(t.id) ? { ...t, done: true, completedAt: syncNow() } : t)) : s.tasks,
        }));
        get().syncMaintenance();
        return true;
      },
      updateAssetPain: (assetId, painId, text, todo) => {
        const found = (get().assets ?? []).find((a) => a.id === assetId);
        const next = found ? updatePain(found, painId, text, todo) : null;
        if (!found || !next) return false;
        const pain = next.pains.find((p) => p.id === painId)!;
        // The reminder shows the same words.
        const taskId = painTaskId(painId);
        const open = get().tasks.some((t) => t.id === taskId && !t.done);
        set((s) => ({
          assets: (s.assets ?? []).map((a) => (a.id === assetId ? next : a)),
          tasks: open ? s.tasks.map((t) => (t.id === taskId ? { ...t, ...pick(painTask(next, pain, t.due ?? todayIso(), 0), ["title", "notes"]) } : t)) : s.tasks,
        }));
        return true;
      },
      planAssetPain: (assetId, painId, input) => {
        const found = (get().assets ?? []).find((a) => a.id === assetId);
        const pain = found?.pains.find((p) => p.id === painId);
        const plan = found && pain ? resolvePainPlan(found, input, todayIso()) : null;
        if (!found || !pain || !plan) return false;
        const nextPain = { ...pain, planDate: plan.planDate, planKm: plan.planKm, taskMade: plan.planDate !== null, solvedAt: null };
        const next: Asset = { ...found, pains: found.pains.map((p) => (p.id === painId ? nextPain : p)) };
        const taskId = painTaskId(painId);
        const made = painTask(next, nextPain, plan.planDate ?? todayIso(), Date.now());
        set((s) => {
          const others = s.tasks.filter((t) => t.id !== taskId);
          const existing = s.tasks.find((t) => t.id === taskId);
          let tasks = s.tasks;
          if (plan.planDate) tasks = existing ? s.tasks.map((t) => (t.id === taskId ? { ...t, ...pick(made, ["title", "notes", "due", "remindAt"]), done: false, completedAt: null } : t)) : [...s.tasks, made];
          else tasks = others; // mileage-based: the task is made when the mileage gets close
          return { assets: (s.assets ?? []).map((a) => (a.id === assetId ? next : a)), tasks };
        });
        get().syncMaintenance();
        return true;
      },
      unplanAssetPain: (assetId, painId) => {
        const taskId = painTaskId(painId);
        set((s) => ({
          assets: (s.assets ?? []).map((a) => (a.id === assetId ? { ...a, pains: a.pains.map((p) => (p.id === painId ? { ...p, planDate: null, planKm: null, taskMade: false } : p)) } : a)),
          tasks: s.tasks.filter((t) => t.id !== taskId || t.done),
        }));
      },
      updateAssetReading: (assetId, readingId, km) => {
        const found = (get().assets ?? []).find((a) => a.id === assetId);
        const next = found ? updateReading(found, readingId, km) : null;
        if (!next) return false;
        set((s) => ({ assets: (s.assets ?? []).map((a) => (a.id === assetId ? next : a)) }));
        get().syncMaintenance();
        return true;
      },
      deleteAssetReading: (assetId, readingId) => {
        set((s) => ({ assets: (s.assets ?? []).map((a) => (a.id === assetId ? removeReading(a, readingId) : a)) }));
        get().syncMaintenance();
      },
      deleteAssetEntry: (assetId, entryId) => {
        set((s) => ({ assets: (s.assets ?? []).map((a) => (a.id === assetId ? removeEntry(a, entryId) : a)) }));
        get().syncMaintenance();
      },
      addAssetPain: (assetId, text, todo) => {
        const found = (get().assets ?? []).find((a) => a.id === assetId);
        const next = found ? addPain(found, text, uid(), Date.now(), todo) : null;
        if (!found || !next) return null;
        set((s) => ({ assets: (s.assets ?? []).map((a) => (a.id === assetId ? next : a)) }));
        return next.pains[next.pains.length - 1]!.id;
      },
      setAssetPainSolved: (assetId, painId, solved) => {
        const taskId = painTaskId(painId);
        set((s) => ({
          assets: (s.assets ?? []).map((a) => (a.id === assetId ? setPainSolved(a, painId, solved, Date.now()) : a)),
          // Solved by hand: the planned task is done too.
          tasks: solved ? s.tasks.map((t) => (t.id === taskId && !t.done ? { ...t, done: true, completedAt: syncNow() } : t)) : s.tasks,
        }));
      },
      deleteAssetPain: (assetId, painId) => {
        const taskId = painTaskId(painId);
        set((s) => ({ assets: (s.assets ?? []).map((a) => (a.id === assetId ? removePain(a, painId) : a)), tasks: s.tasks.filter((t) => t.id !== taskId || t.done) }));
      },
      setAssetMembers: (id, members) =>
        set((s) => ({ assets: (s.assets ?? []).map((a) => (a.id === id ? { ...a, members: [...new Set(members)] } : a)) })),
      syncMaintenance: () => {
        const s = get();
        // Tasks belong to one person: reminders are made only for the cards this person owns.
        const me = currentLogin();
        const mine = (s.assets ?? []).filter((a) => !a.owner || !me || a.owner === me);
        const plan = planMaintenance(mine, s.tasks, todayIso(), Date.now());
        if (planIsEmpty(plan)) return;
        const patches = new Map(plan.patch.map((p) => [p.id, p.patch]));
        const dropped = new Set(plan.remove);
        set((st) => ({
          tasks: [...st.tasks.filter((t) => !dropped.has(t.id)).map((t) => (patches.has(t.id) ? { ...t, ...patches.get(t.id)! } : t)), ...plan.create.filter((c) => !st.tasks.some((t) => t.id === c.id))],
          assets: (st.assets ?? []).map((a) => {
            const marks = plan.ruleNotified.filter((n) => n.assetId === a.id);
            const km = plan.kmNotified.find((n) => n.assetId === a.id);
            const madePains = new Set(plan.painMade.filter((n) => n.assetId === a.id).map((n) => n.painId));
            const warn = plan.warnMade.filter((n) => n.assetId === a.id);
            if (!marks.length && !km && !madePains.size && !warn.length) return a;
            const warnOf = (id: string) => warn.find((n) => n.subjectId === id)?.until;
            return { ...a, ...(madePains.size ? { pains: a.pains.map((p) => (madePains.has(p.id) ? { ...p, taskMade: true } : p)) } : {}),
              ...(warn.length ? { ...(warnOf(a.id) ? { warnMade: warnOf(a.id) } : {}), parts: (a.parts ?? []).map((p) => (warnOf(p.id) ? { ...p, warnMade: warnOf(p.id) } : p)) } : {}), ...(km ? { kmNotified: km.month } : {}), rules: a.rules.map((r) => { const m = marks.find((n) => n.ruleId === r.id); return m ? { ...r, notified: m.notified } : r; }) };
          }),
        }));
      },
      addList: (name) => {
        const id = uid();
        const clean = name.trim() || "Новый список";
        set((s) => ({ lists: [...s.lists, { id, name: clean }] }));
        return id;
      },
renameList: (id, name) =>
        set((s) => ({
          lists: s.lists.map((l) => (l.id === id ? { ...l, name } : l)),
        })),
      deleteList: (id) =>
        set((s) => {
          const list = s.lists.find((l) => l.id === id);
          const me = currentLogin();
          // Somebody else's shared list: «удалить» = leave it; their tasks stay where they are.
          const foreign = Boolean(me && list?.owner && list.owner !== me);
          return {
            lists: s.lists.filter((l) => l.id !== id),
            tasks: s.tasks.map((t) =>
              t.listId === id && (!foreign || t.owner === me) ? { ...t, listId: null } : t,
            ),
          };
        }),
      addHabit: (name, extra) => {
        const clean = name.trim().slice(0, 200);
        if (!clean) return null;
        const id = uid();
        set((s) => {
          const order = s.habits.reduce((max, h) => Math.max(max, h.order ?? 0), 0) + 1;
          const habit: Habit = { remindAt: null, ...extra, id, name: clean, checks: [], log: [], order, createdAt: Date.now() };
          return { habits: [...s.habits, habit] };
        });
        return id;
      },
      updateHabit: (id, patch) =>
        set((s) => ({
          habits: s.habits.map((h) => {
            if (h.id !== id) return h;
            const next: Habit = { ...h, ...patch };
            if (patch.name !== undefined) next.name = patch.name.trim().slice(0, 200) || h.name;
            return next;
          }),
        })),
      toggleHabit: (id, date) =>
        set((s) => ({
          habits: s.habits.map((h) => (h.id === id ? tapDay(h, date) : h)),
        })),
      setHabitDay: (id, date, patch) =>
        set((s) => ({
          habits: s.habits.map((h) => (h.id === id ? withEntry(h, date, patch) : h)),
        })),
      moveHabit: (id, delta) =>
        set((s) => {
          const habit = s.habits.find((h) => h.id === id);
          if (!habit) return {};
          const section = sectionOf(habit);
          const peers = sortHabits(s.habits.filter((h) => !h.archived === !habit.archived && sectionOf(h) === section));
          const index = peers.findIndex((h) => h.id === id);
          const target = index + delta;
          if (index < 0 || target < 0 || target >= peers.length) return {};
          [peers[index], peers[target]] = [peers[target]!, peers[index]!];
          const order = new Map(peers.map((h, i) => [h.id, i + 1]));
          return {
            habits: s.habits.map((h) => (order.has(h.id) && h.order !== order.get(h.id) ? { ...h, order: order.get(h.id) } : h)),
          };
        }),
      setHabitOrder: (ids) =>
        set((s) => {
          const order = new Map(ids.map((id, i) => [id, i + 1]));
          return {
            habits: s.habits.map((h) => (order.has(h.id) && h.order !== order.get(h.id) ? { ...h, order: order.get(h.id) } : h)),
          };
        }),
      deleteHabit: (id) => set((s) => ({ habits: s.habits.filter((h) => h.id !== id) })),
      addMilestone: (input) => {
        const title = input.title.trim();
        if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return null;
        const id = uid();
        set((s) => ({
          milestones: [
            ...s.milestones,
            {
              id,
              title,
              date: input.date,
              yearly: input.yearly,
              kind: input.kind,
              noYear: Boolean(input.noYear),
              remindAt: input.remindAt === undefined ? "09:00" : input.remindAt,
              remindDays: input.remindDays ?? input.reminders?.[0] ?? 0,
              ...(input.reminders ? { reminders: [...new Set(input.reminders)].sort((a, b) => a - b) } : {}),
              ...(input.icon ? { icon: input.icon } : {}),
              ...(input.color ? { color: input.color } : {}),
              ...(typeof input.showAge === "boolean" ? { showAge: input.showAge } : {}),
              ...(input.showInToday !== undefined ? { showInToday: input.showInToday } : {}),
              ...(input.notes ? { notes: input.notes } : {}),
              items: [],
            },
          ],
        }));
        return id;
      },
      updateMilestone: (id, patch) =>
        set((s) => ({
          milestones: s.milestones.map((m) => {
            if (m.id !== id) return m;
            const next = { ...m, ...patch };
            if (patch.title !== undefined) next.title = patch.title.slice(0, 200);
            // Keep the legacy single lead in step so older app versions still remind.
            if (patch.reminders) next.remindDays = patch.reminders[0] ?? 0;
            return next;
          }),
        })),
      deleteMilestone: (id) => set((s) => ({ milestones: s.milestones.filter((m) => m.id !== id) })),
      addProject: (title) => {
        const id = uid();
        const clean = title.trim();
        if (!clean) return id;
        const stages: ProjectStage[] = [
          { id: uid(), title: "План", cards: [] },
          { id: uid(), title: "В работе", cards: [] },
          { id: uid(), title: "Готово", cards: [] },
        ];
        const project: Project = { id, title: clean, start: null, end: null, stages };
        set((s) => ({ projects: [...(s.projects ?? []), project] }));
        return id;
      },
      updateProject: (id, patch) =>
        set((s) => ({
          projects: (s.projects ?? []).map((project) => (project.id === id ? { ...project, ...patch } : project)),
        })),
      deleteProject: (id) =>
        set((s) => ({ projects: (s.projects ?? []).filter((project) => project.id !== id) })),
      addStage: (projectId, title) => {
        const clean = title.trim();
        if (!clean) return;
        set((s) => ({
          projects: (s.projects ?? []).map((project) =>
            project.id === projectId
              ? { ...project, stages: [...project.stages, { id: uid(), title: clean, cards: [] }] }
              : project,
          ),
        }));
      },
      renameStage: (projectId, stageId, title) =>
        set((s) => ({
          projects: (s.projects ?? []).map((project) =>
            project.id === projectId
              ? {
                  ...project,
                  stages: project.stages.map((stage) =>
                    stage.id === stageId ? { ...stage, title: title.trim() || stage.title } : stage,
                  ),
                }
              : project,
          ),
        })),
      placeStage: (projectId, stageId, start, end) =>
        set((s) => ({
          projects: (s.projects ?? []).map((project) => {
            if (project.id !== projectId || end < start) return project;
            return {
              ...project,
              stages: project.stages.map((stage, index) => {
                if (stage.id === stageId) return { ...stage, start, end };
                if (stage.start && stage.end) return stage;
                const range = stageRange(project, stage, index);
                return range ? { ...stage, start: range.start, end: range.end } : stage;
              }),
            };
          }),
        })),
      deleteStage: (projectId, stageId) =>
        set((s) => ({
          projects: (s.projects ?? []).map((project) => {
            if (project.id !== projectId || project.stages.length < 2) return project;
            const index = project.stages.findIndex((stage) => stage.id === stageId);
            if (index < 0) return project;
            const removed = project.stages[index];
            const rest = project.stages.filter((stage) => stage.id !== stageId);
            const host = rest[Math.max(0, index - 1)];
            if (!host || !removed) return project;
            rest[Math.max(0, index - 1)] = { ...host, cards: [...host.cards, ...removed.cards] };
            return { ...project, stages: rest };
          }),
        })),
      addCard: (projectId, stageId, title) => {
        const clean = title.trim();
        if (!clean) return;
        set((s) => ({
          projects: (s.projects ?? []).map((project) =>
            project.id === projectId
              ? {
                  ...project,
                  stages: project.stages.map((stage) =>
                    stage.id === stageId
                      ? { ...stage, cards: [...stage.cards, { id: uid(), title: clean }] }
                      : stage,
                  ),
                }
              : project,
          ),
        }));
      },
      moveCard: (projectId, cardId, toStageId) =>
        set((s) => ({
          projects: (s.projects ?? []).map((project) => {
            if (project.id !== projectId) return project;
            let moving: Project["stages"][number]["cards"][number] | null = null;
            const stripped = project.stages.map((stage) => {
              const card = stage.cards.find((item) => item.id === cardId);
              if (!card) return stage;
              moving = card;
              return { ...stage, cards: stage.cards.filter((item) => item.id !== cardId) };
            });
            if (!moving) return project;
            return {
              ...project,
              stages: stripped.map((stage) =>
                stage.id === toStageId ? { ...stage, cards: [...stage.cards, moving!] } : stage,
              ),
            };
          }),
        })),
      deleteCard: (projectId, cardId) =>
        set((s) => ({
          projects: (s.projects ?? []).map((project) =>
            project.id === projectId
              ? {
                  ...project,
                  stages: project.stages.map((stage) => ({
                    ...stage,
                    cards: stage.cards.filter((card) => card.id !== cardId),
                  })),
                }
              : project,
          ),
        })),
      sendTaskToProject: (taskId, projectId) =>
        set((s) => {
          const task = s.tasks.find((item) => item.id === taskId);
          const projects = s.projects ?? [];
          if (!task || !projects.some((project) => project.id === projectId)) return {};
          const card = { id: uid(), title: task.title, taskId };
          return {
            projects: projects.map((project) => {
              const stages = project.stages.map((stage) => ({
                ...stage,
                cards: stage.cards.filter((item) => item.taskId !== taskId),
              }));
              if (project.id !== projectId) return { ...project, stages };
              const [first, ...rest] = stages;
              if (!first) return { ...project, stages };
              return { ...project, stages: [{ ...first, cards: [...first.cards, card] }, ...rest] };
            }),
          };
        }),
      setWorkHours: (start, end) => set({ workStart: start, workEnd: end }),
      ackReminder: (key, stamp) =>
        set((s) => ({ remindAck: { ...(s.remindAck ?? {}), [key]: stamp } })),
      setTheme: (theme) => set({ theme }),
      setTabBar: (tabs) =>
        set((s) => {
          const tabBar = normalizeTabs(tabs);
          return { tabBar, drawerHidden: normalizeHidden(s.drawerHidden, tabBar) };
        }),
      setNav: (prefs) => {
        const tabBar = normalizeTabs(prefs.tabBar);
        set({ tabBar, drawerHidden: normalizeHidden(prefs.drawerHidden, tabBar) });
      },
      setDrawerTab: (tab) => set({ drawerTab: normalizeDrawerTab(tab) }),
      togglePin: (key) => set((s) => ({ pins: togglePin(s.pins ?? [], key) })),
      setCalendarMode: (mode) => set({ calendarMode: normalizeCalendarMode(mode) }),
      setWeekNumbers: (on) => set({ weekNumbers: on }),
      setRemindLeadDefault: (lead) => set({ remindLeadDefault: normalizeLead(lead) }),
      setAccent: (accent) => set({ accent }),
      bumpPomo: () =>
        set((s) => {
          const today = todayIso();
          return {
            pomoDate: today,
            pomoCount: s.pomoDate === today ? s.pomoCount + 1 : 1,
          };
        }),
      startFocus: () =>
        set((s) => ({
          focus: {
            ...s.focus,
            running: true,
            endsAt: Date.now() + Math.max(1, s.focus.seconds) * 1000,
            note: null,
          },
        })),
      pauseFocus: () => set((s) => ({ focus: { ...s.focus, running: false, endsAt: null } })),
      resetFocus: () =>
        set((s) => {
          const seconds = s.focus.mode === "work" ? s.focus.workLen : breakFor(s.focus.workLen);
          return { focus: { ...s.focus, running: false, endsAt: null, seconds, note: null } };
        }),
      setWorkLen: (workLen) =>
        set((s) => ({
          focus: {
            ...s.focus,
            workLen,
            mode: "work",
            seconds: workLen,
            running: false,
            endsAt: null,
            note: null,
          },
        })),
      setFocusTask: (taskId) => set((s) => ({ focus: { ...s.focus, taskId, habitId: taskId ? null : s.focus.habitId } })),
      setFocusHabit: (habitId) => set((s) => ({ focus: { ...s.focus, habitId } })),
      focusHabit: (id) =>
        set((s) => ({
          focus: {
            ...s.focus,
            habitId: id,
            taskId: null,
            mode: "work",
            seconds: s.focus.workLen,
            running: true,
            endsAt: Date.now() + Math.max(1, s.focus.workLen) * 1000,
            note: null,
          },
        })),
      tickFocus: () => {
        const s = get();
        if (!s.focus.running || s.focus.endsAt == null) return false;
        const left = Math.max(0, Math.round((s.focus.endsAt - Date.now()) / 1000));
        if (left > 0) {
          if (left !== s.focus.seconds) set({ focus: { ...s.focus, seconds: left } });
          return false;
        }
        const work = s.focus.mode === "work";
        const today = todayIso();
        const habit = work && s.focus.habitId ? s.habits.find((h) => h.id === s.focus.habitId && !h.archived) : undefined;
        const step = habit && !habit.checks.includes(today);
        set({
          habits: step ? s.habits.map((h) => (h.id === habit.id ? tapDay(h, today) : h)) : s.habits,
          pomoDate: work ? today : s.pomoDate,
          pomoCount: work ? (s.pomoDate === today ? s.pomoCount + 1 : 1) : s.pomoCount,
          focus: {
            ...s.focus,
            running: false,
            endsAt: null,
            mode: work ? "break" : "work",
            seconds: work ? breakFor(s.focus.workLen) : s.focus.workLen,
            note: work
              ? step
                ? `Фокус-сессия завершена, отметка в «${habit.name}». Можно сделать перерыв.`
                : "Фокус-сессия завершена. Можно сделать перерыв."
              : "Перерыв закончился.",
          },
        });
        return true;
      },
    })),
    {
      name: "srok-planner",
      skipHydration: true,
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<PlannerState>;
        return {
          ...current,
          ...saved,
          milestones: fillRemindAt(saved.milestones, current.milestones).map((m) => (Array.isArray(m.items) ? m : { ...m, items: [] })),
          projects: saved.projects ?? current.projects,
          assets: (saved.assets ?? current.assets).map((a) => ({ ...a, notes: a.notes ?? "", rules: a.rules ?? [], log: a.log ?? [], pains: a.pains ?? [], readings: a.readings ?? [] })),
          workStart: saved.workStart ?? current.workStart,
          workEnd: saved.workEnd ?? current.workEnd,
          focus: saved.focus ?? current.focus,
          habits: fillRemindAt(saved.habits, current.habits),
          tasks: fillTasks(saved.tasks, current.tasks),
          lists: saved.lists ?? current.lists,
          remindAck: saved.remindAck ?? {},
          tombstones: { ...emptyTombstones(), ...(saved.tombstones ?? {}) },
          settingsUpdatedAt: typeof saved.settingsUpdatedAt === "number" ? saved.settingsUpdatedAt : 0,
          archiveDays: normalizeArchiveDays(saved.archiveDays),
          scheduleDays: [1, 2, 3, 5, 7].includes(saved.scheduleDays as number) ? (saved.scheduleDays as number) : 1,
          doneFolded: saved.doneFolded === true,
          ...migrateNav(saved),
          calendarMode: normalizeCalendarMode(saved.calendarMode),
          weekNumbers: saved.weekNumbers === true,
          remindLeadDefault: normalizeLead(saved.remindLeadDefault),
          theme: saved.theme === "dark" ? "dark" : "light",
          accent: isAccent(saved.accent) ? saved.accent : current.accent,
        };
      },
      // This user's partition in IndexedDB (src/lib/offline/device-store.ts).
      storage: createJSONStorage(() => (typeof window === "undefined" ? memoryStorage : plannerStorage)),
    },
  ),
);


