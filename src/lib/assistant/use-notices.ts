/** «Помощник ответил»: answers to queued questions, for the bell. */
import { useCallback, useEffect, useRef, useState } from "react";
import { assistantApi } from "./client";
import type { AssistantNotice } from "./types";

const POLL_MS = 60_000;

export function useAssistantNotices(enabled: boolean): { notices: AssistantNotice[]; dismiss: (filter: { ids?: string[]; conversationId?: string }) => void } {
  const [notices, setNotices] = useState<AssistantNotice[]>([]);
  const seen = useRef<Set<string> | null>(null);

  const load = useCallback(() => {
    assistantApi
      .notices()
      .then((next) => {
        // A browser notification for new ones (not for those found on start).
        if (seen.current && typeof Notification !== "undefined" && Notification.permission === "granted") {
          for (const n of next) if (!seen.current.has(n.id)) new Notification(n.text, { body: n.title, tag: `assistant-${n.id}` });
        }
        seen.current = new Set(next.map((n) => n.id));
        setNotices(next);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    load();
    const id = window.setInterval(load, POLL_MS);
    const onVisible = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, load]);

  const dismiss = useCallback((filter: { ids?: string[]; conversationId?: string }) => {
    setNotices((list) => list.filter((n) => !(filter.ids?.includes(n.id) || n.conversationId === filter.conversationId)));
    void assistantApi.readNotices(filter).catch(() => undefined);
  }, []);

  return { notices: enabled ? notices : [], dismiss };
}
