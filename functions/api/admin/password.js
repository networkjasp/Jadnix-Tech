// POST /api/admin/password  { currentPassword, newPassword }   (signed-in only)
import { json, error, safe, sameOrigin, currentUser, changePassword, sessionCookie, clientIp } from "../../../lib/security.js";

export const onRequestPost = safe(async ({ env, request }) => {
  if (!sameOrigin(request)) return error(403, "Forbidden.");
  if (!(await currentUser(env, request))) return error(401, "Please log in.");
  let b; try { b = await request.json(); } catch { return error(400, "Bad request."); }
  const result = await changePassword(env, clientIp(request),
    String(b?.currentPassword ?? "").slice(0, 200), String(b?.newPassword ?? "").slice(0, 201));
  if (!result.ok) return error(result.status, result.message);
  // The session key was rotated, so give this browser a fresh cookie.
  return json({ ok: true }, 200, { "Set-Cookie": await sessionCookie(env, result.user) });
});
