// Admin-only: contact form enquiries.
// GET    → newest first (up to 200)
// DELETE (json) { id }
import { json, error, safe, kv, requireAdmin, ID_RE } from "../../../lib/security.js";

export const onRequestGet = safe(async ({ env, request }) => {
  const denied = await requireAdmin({ env, request });
  if (denied) return denied;
  const keys = [];
  let cursor;
  do {
    const page = await kv(env).list({ prefix: "enquiry:", cursor, limit: 1000 });
    keys.push(...page.keys);
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor && keys.length < 1000);
  keys.sort((a, b) => String(b.metadata?.createdAt || "").localeCompare(String(a.metadata?.createdAt || "")));
  const items = (await Promise.all(keys.slice(0, 200).map(k => kv(env).get(k.name, { type: "json" })))).filter(Boolean);
  return json({ enquiries: items, total: keys.length });
});

export const onRequestDelete = safe(async ({ env, request }) => {
  const denied = await requireAdmin({ env, request });
  if (denied) return denied;
  let b; try { b = await request.json(); } catch { return error(400, "Bad request."); }
  const id = String(b?.id || "");
  if (!ID_RE.test(id)) return error(404, "Not found.");
  await kv(env).delete(`enquiry:${id}`);
  return json({ ok: true });
});
