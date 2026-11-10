// POST /api/admin/login  { username, password }
import { json, error, safe, sameOrigin, checkLogin, sessionCookie, clientIp } from "../../../lib/security.js";

export const onRequestPost = safe(async ({ env, request }) => {
  if (!sameOrigin(request)) return error(403, "Forbidden.");
  let b; try { b = await request.json(); } catch { return error(400, "Bad request."); }
  const username = String(b?.username ?? "").slice(0, 100);
  const password = String(b?.password ?? "").slice(0, 200);
  if (!username || !password) return error(400, "Enter your username and password.");
  const result = await checkLogin(env, clientIp(request), username, password);
  if (!result.ok) return error(result.status, result.message);
  return json({ ok: true, user: result.user }, 200, { "Set-Cookie": await sessionCookie(env, result.user) });
});
