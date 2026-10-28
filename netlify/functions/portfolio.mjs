// GET /api/portfolio — public, visible items only.
import { json, error, loadItems, publicItem } from "../lib/security.mjs";

export default async req => {
  if (req.method !== "GET") return error(405, "Method not allowed.");
  const items = (await loadItems()).filter(i => i.visible).map(publicItem);
  return json({ projects: items }, 200, { "Cache-Control": "public, max-age=0, must-revalidate" });
};

export const config = { path: "/api/portfolio" };
