import { json } from "../../lib/http.ts";

/**
 * What optional features this server has (authenticated: not on the login
 * surface, so 01.auth requires a session). Never reveals the key itself.
 */
export default function capabilities(): Response {
  return json(200, { assistant: Boolean(process.env.XAI_API_KEY?.trim()) });
}
