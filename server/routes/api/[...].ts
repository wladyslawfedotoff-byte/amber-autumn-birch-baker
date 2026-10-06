import { json } from "../../lib/http.ts";

/** Unknown /api/* paths answer JSON 404 instead of the app's HTML. */
export default function apiNotFound(): Response {
  return json(404, { error: "not_found" });
}
