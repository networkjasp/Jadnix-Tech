// GET /api/portfolio — public list of visible projects.
import { json, loadItems, publicItem, DEFAULT_ITEMS } from "../../lib/security.js";

export async function onRequestGet({ env }) {
  let items;
  try { items = await loadItems(env); }
  catch { items = DEFAULT_ITEMS; }                 // storage not connected yet: still show the default project
  return json({ projects: items.filter(i => i.visible).map(publicItem) }, 200, { "Cache-Control": "public, max-age=0, must-revalidate" });
}
