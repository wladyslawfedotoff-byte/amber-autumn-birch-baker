import { useEffect, useState } from "react";
import { Cloud, Cpu } from "lucide-react";
import { cn } from "@/lib/cn";
import { assistantApi } from "@/lib/assistant/client";
import type { AssistantStatus, ProviderStatus } from "@/lib/assistant/types";
import { SwitchRow } from "@/components/ui/rows";

const MODE: Record<AssistantStatus["mode"], string> = {
  off: "Выключен",
  auto: "Автоматически",
  openai: "Только облако",
  ollama: "Только компьютер дома",
  chain: "По очереди",
};

function hm(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function tokens(n: number): string {
  if (n >= 1_000_000) return `${Number((n / 1_000_000).toFixed(1))} млн`;
  if (n >= 1000) return `${Math.round(n / 1000)} тыс.`;
  return String(n);
}

/** доступен / лимит / ошибка / … with a colour. */
function stateOf(p: ProviderStatus, check: boolean | undefined): { text: string; tone: "ok" | "warn" | "bad" | "muted" } {
  if (p.state === "cap") return { text: "месячный лимит", tone: "warn" };
  if (p.until) return { text: p.state === "limit" ? `лимит, пауза до ${hm(p.until)}` : `ошибка, пауза до ${hm(p.until)}`, tone: p.state === "limit" ? "warn" : "bad" };
  if (check === false) return { text: p.kind === "local" ? "не отвечает" : "ошибка", tone: "bad" };
  if (p.state === "down") return { text: "не отвечает", tone: "bad" };
  if (check === true || p.state === "ok") return { text: "доступен", tone: "ok" };
  if (p.state === "limit") return { text: "лимит", tone: "warn" };
  if (p.state === "error") return { text: "ошибка", tone: "bad" };
  return { text: "не проверен", tone: "muted" };
}

const TONE = { ok: "text-accent", warn: "text-danger/70", bad: "text-danger", muted: "text-muted" } as const;

function ProviderRow({ provider, index, check }: { provider: ProviderStatus; index: number; check: boolean | undefined }) {
  const state = stateOf(provider, check);
  const Icon = provider.kind === "local" ? Cpu : Cloud;
  return (
    <li className="flex gap-3 px-3 py-2">
      <span className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-full bg-surface text-muted">
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-[0.9375rem]">
          <span className="truncate">
            {index + 1}. {provider.kind === "local" ? "Компьютер дома" : provider.name}
          </span>
          {provider.paid ? <span className="rounded-full bg-surface px-2 text-[0.6875rem] text-muted ring-1 ring-line">платный</span> : null}
          <span className={cn("ml-auto shrink-0 text-[0.8125rem]", TONE[state.tone])}>{state.text}</span>
        </p>
        <p className="truncate text-xs text-muted">
          {provider.host} · {provider.models.join(", ")}
        </p>
        {provider.monthlyTokens || provider.usedTokens ? (
          <p className="text-xs text-muted">
            За месяц: {tokens(provider.usedTokens)}
            {provider.monthlyTokens ? ` из ${tokens(provider.monthlyTokens)}` : ""} токенов
          </p>
        ) : null}
      </div>
    </li>
  );
}

/** «Настройки → Помощник»: the chain of models, a live check, the cloud and paid toggles. */
export function AssistantSection() {
  const [status, setStatus] = useState<AssistantStatus | null>(null);
  const [check, setCheck] = useState<Record<string, boolean> | "busy" | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    assistantApi
      .status()
      .then(setStatus)
      .catch(() => setError(true));
  }, []);

  if (error) return <p className="text-sm text-muted">Не удалось узнать состояние помощника. Проверьте связь с сервером.</p>;
  if (!status) return <p className="text-sm text-muted">Загружаем…</p>;
  const hasLocal = status.providers.some((p) => p.kind === "local");
  const hasCloud = status.providers.some((p) => p.kind === "cloud");
  const hasPaid = status.providers.some((p) => p.paid);
  const results = check && check !== "busy" ? check : {};
  const save = (patch: { allowCloud?: boolean; allowPaid?: boolean }) => {
    const before = status;
    setStatus({ ...status, ...patch });
    assistantApi
      .settings(patch)
      .then(setStatus)
      .catch(() => setStatus(before));
  };

  return (
    <div className="text-sm">
      <div className="flex min-h-11 items-center gap-3 rounded-2xl bg-elevated px-3 text-[0.9375rem]">
        <span className="flex-1">Режим</span>
        <span className="text-muted">{MODE[status.mode]}</span>
      </div>

      <p className="mt-4 mb-2 px-1 text-xs text-muted">{status.providers.length > 1 ? "Модели спрашиваются по порядку: если одна занята или выдала ошибку, отвечает следующая." : "Модель"}</p>
      <ul className="divide-y divide-line overflow-hidden rounded-2xl bg-elevated" aria-label="Модели помощника">
        {status.providers.map((p, i) => (
          <ProviderRow key={p.name} provider={p} index={i} check={results[p.name]} />
        ))}
      </ul>
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          disabled={check === "busy"}
          onClick={() => {
            setCheck("busy");
            assistantApi
              .check()
              .then((next) => {
                setCheck(next);
                return assistantApi.status().then(setStatus);
              })
              .catch(() => setCheck({}));
          }}
          className="h-9 rounded-full bg-elevated px-3 text-[0.8125rem] text-accent disabled:opacity-50"
        >
          {check === "busy" ? "Проверяем…" : "Проверить связь"}
        </button>
      </div>

      {(hasLocal && hasCloud) || hasPaid ? (
        <div className="mt-3 divide-y divide-line overflow-hidden rounded-2xl bg-elevated">
          {hasLocal && hasCloud ? (
            <SwitchRow
              label="Разрешить облако, когда ПК выключен"
              hint="Иначе, пока компьютер дома выключен, помощник не отвечает и ничего не уходит в интернет."
              checked={status.allowCloud}
              onChange={(allowCloud) => save({ allowCloud })}
            />
          ) : null}
          {hasPaid ? (
            <SwitchRow
              label="Разрешить платные"
              hint="Платная модель спрашивается последней, когда бесплатные заняты. Выключите — и помощник будет только бесплатным."
              checked={status.allowPaid}
              onChange={(allowPaid) => save({ allowPaid })}
            />
          ) : null}
        </div>
      ) : null}

      <p className="mt-3 px-1 text-xs text-muted">
        Помощник читает только ваши задачи, списки и привычки (и общие с вами) и ничего не меняет без вашего «Применить».{" "}
        {hasCloud ? "Ответ из облака означает, что вопрос и нужные для ответа задачи уходят в облачный сервис. " : ""}
        Модели и адреса задаются в файле .env на сервере; ключи хранятся только там.
      </p>
    </div>
  );
}
