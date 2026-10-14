/**
 * Attachments (photos, PDF, scans) on the NAS.
 *
 *   POST   /api/attachments          multipart: file + parentKind + parentId (+ optional id)
 *   GET    /api/attachments/:id      file bytes (auth + ACL)
 *   DELETE /api/attachments/:id      remove file + meta
 *   GET    /api/attachments?parentKind=&parentId=  list meta for a parent
 */
import { BodyTooLargeError, json, type ServerEvent } from "../../../lib/http.ts";
import { log } from "../../../lib/log.ts";
import { principalOf } from "../../../lib/principal.ts";
import { attachConfig } from "../../../lib/attachments/config.ts";
import { detectType, isInline } from "../../../lib/attachments/detect.ts";
import { canAccessMeta, canAccessParent } from "../../../lib/attachments/access.ts";
import { attachStore } from "../../../lib/attachments/store.ts";
import { safeDisplayName, validAttachId } from "../../../lib/attachments/names.ts";

const MAX_FIELDS = 16;

async function readUpload(req: Request, maxBytes: number): Promise<
  | { ok: true; bytes: Uint8Array; name: string; mime: string; parentKind: "task" | "project"; parentId: string; id?: string }
  | { ok: false; status: number; error: string; message?: string }
> {
  const type = (req.headers.get("content-type") ?? "").toLowerCase();
  if (!type.includes("multipart/form-data")) {
    return { ok: false, status: 415, error: "unsupported_media", message: "Нужен multipart/form-data." };
  }
  const declared = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes + 256 * 1024) {
    return { ok: false, status: 413, error: "too_large", message: "Файл слишком большой." };
  }
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return { ok: false, status: 400, error: "bad_multipart" };
  }
  if ([...form.keys()].length > MAX_FIELDS) return { ok: false, status: 400, error: "too_many_fields" };

  const file = form.get("file");
  if (!(file instanceof File)) return { ok: false, status: 400, error: "missing_file", message: "Нет файла." };
  if (file.size > maxBytes) return { ok: false, status: 413, error: "too_large", message: "Файл слишком большой." };

  const parentKindRaw = String(form.get("parentKind") ?? "");
  const parentId = String(form.get("parentId") ?? "");
  if ((parentKindRaw !== "task" && parentKindRaw !== "project") || !parentId || parentId.length > 200) {
    return { ok: false, status: 400, error: "bad_parent" };
  }
  const mime = (file.type || "application/octet-stream").toLowerCase().split(";")[0]!.trim();
  const idRaw = form.get("id");
  const id = typeof idRaw === "string" && validAttachId(idRaw) ? idRaw : undefined;
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength > maxBytes) return { ok: false, status: 413, error: "too_large" };
  return {
    ok: true,
    bytes,
    name: safeDisplayName(file.name || "файл"),
    mime,
    parentKind: parentKindRaw,
    parentId,
    id,
  };
}

export default async function attachmentsApi(event: ServerEvent): Promise<Response> {
  const user = principalOf(event);
  if (!user) return json(401, { error: "unauthorized" });
  const method = event.req.method.toUpperCase();
  const rest = event.url.pathname.replace(/^\/api\/attachments\/?/, "");
  const id = rest.split("/")[0] ?? "";
  const config = attachConfig();
  const store = attachStore();

  if (!id && method === "GET") {
    const parentKind = event.url.searchParams.get("parentKind");
    const parentId = event.url.searchParams.get("parentId") ?? "";
    if ((parentKind !== "task" && parentKind !== "project") || !parentId) {
      return json(400, { error: "bad_parent" });
    }
    const access = await canAccessParent(user, { kind: parentKind, id: parentId });
    if (!access.ok) return json(access.reason === "not_found" ? 404 : 403, { error: access.reason });
    const items = await store.listFor({ kind: parentKind, id: parentId });
    return json(200, { items });
  }

  if (!id && method === "POST") {
    let upload;
    try {
      upload = await readUpload(event.req, config.maxBytes);
    } catch (error) {
      if (error instanceof BodyTooLargeError) return json(413, { error: "too_large" });
      throw error;
    }
    if (!upload.ok) return json(upload.status, { error: upload.error, message: upload.message });
    // The bytes decide the type; what the phone claims is ignored.
    const detected = detectType(upload.bytes, upload.name);
    if (!detected || !config.allowed.has(detected)) {
      return json(415, { error: "bad_type", message: "Этот тип файла не принимается." });
    }
    upload.mime = detected;
    const access = await canAccessParent(user, { kind: upload.parentKind, id: upload.parentId });
    if (!access.ok) return json(access.reason === "not_found" ? 404 : 403, { error: access.reason });

    if (upload.id) {
      const existing = await store.get(upload.id);
      if (existing && existing.owner !== user.login) return json(409, { error: "id_taken" });
    }

    const meta = await store.put({
      owner: user.login,
      parent: { kind: upload.parentKind, id: upload.parentId },
      name: upload.name,
      mime: upload.mime,
      bytes: upload.bytes,
      id: upload.id,
    });
    log("info", "attach.uploaded", { user: user.login, id: meta.id, size: meta.size, mime: meta.mime });
    return json(201, { item: meta });
  }

  if (id && method === "GET") {
    if (!validAttachId(id)) return json(400, { error: "bad_id" });
    const meta = await store.get(id);
    if (!meta) return json(404, { error: "not_found" });
    const access = await canAccessMeta(user, meta);
    if (!access.ok) return json(access.reason === "not_found" ? 404 : 403, { error: access.reason });
    const bytes = await store.readBytes(id);
    if (!bytes) return json(404, { error: "missing_file" });
    const disposition = isInline(meta.mime) ? "inline" : "attachment";
    return new Response(Buffer.from(bytes), {
      status: 200,
      headers: {
        "content-type": meta.mime.startsWith("text/") ? `${meta.mime}; charset=utf-8` : meta.mime,
        "content-length": String(bytes.byteLength),
        "content-disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(meta.name)}`,
        "cache-control": "private, max-age=3600",
        "x-content-type-options": "nosniff",
        // PDF viewers break under a sandbox; everything else gets it.
        ...(meta.mime === "application/pdf" ? {} : { "content-security-policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox" }),
      },
    });
  }

  if (id && method === "DELETE") {
    if (!validAttachId(id)) return json(400, { error: "bad_id" });
    const meta = await store.get(id);
    if (!meta) return json(404, { error: "not_found" });
    const access = await canAccessMeta(user, meta);
    if (!access.ok) return json(access.reason === "not_found" ? 404 : 403, { error: access.reason });
    await store.remove(id);
    log("info", "attach.deleted", { user: user.login, id });
    return json(200, { ok: true });
  }

  return json(405, { error: "method_not_allowed" });
}
