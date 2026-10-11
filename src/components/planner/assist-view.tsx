import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUp, Check, Zap, Clock, Cloud, Cpu, Menu, Mic, MicOff, Plus, RotateCw, ShieldCheck, Sparkles, Square, Trash2, X } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { AssistMarkdown } from "@/components/planner/assist-markdown";
import { cn } from "@/lib/cn";
import { formatShortDay, todayIso } from "@/lib/dates";
import { usePlanner } from "@/lib/planner-store";
import { applyItems, itemTitle, withTitle } from "@/lib/assistant/apply";
import { assistantApi, streamChat } from "@/lib/assistant/client";
import type { AiWhich, AnswerSource, AssistantStatus, ChatEvent, ChatMessage, ConversationSummary, Proposal, ProposalItem } from "@/lib/assistant/types";

const SUGGESTIONS = ["Спланируй мой день", "Разбей задачу на шаги", "Добавь дела из текста", "Что у меня просрочено?"];
const PRIORITY = ["", "низкий", "средний", "высокий"];

function nowHm(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function uid(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `m${Date.now()}${Math.random().toString(16).slice(2)}`;
}

/** «локально» / «облако» and which provider and model answered. */
export function ProviderBadge({ which, source, className }: { which: AnswerSource; source?: string; className?: string }) {
  const name = source?.split(" · ")[0];
  if (which === "app")
    return (
      <span className={cn("inline-flex h-5 shrink-0 items-center gap-1 rounded-full bg-ok/12 px-1.5 text-[0.6875rem] font-medium text-ok", className)} title="Ответ посчитан приложением по вашим задачам — без модели, токены не тратятся">
        <Zap className="size-3 shrink-0" aria-hidden="true" />
        <span className="truncate">без модели</span>
      </span>
    );
  return (
    <span
      className={cn("inline-flex h-5 max-w-[11rem] shrink-0 items-center gap-1 rounded-full px-1.5 text-[0.6875rem] font-medium", which === "local" ? "bg-accent/12 text-accent" : "bg-elevated text-muted", className)}
      title={`${which === "local" ? "Ответила модель на компьютере дома" : "Ответил облачный сервис"}${source ? `: ${source}` : ""}`}
    >
      {which === "local" ? <Cpu className="size-3 shrink-0" aria-hidden="true" /> : <Cloud className="size-3 shrink-0" aria-hidden="true" />}
      <span className="truncate">
        {which === "local" ? "локально" : "облако"}
        {name && name !== "local" && name !== "cloud" ? ` · ${name}` : ""}
      </span>
    </span>
  );
}

/* ---- consent ------------------------------------------------------------ */

function ConsentScreen({ status, provider, onAccept, onCancel }: { status: AssistantStatus; provider: AiWhich; onAccept: () => void; onCancel: () => void }) {
  const locals = status.providers.filter((p) => p.kind === "local");
  const clouds = status.providers.filter((p) => p.kind === "cloud");
  const hosts = [...new Set(clouds.map((p) => p.host))].join(", ");
  const paid = clouds.some((p) => p.paid);
  const fallback = locals.length > 0 && clouds.length > 0 && status.allowCloud;
  const cloudNow = provider === "cloud" && locals.length > 0;
  return (
    <div className="mx-auto flex max-w-md flex-col py-4" role="dialog" aria-label="Согласие на работу помощника">
      <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-accent/12 text-accent">
        <ShieldCheck className="size-6" aria-hidden="true" />
      </span>
      <h2 className="mt-3 text-center text-lg font-semibold">{cloudNow ? "Сейчас ответит облако" : "Прежде чем начать"}</h2>
      {cloudNow ? <p className="mt-1 text-center text-sm text-muted">Компьютер дома не отвечает, поэтому вопрос уйдёт в облачный сервис.</p> : null}
      <ul className="mt-4 space-y-3 text-[0.875rem]">
        <ConsentLine title="Что читает помощник">
          Только ваши задачи, списки и привычки и то, чем с вами поделились, — и лишь то, что нужно для ответа. Чужие личные задачи он не видит.
        </ConsentLine>
        <ConsentLine title="Ничего не меняет сам">
          Всё, что он предлагает создать или изменить, приходит карточкой. Можно поправить или убрать пункты; изменения появятся только после «Применить».
        </ConsentLine>
        {provider === "local" ? (
          <ConsentLine title="Где работает модель">
            На вашем компьютере дома ({locals.map((p) => p.models[0]).join(", ")}). Вопросы и задачи не уходят в интернет.
          </ConsentLine>
        ) : (
          <ConsentLine title="Где работает модель">
            В облачных сервисах ({hosts}). Текст вопроса и нужные для ответа задачи отправляются туда по защищённому соединению. Если один сервис занят или исчерпал лимит, ответит следующий
            {paid ? "; последним идёт платный — его можно выключить в «Настройки → Помощник»" : ""}.
          </ConsentLine>
        )}
        {provider === "local" && fallback ? (
          <ConsentLine title="Если компьютер выключен">
            Ответ может прийти из облака ({hosts}). Перед первым таким ответом мы спросим ещё раз. Выключить это можно в «Настройки → Помощник».
          </ConsentLine>
        ) : null}
      </ul>
      <button type="button" onClick={onAccept} className="mt-6 h-11 rounded-full bg-accent text-[0.9375rem] font-medium text-accent-fg">
        Понятно, начать
      </button>
      <button type="button" onClick={onCancel} className="mt-1 h-11 text-[0.9375rem] text-muted">
        Не сейчас
      </button>
    </div>
  );
}

function ConsentLine({ title, children }: { title: string; children: ReactNode }) {
  return (
    <li className="rounded-2xl bg-elevated p-3">
      <p className="font-medium">{title}</p>
      <p className="mt-0.5 text-muted">{children}</p>
    </li>
  );
}

/* ---- proposals ---------------------------------------------------------- */

function itemMeta(item: ProposalItem): string {
  const parts: string[] = [];
  const when = (due: string | null | undefined, start: string | null | undefined, end: string | null | undefined) => {
    if (due) parts.push(due === todayIso() ? "сегодня" : formatShortDay(due));
    if (start) parts.push(end ? `${start}–${end}` : start);
  };
  switch (item.op) {
    case "create":
      when(item.due, item.start, item.end);
      if (item.list) parts.push(item.list);
      if (item.priority) parts.push(`приоритет ${PRIORITY[item.priority]}`);
      if (item.subtasks.length) parts.push(`${item.subtasks.length} шаг.`);
      break;
    case "update":
      if (item.due !== undefined && !item.due) parts.push("без даты");
      when(item.due, item.start, item.end);
      if (item.list) parts.push(`в «${item.list}»`);
      if (item.priority !== undefined) parts.push(`приоритет ${PRIORITY[item.priority] || "нет"}`);
      break;
    case "complete":
      parts.push("отметить выполненной");
      break;
    case "subtasks":
      parts.push(item.steps.join(" · "));
      break;
    case "habit":
      parts.push(item.goal ? `${item.goal}${item.unit ? ` ${item.unit}` : ""} в день` : "отметка в день");
      if (item.freq.kind === "weekly") parts.push(`${item.freq.times} р. в неделю`);
      if (item.freq.kind === "weekdays") parts.push("по дням недели");
      break;
  }
  return parts.join(" · ");
}

function ProposalCard({ proposal, onApply, onDismiss }: { proposal: Proposal; onApply: (items: ProposalItem[]) => void; onDismiss: () => void }) {
  const [items, setItems] = useState(proposal.items);
  const pending = proposal.status === "pending";
  const editable = (item: ProposalItem) => item.op === "create" || item.op === "habit";
  return (
    <div className="mt-2 overflow-hidden rounded-2xl bg-elevated" data-proposal={proposal.id}>
      <p className="flex items-center gap-2 px-3 pt-2.5 pb-1 text-[0.9375rem] font-semibold">
        <Sparkles className="size-4 text-accent" aria-hidden="true" />
        <span className="flex-1">{pending ? proposal.title.replace(/\d+/, String(items.length)) : proposal.title.replace(/\?$/, "")}</span>
      </p>
      <ul className="divide-y divide-line/70">
        {items.map((item) => (
          <li key={item.key} className="flex items-start gap-2 px-3 py-2">
            <span className="min-w-0 flex-1">
              {pending && editable(item) ? (
                <input
                  value={itemTitle(item)}
                  aria-label="Название"
                  onChange={(event) => setItems(items.map((it) => (it.key === item.key ? withTitle(it, event.target.value) : it)))}
                  className="w-full bg-transparent text-[0.9375rem] outline-none"
                />
              ) : (
                <span className={cn("block text-[0.9375rem]", proposal.status === "dismissed" && "text-muted line-through")}>{itemTitle(item)}</span>
              )}
              {itemMeta(item) ? <span className="block text-xs text-muted">{itemMeta(item)}</span> : null}
            </span>
            {pending ? (
              <button type="button" aria-label={`Убрать «${itemTitle(item)}»`} onClick={() => setItems(items.filter((it) => it.key !== item.key))} className="-mr-2 flex size-9 shrink-0 items-center justify-center text-subtle">
                <X className="size-4" />
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {pending ? (
        <div className="flex gap-2 p-2">
          <button type="button" onClick={onDismiss} className="h-10 flex-1 rounded-full bg-surface text-[0.875rem] text-muted">
            Отклонить
          </button>
          <button type="button" disabled={!items.length} onClick={() => onApply(items)} className="h-10 flex-[2] rounded-full bg-accent text-[0.875rem] font-medium text-accent-fg disabled:opacity-40">
            Применить
          </button>
        </div>
      ) : (
        <p className="flex items-center gap-1 px-3 pb-2.5 text-xs text-muted">
          {proposal.status === "applied" ? (
            <>
              <Check className="size-3.5 text-accent" aria-hidden="true" /> Применено
            </>
          ) : (
            "Отклонено"
          )}
        </p>
      )}
    </div>
  );
}

/* ---- voice -------------------------------------------------------------- */

type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
};

function recognitionCtor(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/* ---- unavailable: «Повторить» / «Отложить» ---------------------------- */

function hm(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function FailedActions({ message, canQueue, onRetry, onPostpone, onCancel }: { message: ChatMessage; canQueue: boolean; onRetry: () => void; onPostpone: () => void; onCancel: () => void }) {
  if (message.queued) {
    return (
      <div className="mt-2 flex items-center gap-2 rounded-2xl bg-elevated py-1.5 pr-1.5 pl-3 text-[0.8125rem]" role="status">
        <Clock className="size-4 shrink-0 text-accent" aria-hidden="true" />
        <span className="min-w-0 flex-1">В очереди, попробую в {hm(message.queued.nextAt)}</span>
        <button type="button" onClick={onCancel} className="h-8 shrink-0 rounded-full px-3 text-muted">
          Отменить
        </button>
      </div>
    );
  }
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      <button type="button" onClick={onRetry} className="flex h-9 items-center gap-1.5 rounded-full bg-elevated px-3 text-[0.8125rem] text-accent">
        <RotateCw className="size-3.5" aria-hidden="true" />
        Повторить
      </button>
      {canQueue ? (
        <button type="button" onClick={onPostpone} className="flex h-9 items-center gap-1.5 rounded-full bg-elevated px-3 text-[0.8125rem]" title="Сервер будет спрашивать модели сам до суток; ответ появится здесь и в колокольчике">
          <Clock className="size-3.5" aria-hidden="true" />
          Отложить
        </button>
      ) : null}
    </div>
  );
}

/* ---- view --------------------------------------------------------------- */

export function AssistView({ onOpen, openConversationId }: { onOpen: (id: string) => void; /** From the bell: «<conversation id>#<stamp>». */ openConversationId?: string | null }) {
  const [status, setStatus] = useState<AssistantStatus | null>(null);
  const [statusError, setStatusError] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [consent, setConsent] = useState<{ provider: AiWhich; retry: string | null } | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<ConversationSummary[] | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [lastProvider, setLastProvider] = useState<{ which: AnswerSource; source?: string } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const recognition = useRef<Recognition | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const canSpeak = recognitionCtor() !== null;

  useEffect(() => {
    assistantApi
      .status()
      .then((next) => {
        setStatus(next);
        const first = next.providers[0]?.kind;
        if (first && !next.consent[first]) setConsent({ provider: first, retry: null });
      })
      .catch(() => setStatusError(true));
    return () => abort.current?.abort();
  }, []);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
    // Cards and long answers settle a moment later.
    const later = window.setTimeout(() => bottom.current?.scrollIntoView({ block: "end" }), 120);
    return () => window.clearTimeout(later);
  }, [messages]);

  // A conversation opened from the bell («Помощник ответил»).
  useEffect(() => {
    // «<id>#<stamp>»: the stamp makes a repeated tap on the same notice open it again.
    if (openConversationId) void openConversation(openConversationId.split("#")[0]!);
  }, [openConversationId]);

  // A queued question: look for the answer now and then.
  const waiting = messages.some((m) => m.queued);
  useEffect(() => {
    if (!waiting || !conversationId) return;
    const id = window.setInterval(() => {
      assistantApi
        .get(conversationId)
        .then((conv) => {
          if (conv.messages.some((m) => m.queued)) return setMessages((list) => (list.length === conv.messages.length ? conv.messages : list));
          setMessages(conv.messages);
          void assistantApi.readNotices({ conversationId }).catch(() => undefined);
        })
        .catch(() => undefined);
    }, 30_000);
    return () => window.clearInterval(id);
  }, [waiting, conversationId]);

  const loadHistory = useCallback(() => {
    assistantApi
      .list()
      .then(setHistory)
      .catch(() => setHistory([]));
  }, []);

  function newConversation() {
    abort.current?.abort();
    setConversationId(null);
    setMessages([]);
    setLastProvider(null);
    setBusy(false);
    setHistoryOpen(false);
  }

  async function openConversation(id: string) {
    setHistoryOpen(false);
    try {
      const conv = await assistantApi.get(id);
      abort.current?.abort();
      setConversationId(conv.id);
      setMessages(conv.messages);
      void assistantApi.readNotices({ conversationId: conv.id }).catch(() => undefined);
      const last = [...conv.messages].reverse().find((m) => m.provider);
      setLastProvider(last?.provider ? { which: last.provider, source: last.source } : null);
    } catch {
      // keep the current one
    }
  }

  async function send(text: string, retryOf?: string) {
    const question = text.trim();
    if (!question || busy) return;
    setDraft("");
    setBusy(true);
    const localUser: ChatMessage = { id: uid(), role: "user", text: question, at: Date.now() };
    const answerId = uid();
    setMessages((list) => [...list, localUser, { id: answerId, role: "assistant", text: "", at: Date.now() }]);
    const controller = new AbortController();
    abort.current = controller;
    const patchAnswer = (fn: (m: ChatMessage) => ChatMessage) => setMessages((list) => list.map((m) => (m.id === answerId ? fn(m) : m)));
    const drop = () => setMessages((list) => list.filter((m) => m.id !== answerId && m.id !== localUser.id));
    await streamChat(
      { conversationId, text: question, today: todayIso(), now: nowHm(), ...(retryOf ? { retryOf } : {}) },
      (event: ChatEvent) => {
        switch (event.type) {
          case "start":
            setConversationId(event.conversationId);
            setLastProvider({ which: event.provider, source: event.source });
            patchAnswer((m) => ({ ...m, provider: event.provider, source: event.source, text: "", proposals: undefined }));
            break;
          case "delta":
            patchAnswer((m) => ({ ...m, text: m.text + event.text }));
            break;
          case "proposal":
            patchAnswer((m) => ({ ...m, proposals: [...(m.proposals ?? []), event.proposal] }));
            break;
          case "done":
            patchAnswer(() => event.message);
            break;
          case "consent":
            drop();
            setDraft(question);
            setConsent({ provider: event.provider, retry: question });
            break;
          case "error":
            if (event.conversationId) setConversationId(event.conversationId);
            if (event.userMessageId) {
              const stored = event.userMessageId;
              setMessages((list) => list.map((m) => (m.id === localUser.id ? { ...m, id: stored } : m)));
            }
            patchAnswer((m) => ({ ...m, id: event.messageId ?? m.id, text: event.message, error: true, ...(event.retryable ? { retryable: true } : {}) }));
            // The badge names who answered; a failed attempt did not.
            setLastProvider(null);
            break;
        }
      },
      controller.signal,
    );
    setBusy(false);
    if (abort.current === controller) abort.current = null;
  }

  async function acceptConsent() {
    if (!consent) return;
    const { provider, retry } = consent;
    try {
      setStatus(await assistantApi.settings({ consent: provider }));
    } catch {
      return;
    }
    setConsent(null);
    if (retry) void send(retry);
  }

  function apply(message: ChatMessage, proposal: Proposal, items: ProposalItem[]) {
    const s = usePlanner.getState();
    const result = applyItems(items, {
      lists: s.lists,
      tasks: s.tasks,
      addList: s.addList,
      addTask: s.addTask,
      updateTask: s.updateTask,
      toggleTask: s.toggleTask,
      addSubtask: s.addSubtask,
      addHabit: s.addHabit,
    });
    setMessages((list) =>
      list.map((m) => (m.id === message.id ? { ...m, proposals: m.proposals?.map((p) => (p.id === proposal.id ? { ...p, items, status: "applied" } : p)) } : m)),
    );
    if (conversationId) void assistantApi.setProposal(conversationId, proposal.id, "applied", items).catch(() => undefined);
    if (items.length === 1 && items[0]!.op !== "create" && items[0]!.op !== "habit" && result.applied) onOpen(items[0]!.taskId);
  }

  function dismiss(message: ChatMessage, proposal: Proposal) {
    setMessages((list) => list.map((m) => (m.id === message.id ? { ...m, proposals: m.proposals?.map((p) => (p.id === proposal.id ? { ...p, status: "dismissed" } : p)) } : m)));
    if (conversationId) void assistantApi.setProposal(conversationId, proposal.id, "dismissed").catch(() => undefined);
  }

  /** «Повторить»: the failed answer and its question go away and are asked again. */
  function retry(message: ChatMessage) {
    const index = messages.findIndex((m) => m.id === message.id);
    const question = index > 0 && messages[index - 1]?.role === "user" ? messages[index - 1]! : null;
    if (!question || busy) return;
    if (message.queued) void assistantApi.cancelQueued(message.queued.id).catch(() => undefined);
    setMessages((list) => list.filter((m) => m.id !== message.id && m.id !== question.id));
    void send(question.text, message.retryable && conversationId ? message.id : undefined);
  }

  /** «Отложить»: the server keeps trying for up to a day; the answer lands here and in the bell. */
  async function postpone(message: ChatMessage) {
    if (!conversationId) return;
    try {
      const item = await assistantApi.enqueue(conversationId, message.id);
      setMessages((list) => list.map((m) => (m.id === message.id ? { ...m, queued: { id: item.id, nextAt: item.nextAt } } : m)));
    } catch {
      // stays as it is; «Повторить» still works
    }
  }

  async function cancelQueued(message: ChatMessage) {
    if (!message.queued) return;
    const { id } = message.queued;
    setMessages((list) => list.map((m) => (m.id === message.id ? { ...m, queued: undefined } : m)));
    await assistantApi.cancelQueued(id).catch(() => undefined);
  }

  function toggleVoice() {
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    if (listening) {
      recognition.current?.stop();
      return;
    }
    const rec = new Ctor();
    rec.lang = "ru-RU";
    rec.interimResults = true;
    rec.continuous = false;
    const base = draft ? `${draft.trimEnd()} ` : "";
    rec.onresult = (event) => {
      const text = Array.from(event.results)
        .map((r) => r[0]?.transcript ?? "")
        .join("");
      setDraft(base + text);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recognition.current = rec;
    setListening(true);
    rec.start();
  }

  if (statusError) return <p className="py-10 text-center text-sm text-muted">Помощник сейчас недоступен. Проверьте связь с сервером.</p>;
  if (!status) return <p className="py-10 text-center text-sm text-muted">Загружаем…</p>;
  if (consent) return <ConsentScreen status={status} provider={consent.provider} onAccept={acceptConsent} onCancel={() => setConsent(null)} />;

  const empty = messages.length === 0;

  return (
    <div className="mx-auto flex min-h-full max-w-2xl flex-col">
      <div className="sticky top-0 z-10 -mx-4 flex h-11 items-center gap-1 bg-surface px-2 md:mx-0 md:px-0">
        <button
          type="button"
          aria-label="Беседы"
          onClick={() => {
            setHistoryOpen(true);
            setConfirmDelete(null);
            loadHistory();
          }}
          className="flex size-10 items-center justify-center rounded-full text-muted"
        >
          <Menu className="size-5" />
        </button>
        <span className="min-w-0 flex-1 truncate text-center text-sm text-muted">{empty ? "Новая беседа" : (messages.find((m) => m.role === "user")?.text ?? "")}</span>
        {lastProvider ? <ProviderBadge which={lastProvider.which} source={lastProvider.source} /> : null}
        <button type="button" aria-label="Новая беседа" onClick={newConversation} className="flex size-10 items-center justify-center rounded-full text-muted">
          <Plus className="size-5" />
        </button>
      </div>

      <div className="flex-1 pb-3">
        {empty ? (
          <div className="flex flex-col items-center px-2 pt-10 text-center">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-accent/12 text-accent">
              <Sparkles className="size-6" aria-hidden="true" />
            </span>
            <p className="mt-3 text-[0.9375rem] font-semibold">Чем помочь?</p>
            <p className="mt-1 max-w-xs text-[0.8125rem] text-muted">Спросите про свои дела или вставьте текст — предложу задачи. Без вашего «Применить» ничего не изменится.</p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" onClick={() => void send(s)} className="h-9 rounded-full bg-elevated px-3 text-[0.8125rem]">
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <ul className="space-y-3 pt-2" aria-live="polite">
            {messages.map((m) =>
              m.role === "user" ? (
                <li key={m.id} className="flex justify-end">
                  <p className="max-w-[85%] rounded-2xl rounded-br-md bg-accent px-3 py-2 text-[0.9375rem] whitespace-pre-wrap text-accent-fg">{m.text}</p>
                </li>
              ) : (
                <li key={m.id} className="max-w-[95%]">
                  {m.text ? (
                    m.error ? (
                      <p className="text-[0.9375rem] whitespace-pre-wrap text-danger">{m.text}</p>
                    ) : (
                      <AssistMarkdown text={m.text} />
                    )
                  ) : busy && !m.proposals?.length ? (
                    <p className="flex h-6 items-center gap-1 text-muted" aria-label="Помощник думает">
                      <span className="size-1.5 animate-pulse rounded-full bg-current" />
                      <span className="size-1.5 animate-pulse rounded-full bg-current [animation-delay:150ms]" />
                      <span className="size-1.5 animate-pulse rounded-full bg-current [animation-delay:300ms]" />
                    </p>
                  ) : null}
                  {m.proposals?.map((p) => (
                    <ProposalCard key={p.id} proposal={p} onApply={(items) => apply(m, p, items)} onDismiss={() => dismiss(m, p)} />
                  ))}
                  {m.source && !m.error && (m.text || m.proposals?.length) ? <p className="mt-1 truncate text-[0.6875rem] text-muted/80">{m.source}</p> : null}
                  {m.error && !busy && m.id === messages.at(-1)?.id ? (
                    <FailedActions message={m} canQueue={Boolean(m.retryable && conversationId)} onRetry={() => retry(m)} onPostpone={() => void postpone(m)} onCancel={() => void cancelQueued(m)} />
                  ) : null}
                </li>
              ),
            )}
          </ul>
        )}
        {/* scroll-margin: the input bar is sticky and would cover the end of the answer. */}
        <div ref={bottom} className="h-px scroll-mb-28" />
      </div>

      <form
        className="sticky bottom-0 -mx-4 border-t border-line/60 bg-surface px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] md:mx-0 md:px-0"
        onSubmit={(event) => {
          event.preventDefault();
          void send(draft);
        }}
      >
        <div className="flex items-end gap-1.5 rounded-3xl bg-elevated py-1 pr-1 pl-3">
          <textarea
            ref={field}
            value={draft}
            rows={1}
            aria-label="Вопрос помощнику"
            placeholder={listening ? "Говорите…" : "Спросите или вставьте текст"}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && window.matchMedia("(pointer: fine)").matches) {
                event.preventDefault();
                void send(draft);
              }
            }}
            className="max-h-36 min-h-9 flex-1 resize-none bg-transparent py-1.5 text-base outline-none [field-sizing:content] placeholder:text-subtle"
          />
          {canSpeak ? (
            <button
              type="button"
              aria-label={listening ? "Остановить запись" : "Сказать голосом"}
              aria-pressed={listening}
              onClick={toggleVoice}
              className={cn("flex size-9 shrink-0 items-center justify-center rounded-full", listening ? "bg-danger/15 text-danger" : "text-muted")}
            >
              {listening ? <MicOff className="size-5" /> : <Mic className="size-5" />}
            </button>
          ) : null}
          {busy ? (
            <button type="button" aria-label="Остановить ответ" onClick={() => abort.current?.abort()} className="flex size-9 shrink-0 items-center justify-center rounded-full bg-fg text-surface">
              <Square className="size-3.5" fill="currentColor" />
            </button>
          ) : (
            <button type="submit" aria-label="Отправить" disabled={!draft.trim()} className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-fg disabled:opacity-30">
              <ArrowUp className="size-5" />
            </button>
          )}
        </div>
      </form>

      <Sheet open={historyOpen} title="Беседы" onClose={() => setHistoryOpen(false)} action={{ label: "Новая", onClick: newConversation }}>
        {history === null ? (
          <p className="py-6 text-center text-sm text-muted">Загружаем…</p>
        ) : history.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">Бесед пока нет.</p>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-2xl bg-elevated">
            {history.map((c) => (
              <li key={c.id} className="flex items-center">
                <button type="button" onClick={() => void openConversation(c.id)} className={cn("min-w-0 flex-1 px-3 py-2.5 text-left", c.id === conversationId && "text-accent")}>
                  <span className="block truncate text-[0.9375rem]">{c.title}</span>
                  <span className="block text-xs text-muted">{formatShortDay(new Date(c.updatedAt).toISOString().slice(0, 10))}</span>
                </button>
                {confirmDelete === c.id ? (
                  <button
                    type="button"
                    onClick={() => {
                      void assistantApi.remove(c.id).finally(loadHistory);
                      if (c.id === conversationId) newConversation();
                      setHistoryOpen(true);
                      setConfirmDelete(null);
                    }}
                    className="mr-2 h-8 rounded-full bg-danger px-3 text-xs font-medium text-on-danger"
                  >
                    Удалить
                  </button>
                ) : (
                  <button type="button" aria-label={`Удалить беседу «${c.title}»`} onClick={() => setConfirmDelete(c.id)} className="flex size-11 shrink-0 items-center justify-center text-subtle">
                    <Trash2 className="size-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 px-1 text-xs text-subtle">Беседы хранятся на вашем сервере и видны только вам.</p>
      </Sheet>
    </div>
  );
}
