/**
 * «Помощник»: what the server sends to the app. Shared by the server (it builds
 * proposals from the model's tool calls) and the app (it shows them and, after
 * «Применить», applies them through the normal store so they sync).
 */
import type { HabitFreq, HabitSection, Priority } from "../planner-types.ts";

/** Which model answered: on the home PC or a cloud API. */
export type AiWhich = "local" | "cloud";
/** Who answered: a model at home, a cloud model, or the app itself (simple questions, no model, no tokens). */
export type AnswerSource = AiWhich | "app";

export type ProposalItem =
  | {
      op: "create";
      key: string;
      title: string;
      due: string | null;
      start: string | null;
      end: string | null;
      /** List name; created on apply when there is no such list. */
      list: string | null;
      priority: Priority;
      subtasks: string[];
      notes: string;
    }
  | {
      op: "update";
      key: string;
      taskId: string;
      taskTitle: string;
      title?: string;
      due?: string | null;
      start?: string | null;
      end?: string | null;
      list?: string | null;
      priority?: Priority;
      /** The values before the change (for «было → стало»); only the changed fields. */
      was?: { title?: string; due?: string | null; start?: string | null; end?: string | null; list?: string | null; priority?: Priority };
    }
  | { op: "complete"; key: string; taskId: string; taskTitle: string }
  | { op: "subtasks"; key: string; taskId: string; taskTitle: string; steps: string[] }
  | { op: "habit"; key: string; name: string; goal: number | null; unit: string | null; section: HabitSection; freq: HabitFreq };

export type ProposalStatus = "pending" | "applied" | "dismissed";

export type Proposal = {
  id: string;
  /** «Создать 3 задачи?» */
  title: string;
  items: ProposalItem[];
  status: ProposalStatus;
  /** «plan»: a day plan, shown as a timeline. */
  kind?: "plan";
};

/**
 * A structured answer the app draws itself (task rows with quick actions,
 * free time by day) instead of the plain text. Built by the server without a
 * model; the text stays for history and older apps.
 */
export type AnswerView =
  | { kind: "tasks"; mode: "overdue" | "day"; date: string; title: string; ids: string[]; more: number; note?: string }
  | { kind: "free"; title: string; days: { date: string; label: string; slots: string[] }[] };

/** A one-tap follow-up under an answer: ask a question, or show a ready card. Built without a model. */
export type Chip = { label: string; ask?: string; proposal?: Proposal };

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  at: number;
  provider?: AnswerSource;
  /** Which provider and model answered: «free · some-model». */
  source?: string;
  proposals?: Proposal[];
  view?: AnswerView;
  chips?: Chip[];
  /** The answer failed («Помощник сейчас недоступен»). */
  error?: boolean;
  /** Every model was unavailable: «Повторить» / «Отложить» are offered. */
  retryable?: boolean;
  /** «Отложить»: the server keeps trying; this is the next attempt. */
  queued?: { id: string; nextAt: number };
};

/** A question kept on the server until some model answers (at most a day). */
export type QueuedRequest = {
  id: string;
  conversationId: string;
  /** The failed answer it replaces. */
  messageId: string;
  text: string;
  createdAt: number;
  nextAt: number;
  attempts: number;
};

/** «Помощник ответил» in the bell. */
export type AssistantNotice = { id: string; conversationId: string; title: string; text: string; at: number };

export type ConversationSummary = { id: string; title: string; updatedAt: number };
export type Conversation = ConversationSummary & { createdAt: number; messages: ChatMessage[] };

/** State of one provider in the chain (for «Настройки → Помощник»). */
export type ProviderState = "unknown" | "ok" | "limit" | "error" | "cap" | "down";

export type ProviderStatus = {
  name: string;
  kind: AiWhich;
  host: string;
  models: string[];
  paid: boolean;
  state: ProviderState;
  /** Skipped until (ms) after an error or a limit. */
  until: number | null;
  usedTokens: number;
  /** 0 = no monthly cap. */
  monthlyTokens: number;
  lastModel: string | null;
};

/** GET /api/assistant/status — never contains keys. */
export type AssistantStatus = {
  enabled: boolean;
  mode: "off" | "auto" | "openai" | "ollama" | "chain";
  /** In the order they are tried. */
  providers: ProviderStatus[];
  /** When the user agreed (ms) per provider kind; absent = consent screen first. */
  consent: Partial<Record<AiWhich, number>>;
  /** «Разрешить облако, когда ПК выключен». */
  allowCloud: boolean;
  /** «Разрешить платные». */
  allowPaid: boolean;
};

/** One line of the POST /api/assistant/chat stream (NDJSON). */
export type ChatEvent =
  | { type: "start"; conversationId: string; provider: AnswerSource; source: string; userMessageId: string }
  | { type: "delta"; text: string }
  | { type: "proposal"; proposal: Proposal }
  | { type: "done"; message: ChatMessage; title: string }
  | { type: "consent"; provider: AiWhich }
  | { type: "error"; message: string; retryable?: boolean; conversationId?: string; userMessageId?: string; messageId?: string };
