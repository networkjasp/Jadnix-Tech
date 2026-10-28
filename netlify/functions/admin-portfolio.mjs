// Admin-only portfolio management.
// GET    /api/admin/portfolio                 → all items (incl. hidden)
// POST   /api/admin/portfolio   (multipart)   → create   fields: title, category, year, description, url, visible, image?
// PUT    /api/admin/portfolio   (multipart)   → update   fields: id + the above, removeImage?
// PATCH  /api/admin/portfolio   (json)        → { id, action: "toggle" | "up" | "down" }
// DELETE /api/admin/portfolio   (json)        → { id }
import {
  json, error, requireAdmin, loadItems, saveItems, publicItem, validateItem,
  imageStore, sniffImage, MAX_IMAGE_BYTES, newId, ID_RE,
} from "../lib/security.mjs";

async function storeImage(file) {
  if (!file || typeof file === "string" || !file.size) return { id: null };
  if (file.size > MAX_IMAGE_BYTES) return { error: "Image is too large (max 3 MB)." };
  const buf = await file.arrayBuffer();
  const type = sniffImage(buf);
  if (!type) return { error: "Image must be a JPG, PNG or WEBP file." };
  const id = newId("img");
  await imageStore().set(id, buf, { metadata: { type } });
  return { id };
}
async function dropImage(id) { if (id) { try { await imageStore().delete(id); } catch {} } }

const all = items => json({ projects: items.map(publicItem) });

export default async req => {
  const denied = requireAdmin(req);
  if (denied) return denied;

  const items = await loadItems();

  if (req.method === "GET") return all(items);

  if (req.method === "POST" || req.method === "PUT") {
    let form;
    try { form = await req.formData(); } catch { return error(400, "Bad request."); }
    const fields = Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string"));
    const { item, error: msg } = validateItem(fields);
    if (msg) return error(400, msg);

    const img = await storeImage(form.get("image"));
    if (img.error) return error(400, img.error);

    if (req.method === "POST") {
      if (items.length >= 100) { await dropImage(img.id); return error(400, "Portfolio is full (100 items)."); }
      items.unshift({ id: newId("p"), ...item, imageId: img.id });
    } else {
      const id = String(fields.id || "");
      const idx = ID_RE.test(id) ? items.findIndex(i => i.id === id) : -1;
      if (idx < 0) { await dropImage(img.id); return error(404, "Item not found."); }
      const prev = items[idx];
      let imageId = prev.imageId;
      if (img.id) { await dropImage(prev.imageId); imageId = img.id; }
      else if (fields.removeImage === "true") { await dropImage(prev.imageId); imageId = null; }
      items[idx] = { ...prev, ...item, imageId };
    }
    await saveItems(items);
    return all(items);
  }

  if (req.method === "PATCH" || req.method === "DELETE") {
    let body;
    try { body = await req.json(); } catch { return error(400, "Bad request."); }
    const id = String(body?.id || "");
    const idx = ID_RE.test(id) ? items.findIndex(i => i.id === id) : -1;
    if (idx < 0) return error(404, "Item not found.");

    if (req.method === "DELETE") {
      const [removed] = items.splice(idx, 1);
      await dropImage(removed.imageId);
    } else if (body.action === "toggle") {
      items[idx].visible = !items[idx].visible;
    } else if (body.action === "up" || body.action === "down") {
      const to = body.action === "up" ? idx - 1 : idx + 1;
      if (to >= 0 && to < items.length) [items[idx], items[to]] = [items[to], items[idx]];
    } else {
      return error(400, "Unknown action.");
    }
    await saveItems(items);
    return all(items);
  }

  return error(405, "Method not allowed.");
};

export const config = { path: "/api/admin/portfolio" };
