// Admin-only portfolio management.
// GET    → all items (incl. hidden)
// POST   (multipart) → create   fields: title, category, year, description, url, visible, image?
// PUT    (multipart) → update   fields: id + the above, removeImage?
// PATCH  (json)      → { id, action: "toggle" | "up" | "down" }
// DELETE (json)      → { id }
import {
  json, error, safe, kv, requireAdmin, loadItems, saveItems, publicItem, validateItem,
  sniffImage, MAX_IMAGE_BYTES, newId, ID_RE,
} from "../../../lib/security.js";

async function storeImage(env, file) {
  if (!file || typeof file === "string" || !file.size) return { id: null };
  if (file.size > MAX_IMAGE_BYTES) return { error: "Image is too large (max 3 MB)." };
  const buf = await file.arrayBuffer();
  const type = sniffImage(buf);
  if (!type) return { error: "Image must be a JPG, PNG or WEBP file." };
  const id = newId("img");
  await kv(env).put(`image:${id}`, buf, { metadata: { type } });
  return { id };
}
async function dropImage(env, id) { if (id) { try { await kv(env).delete(`image:${id}`); } catch {} } }
const all = items => json({ projects: items.map(publicItem) });

export const onRequest = safe(async ({ env, request }) => {
  const denied = await requireAdmin({ env, request });
  if (denied) return denied;
  const items = await loadItems(env);
  const method = request.method;

  if (method === "GET") return all(items);

  if (method === "POST" || method === "PUT") {
    let form; try { form = await request.formData(); } catch { return error(400, "Bad request."); }
    const fields = Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string"));
    const { item, error: msg } = validateItem(fields);
    if (msg) return error(400, msg);
    const img = await storeImage(env, form.get("image"));
    if (img.error) return error(400, img.error);

    if (method === "POST") {
      if (items.length >= 100) { await dropImage(env, img.id); return error(400, "Portfolio is full (100 items)."); }
      items.unshift({ id: newId("p"), ...item, imageId: img.id });
    } else {
      const id = String(fields.id || "");
      const idx = ID_RE.test(id) ? items.findIndex(i => i.id === id) : -1;
      if (idx < 0) { await dropImage(env, img.id); return error(404, "Item not found."); }
      const prev = items[idx];
      let imageId = prev.imageId;
      if (img.id) { await dropImage(env, prev.imageId); imageId = img.id; }
      else if (fields.removeImage === "true") { await dropImage(env, prev.imageId); imageId = null; }
      items[idx] = { ...prev, ...item, imageId };
    }
    await saveItems(env, items);
    return all(items);
  }

  if (method === "PATCH" || method === "DELETE") {
    let b; try { b = await request.json(); } catch { return error(400, "Bad request."); }
    const id = String(b?.id || "");
    const idx = ID_RE.test(id) ? items.findIndex(i => i.id === id) : -1;
    if (idx < 0) return error(404, "Item not found.");
    if (method === "DELETE") {
      const [removed] = items.splice(idx, 1);
      await dropImage(env, removed.imageId);
    } else if (b.action === "toggle") {
      items[idx].visible = !items[idx].visible;
    } else if (b.action === "up" || b.action === "down") {
      const to = b.action === "up" ? idx - 1 : idx + 1;
      if (to >= 0 && to < items.length) [items[idx], items[to]] = [items[to], items[idx]];
    } else {
      return error(400, "Unknown action.");
    }
    await saveItems(env, items);
    return all(items);
  }
  return error(405, "Method not allowed.");
});
