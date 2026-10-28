// POST /api/admin/login   { username, password }
// POST /api/admin/logout
// GET  /api/admin/session
import { json, error, sameOrigin, checkLogin, sessionCookie, clearCookie, currentUser } from "../lib/security.mjs";

export default async (req, context) => {
  const action = new URL(req.url).pathname.split("/").pop();

  if (action === "session" && req.method === "GET") {
    const user = currentUser(req);
    return json({ authenticated: !!user, user: user || null });
  }

  if (req.method !== "POST") return error(405, "Method not allowed.");
  if (!sameOrigin(req)) return error(403, "Forbidden.");

  if (action === "logout") return json({ ok: true }, 200, { "Set-Cookie": clearCookie() });

  if (action === "login") {
    let body;
    try { body = await req.json(); } catch { return error(400, "Bad request."); }
    const username = String(body?.username ?? "").slice(0, 100);
    const password = String(body?.password ?? "").slice(0, 200);
    if (!username || !password) return error(400, "Enter your username and password.");
    const result = await checkLogin(context.ip, username, password);
    if (!result.ok) return error(result.status, result.message);
    return json({ ok: true, user: result.user }, 200, { "Set-Cookie": sessionCookie(result.user) });
  }

  return error(404, "Not found.");
};

export const config = { path: ["/api/admin/login", "/api/admin/logout", "/api/admin/session"] };
