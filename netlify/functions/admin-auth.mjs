// POST /api/admin/login     { username, password }
// POST /api/admin/logout
// GET  /api/admin/session
// POST /api/admin/password  { currentPassword, newPassword }   (signed-in only)
import {
  json, error, sameOrigin, checkLogin, sessionCookie, clearCookie, currentUser,
  getCredentials, changePassword,
} from "../lib/security.mjs";

async function body(req) {
  try { return await req.json(); } catch { return null; }
}

export default async (req, context) => {
  const action = new URL(req.url).pathname.split("/").pop();

  if (action === "session" && req.method === "GET") {
    const user = await currentUser(req);
    if (!user) return json({ authenticated: false, user: null });
    const cred = await getCredentials();
    return json({ authenticated: true, user, usingBuiltInPassword: cred.source === "built-in" });
  }

  if (req.method !== "POST") return error(405, "Method not allowed.");
  if (!sameOrigin(req)) return error(403, "Forbidden.");

  if (action === "logout") return json({ ok: true }, 200, { "Set-Cookie": clearCookie() });

  if (action === "login") {
    const b = await body(req);
    if (!b) return error(400, "Bad request.");
    const username = String(b.username ?? "").slice(0, 100);
    const password = String(b.password ?? "").slice(0, 200);
    if (!username || !password) return error(400, "Enter your username and password.");
    const result = await checkLogin(context.ip, username, password);
    if (!result.ok) return error(result.status, result.message);
    return json({ ok: true, user: result.user }, 200, { "Set-Cookie": await sessionCookie(result.user) });
  }

  if (action === "password") {
    const user = await currentUser(req);
    if (!user) return error(401, "Please log in.");
    const b = await body(req);
    if (!b) return error(400, "Bad request.");
    const result = await changePassword(context.ip, user,
      String(b.currentPassword ?? "").slice(0, 200), String(b.newPassword ?? "").slice(0, 201));
    if (!result.ok) return error(result.status, result.message);
    // The session key was rotated, so issue a fresh cookie for this browser.
    return json({ ok: true }, 200, { "Set-Cookie": await sessionCookie(result.user) });
  }

  return error(404, "Not found.");
};

export const config = { path: ["/api/admin/login", "/api/admin/logout", "/api/admin/session", "/api/admin/password"] };
