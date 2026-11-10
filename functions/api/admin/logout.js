// POST /api/admin/logout
import { json, error, sameOrigin, clearCookie } from "../../../lib/security.js";

export async function onRequestPost({ request }) {
  if (!sameOrigin(request)) return error(403, "Forbidden.");
  return json({ ok: true }, 200, { "Set-Cookie": clearCookie() });
}
