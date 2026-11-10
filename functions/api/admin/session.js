// GET /api/admin/session
import { json, safe, currentUser, getCredentials } from "../../../lib/security.js";

export const onRequestGet = safe(async ({ env, request }) => {
  const user = await currentUser(env, request);
  if (!user) return json({ authenticated: false, user: null });
  const cred = await getCredentials(env);
  return json({ authenticated: true, user, usingBuiltInPassword: cred.source === "built-in" });
});
