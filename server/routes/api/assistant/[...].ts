import type { ChatEvent, ProposalItem } from "../../../../src/lib/assistant/types.ts";
import { BodyTooLargeError, json, readBodyLimited, type ServerEvent } from "../../../lib/http.ts";
import { log } from "../../../lib/log.ts";
import { principalOf } from "../../../lib/principal.ts";
import { getAssistant, parseChatInput } from "../../../lib/ai/service.ts";

const ID = /^[a-z0-9-]{8,64}$/i;

async function body(event: ServerEvent, limit = 64 * 1024): Promise<Record<string, unknown> | null> {
  try {
    const parsed = JSON.parse(await readBodyLimited(event.req, limit)) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch (error) {
    if (error instanceof BodyTooLargeError) return null;
    return null;
  }
}

/**
 * /api/assistant/*:
 *   GET  status                         provider, model, consent (no keys)
 *   POST check                          health check of the endpoints
 *   POST settings {allowCloud?, allowPaid?, consent?}
 *   GET  conversations                  list; GET/DELETE conversations/<id>
 *   POST conversations/<id>/proposals/<pid> {status, items?}
 *   POST chat {conversationId?, text, today, now, retryOf?}  → NDJSON stream of ChatEvent
 *   POST queue {conversationId, messageId}   «Отложить»; DELETE queue/<id> cancels
 *   GET  notices                        «Помощник ответил» for the bell
 *   POST notices/read {ids?, conversationId?}
 */
export default async function assistantApi(event: ServerEvent): Promise<Response> {
  const user = principalOf(event);
  if (!user) return json(401, { error: "unauthorized" });
  const assistant = getAssistant();
  const method = event.req.method.toUpperCase();
  const parts = event.url.pathname.replace(/^\/api\/assistant\/?/, "").split("/").filter(Boolean);
  const [head, id, sub, subId] = parts;

  if (head === "status" && method === "GET") return json(200, await assistant.status(user));
  if (!assistant.enabled) return json(404, { error: "assistant_off" });

  if (head === "check" && method === "POST") return json(200, await assistant.check());

  if (head === "settings" && method === "POST") {
    const b = await body(event);
    if (!b) return json(400, { error: "bad_request" });
    const consent = b.consent === "local" || b.consent === "cloud" ? b.consent : undefined;
    const allowCloud = typeof b.allowCloud === "boolean" ? b.allowCloud : undefined;
    const allowPaid = typeof b.allowPaid === "boolean" ? b.allowPaid : undefined;
    await assistant.deps.store.setSettings(user.login, { consent, allowCloud, allowPaid });
    return json(200, await assistant.status(user));
  }

  if (head === "conversations") {
    if (!id && method === "GET") return json(200, { conversations: await assistant.deps.store.list(user.login) });
    if (!id || !ID.test(id)) return json(404, { error: "not_found" });
    if (!sub && method === "GET") {
      const conv = await assistant.deps.store.get(user.login, id);
      return conv ? json(200, conv) : json(404, { error: "not_found" });
    }
    if (!sub && method === "DELETE") return json(200, { ok: await assistant.deps.store.remove(user.login, id) });
    if (sub === "proposals" && subId && ID.test(subId) && method === "POST") {
      const b = await body(event, 256 * 1024);
      const status = b?.status === "applied" || b?.status === "dismissed" ? b.status : null;
      if (!status) return json(400, { error: "bad_request" });
      const items = Array.isArray(b?.items) ? (b.items as ProposalItem[]).slice(0, 50) : undefined;
      const proposal = await assistant.setProposal(user, id, subId, status, items);
      return proposal ? json(200, proposal) : json(404, { error: "not_found" });
    }
    return json(405, { error: "method_not_allowed" });
  }

  if (head === "queue") {
    if (!id && method === "GET") return json(200, { queue: await assistant.deps.store.queue(user.login) });
    if (!id && method === "POST") {
      const b = await body(event);
      const conversationId = typeof b?.conversationId === "string" && ID.test(b.conversationId) ? b.conversationId : null;
      const messageId = typeof b?.messageId === "string" && ID.test(b.messageId) ? b.messageId : null;
      // A question asked without network: { text, clientId, conversationId? }.
      const text = typeof b?.text === "string" ? b.text.trim().slice(0, 4000) : "";
      const clientId = typeof b?.clientId === "string" && /^[A-Za-z0-9-]{6,48}$/.test(b.clientId) ? b.clientId : null;
      if (!messageId && text && clientId) {
        const item = await assistant.enqueueQuestion(user, { text, clientId, conversationId });
        if (item === "known") return json(200, { ok: true, known: true });
        return item ? json(200, item) : json(409, { error: "not_queueable" });
      }
      if (!conversationId || !messageId) return json(400, { error: "bad_request" });
      const item = await assistant.enqueue(user, conversationId, messageId);
      return item ? json(200, item) : json(409, { error: "not_queueable" });
    }
    if (id && ID.test(id) && method === "DELETE") return json(200, { ok: await assistant.deps.store.cancelQueued(user.login, id) });
    return json(405, { error: "method_not_allowed" });
  }

  if (head === "notices") {
    if (!id && method === "GET") return json(200, { notices: await assistant.deps.store.notices(user.login) });
    if (id === "read" && method === "POST") {
      const b = await body(event);
      const ids = Array.isArray(b?.ids) ? b.ids.filter((x): x is string => typeof x === "string" && ID.test(x)).slice(0, 50) : undefined;
      const conversationId = typeof b?.conversationId === "string" && ID.test(b.conversationId) ? b.conversationId : undefined;
      return json(200, { removed: await assistant.deps.store.dismissNotices(user.login, { ids, conversationId }) });
    }
    return json(405, { error: "method_not_allowed" });
  }

  if (head === "chat" && method === "POST") {
    const input = parseChatInput(await body(event));
    if (!input) return json(400, { error: "bad_request", message: "Напишите вопрос." });
    const encoder = new TextEncoder();
    const signal = event.req.signal;
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const emit = (e: ChatEvent) => {
          try {
            controller.enqueue(encoder.encode(`${JSON.stringify(e)}\n`));
          } catch {
            // client went away
          }
        };
        try {
          await assistant.chat(user, input, emit, signal);
        } catch (error) {
          log("error", "assistant.chat_failed", { user: user.login }, error);
          emit({ type: "error", message: "Помощник сейчас недоступен." });
        } finally {
          try {
            controller.close();
          } catch {
            // already closed
          }
        }
      },
    });
    return new Response(stream, {
      status: 200,
      headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" },
    });
  }

  return json(404, { error: "not_found" });
}
